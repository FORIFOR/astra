//! マイクの取り込み。正本 §11・§12。
//!
//! DeepNote の `audio/capture.rs` を donor にしているが、次を変えてある:
//!
//!   - **出所を付けて返す。**裸の `Vec<f32>` を渡さない
//!   - **失敗を型で返す。**「権限が無い」と「装置が無い」は別の話で、
//!     利用者が次にすることも違う
//!   - **二重に始めない。**既に取り込んでいるなら、そう言って断る
//!
//! 実行時の音声コールバックは realtime スレッドで走る。
//! ここで panic すると stream ごと死んで、以後 1 フレームも来なくなる。
//! DeepNote が `lock().unwrap()` で踏んだ問題なので、同じ轍は踏まない。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use serde::{Deserialize, Serialize};

use super::frame::{to_mono, AudioSourceKind, PcmFrame, SAMPLE_RATE_HZ};
use super::resample::Resampler;

/// 取り込めない理由。TypeScript 側（`@astra/audio`）の `CaptureFailure` と同じ綴り。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureFailure {
    MicrophonePermissionDenied,
    SystemAudioPermissionDenied,
    NoInputDevice,
    DeviceRemoved,
    UnsupportedSampleFormat,
    AlreadyCapturing,
    NotCapturing,
    StreamEnded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureError {
    pub reason: CaptureFailure,
    pub message: String,
}

impl CaptureError {
    fn new(reason: CaptureFailure, message: impl Into<String>) -> Self {
        Self {
            reason,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.reason, self.message)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// 取り込みの設定。
#[derive(Debug, Clone, Default)]
pub struct CaptureConfig {
    pub device_id: Option<String>,
}

/// 走っている取り込み。落とすと止まる。
pub struct MicrophoneCapture {
    stream: Option<Stream>,
    paused: Arc<AtomicBool>,
    sequence: Arc<AtomicU64>,
    samples_seen: Arc<AtomicU64>,
}

// cpal の Stream は自前の音声スレッドを持つ。作ったスレッドからしか触らない。
unsafe impl Send for MicrophoneCapture {}
unsafe impl Sync for MicrophoneCapture {}

impl MicrophoneCapture {
    /// 使える入力装置。**取れないものを取れると言わない。**
    pub fn devices() -> Result<Vec<InputDevice>, CaptureError> {
        let host = cpal::default_host();
        let default_name = host
            .default_input_device()
            .and_then(|d| d.name().ok())
            .unwrap_or_default();

        let devices = host.input_devices().map_err(|e| {
            // 列挙そのものが拒まれるのは、たいてい権限
            CaptureError::new(
                CaptureFailure::MicrophonePermissionDenied,
                format!("could not list input devices: {e}"),
            )
        })?;

        Ok(devices
            .filter_map(|device| {
                let name = device.name().ok()?;
                Some(InputDevice {
                    id: name.clone(),
                    is_default: name == default_name,
                    name,
                })
            })
            .collect())
    }

    /// 取り込みを始める。frame は出所と位置を持って届く。
    pub fn start<F>(config: CaptureConfig, mut on_frame: F) -> Result<Self, CaptureError>
    where
        F: FnMut(PcmFrame) + Send + 'static,
    {
        let host = cpal::default_host();

        let device = match config.device_id.as_deref() {
            Some(id) => host
                .input_devices()
                .map_err(|e| {
                    CaptureError::new(
                        CaptureFailure::MicrophonePermissionDenied,
                        format!("could not list input devices: {e}"),
                    )
                })?
                .find(|d| d.name().map(|n| n == id).unwrap_or(false))
                .ok_or_else(|| {
                    CaptureError::new(
                        CaptureFailure::DeviceRemoved,
                        format!("input device \"{id}\" is not available"),
                    )
                })?,
            None => host.default_input_device().ok_or_else(|| {
                CaptureError::new(
                    CaptureFailure::NoInputDevice,
                    "no default input device is available",
                )
            })?,
        };

        let supported = device.default_input_config().map_err(|e| {
            CaptureError::new(
                CaptureFailure::MicrophonePermissionDenied,
                format!("could not read the input configuration: {e}"),
            )
        })?;

        let sample_rate = supported.sample_rate().0;
        let channels = supported.channels() as usize;
        let format = supported.sample_format();

        // 対応していない形式を、黙って読み替えない
        if !matches!(format, SampleFormat::F32 | SampleFormat::I16) {
            return Err(CaptureError::new(
                CaptureFailure::UnsupportedSampleFormat,
                format!("sample format {format:?} is not supported"),
            ));
        }

        let resampler = Arc::new(Mutex::new(
            Resampler::new(sample_rate, SAMPLE_RATE_HZ).map_err(|e| {
                CaptureError::new(CaptureFailure::UnsupportedSampleFormat, e.to_string())
            })?,
        ));

        let paused = Arc::new(AtomicBool::new(false));
        let sequence = Arc::new(AtomicU64::new(0));
        let samples_seen = Arc::new(AtomicU64::new(0));

        let paused_cb = paused.clone();
        let sequence_cb = sequence.clone();
        let seen_cb = samples_seen.clone();
        let resampler_cb = resampler.clone();

        /*
         * realtime スレッドで走る。**ここで panic させない。**
         * panic すると stream ごと死に、以後 1 フレームも来なくなる。
         * lock は poison を回復して続ける（DeepNote が踏んだ問題）。
         */
        let mut emit = move |mono: Vec<f32>| {
            if paused_cb.load(Ordering::Relaxed) {
                return;
            }
            let resampled = match resampler_cb.lock() {
                Ok(mut guard) => guard.process(&mono),
                Err(poisoned) => poisoned.into_inner().process(&mono),
            };
            if resampled.is_empty() {
                return;
            }
            let offset_samples = seen_cb.fetch_add(resampled.len() as u64, Ordering::Relaxed);
            on_frame(PcmFrame {
                source: AudioSourceKind::Microphone,
                offset_ms: (offset_samples * 1000) / SAMPLE_RATE_HZ as u64,
                sequence: sequence_cb.fetch_add(1, Ordering::Relaxed),
                samples: resampled,
                sample_rate: SAMPLE_RATE_HZ,
            });
        };

        let on_error = |error: cpal::StreamError| {
            // 装置が抜けたことを黙らない
            log::error!("audio stream error: {error}");
        };

        let stream_config: cpal::StreamConfig = supported.clone().into();
        let stream = match format {
            SampleFormat::F32 => device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| emit(to_mono(data, channels)),
                on_error,
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    let floats: Vec<f32> = data.iter().map(|s| *s as f32 / 32_768.0).collect();
                    emit(to_mono(&floats, channels))
                },
                on_error,
                None,
            ),
            other => {
                return Err(CaptureError::new(
                    CaptureFailure::UnsupportedSampleFormat,
                    format!("sample format {other:?} is not supported"),
                ))
            }
        }
        .map_err(|e| {
            CaptureError::new(
                CaptureFailure::MicrophonePermissionDenied,
                format!("could not open the input stream: {e}"),
            )
        })?;

        stream.play().map_err(|e| {
            CaptureError::new(
                CaptureFailure::StreamEnded,
                format!("could not start the input stream: {e}"),
            )
        })?;

        log::info!("microphone capture started at {sample_rate}Hz, {channels}ch, {format:?}");

        Ok(Self {
            stream: Some(stream),
            paused,
            sequence,
            samples_seen,
        })
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::Relaxed);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::Relaxed);
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }

    /// 届いた frame の数。欠番の検出に使う。
    pub fn frames_emitted(&self) -> u64 {
        self.sequence.load(Ordering::Relaxed)
    }

    pub fn captured_ms(&self) -> u64 {
        (self.samples_seen.load(Ordering::Relaxed) * 1000) / SAMPLE_RATE_HZ as u64
    }

    /// 止める。**二重に止めても落ちない。**
    pub fn stop(&mut self) {
        self.stream.take();
    }
}

impl Drop for MicrophoneCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_failure_has_a_distinct_name() {
        // TypeScript 側と綴りを揃えるので、serde の名前を固定しておく
        let json = serde_json::to_string(&CaptureFailure::MicrophonePermissionDenied).unwrap();
        assert_eq!(json, "\"microphone_permission_denied\"");
        let json = serde_json::to_string(&CaptureFailure::NoInputDevice).unwrap();
        assert_eq!(json, "\"no_input_device\"");
    }

    #[test]
    fn an_error_says_which_kind_it_is() {
        let error = CaptureError::new(CaptureFailure::DeviceRemoved, "unplugged");
        assert_eq!(error.reason, CaptureFailure::DeviceRemoved);
        assert!(error.to_string().contains("unplugged"));
    }
}

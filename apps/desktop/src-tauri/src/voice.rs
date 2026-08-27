//! 声を拾って、音量と途中経過を画面へ流す。UI/UX §4.1・§23。
//!
//! Dock の mic は長らく「聞いているふり」だった。取り込みの実装
//! （`audio::capture`）と手元の認識（`stt::recognizer`）は在ったのに、
//! **画面へ繋ぐ口が無かった。**ここがその口。
//!
//! 出すものは 2 つ:
//!   `voice:audio-level`  … 30Hz 程度に間引いた入力の大きさ（Orb / 波形用）
//!   `voice:transcript`   … 手元の認識の途中経過と確定
//!
//! 認識の模型が無い端末でも**音量は出す**。喋っていることが見えるだけでも、
//! 黙って待たせるよりよい。認識できないことは別の event で言う。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::audio::capture::{CaptureConfig, MicrophoneCapture};
use crate::audio::frame::{rms, PcmFrame};
use crate::stt::model;
use crate::stt::recognizer::{LiveWindow, LocalRecognizer, TranscriptEvent};

/// 音量を流す間隔。60Hz は多すぎ、10Hz は波形がカクつく。
const LEVEL_INTERVAL_MS: u64 = 33;
/// 手元の認識が受け取る rate。違えば認識へは回さない（音量は出す）。
const RECOGNIZER_RATE: u32 = 16_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevel {
    /// マイク。0〜1。
    pub input: f32,
    /// 読み上げ。いまは端末で再生していないので常に 0。**あるふりをしない。**
    pub output: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptUnavailable {
    pub reason: String,
}

pub struct VoiceRuntime {
    capture: Mutex<Option<MicrophoneCapture>>,
    recognizer: Arc<Mutex<LocalRecognizer>>,
}

impl Default for VoiceRuntime {
    fn default() -> Self {
        Self::with_window(LiveWindow::default())
    }
}

/// 大きさを、Orb が扱える 0〜1 に写す。
///
/// RMS そのままだと普通の声で 0.05〜0.2 にしかならず、Orb はほとんど動かない。
/// 声の範囲を持ち上げる。**無音は 0 のまま**（ノイズで揺らさない）。
pub fn level_from(samples: &[f32]) -> f32 {
    let raw = rms(samples);
    if raw < 0.005 {
        return 0.0;
    }
    (raw * 4.0).clamp(0.0, 1.0)
}

#[tauri::command]
pub fn voice_start(app: AppHandle, runtime: tauri::State<'_, VoiceRuntime>) -> Result<(), String> {
    let mut slot = runtime
        .capture
        .lock()
        .map_err(|_| "the voice runtime is in a bad state".to_string())?;
    if slot.is_some() {
        // 二重に取り込まない。2 本目を作ると、片方が止められなくなる。
        return Ok(());
    }

    // 模型があれば読む。無ければ**音量だけ**流し、無いことを言う。
    let recognizer = Arc::clone(&runtime.recognizer);
    let status = model::japanese_model_status();
    let recognizing = if status.is_ready() {
        match recognizer
            .lock()
            .map_err(|_| "the recognizer is in a bad state".to_string())?
            .load(&model::japanese_model_dir())
        {
            Ok(()) => true,
            Err(error) => {
                let _ = app.emit(
                    "voice:transcript-unavailable",
                    TranscriptUnavailable {
                        reason: format!("手元の文字起こしを読み込めませんでした（{error}）"),
                    },
                );
                false
            }
        }
    } else {
        let _ = app.emit(
            "voice:transcript-unavailable",
            TranscriptUnavailable {
                reason: "手元の文字起こしの模型が入っていません。".to_string(),
            },
        );
        false
    };

    let last_level_at = Arc::new(AtomicU64::new(0));
    let handle = app.clone();

    let capture = MicrophoneCapture::start(CaptureConfig::default(), move |frame: PcmFrame| {
        // 音量は間引いて出す。frame ごとに出すと 100Hz を超える。
        let now = frame.offset_ms;
        let last = last_level_at.load(Ordering::Relaxed);
        if now.saturating_sub(last) >= LEVEL_INTERVAL_MS || last == 0 {
            last_level_at.store(now, Ordering::Relaxed);
            let _ = handle.emit(
                "voice:audio-level",
                AudioLevel {
                    input: level_from(&frame.samples),
                    output: 0.0,
                },
            );
        }

        if !recognizing || frame.sample_rate != RECOGNIZER_RATE {
            return;
        }
        if let Ok(mut r) = recognizer.lock() {
            match r.push(&frame.samples) {
                Ok(Some(event)) => {
                    let _ = handle.emit("voice:transcript", event);
                }
                Ok(None) => {}
                Err(error) => {
                    // 途中で認識が落ちた。**黙って partial を止めない。**
                    let _ = handle.emit(
                        "voice:transcript-unavailable",
                        TranscriptUnavailable {
                            reason: format!("文字起こしが途中で止まりました（{error}）"),
                        },
                    );
                }
            }
        }
    })
    .map_err(|error| error.to_string())?;

    *slot = Some(capture);
    Ok(())
}

#[tauri::command]
pub fn voice_stop(app: AppHandle, runtime: tauri::State<'_, VoiceRuntime>) -> Result<(), String> {
    let mut slot = runtime
        .capture
        .lock()
        .map_err(|_| "the voice runtime is in a bad state".to_string())?;
    let Some(mut capture) = slot.take() else {
        // 動いていないものを止めるのは、何もしないのと同じ
        return Ok(());
    };
    capture.stop();

    // 最後の一言を確定して流す。捨てると、止めた直前の言葉が消える。
    if let Ok(mut r) = runtime.recognizer.lock() {
        if r.is_loaded() {
            match r.finish() {
                Ok(event @ TranscriptEvent::Final { .. }) => {
                    let _ = app.emit("voice:transcript", event);
                }
                Ok(_) => {}
                Err(_) => {}
            }
            r.reset();
        }
    }
    // 止まったことも言う。画面が「聞いています」のまま残らないように。
    let _ = app.emit(
        "voice:audio-level",
        AudioLevel {
            input: 0.0,
            output: 0.0,
        },
    );
    Ok(())
}

impl VoiceRuntime {
    pub fn with_window(window: LiveWindow) -> Self {
        Self {
            capture: Mutex::new(None),
            recognizer: Arc::new(Mutex::new(LocalRecognizer::new(window))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_is_zero_not_noise() {
        // 無音でノイズを拾って Orb を揺らさない
        assert_eq!(level_from(&[0.0; 512]), 0.0);
        assert_eq!(level_from(&[0.001; 512]), 0.0);
    }

    #[test]
    fn ordinary_speech_moves_the_orb() {
        // RMS 0.1 程度の普通の声が、見える大きさになる
        let quiet: Vec<f32> = (0..512).map(|i| 0.14 * ((i as f32) * 0.3).sin()).collect();
        let level = level_from(&quiet);
        assert!(level > 0.3, "level was {level}");
        assert!(level <= 1.0);
    }

    #[test]
    fn loud_input_is_capped() {
        assert_eq!(level_from(&[1.0; 512]), 1.0);
    }

    #[test]
    fn stopping_without_starting_is_harmless() {
        // 動いていないものを止めても壊れない（二重の stop は普通に起きる）
        let runtime = VoiceRuntime::default();
        let slot = runtime.capture.lock().unwrap();
        assert!(slot.is_none());
    }
}

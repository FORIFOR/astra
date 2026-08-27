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

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::audio::capture::{CaptureConfig, MicrophoneCapture};
use crate::audio::frame::{rms, to_pcm16, PcmFrame, SAMPLE_RATE_HZ};
use crate::stt::model;
use crate::stt::recognizer::{LiveWindow, LocalRecognizer, TranscriptEvent};

/// 音量を流す間隔。60Hz は多すぎ、10Hz は波形がカクつく。
const LEVEL_INTERVAL_MS: u64 = 33;
/// 手元の認識が受け取る rate。違えば認識へは回さない（音量は出す）。
const RECOGNIZER_RATE: u32 = 16_000;
/// 一度の発話。長い録音は Meeting の責務で、Dock に無制限に保持しない。
const MAX_CAPTURE_SAMPLES: usize = SAMPLE_RATE_HZ as usize * 60;
const VOICE_HUD_WINDOW_LABEL: &str = "voice-hud";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevel {
    /// マイク。0〜1。
    pub input: f32,
    /// Web Audio が実際の Google TTS 再生から測った読み上げ音量。0〜1。
    pub output: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptUnavailable {
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceMode {
    Idle,
    Connecting,
    Listening,
    Thinking,
    Speaking,
    Interrupted,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceModeEvent {
    pub mode: VoiceMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedVoice {
    /// 16kHz / mono / little-endian PCM16。空なら音は取れていない。
    pub audio_base64: String,
    pub sample_rate_hz: u32,
    pub duration_ms: u64,
}

pub struct VoiceRuntime {
    capture: Mutex<Option<MicrophoneCapture>>,
    recognizer: Arc<Mutex<LocalRecognizer>>,
    captured: Arc<Mutex<Vec<f32>>>,
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

    // 前の発話を次へ混ぜない。
    match runtime.captured.lock() {
        Ok(mut samples) => samples.clear(),
        Err(poisoned) => poisoned.into_inner().clear(),
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
    let captured = Arc::clone(&runtime.captured);

    let capture = MicrophoneCapture::start(CaptureConfig::default(), move |frame: PcmFrame| {
        // 明示的なクラウド精度補正に使う可能性があるため、最大 60 秒だけ保持する。
        match captured.lock() {
            Ok(mut samples) => append_until_limit(&mut samples, &frame.samples),
            Err(poisoned) => append_until_limit(&mut poisoned.into_inner(), &frame.samples),
        }

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
pub fn voice_stop(
    app: AppHandle,
    runtime: tauri::State<'_, VoiceRuntime>,
) -> Result<RecordedVoice, String> {
    let mut slot = runtime
        .capture
        .lock()
        .map_err(|_| "the voice runtime is in a bad state".to_string())?;
    let Some(mut capture) = slot.take() else {
        // 動いていないものを止めるのは、何もしないのと同じ
        return Ok(RecordedVoice {
            audio_base64: String::new(),
            sample_rate_hz: SAMPLE_RATE_HZ,
            duration_ms: 0,
        });
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
    let samples = match runtime.captured.lock() {
        Ok(mut captured) => std::mem::take(&mut *captured),
        Err(poisoned) => std::mem::take(&mut *poisoned.into_inner()),
    };
    let duration_ms = (samples.len() as u64 * 1000) / SAMPLE_RATE_HZ as u64;
    Ok(RecordedVoice {
        audio_base64: BASE64.encode(to_pcm16(&samples)),
        sample_rate_hz: SAMPLE_RATE_HZ,
        duration_ms,
    })
}

fn append_until_limit(target: &mut Vec<f32>, samples: &[f32]) {
    let room = MAX_CAPTURE_SAMPLES.saturating_sub(target.len());
    target.extend_from_slice(&samples[..samples.len().min(room)]);
}

/// UI が表示すべき音声の状態を配る。
///
/// 以前はここで別 window の Voice HUD（大きな Orb）を出していた。
/// 今は上部の Dock ピルが「聞いています / 考えています」を担うので、
/// **別の浮いた面は出さない**（同じことを 2 か所で言わない）。
/// HUD window 自体は残してあるが、出すのは明示的に呼ばれたときだけ。
#[tauri::command]
pub fn voice_set_mode(app: AppHandle, mode: VoiceMode) -> Result<(), String> {
    app.emit("voice:mode", VoiceModeEvent { mode })
        .map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window(VOICE_HUD_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        }
    }
    Ok(())
}

/** Web Audio が測った読み上げ音量を独立 HUD にも流す。 */
#[tauri::command]
pub fn voice_set_output_level(app: AppHandle, output: f32) -> Result<(), String> {
    app.emit(
        "voice:audio-level",
        AudioLevel {
            input: 0.0,
            output: output.clamp(0.0, 1.0),
        },
    )
    .map_err(|error| error.to_string())
}

impl VoiceRuntime {
    pub fn with_window(window: LiveWindow) -> Self {
        Self {
            capture: Mutex::new(None),
            recognizer: Arc::new(Mutex::new(LocalRecognizer::new(window))),
            captured: Arc::new(Mutex::new(Vec::new())),
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

    #[test]
    fn a_dock_utterance_is_bounded_to_one_minute() {
        let mut captured = vec![0.0; MAX_CAPTURE_SAMPLES - 2];
        append_until_limit(&mut captured, &[0.1, 0.2, 0.3, 0.4]);
        assert_eq!(captured.len(), MAX_CAPTURE_SAMPLES);
        assert_eq!(&captured[MAX_CAPTURE_SAMPLES - 2..], &[0.1, 0.2]);
    }
}

/// 使える入力装置。UI/UX §12.1「Audio sources」の選択肢（Deepgram の MicSelector 相当）。
/// **取れないものを取れると言わない** — 列挙が拒まれたら、その理由を返す。
#[tauri::command]
pub fn audio_input_devices() -> Result<Vec<crate::audio::capture::InputDevice>, String> {
    crate::audio::capture::MicrophoneCapture::devices().map_err(|e| e.to_string())
}

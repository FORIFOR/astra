//! 会議の音声パイプライン（端末側）。実装仕様 §3、正本 §25。
//!
//! ```text
//! Mic ─▶ PcmFrame(16 kHz f32) ─▶ i16 LE ─┬─▶ ローカル断片（5 秒ごと）+ manifest.json
//!                                        └─▶ WebSocket /v1/meetings/:id/audio
//! ```
//!
//! **ローカルが先、クラウドは後。**音は先に手元へ残し、送るのはその写し。
//! 回線が切れても取り込みは止めない（オフライン保存）。戻ったら未送信分から順に送る。
//! アプリが落ちても manifest が `recording` のまま断片が残るので、次回起動で回復できる。
//!
//! 送り先の WebSocket は upgrade 時に `Authorization: Bearer` が要る。webview の
//! `WebSocket` はヘッダを付けられないので、ここ（Rust）から張る。

use std::collections::VecDeque;
use std::fs;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tungstenite::client::IntoClientRequest;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

use crate::audio::capture::{CaptureConfig, MicrophoneCapture};
use crate::audio::frame::PcmFrame;
use crate::audio::resample::Resampler;

/// 再接続の待ち。1s → 2s → … → 10s。
const RECONNECT_MIN: Duration = Duration::from_secs(1);
const RECONNECT_MAX: Duration = Duration::from_secs(10);
/// 停止時、未送信分を送り切るまで待つ上限。
const DRAIN_TIMEOUT: Duration = Duration::from_secs(15);

// ---------------------------------------------------------------- manifest

// OS 非依存の断片モデル・wire 変換・回復は astra-core に一本化した（§8: 二重実装を避ける）。
use astra_core::{
    scan_recoverable_path, to_wire, Journal, JournalState, LinkState, RecoverableMeeting,
    FRAGMENT_MS, WIRE_SAMPLE_RATE,
};

/// 会議の保存先。ASTRA_MEETINGS_DIR も含め astra-core の既定に委ねる。
fn meetings_root() -> std::path::PathBuf {
    astra_core::meetings_root_default()
}

/// frontend へ配る接続状態イベント（Tauri 固有のシリアライズ。core の LinkState を包む）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkEvent {
    meeting_id: String,
    state: LinkState,
    /// まだ送れていない音の長さ。オフラインの間に増える。
    pending_ms: u64,
}

enum Outbound {
    Audio(Vec<u8>),
    Control(String),
    Stop,
}

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

fn connect(base_url: &str, meeting_id: &str, token: &str) -> Result<Socket, String> {
    let ws_base = base_url
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
    let url = format!(
        "{}/v1/meetings/{}/audio",
        ws_base.trim_end_matches('/'),
        meeting_id
    );
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("bad audio url: {e}"))?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {token}")
            .parse()
            .map_err(|_| "token is not a valid header value".to_string())?,
    );
    let (socket, _) = tungstenite::connect(request).map_err(|e| e.to_string())?;
    Ok(socket)
}

/// 送信スレッド。順番を守り、切れたら溜めて、戻ったら続きから。
fn uploader(
    app: AppHandle,
    meeting_id: String,
    base_url: String,
    token: Arc<Mutex<String>>,
    rx: Receiver<Outbound>,
) {
    let mut pending: VecDeque<Outbound> = VecDeque::new();
    let mut socket: Option<Socket> = None;
    let mut backoff = RECONNECT_MIN;
    let mut next_attempt = Instant::now();
    let mut stopping: Option<Instant> = None;
    let mut last_state: Option<LinkState> = None;

    let emit = |state: LinkState, pending_ms: u64, last: &mut Option<LinkState>| {
        if *last == Some(state) && state == LinkState::Online {
            return;
        }
        *last = Some(state);
        let _ = app.emit(
            "meeting:link",
            LinkEvent {
                meeting_id: meeting_id.clone(),
                state,
                pending_ms,
            },
        );
    };
    let pending_ms = |q: &VecDeque<Outbound>| -> u64 {
        q.iter()
            .map(|m| match m {
                Outbound::Audio(b) => (b.len() as u64) * 1000 / (WIRE_SAMPLE_RATE as u64 * 2),
                _ => 0,
            })
            .sum()
    };

    emit(LinkState::Connecting, 0, &mut last_state);

    loop {
        // 取り込みからの新着。止まっている間も受け続ける（捨てない）
        loop {
            match rx.try_recv() {
                Ok(Outbound::Stop) => {
                    stopping.get_or_insert_with(Instant::now);
                    break;
                }
                Ok(item) => pending.push_back(item),
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    stopping.get_or_insert_with(Instant::now);
                    break;
                }
            }
        }

        if socket.is_none() && Instant::now() >= next_attempt {
            let current = token.lock().map(|t| t.clone()).unwrap_or_default();
            match connect(&base_url, &meeting_id, &current) {
                Ok(s) => {
                    socket = Some(s);
                    backoff = RECONNECT_MIN;
                    emit(LinkState::Online, pending_ms(&pending), &mut last_state);
                }
                Err(error) => {
                    log::warn!("meeting audio link down ({error}); keeping audio locally");
                    next_attempt = Instant::now() + backoff;
                    backoff = (backoff * 2).min(RECONNECT_MAX);
                    emit(
                        if last_state == Some(LinkState::Connecting) {
                            LinkState::Offline
                        } else {
                            LinkState::Reconnecting
                        },
                        pending_ms(&pending),
                        &mut last_state,
                    );
                }
            }
        }

        if let Some(s) = socket.as_mut() {
            while let Some(item) = pending.pop_front() {
                let message = match &item {
                    Outbound::Audio(bytes) => Message::Binary(bytes.clone().into()),
                    Outbound::Control(text) => Message::Text(text.clone().into()),
                    Outbound::Stop => continue,
                };
                if let Err(error) = s.send(message) {
                    // 送れなかったものは先頭に戻す。順番を崩さない
                    pending.push_front(item);
                    log::warn!("meeting audio send failed ({error}); will reconnect");
                    socket = None;
                    next_attempt = Instant::now() + backoff;
                    emit(LinkState::Reconnecting, pending_ms(&pending), &mut last_state);
                    break;
                }
            }
        }

        if let Some(since) = stopping {
            let drained = pending.is_empty();
            if drained || since.elapsed() > DRAIN_TIMEOUT {
                if !drained {
                    log::warn!(
                        "meeting audio: {} ms left unsent after stop; kept in the local journal",
                        pending_ms(&pending)
                    );
                }
                if let Some(mut s) = socket.take() {
                    let _ = s.close(None);
                }
                let _ = app.emit(
                    "meeting:link",
                    LinkEvent {
                        meeting_id: meeting_id.clone(),
                        state: if drained {
                            LinkState::Online
                        } else {
                            LinkState::Offline
                        },
                        pending_ms: pending_ms(&pending),
                    },
                );
                return;
            }
        }

        std::thread::sleep(Duration::from_millis(20));
    }
}

// ---------------------------------------------------------------- runtime

struct Session {
    meeting_id: String,
    capture: MicrophoneCapture,
    tx: Sender<Outbound>,
    journal: Arc<Mutex<Journal>>,
    token: Arc<Mutex<String>>,
    paused: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct MeetingRuntime {
    session: Mutex<Option<Session>>,
}

#[tauri::command]
pub fn meeting_capture_start(
    app: AppHandle,
    runtime: tauri::State<'_, MeetingRuntime>,
    meeting_id: String,
    base_url: String,
    token: String,
) -> Result<(), String> {
    let mut slot = runtime
        .session
        .lock()
        .map_err(|_| "meeting runtime is in a bad state".to_string())?;
    if slot.is_some() {
        return Err("a meeting is already being recorded".to_string());
    }

    let journal = Journal::create(&meetings_root(), &meeting_id, WIRE_SAMPLE_RATE)
        .map_err(|e| format!("could not open the local journal: {e}"))?;
    let journal = Arc::new(Mutex::new(journal));
    let token = Arc::new(Mutex::new(token));
    let (tx, rx) = mpsc::channel::<Outbound>();
    let paused = Arc::new(AtomicBool::new(false));

    {
        let app = app.clone();
        let meeting_id = meeting_id.clone();
        let base_url = base_url.clone();
        let token = Arc::clone(&token);
        std::thread::Builder::new()
            .name("meeting-audio-uploader".into())
            .spawn(move || uploader(app, meeting_id, base_url, token, rx))
            .map_err(|e| e.to_string())?;
    }

    let frame_tx = tx.clone();
    let frame_journal = Arc::clone(&journal);
    let frame_paused = Arc::clone(&paused);
    let mut resampler: Option<Resampler> = None;
    let capture = MicrophoneCapture::start(CaptureConfig::default(), move |frame: PcmFrame| {
        if frame_paused.load(Ordering::Relaxed) {
            return;
        }
        let samples: Vec<f32> = if frame.sample_rate == WIRE_SAMPLE_RATE {
            frame.samples
        } else {
            let r = resampler.get_or_insert_with(|| {
                Resampler::new(frame.sample_rate, WIRE_SAMPLE_RATE)
                    .expect("resampler for the wire rate")
            });
            r.process(&frame.samples)
        };
        if samples.is_empty() {
            return;
        }
        let bytes = to_wire(samples);
        // ローカルが先。書けなかったことは黙らない（送るのは続ける）
        if let Ok(mut j) = frame_journal.lock() {
            if let Err(error) = j.append(&bytes) {
                log::warn!("meeting journal write failed ({error})");
            }
        }
        let _ = frame_tx.send(Outbound::Audio(bytes));
    })
    .map_err(|e| e.to_string())?;

    *slot = Some(Session {
        meeting_id,
        capture,
        tx,
        journal,
        token,
        paused,
    });
    Ok(())
}

/// access token は 15 分で切れる。長い会議では画面側が新しいものを渡す。
#[tauri::command]
pub fn meeting_capture_token(
    runtime: tauri::State<'_, MeetingRuntime>,
    token: String,
) -> Result<(), String> {
    let slot = runtime
        .session
        .lock()
        .map_err(|_| "meeting runtime is in a bad state".to_string())?;
    if let Some(session) = slot.as_ref() {
        if let Ok(mut t) = session.token.lock() {
            *t = token;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn meeting_capture_pause(
    runtime: tauri::State<'_, MeetingRuntime>,
    paused: bool,
) -> Result<(), String> {
    let slot = runtime
        .session
        .lock()
        .map_err(|_| "meeting runtime is in a bad state".to_string())?;
    let Some(session) = slot.as_ref() else {
        return Ok(());
    };
    session.paused.store(paused, Ordering::Relaxed);
    let control = if paused { "pause" } else { "resume" };
    let _ = session
        .tx
        .send(Outbound::Control(format!("{{\"type\":\"{control}\"}}")));
    Ok(())
}

/// 取り込みを止め、未送信分を送り切ってから閉じる。送り切れなかった分は手元に残る。
#[tauri::command]
pub fn meeting_capture_stop(runtime: tauri::State<'_, MeetingRuntime>) -> Result<(), String> {
    let mut slot = runtime
        .session
        .lock()
        .map_err(|_| "meeting runtime is in a bad state".to_string())?;
    let Some(mut session) = slot.take() else {
        return Ok(());
    };
    session.capture.stop();
    if let Ok(mut j) = session.journal.lock() {
        // 端数の断片も閉じる。送信が終わっていなくても「取り込みは完了」
        let _ = j.finish(JournalState::Completed);
    }
    let _ = session.tx.send(Outbound::Stop);
    Ok(())
}

#[tauri::command]
pub fn meeting_recoverable(runtime: tauri::State<'_, MeetingRuntime>) -> Vec<RecoverableMeeting> {
    let active = runtime
        .session
        .lock()
        .ok()
        .and_then(|s| s.as_ref().map(|x| x.meeting_id.clone()));
    scan_recoverable_path(&meetings_root(), active.as_deref())
}

/// 手元に残った断片を、続きから送り直す。
#[tauri::command]
pub fn meeting_reupload(
    app: AppHandle,
    meeting_id: String,
    base_url: String,
    token: String,
) -> Result<u64, String> {
    let mut journal = Journal::open(&meetings_root(), &meeting_id).map_err(|e| e.to_string())?;
    let mut socket = connect(&base_url, &meeting_id, &token)?;
    let first = journal.manifest().last_uploaded_seq + 1;
    let last = journal.manifest().last_audio_seq;
    let mut sent_ms = 0u64;
    for seq in first..=last {
        let bytes = journal.read_fragment(seq).map_err(|e| e.to_string())?;
        socket
            .send(Message::Binary(bytes.into()))
            .map_err(|e| format!("re-upload stopped at fragment {seq}: {e}"))?;
        journal.mark_uploaded(seq).map_err(|e| e.to_string())?;
        sent_ms += FRAGMENT_MS;
        let _ = app.emit(
            "meeting:link",
            LinkEvent {
                meeting_id: meeting_id.clone(),
                state: LinkState::Online,
                pending_ms: (last - seq) * FRAGMENT_MS,
            },
        );
    }
    let _ = socket.close(None);
    journal
        .finish(JournalState::Uploaded)
        .map_err(|e| e.to_string())?;
    Ok(sent_ms)
}

#[tauri::command]
pub fn meeting_discard(meeting_id: String) -> Result<(), String> {
    let dir = meetings_root().join(&meeting_id);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

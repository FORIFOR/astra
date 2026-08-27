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
use std::io::Write;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tungstenite::client::IntoClientRequest;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

use crate::audio::capture::{CaptureConfig, MicrophoneCapture};
use crate::audio::frame::PcmFrame;
use crate::audio::resample::Resampler;

/// gateway が期待する形（contracts の AUDIO_SAMPLE_RATE_HZ）。
pub const WIRE_SAMPLE_RATE: u32 = 16_000;
/// 断片 1 つの長さ。短いほど落ちたときの欠けが小さく、長いほどファイル数が少ない。
pub const FRAGMENT_MS: u64 = 5_000;
const FRAGMENT_BYTES: usize = (WIRE_SAMPLE_RATE as usize * 2 * FRAGMENT_MS as usize) / 1000;
/// 再接続の待ち。1s → 2s → … → 10s。
const RECONNECT_MIN: Duration = Duration::from_secs(1);
const RECONNECT_MAX: Duration = Duration::from_secs(10);
/// 停止時、未送信分を送り切るまで待つ上限。
const DRAIN_TIMEOUT: Duration = Duration::from_secs(15);

// ---------------------------------------------------------------- manifest

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JournalState {
    Recording,
    Completed,
    Uploaded,
}

/// `meetings/<id>/manifest.json`。**これが残っていれば回復できる。**
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub meeting_id: String,
    pub state: JournalState,
    pub sample_rate: u32,
    pub started_at: String,
    /// 書いた断片の最後の番号（1 始まり、0 は未書き込み）。
    pub last_audio_seq: u64,
    /// 送り終えた断片の最後の番号。
    pub last_uploaded_seq: u64,
}

pub fn meetings_root() -> PathBuf {
    if let Ok(explicit) = std::env::var("ASTRA_MEETINGS_DIR") {
        if !explicit.trim().is_empty() {
            return PathBuf::from(explicit);
        }
    }
    dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Astra")
        .join("meetings")
}

fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // RFC 3339 風（秒精度）。時刻の見せ方は画面側が決める
    format!("{secs}")
}

/// ローカルの断片書き込み。5 秒ごとに `mic/NNNNNN.pcm` を閉じ、manifest を進める。
pub struct Journal {
    dir: PathBuf,
    manifest: Manifest,
    buffer: Vec<u8>,
}

impl Journal {
    pub fn create(root: &Path, meeting_id: &str, sample_rate: u32) -> std::io::Result<Self> {
        let dir = root.join(meeting_id);
        fs::create_dir_all(dir.join("mic"))?;
        let manifest = Manifest {
            meeting_id: meeting_id.to_string(),
            state: JournalState::Recording,
            sample_rate,
            started_at: now_iso(),
            last_audio_seq: 0,
            last_uploaded_seq: 0,
        };
        let journal = Self {
            dir,
            manifest,
            buffer: Vec::with_capacity(FRAGMENT_BYTES),
        };
        journal.write_manifest()?;
        Ok(journal)
    }

    pub fn open(root: &Path, meeting_id: &str) -> std::io::Result<Self> {
        let dir = root.join(meeting_id);
        let manifest: Manifest =
            serde_json::from_slice(&fs::read(dir.join("manifest.json"))?).map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
            })?;
        Ok(Self {
            dir,
            manifest,
            buffer: Vec::new(),
        })
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn fragment_path(&self, seq: u64) -> PathBuf {
        self.dir.join("mic").join(format!("{seq:06}.pcm"))
    }

    /// manifest は一時ファイルに書いてから置き換える。途中で落ちても壊れた JSON を残さない。
    fn write_manifest(&self) -> std::io::Result<()> {
        let path = self.dir.join("manifest.json");
        let tmp = self.dir.join("manifest.json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&self.manifest)?)?;
        fs::rename(tmp, path)
    }

    /// 音を足す。断片が満ちたら閉じて番号を進める。閉じた断片の番号を返す。
    pub fn append(&mut self, bytes: &[u8]) -> std::io::Result<Vec<u64>> {
        let mut closed = Vec::new();
        let mut rest = bytes;
        while !rest.is_empty() {
            let room = FRAGMENT_BYTES - self.buffer.len();
            let take = room.min(rest.len());
            self.buffer.extend_from_slice(&rest[..take]);
            rest = &rest[take..];
            if self.buffer.len() >= FRAGMENT_BYTES {
                closed.push(self.flush()?);
            }
        }
        Ok(closed)
    }

    /// 溜まっている分を断片として閉じる。
    fn flush(&mut self) -> std::io::Result<u64> {
        let seq = self.manifest.last_audio_seq + 1;
        let mut file = fs::File::create(self.fragment_path(seq))?;
        file.write_all(&self.buffer)?;
        file.sync_all()?;
        self.buffer.clear();
        self.manifest.last_audio_seq = seq;
        self.write_manifest()?;
        Ok(seq)
    }

    pub fn mark_uploaded(&mut self, seq: u64) -> std::io::Result<()> {
        if seq > self.manifest.last_uploaded_seq {
            self.manifest.last_uploaded_seq = seq;
            self.write_manifest()?;
        }
        Ok(())
    }

    /// 取り込みを終える。端数も断片にして、状態を進める。
    pub fn finish(&mut self, state: JournalState) -> std::io::Result<()> {
        if !self.buffer.is_empty() {
            self.flush()?;
        }
        self.manifest.state = state;
        self.write_manifest()
    }

    pub fn read_fragment(&self, seq: u64) -> std::io::Result<Vec<u8>> {
        fs::read(self.fragment_path(seq))
    }

    /// 残っている音の長さ（ミリ秒）。
    pub fn recorded_ms(&self) -> u64 {
        self.manifest.last_audio_seq * FRAGMENT_MS
    }
}

/// 前回落ちたまま残っている会議。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recoverable {
    pub meeting_id: String,
    pub started_at: String,
    pub recorded_ms: u64,
    pub uploaded_ms: u64,
}

pub fn scan_recoverable(root: &Path, active: Option<&str>) -> Vec<Recoverable> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let id = entry.file_name().to_string_lossy().to_string();
        if active == Some(id.as_str()) {
            continue;
        }
        let Ok(journal) = Journal::open(root, &id) else {
            continue;
        };
        let m = journal.manifest();
        // 完了している（state が進んでいる）ものは回復の対象ではない
        if m.state == JournalState::Uploaded {
            continue;
        }
        if m.last_audio_seq == 0 {
            continue;
        }
        found.push(Recoverable {
            meeting_id: id,
            started_at: m.started_at.clone(),
            recorded_ms: m.last_audio_seq * FRAGMENT_MS,
            uploaded_ms: m.last_uploaded_seq * FRAGMENT_MS,
        });
    }
    found.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    found
}

// ---------------------------------------------------------------- wire

/// f32 mono → 16-bit LE。gateway は `byteLength / 2 / 16000` で時刻を数える。
pub fn to_wire(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkState {
    Connecting,
    Online,
    Offline,
    Reconnecting,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkEvent {
    meeting_id: String,
    state: LinkState,
    /// まだ送れていない音の長さ。オフラインの間に増える
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
        let bytes = to_wire(&samples);
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
pub fn meeting_recoverable(runtime: tauri::State<'_, MeetingRuntime>) -> Vec<Recoverable> {
    let active = runtime
        .session
        .lock()
        .ok()
        .and_then(|s| s.as_ref().map(|x| x.meeting_id.clone()));
    scan_recoverable(&meetings_root(), active.as_deref())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("astra-meeting-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn wire_is_16bit_little_endian_mono() {
        let bytes = to_wire(&[0.0, 1.0, -1.0]);
        assert_eq!(bytes.len(), 6);
        assert_eq!(&bytes[2..4], &i16::MAX.to_le_bytes());
        assert_eq!(&bytes[4..6], &(-i16::MAX).to_le_bytes());
    }

    #[test]
    fn journal_closes_a_fragment_every_five_seconds_and_keeps_the_rest_on_finish() {
        let root = temp_root("fragments");
        let mut j = Journal::create(&root, "m1", WIRE_SAMPLE_RATE).unwrap();
        // 5 秒 + 1 秒
        let closed = j.append(&vec![0u8; FRAGMENT_BYTES + FRAGMENT_BYTES / 5]).unwrap();
        assert_eq!(closed, vec![1]);
        assert_eq!(j.manifest().last_audio_seq, 1);
        assert!(root.join("m1/mic/000001.pcm").exists());

        j.finish(JournalState::Completed).unwrap();
        assert_eq!(j.manifest().last_audio_seq, 2);
        assert_eq!(j.read_fragment(2).unwrap().len(), FRAGMENT_BYTES / 5);
        let reopened = Journal::open(&root, "m1").unwrap();
        assert_eq!(reopened.manifest().state, JournalState::Completed);
    }

    #[test]
    fn a_crashed_recording_is_recoverable_until_it_is_uploaded() {
        let root = temp_root("recover");
        let mut j = Journal::create(&root, "crashed", WIRE_SAMPLE_RATE).unwrap();
        j.append(&vec![0u8; FRAGMENT_BYTES * 2]).unwrap();
        // finish を呼ばずに落ちた想定（state は recording のまま）
        drop(j);
        let found = scan_recoverable(&root, None);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].meeting_id, "crashed");
        assert_eq!(found[0].recorded_ms, 2 * FRAGMENT_MS);
        assert_eq!(found[0].uploaded_ms, 0);

        // 今まさに録っている会議は回復の対象にしない
        assert!(scan_recoverable(&root, Some("crashed")).is_empty());

        let mut again = Journal::open(&root, "crashed").unwrap();
        again.mark_uploaded(2).unwrap();
        again.finish(JournalState::Uploaded).unwrap();
        assert!(scan_recoverable(&root, None).is_empty());
    }

    #[test]
    fn manifest_survives_a_partial_write() {
        let root = temp_root("atomic");
        let j = Journal::create(&root, "m", WIRE_SAMPLE_RATE).unwrap();
        // 途中で落ちた一時ファイルが残っていても manifest.json は前の版のまま読める
        fs::write(j.dir().join("manifest.json.tmp"), b"{ broken").unwrap();
        assert!(Journal::open(&root, "m").is_ok());
    }
}

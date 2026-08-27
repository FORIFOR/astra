//! 会議録音の OS 非依存モデル。断片台帳・回復・wire 変換・表示派生。
//!
//! `apps/desktop/src-tauri/src/meeting.rs` から純粋な部分を移したもの（OS 依存の
//! マイク取り込み・WebSocket・Tauri command はあちら側に残す）。macOS/Windows で共用する。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::mode::AstraMode;

/// gateway が期待する形（contracts の AUDIO_SAMPLE_RATE_HZ）。
pub const WIRE_SAMPLE_RATE: u32 = 16_000;
/// 断片 1 つの長さ。短いほど落ちたときの欠けが小さい。
pub const FRAGMENT_MS: u64 = 5_000;
const FRAGMENT_BYTES: usize = (WIRE_SAMPLE_RATE as usize * 2 * FRAGMENT_MS as usize) / 1000;

// ---------------------------------------------------------------- wire

/// f32 mono → 16-bit LE。gateway は `byteLength / 2 / 16000` で時刻を数える。
/// macOS(AVAudioEngine) / Windows(WASAPI) のどちらの PCM もここで同じ形にする。
#[uniffi::export]
pub fn to_wire(samples: Vec<f32>) -> Vec<u8> {
    wire_bytes(&samples)
}

/// slice 版（内部・C ABI 用）。
pub(crate) fn wire_bytes(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// 依存を増やさない線形リサンプラ（16 kHz 以外の入力を wire レートへ）。
pub(crate) fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = to as f64 / from as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let j = src.floor() as usize;
        let frac = (src - j as f64) as f32;
        let a = input.get(j).copied().unwrap_or(0.0);
        let b = input.get(j + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}

/// 00:00 / 1:02:03 の形。UI はこれを使い、各言語で書き直さない。
#[uniffi::export]
pub fn format_elapsed(ms: u64) -> String {
    let total = ms / 1000;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

// ---------------------------------------------------------------- link + snapshot

/// 端末 → gateway の音声の接続。offline の間も手元の断片には残っている。
#[derive(uniffi::Enum, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkState {
    Connecting,
    Online,
    Offline,
    Reconnecting,
}

/// 録音の生の状態（UI から core へ渡す入力）。
#[derive(uniffi::Record, Clone, Debug)]
pub struct RecordingInput {
    pub elapsed_ms: u64,
    pub is_paused: bool,
    pub link: LinkState,
    /// まだ送れていない音の長さ。オフラインの間に増える。
    pub pending_ms: u64,
}

/// UI が描くために必要な、派生済みの表示（core が唯一の実装）。
#[derive(uniffi::Record, Clone, Debug, PartialEq, Eq)]
pub struct RecordingSnapshot {
    pub mode: AstraMode,
    /// 04:21。
    pub elapsed_label: String,
    /// 録音中 / 一時停止中。
    pub hero_text: String,
    /// オフライン保存中… / 空。
    pub link_text: String,
    /// 未送信 約N秒 / 空。
    pub pending_label: String,
    /// 送り先に届いていない（手元には残っている）。
    pub unsynced: bool,
}

/// 生の状態 → 表示。Dock/HUD の分岐を各言語で二重に書かないための単一実装（§8）。
#[uniffi::export]
pub fn recording_snapshot(input: RecordingInput) -> RecordingSnapshot {
    let unsynced = matches!(input.link, LinkState::Offline | LinkState::Reconnecting);
    let pending_label = if input.pending_ms > 0 {
        format!("未送信 約{}秒", input.pending_ms.div_ceil(1000))
    } else {
        String::new()
    };
    RecordingSnapshot {
        mode: if input.is_paused {
            AstraMode::RecordingPaused
        } else {
            AstraMode::Recording
        },
        elapsed_label: format_elapsed(input.elapsed_ms),
        hero_text: if input.is_paused { "一時停止中" } else { "録音中" }.to_string(),
        link_text: if unsynced { "オフライン保存中…" } else { "" }.to_string(),
        pending_label,
        unsynced,
    }
}

// ---------------------------------------------------------------- journal (plain Rust)

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JournalState {
    Recording,
    Completed,
    Uploaded,
}

/// `meetings/<id>/manifest.json`。これが残っていれば回復できる。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub meeting_id: String,
    pub state: JournalState,
    pub sample_rate: u32,
    pub started_at: String,
    pub last_audio_seq: u64,
    pub last_uploaded_seq: u64,
}

/// 既定の保存先（Application Support/Astra/meetings）。OS の data dir を使う。
pub fn meetings_root_default() -> PathBuf {
    if let Ok(explicit) = std::env::var("ASTRA_MEETINGS_DIR") {
        if !explicit.trim().is_empty() {
            return PathBuf::from(explicit);
        }
    }
    dirs_data_local()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Astra")
        .join("meetings")
}

/// `dirs` に依存しない最小の data-local 解決（macOS/Windows/Linux）。
fn dirs_data_local() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join("Library").join("Application Support"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
    }
}

fn now_secs() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

/// 断片書き込みと manifest の進行。fs のみで OS 非依存。
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
            started_at: now_secs(),
            last_audio_seq: 0,
            last_uploaded_seq: 0,
        };
        let journal = Self { dir, manifest, buffer: Vec::with_capacity(FRAGMENT_BYTES) };
        journal.write_manifest()?;
        Ok(journal)
    }

    pub fn open(root: &Path, meeting_id: &str) -> std::io::Result<Self> {
        let dir = root.join(meeting_id);
        let manifest: Manifest = serde_json::from_slice(&fs::read(dir.join("manifest.json"))?)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
        Ok(Self { dir, manifest, buffer: Vec::new() })
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

    /// manifest は一時ファイル→rename。途中で落ちても壊れた JSON を残さない。
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

    pub fn recorded_ms(&self) -> u64 {
        self.manifest.last_audio_seq * FRAGMENT_MS
    }
}

/// 前回落ちたまま残っている会議。
#[derive(uniffi::Record, Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoverableMeeting {
    pub meeting_id: String,
    pub started_at: String,
    pub recorded_ms: u64,
    pub uploaded_ms: u64,
}

/// 手元に残ったまま完了していない録音を集める（plain）。
pub fn scan_recoverable_path(root: &Path, active: Option<&str>) -> Vec<RecoverableMeeting> {
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
        if m.state == JournalState::Uploaded || m.last_audio_seq == 0 {
            continue;
        }
        found.push(RecoverableMeeting {
            meeting_id: id,
            started_at: m.started_at.clone(),
            recorded_ms: m.last_audio_seq * FRAGMENT_MS,
            uploaded_ms: m.last_uploaded_seq * FRAGMENT_MS,
        });
    }
    found.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    found
}

/// 会議の journal を「アップロード済み」に印す。gateway へ送り終えたら呼ぶ。
/// これをしないと scan_recoverable が毎回その会議を回復候補に出し、二重アップロードになる。
#[uniffi::export]
pub fn mark_meeting_uploaded(root: String, meeting_id: String) -> bool {
    match Journal::open(&std::path::PathBuf::from(root), &meeting_id) {
        Ok(mut journal) => journal.finish(JournalState::Uploaded).is_ok(),
        Err(_) => false,
    }
}

/// UniFFI 向け（String path）。Swift/C# から回復候補を引く。
#[uniffi::export]
pub fn scan_recoverable(root: String, active: Option<String>) -> Vec<RecoverableMeeting> {
    scan_recoverable_path(Path::new(&root), active.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("astra-core-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn wire_is_16bit_little_endian_mono() {
        let bytes = to_wire(vec![0.0, 1.0, -1.0]);
        assert_eq!(bytes.len(), 6);
        assert_eq!(&bytes[2..4], &i16::MAX.to_le_bytes());
        assert_eq!(&bytes[4..6], &(-i16::MAX).to_le_bytes());
    }

    #[test]
    fn elapsed_gains_hours_only_when_needed() {
        assert_eq!(format_elapsed(0), "00:00");
        assert_eq!(format_elapsed(261_000), "04:21");
        assert_eq!(format_elapsed(3_723_000), "1:02:03");
    }

    #[test]
    fn snapshot_says_offline_while_the_link_is_down_but_stays_recording() {
        let snap = recording_snapshot(RecordingInput {
            elapsed_ms: 261_000,
            is_paused: false,
            link: LinkState::Reconnecting,
            pending_ms: 12_000,
        });
        assert_eq!(snap.mode, AstraMode::Recording);
        assert_eq!(snap.elapsed_label, "04:21");
        assert_eq!(snap.hero_text, "録音中");
        assert_eq!(snap.link_text, "オフライン保存中…");
        assert_eq!(snap.pending_label, "未送信 約12秒");
        assert!(snap.unsynced);
    }

    #[test]
    fn snapshot_paused_is_not_offline() {
        let snap = recording_snapshot(RecordingInput {
            elapsed_ms: 1000,
            is_paused: true,
            link: LinkState::Online,
            pending_ms: 0,
        });
        assert_eq!(snap.mode, AstraMode::RecordingPaused);
        assert_eq!(snap.hero_text, "一時停止中");
        assert_eq!(snap.link_text, "");
        assert!(!snap.unsynced);
    }

    #[test]
    fn journal_closes_a_fragment_every_five_seconds_and_keeps_the_rest_on_finish() {
        let root = temp_root("fragments");
        let mut j = Journal::create(&root, "m1", WIRE_SAMPLE_RATE).unwrap();
        let closed = j.append(&vec![0u8; FRAGMENT_BYTES + FRAGMENT_BYTES / 5]).unwrap();
        assert_eq!(closed, vec![1]);
        j.finish(JournalState::Completed).unwrap();
        assert_eq!(j.manifest().last_audio_seq, 2);
        assert_eq!(j.read_fragment(2).unwrap().len(), FRAGMENT_BYTES / 5);
    }

    #[test]
    fn a_crashed_recording_is_recoverable_until_it_is_uploaded() {
        let root = temp_root("recover");
        let mut j = Journal::create(&root, "crashed", WIRE_SAMPLE_RATE).unwrap();
        j.append(&vec![0u8; FRAGMENT_BYTES * 2]).unwrap();
        drop(j);
        let found = scan_recoverable(root.to_string_lossy().to_string(), None);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].meeting_id, "crashed");
        assert_eq!(found[0].recorded_ms, 2 * FRAGMENT_MS);
        assert!(scan_recoverable(root.to_string_lossy().to_string(), Some("crashed".into())).is_empty());
    }

    #[test]
    fn manifest_survives_a_partial_write() {
        let root = temp_root("atomic");
        let j = Journal::create(&root, "m", WIRE_SAMPLE_RATE).unwrap();
        fs::write(j.dir().join("manifest.json.tmp"), b"{ broken").unwrap();
        assert!(Journal::open(&root, "m").is_ok());
    }
}

//! 会議録音の実行時セッション。マイクの PCM を受け取り、断片として実ファイルに書く。
//!
//! **OS 非依存の実運用経路。** macOS(AVAudioEngine) / Windows(WASAPI) はここへ f32 サンプルを渡すだけ。
//! 断片化・manifest・回復は core が持つ（各言語で書き直さない）。
//! 送信（WebSocket）は OS 側に残す（回線・認証は core の外）。

use std::path::PathBuf;
use std::sync::Mutex;

use crate::mode::AstraMode;
use crate::recording::{
    format_elapsed, resample_linear, wire_bytes, Journal, JournalState, LinkState,
    RecordingSnapshot, WIRE_SAMPLE_RATE,
};

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum SessionError {
    #[error("could not open the local journal: {message}")]
    Journal { message: String },
}

struct Inner {
    journal: Journal,
    paused: bool,
    /// 送信済みの目安（OS 側が uploaded を伝えたら進める）。
    link: LinkState,
    pending_ms: u64,
}

/// 実行時セッション（UniFFI object）。Swift/C# は Arc として持つ。
#[derive(uniffi::Object)]
pub struct RecordingSession {
    meeting_id: String,
    inner: Mutex<Inner>,
}

#[uniffi::export]
impl RecordingSession {
    /// 保存先 root と会議 id を渡して開始。断片は root/<id>/mic/NNNNNN.pcm に貯まる。
    #[uniffi::constructor]
    pub fn start(root: String, meeting_id: String) -> Result<std::sync::Arc<Self>, SessionError> {
        let journal = Journal::create(&PathBuf::from(root), &meeting_id, WIRE_SAMPLE_RATE)
            .map_err(|e| SessionError::Journal { message: e.to_string() })?;
        Ok(std::sync::Arc::new(Self {
            meeting_id,
            inner: Mutex::new(Inner {
                journal,
                paused: false,
                link: LinkState::Connecting,
                pending_ms: 0,
            }),
        }))
    }

    pub fn meeting_id(&self) -> String {
        self.meeting_id.clone()
    }

    /// マイクの f32 mono を渡す。sample_rate が 16 kHz でなければ core が寄せる。
    /// 一時停止中は捨てる。書けた断片数（この呼び出しで閉じた数）を返す。
    pub fn push_samples(&self, samples: Vec<f32>, sample_rate: u32) -> u32 {
        let mut inner = self.inner.lock().unwrap();
        if inner.paused {
            return 0;
        }
        let resampled = resample_linear(&samples, sample_rate, WIRE_SAMPLE_RATE);
        let bytes = wire_bytes(&resampled);
        match inner.journal.append(&bytes) {
            Ok(closed) => closed.len() as u32,
            Err(_) => 0,
        }
    }

    pub fn set_paused(&self, paused: bool) {
        self.inner.lock().unwrap().paused = paused;
    }

    /// OS 側の送信状態を反映（表示用）。
    pub fn set_link(&self, link: LinkState, pending_ms: u64) {
        let mut inner = self.inner.lock().unwrap();
        inner.link = link;
        inner.pending_ms = pending_ms;
    }

    /// 今の表示。経過は書けた断片から数える（壁時計に依存しない）。
    pub fn snapshot(&self) -> RecordingSnapshot {
        let inner = self.inner.lock().unwrap();
        let elapsed_ms = inner.journal.recorded_ms();
        let unsynced = matches!(inner.link, LinkState::Offline | LinkState::Reconnecting);
        RecordingSnapshot {
            mode: if inner.paused {
                AstraMode::RecordingPaused
            } else {
                AstraMode::Recording
            },
            elapsed_label: format_elapsed(elapsed_ms),
            hero_text: if inner.paused { "一時停止中" } else { "録音中" }.to_string(),
            link_text: if unsynced { "オフライン保存中…" } else { "" }.to_string(),
            pending_label: if inner.pending_ms > 0 {
                format!("未送信 約{}秒", inner.pending_ms.div_ceil(1000))
            } else {
                String::new()
            },
            unsynced,
        }
    }

    pub fn recorded_ms(&self) -> u64 {
        self.inner.lock().unwrap().journal.recorded_ms()
    }

    /// 取り込みを終える。端数も断片にして、状態を completed に。
    pub fn finish(&self) -> Result<(), SessionError> {
        let mut inner = self.inner.lock().unwrap();
        inner
            .journal
            .finish(JournalState::Completed)
            .map_err(|e| SessionError::Journal { message: e.to_string() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recording::scan_recoverable_path;
    use std::path::Path;

    fn temp_root(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("astra-sess-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn resamples_toward_the_wire_rate() {
        use crate::recording::resample_linear;
        let up = resample_linear(&[0.0, 1.0], 8_000, 16_000);
        assert_eq!(up.len(), 4);
        assert_eq!(resample_linear(&[0.2, 0.4], 16_000, 16_000), vec![0.2, 0.4]);
    }

    #[test]
    fn a_session_writes_real_fragments_and_is_recoverable() {
        let root = temp_root("write");
        let session = RecordingSession::start(root.clone(), "m1".into()).unwrap();
        // 6 秒相当（16k * 6）の無音を 16 kHz で渡す → 5 秒断片が 1 つ閉じる
        let one_second = vec![0.0f32; WIRE_SAMPLE_RATE as usize];
        let mut closed = 0;
        for _ in 0..6 {
            closed += session.push_samples(one_second.clone(), WIRE_SAMPLE_RATE);
        }
        assert_eq!(closed, 1, "one 5s fragment should have closed");
        assert_eq!(session.snapshot().elapsed_label, "00:05");

        // 一時停止中は捨てる
        session.set_paused(true);
        assert_eq!(session.push_samples(one_second.clone(), WIRE_SAMPLE_RATE), 0);
        session.set_paused(false);

        session.finish().unwrap();
        // 実ファイルが在る
        assert!(Path::new(&root).join("m1/mic/000001.pcm").exists());
        // 未完了として回復候補に出る（uploaded まで進んでいない）
        let rec = scan_recoverable_path(Path::new(&root), None);
        assert_eq!(rec.len(), 1);
        assert_eq!(rec[0].meeting_id, "m1");
    }

    #[test]
    fn snapshot_reflects_link_state() {
        let root = temp_root("link");
        let session = RecordingSession::start(root, "m".into()).unwrap();
        session.set_link(LinkState::Reconnecting, 8_000);
        let snap = session.snapshot();
        assert_eq!(snap.link_text, "オフライン保存中…");
        assert_eq!(snap.pending_label, "未送信 約8秒");
        assert!(snap.unsynced);
    }
}

//! Astra の対話モード。両 OS の UI 状態機械の共通語彙（正本 §3・手書き案）。
//!
//! Swift の VoiceHUDState / RecordingWorkspaceState と、Windows の同等 state が同じ enum を使い、
//! 「macOS では録音中、Windows では Idle」のような実装差を防ぐ。

/// UI framework 非依存の対話モード。
#[derive(uniffi::Enum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AstraMode {
    /// 何もしていない（上部ピル）。
    Idle,
    /// 押している間だけ聞いている。
    Listening,
    /// 依頼を考えている。
    Thinking,
    /// 会議を録っている（下部 Recording Workspace）。
    Recording,
    /// 録音を一時停止。
    RecordingPaused,
    /// 停止直後、保存している。
    Processing,
}

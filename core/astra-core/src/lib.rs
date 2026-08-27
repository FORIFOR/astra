//! Astra Shared Core。OS も UI framework も知らない純ロジック。
//!
//! 二つの顔を持つ:
//!   - **plain Rust API**（`Journal` など）: Tauri（`apps/desktop/src-tauri`）が path 依存で使う。
//!   - **UniFFI API**（`#[uniffi::export]` の record/enum/fn）: macOS Swift / Windows C# が使う。
//!
//! ここに `AppHandle` / WebviewWindow / Tauri command / plugin を入れない。
//! OS 依存（マイク取り込み・WebSocket・window）は各アプリ側に残す。

uniffi::setup_scaffolding!();

pub mod mode;
pub mod api;
pub mod capi;
pub mod context;
pub mod recording;
pub mod session;

pub use api::{
    api_create_meeting, api_dev_sign_in, api_finish_meeting, api_me, api_reachable,
    api_create_task, api_plugin_catalog, api_send_turn, api_start_conversation, api_task_status,
    api_upload_meeting_audio, api_wait_task, ApiError, Me, TaskStatus, TurnOutcome, Tokens,
};
pub use context::{rank_context, ContextCandidate, ContextQuery, ContextResult, ContextSource};
pub use mode::AstraMode;
pub use session::{RecordingSession, SessionError};
pub use recording::{
    format_elapsed, meetings_root_default, recording_snapshot, scan_recoverable,
    scan_recoverable_path, to_wire, Journal,
    JournalState, LinkState, Manifest, RecordingInput, RecordingSnapshot, RecoverableMeeting,
    FRAGMENT_MS, WIRE_SAMPLE_RATE,
};

/// バージョン。Swift ↔ Rust の疎通確認（round trip）の入口にも使う。
#[uniffi::export]
pub fn astra_core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

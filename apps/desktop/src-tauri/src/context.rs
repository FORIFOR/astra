//! ローカル文脈の取得。正本 §6.2、UI/UX §5。
//!
//! **ここが返すのは「今回の依頼で使う候補」だけ。**
//! アクセスできる全データの一覧を返さない（UI/UX §5.2）。
//!
//! Phase 1 の範囲は前面アプリの識別まで。選択テキスト・画面領域・
//! ファイル索引は OS の権限（accessibility / screen recording）を
//! 利用直前に purpose-first で要求する必要があるため、後続で足す（§22）。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct LocalContext {
    /// 前面アプリの表示名。取れなければ None。
    pub active_app: Option<String>,
    /// window のタイトル。accessibility 権限が要るので Phase 1 では常に None。
    pub window_title: Option<String>,
    /// この端末で追加の権限なしに取れた情報かどうか。
    pub requires_permission: Vec<String>,
}

impl Default for LocalContext {
    fn default() -> Self {
        Self {
            active_app: None,
            window_title: None,
            // §22: 権限は利用直前に purpose-first で要求する。
            // ここでは「何が足りないか」を返すだけで、要求はしない。
            requires_permission: vec!["accessibility".to_string()],
        }
    }
}

#[cfg(target_os = "macos")]
fn frontmost_app() -> Option<String> {
    use std::process::Command;
    // NSWorkspace を叩くために AppKit を丸ごと持ち込むより、
    // Phase 1 の範囲ではこの一行で足りる。置き換え可能なように関数を分けてある。
    let output = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

#[cfg(not(target_os = "macos"))]
fn frontmost_app() -> Option<String> {
    None
}

/// 前面アプリを含む最小の文脈を返す。
///
/// 取れなかった項目は None のままにする。**推測で埋めない。**
/// Context Lens は「Astra が実際に見たもの」を映す面なので、
/// 埋め草を入れるとその意味が壊れる。
#[tauri::command]
pub fn context_snapshot() -> LocalContext {
    LocalContext {
        active_app: frontmost_app(),
        ..LocalContext::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_what_it_could_not_reach_instead_of_guessing() {
        let context = LocalContext::default();
        assert!(context.window_title.is_none());
        assert!(context
            .requires_permission
            .contains(&"accessibility".to_string()));
    }
}

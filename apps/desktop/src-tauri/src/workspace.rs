//! Dock から本体（Workspace）へ渡す。UI/UX §2.2・§4.4。
//!
//! Dock の「詳しく見る」が押せる形で在るのに、**押しても何も起きなかった。**
//! 本体の窓を前に出し、どの仕事を開くかを伝える。
//!
//! ここは窓を出すだけ。何を見せるかは TypeScript 側が決める
//! （`astra://open-task` を受けて、その仕事へ移る）。

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenTask {
    task_id: Option<String>,
}

/// 本体を前に出し、開く仕事を伝える。**Dock は消さない。**
/// 消すかどうかは Dock 側が決める（§4.4: Dismiss と Cancel を分ける）。
#[tauri::command]
pub fn workspace_open(app: AppHandle, task_id: Option<String>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "the workspace window is not there".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    // 出せなかったことを飲み込まない。飲み込むと「押したのに何も起きない」になる。
    app.emit("astra://open-task", OpenTask { task_id })
        .map_err(|e| e.to_string())
}

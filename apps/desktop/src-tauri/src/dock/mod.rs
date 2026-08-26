//! Task Dock の window 管理。UI/UX §4。
//!
//! Dock は通常の window ではなく「OS のどこからでも出せる薄い層」。
//! main window とは別 window にして、常に最前面・装飾なし・透過で置く。

pub mod geometry;
mod geometry_generated;
mod state;

pub use geometry::{DockState, Position, Rect};
pub use state::DockPlacementMemory;

use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const DOCK_WINDOW_LABEL: &str = "dock";

/// Dock の実行時状態。位置の記憶は display ごと（§4.2）。
#[derive(Default)]
pub struct DockRuntime {
    pub placement: Mutex<DockPlacementMemory>,
    pub state: Mutex<Option<DockState>>,
}

fn dock_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(DOCK_WINDOW_LABEL)
        .ok_or_else(|| format!("no window labelled {DOCK_WINDOW_LABEL}"))
}

/// window が今いる display の作業領域。取れなければ None。
fn work_area_of(window: &WebviewWindow) -> Option<(u32, Rect)> {
    let monitor = window.current_monitor().ok().flatten()?;
    let position = monitor.position();
    let size = monitor.size();
    // Tauri は monitor に安定 id を出さないので、原点をキーにする。
    // 同じ配置なら同じ display とみなせる。
    let id = ((position.x as i64) << 20 ^ (position.y as i64)) as u32;
    Some((
        id,
        Rect {
            x: position.x,
            y: position.y,
            width: size.width as i32,
            height: size.height as i32,
        },
    ))
}

fn apply_geometry(
    window: &WebviewWindow,
    runtime: &DockRuntime,
    state: DockState,
    content_height: Option<u32>,
) -> Result<(), String> {
    let size = state.size();
    let height = geometry::height_for(state, content_height.unwrap_or(size.min_height));

    window
        .set_size(PhysicalSize::new(size.width, height))
        .map_err(|e| e.to_string())?;

    if let Some((display_id, work_area)) = work_area_of(window) {
        let memory = runtime
            .placement
            .lock()
            .map_err(|_| "placement lock poisoned")?;
        let position = match memory.remembered(display_id) {
            // ユーザーが動かした位置は、その display の中に収めて再利用する
            Some(saved) => {
                geometry::clamp_to_work_area(saved, work_area, size.width as i32, height as i32)
            }
            None => geometry::default_position(
                work_area,
                size.width as i32,
                height as i32,
                geometry::BOTTOM_OFFSET_DEFAULT,
            ),
        };
        window
            .set_position(PhysicalPosition::new(position.x, position.y))
            .map_err(|e| e.to_string())?;
    }

    *runtime.state.lock().map_err(|_| "state lock poisoned")? = Some(state);
    Ok(())
}

/// Dock を出す。§4.4「簡単な質問は Dock 内で答え、full app へ遷移しない」。
#[tauri::command]
pub fn dock_show(
    app: AppHandle,
    runtime: tauri::State<'_, DockRuntime>,
    state: Option<DockState>,
    content_height: Option<u32>,
) -> Result<(), String> {
    let window = dock_window(&app)?;
    apply_geometry(
        &window,
        &runtime,
        state.unwrap_or(DockState::Ready),
        content_height,
    )?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Dock を引っ込める。**実行中の Task はキャンセルしない**（§4.4）。
#[tauri::command]
pub fn dock_hide(app: AppHandle) -> Result<(), String> {
    dock_window(&app)?.hide().map_err(|e| e.to_string())
}

/// 状態が変わったときに形を合わせる（§4.1 の geometry）。
#[tauri::command]
pub fn dock_set_state(
    app: AppHandle,
    runtime: tauri::State<'_, DockRuntime>,
    state: DockState,
    content_height: Option<u32>,
) -> Result<(), String> {
    let window = dock_window(&app)?;
    apply_geometry(&window, &runtime, state, content_height)
}

/// ショートカットでの開閉。押すたびに反転する。
#[tauri::command]
pub fn dock_toggle(app: AppHandle, runtime: tauri::State<'_, DockRuntime>) -> Result<bool, String> {
    let window = dock_window(&app)?;
    if window.is_visible().map_err(|e| e.to_string())? {
        window.hide().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        apply_geometry(&window, &runtime, DockState::Ready, None)?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

/// ユーザーが動かした位置を覚える（§4.2）。display ごとに別々に持つ。
#[tauri::command]
pub fn dock_remember_position(
    app: AppHandle,
    runtime: tauri::State<'_, DockRuntime>,
) -> Result<(), String> {
    let window = dock_window(&app)?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    if let Some((display_id, _)) = work_area_of(&window) {
        runtime
            .placement
            .lock()
            .map_err(|_| "placement lock poisoned")?
            .remember(
                display_id,
                Position {
                    x: position.x,
                    y: position.y,
                },
            );
    }
    Ok(())
}

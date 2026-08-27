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
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

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
/// display の**使える領域**を、論理 px で。
///
/// 長らく `monitor.size()`（画面全体）を「work area」と呼んでいた。
/// それでは macOS の Dock とメニューバーを避けられず、
/// **Astra の Dock が macOS の Dock の下に潜っていた**（§4.2「タスクバーと重ならない」に反する）。
/// `work_area()` はその 2 つを除いた矩形を返す。
///
/// 論理 px に直すのは、§4.1 の寸法（560 × 56）が論理 px だから。
/// 物理 px のまま使うと、Retina では半分の大きさの Dock になる。
fn work_area_of(window: &WebviewWindow) -> Option<(u32, f64, Rect)> {
    let monitor = window.current_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let origin = monitor.position();
    // Tauri は monitor に安定 id を出さないので、原点をキーにする。
    // 同じ配置なら同じ display とみなせる。
    let id = ((origin.x as i64) << 20 ^ (origin.y as i64)) as u32;
    Some((
        id,
        scale,
        Rect {
            x: (area.position.x as f64 / scale).round() as i32,
            y: (area.position.y as f64 / scale).round() as i32,
            width: (area.size.width as f64 / scale).round() as i32,
            height: (area.size.height as f64 / scale).round() as i32,
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

    // §4.1 の寸法は論理 px。物理で渡すと Retina で半分になる。
    window
        .set_size(LogicalSize::new(size.width, height))
        .map_err(|e| e.to_string())?;

    if let Some((display_id, _scale, work_area)) = work_area_of(window) {
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
            .set_position(LogicalPosition::new(position.x, position.y))
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
    if let Some((display_id, scale, _)) = work_area_of(&window) {
        // 覚えるのも論理 px で。物理のまま覚えると、display を跨いだときにずれる。
        runtime
            .placement
            .lock()
            .map_err(|_| "placement lock poisoned")?
            .remember(
                display_id,
                Position {
                    x: (position.x as f64 / scale).round() as i32,
                    y: (position.y as f64 / scale).round() as i32,
                },
            );
    }
    Ok(())
}

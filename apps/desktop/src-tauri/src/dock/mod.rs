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

    // 今の大きさ・位置。morph の出発点（§18: 位置の連続性を保って変形する）。
    let from = current_logical(window);

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
        let to = Frame {
            x: position.x as f64,
            y: position.y as f64,
            width: size.width as f64,
            height: height as f64,
        };
        morph(window.clone(), from, to);
    } else {
        // 表示領域が分からなくても、大きさだけは合わせる
        window
            .set_size(LogicalSize::new(size.width, height))
            .map_err(|e| e.to_string())?;
    }

    *runtime.state.lock().map_err(|_| "state lock poisoned")? = Some(state);
    Ok(())
}

/// 論理 px の枠。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn current_logical(window: &WebviewWindow) -> Option<Frame> {
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    let pos = window.outer_position().ok()?.to_logical::<f64>(scale);
    Some(Frame {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    })
}

/// morph の刻み。Deepgram の floating card は CSS で高さが繋がる。
/// window は CSS で動かせないので、ここで数段に分けて寄せる。
pub const MORPH_STEPS: u32 = 6;
pub const MORPH_STEP_MS: u64 = 24;

/// 途中の枠。ease-out（終わり際をゆっくり）。
pub fn morph_frame(from: Frame, to: Frame, step: u32) -> Frame {
    let t = (step.min(MORPH_STEPS) as f64) / MORPH_STEPS as f64;
    let eased = 1.0 - (1.0 - t) * (1.0 - t);
    let lerp = |a: f64, b: f64| a + (b - a) * eased;
    Frame {
        x: lerp(from.x, to.x),
        y: lerp(from.y, to.y),
        width: lerp(from.width, to.width),
        height: lerp(from.height, to.height),
    }
}

/// 出発点が分からない、または隠れている間は一気に置く（見えていない動きに意味はない）。
fn morph(window: WebviewWindow, from: Option<Frame>, to: Frame) {
    let visible = window.is_visible().unwrap_or(false);
    let Some(from) = from.filter(|_| visible) else {
        let _ = window.set_size(LogicalSize::new(to.width, to.height));
        let _ = window.set_position(LogicalPosition::new(to.x, to.y));
        return;
    };
    if from == to {
        return;
    }
    std::thread::spawn(move || {
        for step in 1..=MORPH_STEPS {
            let f = morph_frame(from, to, step);
            let _ = window.set_size(LogicalSize::new(f.width, f.height));
            let _ = window.set_position(LogicalPosition::new(f.x, f.y));
            std::thread::sleep(std::time::Duration::from_millis(MORPH_STEP_MS));
        }
    });
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

#[cfg(test)]
mod morph_tests {
    use super::*;

    #[test]
    fn ends_exactly_on_the_target() {
        let from = Frame {
            x: 0.0,
            y: 0.0,
            width: 560.0,
            height: 56.0,
        };
        let to = Frame {
            x: 20.0,
            y: -40.0,
            width: 560.0,
            height: 96.0,
        };
        assert_eq!(morph_frame(from, to, MORPH_STEPS), to);
        assert_eq!(morph_frame(from, to, 0), from);
    }

    #[test]
    fn eases_out_so_the_first_step_moves_the_most() {
        let from = Frame {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        };
        let to = Frame {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 60.0,
        };
        let first = morph_frame(from, to, 1).height;
        let last = to.height - morph_frame(from, to, MORPH_STEPS - 1).height;
        assert!(first > last, "first {first} should exceed last {last}");
    }
}

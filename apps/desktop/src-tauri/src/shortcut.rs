//! Global shortcut。UI/UX §20。
//!
//! macOS: Option + Space / Windows: Ctrl + Alt + Space。
//! OS や IME と衝突することがあるので、登録に失敗しても**起動は止めない**。
//! 起動しないより、ショートカットが効かない方がまし（設定から変更できる）。

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::dock::{DockRuntime, DOCK_WINDOW_LABEL};

/// 既定のショートカット（§20）。
pub fn default_shortcut() -> Shortcut {
    #[cfg(target_os = "macos")]
    {
        Shortcut::new(Some(Modifiers::ALT), Code::Space)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space)
    }
}

/// 登録する。失敗は警告に留める（衝突は珍しくない）。
pub fn register(app: &AppHandle) {
    let shortcut = default_shortcut();
    let manager = app.global_shortcut();

    let result = manager.on_shortcut(shortcut, move |app, _shortcut, event| {
        // 押下でのみ反応する。離したときにもう一度動くと 2 回トグルしてしまう。
        if event.state() != ShortcutState::Pressed {
            return;
        }
        toggle(app);
    });

    if let Err(error) = result {
        log::warn!(
            "could not register the global shortcut ({error}); the dock is still reachable from the app window"
        );
    }
}

fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(DOCK_WINDOW_LABEL) else {
        log::warn!("dock window is missing; ignoring the shortcut");
        return;
    };
    let runtime = app.state::<DockRuntime>();
    match crate::dock::dock_toggle(app.clone(), runtime) {
        Ok(visible) => log::debug!("dock toggled to visible={visible}"),
        Err(error) => {
            log::warn!("dock toggle failed ({error}); falling back to a plain show");
            let _ = window.show();
        }
    }
}

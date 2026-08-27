//! Astra desktop の Local Control Plane。正本 §16.1。

pub mod audio;
pub mod capability;
pub mod context;
pub mod dock;
pub mod notify;
pub mod oauth;
pub mod permission;
pub mod secrets;
pub mod shortcut;
pub mod shortcut_generated;
pub mod stt;
mod voice;
mod workspace;

use dock::DockRuntime;
use oauth::OauthRuntime;
use shortcut::ShortcutRuntime;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(DockRuntime::default())
        .manage(ShortcutRuntime::default())
        .manage(OauthRuntime::default())
        .manage(voice::VoiceRuntime::with_window(
            crate::stt::recognizer::LiveWindow::default(),
        ))
        .invoke_handler(tauri::generate_handler![
            dock::dock_show,
            dock::dock_hide,
            dock::dock_set_state,
            dock::dock_toggle,
            dock::dock_remember_position,
            context::context_snapshot,
            permission::permission_open_settings,
            notify::notify_send,
            capability::capability_report,
            oauth::oauth_listen,
            oauth::oauth_await_callback,
            oauth::oauth_cancel,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            shortcut::shortcut_status,
            shortcut::shortcut_rebind,
            workspace::workspace_open,
            voice::voice_start,
            voice::voice_stop,
            voice::voice_set_mode,
            voice::voice_set_output_level,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            shortcut::register(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

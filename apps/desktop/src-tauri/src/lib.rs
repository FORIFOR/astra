//! Astra desktop の Local Control Plane。正本 §16.1。

pub mod context;
pub mod dock;
pub mod secrets;
pub mod shortcut;

use dock::DockRuntime;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(DockRuntime::default())
        .invoke_handler(tauri::generate_handler![
            dock::dock_show,
            dock::dock_hide,
            dock::dock_set_state,
            dock::dock_toggle,
            dock::dock_remember_position,
            context::context_snapshot,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
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

//! Global shortcut。UI/UX §20。
//!
//! §20 は 3 つを要求している:
//!   1. 表のとおりに効くこと
//!   2. Settings で変更できること
//!   3. OS / IME と衝突したら、初回設定で**代替候補を出す**こと
//!
//! Option+Space も Ctrl+Alt+Space も、IME 切り替えや Spotlight と
//! ぶつかることが珍しくない。**「登録できませんでした」で終わらせない。**
//! 既定が取られていたら候補を順に試し、どれが効いているのかと、
//! 何が取られていたのかを画面へ返す。黙って効かないままにしない。

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};

use crate::dock::{DockRuntime, DOCK_WINDOW_LABEL};
use crate::shortcut_generated::{Binding, GlobalShortcutSpec, GLOBAL_SHORTCUTS};

/// いま効いている割り当て。画面（Settings）へそのまま返す。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    pub id: String,
    pub label: String,
    /// 効いている割り当ての `KeyboardEvent.code`。登録できていなければ None。
    pub code: Option<String>,
    pub modifiers: ModifierFlags,
    /// 既定を使えているか。false なら OS / IME に取られている。
    pub using_default: bool,
    /// まだ試していない代替候補。空なら薦められるものが無い。
    pub alternates: Vec<AlternateBinding>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifierFlags {
    pub primary: bool,
    pub alt: bool,
    pub shift: bool,
    pub control: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlternateBinding {
    pub code: String,
    pub modifiers: ModifierFlags,
}

/// 押している間だけ効くもの（push-to-talk）の状態変化。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldEvent {
    id: String,
    pressed: bool,
}

#[derive(Default)]
pub struct ShortcutRuntime {
    status: Mutex<Vec<ShortcutStatus>>,
}

fn flags(binding: Binding) -> ModifierFlags {
    let m = binding.modifiers.unwrap_or_else(Modifiers::empty);
    ModifierFlags {
        // macOS の primary は Command（SUPER）、それ以外は Ctrl
        primary: if cfg!(target_os = "macos") {
            m.contains(Modifiers::SUPER)
        } else {
            m.contains(Modifiers::CONTROL)
        },
        alt: m.contains(Modifiers::ALT),
        shift: m.contains(Modifiers::SHIFT),
        control: cfg!(target_os = "macos") && m.contains(Modifiers::CONTROL),
    }
}

fn alternate(binding: Binding) -> AlternateBinding {
    AlternateBinding {
        code: binding.label.to_string(),
        modifiers: flags(binding),
    }
}

/// 1 つ登録する。既定が取られていたら候補を順に試す。
fn register_one(app: &AppHandle, spec: &'static GlobalShortcutSpec) -> ShortcutStatus {
    let manager = app.global_shortcut();
    let candidates: Vec<(Binding, bool)> = std::iter::once((spec.default_binding, true))
        .chain(spec.alternates.iter().map(|b| (*b, false)))
        .collect();

    for (index, (binding, is_default)) in candidates.iter().enumerate() {
        let id = spec.id;
        let hold = spec.hold;
        let result = manager.on_shortcut(binding.shortcut(), move |app, _shortcut, event| {
            if hold {
                // 押している間だけ。離したことも伝える（伝えないと録音が止まらない）。
                emit_hold(app, id, event.state() == ShortcutState::Pressed);
                return;
            }
            // 押下でのみ反応する。離したときにもう一度動くと 2 回トグルしてしまう。
            if event.state() != ShortcutState::Pressed {
                return;
            }
            dispatch(app, id);
        });

        if result.is_ok() {
            if !is_default {
                log::warn!(
                    "the default shortcut for {} is taken; using an alternate instead",
                    spec.id
                );
            }
            return ShortcutStatus {
                id: spec.id.to_string(),
                label: spec.label.to_string(),
                code: Some(binding.label.to_string()),
                modifiers: flags(*binding),
                using_default: *is_default,
                // まだ試していない残りだけを薦める
                alternates: spec.alternates[index.min(spec.alternates.len())..]
                    .iter()
                    .map(|b| alternate(*b))
                    .collect(),
            };
        }
        log::warn!("could not register {} ({:?})", spec.id, result.err());
    }

    // 全部取られていた。**黙らない。**画面が「効いていない」と言えるようにする。
    ShortcutStatus {
        id: spec.id.to_string(),
        label: spec.label.to_string(),
        code: None,
        modifiers: ModifierFlags::default(),
        using_default: false,
        alternates: Vec::new(),
    }
}

fn emit_hold(app: &AppHandle, id: &str, pressed: bool) {
    let payload = HoldEvent {
        id: id.to_string(),
        pressed,
    };
    if let Err(error) = app.emit("astra://shortcut-hold", payload) {
        log::warn!("could not deliver the push-to-talk event ({error})");
    }
}

fn dispatch(app: &AppHandle, id: &str) {
    match id {
        "dock.toggle" => toggle(app),
        other => log::warn!("no handler for the shortcut {other}"),
    }
}

/// 登録する。**起動は止めない。**効かないより、起動しない方が悪い。
pub fn register(app: &AppHandle) {
    let status: Vec<ShortcutStatus> = GLOBAL_SHORTCUTS
        .iter()
        .map(|spec| register_one(app, spec))
        .collect();

    for entry in &status {
        if entry.code.is_none() {
            log::warn!(
                "{} has no working shortcut; it is only reachable from the app window",
                entry.id
            );
        }
    }

    if let Some(runtime) = app.try_state::<ShortcutRuntime>() {
        if let Ok(mut slot) = runtime.status.lock() {
            *slot = status;
        }
    }
}

/// いまの割り当てと、衝突していたかどうか。Settings と初回設定が読む。
#[tauri::command]
pub fn shortcut_status(runtime: tauri::State<'_, ShortcutRuntime>) -> Vec<ShortcutStatus> {
    runtime
        .status
        .lock()
        .map(|slot| slot.clone())
        .unwrap_or_default()
}

/// Settings からの変更。**古い割り当ては必ず外してから入れる。**
#[tauri::command]
pub fn shortcut_rebind(
    app: AppHandle,
    runtime: tauri::State<'_, ShortcutRuntime>,
    id: String,
    code: String,
    modifiers: ModifierFlags,
) -> Result<ShortcutStatus, String> {
    let spec = GLOBAL_SHORTCUTS
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("unknown shortcut: {id}"))?;

    let binding = Binding {
        modifiers: to_modifiers(&modifiers),
        code: parse_code(&code)?,
        // 'static が要るので、表にある綴りをそのまま使う
        label: leak(code.clone()),
    };

    let manager = app.global_shortcut();
    // 先に今のものを外す。外さずに足すと、古い方も効いたままになる。
    if let Ok(slot) = runtime.status.lock() {
        if let Some(current) = slot.iter().find(|s| s.id == id) {
            if let Some(current_code) = &current.code {
                if let Ok(parsed) = parse_code(current_code) {
                    let previous = Binding {
                        modifiers: to_modifiers(&current.modifiers),
                        code: parsed,
                        label: "",
                    };
                    let _ = manager.unregister(previous.shortcut());
                }
            }
        }
    }

    let hold = spec.hold;
    let handler_id = spec.id;
    manager
        .on_shortcut(binding.shortcut(), move |app, _shortcut, event| {
            if hold {
                emit_hold(app, handler_id, event.state() == ShortcutState::Pressed);
                return;
            }
            if event.state() != ShortcutState::Pressed {
                return;
            }
            dispatch(app, handler_id);
        })
        // 取られている組み合わせを選んだことを、画面が言えるようにする
        .map_err(|error| format!("that combination is already taken ({error})"))?;

    let status = ShortcutStatus {
        id: id.clone(),
        label: spec.label.to_string(),
        code: Some(binding.label.to_string()),
        modifiers: flags(binding),
        using_default: false,
        alternates: spec.alternates.iter().map(|b| alternate(*b)).collect(),
    };

    if let Ok(mut slot) = runtime.status.lock() {
        if let Some(entry) = slot.iter_mut().find(|s| s.id == id) {
            *entry = status.clone();
        } else {
            slot.push(status.clone());
        }
    }
    Ok(status)
}

/// `'static` が要る場所に、実行時に決まる綴りを渡すため。
///
/// Settings からの変更は起動中に数回しか起きないので、漏らして構わない。
/// 参照を持ち回すために `Arc<str>` を配るより、ここは素直な方がよい。
fn leak(value: String) -> &'static str {
    Box::leak(value.into_boxed_str())
}

fn to_modifiers(flags: &ModifierFlags) -> Option<Modifiers> {
    let mut m = Modifiers::empty();
    if flags.control {
        m |= Modifiers::CONTROL;
    }
    if flags.alt {
        m |= Modifiers::ALT;
    }
    if flags.shift {
        m |= Modifiers::SHIFT;
    }
    if flags.primary {
        m |= if cfg!(target_os = "macos") {
            Modifiers::SUPER
        } else {
            Modifiers::CONTROL
        };
    }
    if m.is_empty() {
        None
    } else {
        Some(m)
    }
}

/// `KeyboardEvent.code` を tauri の `Code` にする。**知らない綴りは断る。**
fn parse_code(code: &str) -> Result<Code, String> {
    code.parse::<Code>()
        .map_err(|_| format!("unknown key: {code}"))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_row_in_the_table_has_a_handler() {
        // dispatch に無い id を表へ足したら、押しても何も起きない
        for spec in GLOBAL_SHORTCUTS {
            assert!(
                spec.hold || spec.id == "dock.toggle",
                "{} has no handler in dispatch()",
                spec.id
            );
        }
    }

    #[test]
    fn alternates_are_not_the_default() {
        for spec in GLOBAL_SHORTCUTS {
            for alternate in spec.alternates {
                assert!(
                    !(alternate.code == spec.default_binding.code
                        && alternate.modifiers == spec.default_binding.modifiers),
                    "{} offers its own default as an alternate",
                    spec.id
                );
            }
        }
    }

    #[test]
    fn a_rebind_round_trips_through_the_flags() {
        let flags = ModifierFlags {
            primary: true,
            alt: false,
            shift: true,
            control: false,
        };
        let binding = Binding {
            modifiers: to_modifiers(&flags),
            code: parse_code("KeyJ").expect("KeyJ is a real key"),
            label: "KeyJ",
        };
        let round_tripped = super::flags(binding);
        assert!(round_tripped.primary);
        assert!(round_tripped.shift);
        assert!(!round_tripped.alt);
    }

    #[test]
    fn an_unknown_key_is_refused_rather_than_guessed() {
        assert!(parse_code("NotAKey").is_err());
    }
}

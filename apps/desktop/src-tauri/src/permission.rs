//! OS の許可。UI/UX §22。
//!
//! **ここは許可を「求める」だけで、勝手に開かない。**
//! §22 は「利用直前に purpose-first」「初回起動時の一括権限要求は禁止」と言う。
//! なので、画面が目的を言ったうえで押されたときにだけ、
//! OS の設定面を開く。こちらから先回りして開かない。
//!
//! 許可そのものは OS が与える。ここが確かめられるのは
//! 「設定面を開けたか」までで、**許可されたことは確かめられない**。
//! 画面には「開きました」としか言わせない。

use serde::{Deserialize, Serialize};

/// 求められる許可。TypeScript の `OsPermission` と同じ綴り。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OsPermission {
    Microphone,
    Accessibility,
    ScreenRecording,
    Notifications,
    Files,
    CalendarContacts,
}

impl OsPermission {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "microphone" => Some(Self::Microphone),
            "accessibility" => Some(Self::Accessibility),
            "screen_recording" => Some(Self::ScreenRecording),
            "notifications" => Some(Self::Notifications),
            "files" => Some(Self::Files),
            "calendar_contacts" => Some(Self::CalendarContacts),
            _ => None,
        }
    }

    /// macOS のシステム設定で、その項目が出るところ。
    #[cfg(target_os = "macos")]
    fn settings_url(self) -> &'static str {
        const PRIVACY: &str = "x-apple.systempreferences:com.apple.preference.security";
        match self {
            Self::Microphone => concat!(
                "x-apple.systempreferences:com.apple.preference.security",
                "?Privacy_Microphone"
            ),
            Self::Accessibility => concat!(
                "x-apple.systempreferences:com.apple.preference.security",
                "?Privacy_Accessibility"
            ),
            Self::ScreenRecording => concat!(
                "x-apple.systempreferences:com.apple.preference.security",
                "?Privacy_ScreenCapture"
            ),
            Self::Notifications => "x-apple.systempreferences:com.apple.preference.notifications",
            Self::Files => concat!(
                "x-apple.systempreferences:com.apple.preference.security",
                "?Privacy_AllFiles"
            ),
            Self::CalendarContacts => concat!(
                "x-apple.systempreferences:com.apple.preference.security",
                "?Privacy_Calendars"
            ),
            // 新しい項目を足したときに、黙って一般の Privacy へ落とさないための保険
            #[allow(unreachable_patterns)]
            _ => PRIVACY,
        }
    }
}

/// 設定面を開く。**開けたかどうかしか返さない。**
///
/// 許可されたかは OS の中の話で、ここからは分からない。
/// 「許可されました」と言えるふりをしない。
#[tauri::command]
pub fn permission_open_settings(permission: String) -> Result<(), String> {
    let parsed = OsPermission::parse(&permission)
        .ok_or_else(|| format!("unknown permission: {permission}"))?;

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(parsed.settings_url())
            .status()
            .map_err(|error| format!("could not open the settings pane ({error})"))
            .and_then(|status| {
                if status.success() {
                    Ok(())
                } else {
                    Err("the settings pane did not open".to_string())
                }
            })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = parsed;
        // 対応していない OS では、開けないことを言う。黙って成功にしない。
        Err("この OS では設定を自動で開けません".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_a_permission_it_does_not_know() {
        assert!(OsPermission::parse("camera").is_none());
    }

    #[test]
    fn knows_every_permission_the_contract_names() {
        for name in [
            "microphone",
            "accessibility",
            "screen_recording",
            "notifications",
            "files",
            "calendar_contacts",
        ] {
            assert!(OsPermission::parse(name).is_some(), "{name} is unmapped");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn every_permission_points_somewhere_specific() {
        use std::collections::HashSet;
        let urls: HashSet<&str> = [
            OsPermission::Microphone,
            OsPermission::Accessibility,
            OsPermission::ScreenRecording,
            OsPermission::Notifications,
            OsPermission::Files,
            OsPermission::CalendarContacts,
        ]
        .into_iter()
        .map(|p| p.settings_url())
        .collect();
        // 全部が同じ一般ページへ落ちていたら、案内になっていない
        assert_eq!(urls.len(), 6);
    }
}

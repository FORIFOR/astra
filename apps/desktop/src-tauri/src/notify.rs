//! OS への通知。UI/UX §16。
//!
//! §16 の表:
//!   Info            → Home only
//!   Attention       → Home + 控えめな印
//!   Action required → OS notification + Work の確認待ち
//!   Critical        → policy が要求するときの警告
//!
//! **ここは面の判断をしない。**どの severity が OS まで来てよいかは
//! contracts（surfacesFor / interrupts）が決める。
//! 両側で判断すると、片方だけ直って食い違う。
//!
//! ここが持つのは「OS へ出す」ことと、
//! **出せなかったことを黙らない**ことだけ。

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// 出す強さ。contracts の severity のうち、OS まで来るものだけ。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotifyLevel {
    /// approval 待ちなど。通常の通知。
    ActionRequired,
    /// 録音の失敗、規制対象の書き込みの拒否など。
    Critical,
}

impl NotifyLevel {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "action-required" => Some(Self::ActionRequired),
            "critical" => Some(Self::Critical),
            // info / attention は OS へ来てはいけない。**黙って通さない。**
            _ => None,
        }
    }
}

/// OS へ 1 件出す。
///
/// **出せなかったら、出せなかったと返す。**成功にしておくと、
/// 画面は「知らせた」と思い込んだまま、利用者には何も届かない。
#[tauri::command]
pub fn notify_send(
    app: AppHandle,
    severity: String,
    title: String,
    body: String,
) -> Result<(), String> {
    let level = NotifyLevel::parse(&severity).ok_or_else(|| {
        // §16 に反する呼び出しは断る。ここが最後の砦。
        format!("{severity} does not belong on the OS surface")
    })?;

    let mut builder = app.notification().builder().title(&title).body(&body);
    if level == NotifyLevel::Critical {
        // 取り返しがつかないものは、通知の中でも目立たせる
        builder = builder.sound("default");
    }
    builder
        .show()
        .map_err(|error| format!("could not deliver the notification ({error})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_the_severities_that_belong_on_home() {
        // §16: Info は Home only、Attention は Home + 控えめな印
        assert!(NotifyLevel::parse("info").is_none());
        assert!(NotifyLevel::parse("attention").is_none());
    }

    #[test]
    fn accepts_the_two_that_may_interrupt() {
        assert_eq!(
            NotifyLevel::parse("action-required"),
            Some(NotifyLevel::ActionRequired)
        );
        assert_eq!(NotifyLevel::parse("critical"), Some(NotifyLevel::Critical));
    }

    #[test]
    fn refuses_a_severity_it_does_not_know() {
        assert!(NotifyLevel::parse("urgent").is_none());
    }
}

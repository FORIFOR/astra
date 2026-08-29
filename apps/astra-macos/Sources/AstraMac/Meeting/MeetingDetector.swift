import AppKit

/// §18 会議アプリを検出する。**検出しても録音は始めない。**
///
/// 仕様書がわざわざ書いているとおり、Meeting 検出 = 録音開始 にすると、
/// 同意していない会議まで録り始める製品になる。ここは「会議らしい」ことを
/// State に置くだけで、録音を始めるのは常にユーザーの操作。
@MainActor
enum MeetingDetector {
    /// bundle id → 表示名。
    static let apps: [String: String] = [
        "us.zoom.xos": "Zoom",
        "com.microsoft.teams": "Microsoft Teams",
        "com.microsoft.teams2": "Microsoft Teams",
        "com.cisco.webexmeetingsapp": "Webex",
        "com.hnc.Discord": "Discord",
        "com.tinyspeck.slackmacgap": "Slack",
    ]

    /// ブラウザで開いていれば会議とみなす URL の断片。窓のタイトルから拾う。
    static let browserTitles: [String: String] = [
        "meet.google.com": "Google Meet",
        "Google Meet": "Google Meet",
        "Zoom Meeting": "Zoom",
        "Microsoft Teams": "Microsoft Teams",
    ]

    static let browsers: Set<String> = [
        "com.google.Chrome", "com.apple.Safari", "com.microsoft.edgemac", "company.thebrowser.Browser",
    ]

    /// 前面アプリと窓のタイトルから会議アプリを判定する。無ければ nil。
    static func detect(bundleId: String?, windowTitle: String?) -> String? {
        if let bundleId, let name = apps[bundleId] {
            // Slack は常駐しているだけのことが多い。Huddle のときだけ会議とみなす。
            if bundleId == "com.tinyspeck.slackmacgap" {
                guard let t = windowTitle, t.localizedCaseInsensitiveContains("huddle") else { return nil }
                return "Slack ハドル"
            }
            return name
        }
        if let bundleId, browsers.contains(bundleId), let title = windowTitle {
            for (needle, name) in browserTitles where title.localizedCaseInsensitiveContains(needle) {
                return name
            }
        }
        return nil
    }

    /// 実環境を見て State を更新する。録音には触れない。
    static func refresh() {
        let app = NSWorkspace.shared.frontmostApplication
        let title = AccessibilityContext.frontmostWindowTitle()
        AstraStateStore.shared.meetingDetected(app: detect(bundleId: app?.bundleIdentifier, windowTitle: title))
    }
}

import AppKit

/// いま前面にあるアプリを見て、まだ Astra に繋がっていなければ 1 度だけ勧める。
///
/// Dock 本体は大きくしない。勧誘は **第二の Panel**（`AppDiscoveryPanel`）に出す
/// ——Task Dock が状況で伸び縮みすると、画面上端の静けさが壊れるため。
struct AppSuggestion: Equatable, Identifiable {
    /// ConnectorState が使うアプリ名（"Notion" など）。
    let id: String
    let displayName: String
    let bundleId: String
}

@MainActor
enum AppDiscovery {
    /// bundle id → Astra 側のアプリ名。ここに無いものは勧めない（当てずっぽうで勧誘しない）。
    static let known: [String: String] = [
        "notion.id": "Notion",
        "com.google.Chrome": "Google Chrome",
        "com.tinyspeck.slackmacgap": "Slack",
        "com.microsoft.Outlook": "Outlook",
        "com.figma.Desktop": "Figma",
        "com.linear": "Linear",
    ]

    /// 一度断られたものは同じセッションで再び出さない。
    private static var dismissed: Set<String> = []

    /// 前面アプリから勧めるものを決める。既に接続済み / 対象外 / 断られた なら nil。
    static func suggestionForFrontmostApp(
        bundleId: String? = nil,
        connected: Set<String>? = nil
    ) -> AppSuggestion? {
        let bundleId = bundleId ?? NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let connected = connected ?? ConnectorState.shared.connected
        guard let bundleId, let name = known[bundleId] else { return nil }
        guard !connected.contains(name), !dismissed.contains(name) else { return nil }
        return AppSuggestion(id: name, displayName: name, bundleId: bundleId)
    }

    static func dismiss(_ suggestion: AppSuggestion) {
        dismissed.insert(suggestion.id)
    }

    /// テスト用に戻す。
    static func resetDismissed() { dismissed.removeAll() }
}

import AppKit

/// §Context Recognition 前面アプリを Presence の 1 行にまとめる。
///
/// 出すのは「◈ Notion」程度。開いたときだけ、そのアプリで**実際に頼めること**を出す。
/// 頼めることが無いアプリでは提案を作らない（当てずっぽうの提案を並べない）。
@MainActor
enum AppContextResolver {
    /// アプリごとに頼めること。ここに無いアプリは提案なしで名前だけ出す。
    static let suggestions: [String: [String]] = [
        "Notion": ["Summarize page", "Extract action items", "Find unresolved decisions", "Ask about this page"],
        "Google Chrome": ["Summarize page", "Extract action items", "Ask about this page"],
        "Safari": ["Summarize page", "Ask about this page"],
        "Slack": ["Summarize thread", "Draft a reply"],
        "Mail": ["Summarize thread", "Draft a reply"],
        "Xcode": ["Explain this file", "Find related tests"],
    ]

    static func current(now: Date = Date()) -> AppContextSummary? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              let name = app.localizedName, name != "Astra" else { return nil }
        // 書類名はブラウザの文脈があればそちらを優先し、無ければ窓のタイトル。
        let document = AstraStateStore.shared.state.context.items
            .first { $0.application == name }?.summary
            ?? AccessibilityContext.frontmostWindowTitle()
        return AppContextSummary(
            app: name,
            document: document,
            suggestions: suggestions[name] ?? []
        )
    }
}

import AppKit

/// §Context Recognition 前面アプリを Presence の 1 行にまとめる。
///
/// 出すのは「◈ Notion」程度。開いたときだけ、そのアプリで**実際に頼めること**を出す。
/// 頼めることが無いアプリでは提案を作らない（当てずっぽうの提案を並べない）。
@MainActor
enum AppContextResolver {
    /// アプリごとに頼めること。ここに無いアプリは提案なしで名前だけ出す。
    static let suggestions: [String: [String]] = [
        "Notion": ["ページを要約", "やることを抽出", "未決の決定を探す", "このページに質問"],
        "Google Chrome": ["ページを要約", "やることを抽出", "このページに質問"],
        "Safari": ["ページを要約", "このページに質問"],
        "Slack": ["スレッドを要約", "返信の下書き"],
        "Mail": ["スレッドを要約", "返信の下書き"],
        "Xcode": ["このファイルを説明", "関連するテストを探す"],
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

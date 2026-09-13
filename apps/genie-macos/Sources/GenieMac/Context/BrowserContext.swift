import Foundation

/// §9 ブラウザから来た文脈。Chrome 拡張 → Native Messaging → ここ。
///
/// 受け取るのは拡張が絞った結果だけで、DOM 全文は来ない。
/// それでも来てしまった場合に備えて、ここでも上限で切る（送り手を信用しきらない）。
struct BrowserPayload: Equatable {
    let url: String
    let title: String
    let selection: String
    let focusedRole: String?
    let blocks: [Block]

    struct Block: Equatable {
        let id: String?
        let role: String
        let text: String
    }

    static let maxBlocks = 12
    static let maxBlockChars = 400
    static let maxSelectionChars = 2000

    /// 受け取った JSON から作る。上限を超えるものは切る。
    static func from(json: [String: Any]) -> BrowserPayload? {
        guard let url = json["url"] as? String, let title = json["title"] as? String else { return nil }
        let selection = String((json["selection"] as? String ?? "").prefix(maxSelectionChars))
        let focused = (json["focusedElement"] as? [String: Any])?["role"] as? String
        let rawBlocks = (json["semanticBlocks"] as? [[String: Any]]) ?? []
        let blocks = rawBlocks.prefix(maxBlocks).compactMap { b -> Block? in
            guard let text = b["text"] as? String, !text.isEmpty else { return nil }
            return Block(id: b["id"] as? String,
                         role: b["role"] as? String ?? "?",
                         text: String(text.prefix(maxBlockChars)))
        }
        return BrowserPayload(url: url, title: title, selection: selection,
                              focusedRole: focused, blocks: Array(blocks))
    }

    /// ホスト名（notion.so など）。
    var host: String { URL(string: url)?.host ?? "" }

    /// §7 文脈へ。出所は browserDOM（AX より信頼できる）。
    func fact(now: Date = Date(), ttl: TimeInterval = 45) -> ContextFact {
        let app = NotionAdapter.matches(self) ? "Notion" : (host.isEmpty ? "ブラウザ" : host)
        let summary = selection.isEmpty
            ? "\(title) · 見えている \(blocks.count) 件"
            : "選択: \(selection.prefix(120))"
        return ContextFact(source: .browserDOM, application: app,
                           sensitivity: selection.isEmpty ? .workspace : .personal,
                           summary: summary, capturedAt: now, expiresAt: now.addingTimeInterval(ttl))
    }
}

/// §10 Notion のときだけ効く読み替え。
///
/// 「Chrome を見ている」ではなく「Notion の Q3 Roadmap を見ている」まで分からないと、
/// 頼めることが決まらない。capabilities は**このページで実際にできること**だけを挙げる。
enum NotionAdapter {
    static func matches(_ payload: BrowserPayload) -> Bool {
        let h = payload.host
        return h == "notion.so" || h.hasSuffix(".notion.so")
    }

    struct Bundle: Equatable {
        let application = "Notion"
        let document: String
        let pageId: String?
        let selection: [String]
        let capabilities: [String]
    }

    static let baseCapabilities = ["summarize", "create_task", "extract_decisions"]

    static func bundle(_ payload: BrowserPayload) -> Bundle? {
        guard matches(payload) else { return nil }
        // タイトルの末尾に付くサービス名は落とす。
        let document = payload.title
            .replacingOccurrences(of: " | Notion", with: "")
            .trimmingCharacters(in: .whitespaces)
        // ページ id は URL 末尾の 32 桁 hex。無ければ nil のまま（推測で埋めない）。
        let pageId = payload.url.split(separator: "-").last
            .map(String.init)
            .flatMap { $0.count == 32 && $0.allSatisfy(\.isHexDigit) ? $0 : nil }
        let selectedBlocks = payload.blocks.compactMap(\.id)
        // 編集できるのは、入力できる要素に focus しているときだけ。
        var capabilities = baseCapabilities
        if payload.focusedRole == "textbox" { capabilities.append("edit") }
        return Bundle(document: document, pageId: pageId,
                      selection: selectedBlocks, capabilities: capabilities)
    }
}

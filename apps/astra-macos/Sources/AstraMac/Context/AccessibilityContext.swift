import AppKit
import ApplicationServices

/// アクセシビリティ文脈（AX）。前面アプリで選択中のテキストを読み、RAG/依頼の文脈にする。
/// 正本 §3「Accessibility integration」/ §5「見たものだけ・推測で埋めない」。
///
/// **注意**: 実データの取得はアクセシビリティ許可(TCC)が要る。許可が無ければ nil を返す
/// （**推測で埋めない**・クラッシュしない）。`AXIsProcessTrusted()` は prompt を出さず読めるので、
/// 許可状態の確認と「許可なし→nil」の経路は headless で検証できる。
enum AccessibilityContext {
    /// 許可済みか（prompt を出さない）。
    static var isTrusted: Bool { AXIsProcessTrusted() }

    /// 前面で選択中のテキスト。許可が無い / 選択が無ければ nil。
    static func selectedText() -> String? {
        guard isTrusted else { return nil }
        let system = AXUIElementCreateSystemWide()
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
                system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let element = focused
        else { return nil }
        // CFTypeRef を AXUIElement として扱う（同一 CF 型）。
        let axElement = element as! AXUIElement
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
                axElement, kAXSelectedTextAttribute as CFString, &value) == .success,
              let text = value as? String, !text.isEmpty
        else { return nil }
        return text
    }

    /// 選択テキストを RAG 候補にする（あれば 1 件）。source は .message（外から来た文脈）。
    static func candidate(now: Date = Date()) -> [ContextCandidateLite] {
        guard let text = selectedText() else { return [] }
        return [ContextCandidateLite(id: "ax.selection", text: text)]
    }
}

/// AX 由来の軽量候補（core の ContextCandidate へ詰め替える前段。source/age は呼び出し側で決める）。
struct ContextCandidateLite {
    let id: String
    let text: String
}

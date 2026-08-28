import AppKit
import ApplicationServices

/// UI/UX テスト仕様 v1.0 HUD-004「TextField-aware dictation」/ P0-2「全アプリ音声入力」。
///
/// 前面アプリのフォーカス中テキスト欄に、認識した文字を**そのまま入れる**。
/// ここが Astra の中核で、「Agent 会話を勝手に始めない」ことが PASS 条件。
///
/// 入力欄が無い（デスクトップ等）ときは `insert` が false を返す。呼び出し側はその時だけ
/// Ask Astra へ回す（Context-aware Voice Routing）。**推測で会話を始めない。**
enum Dictation {
    /// フォーカス中の要素が「テキストを受け取れる」か。
    /// AX の role と、値の設定可否（`AXUIElementIsAttributeSettable`）で判定する。
    static func focusedTextTarget() -> AXUIElement? {
        guard AXIsProcessTrusted() else { return nil }
        let system = AXUIElementCreateSystemWide()
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let element = focused
        else { return nil }
        let axElement = element as! AXUIElement

        // 値を書き換えられない要素（ボタン等）は対象外。
        var settable: DarwinBoolean = false
        guard AXUIElementIsAttributeSettable(axElement, kAXValueAttribute as CFString, &settable) == .success,
              settable.boolValue
        else { return nil }

        // テキストを持つ role だけに限る。role が取れないものは触らない。
        var roleRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(axElement, kAXRoleAttribute as CFString, &roleRef) == .success,
              let role = roleRef as? String
        else { return nil }
        let textRoles: Set<String> = [
            kAXTextFieldRole as String, kAXTextAreaRole as String, kAXComboBoxRole as String,
        ]
        return textRoles.contains(role) ? axElement : nil
    }

    /// 認識文字をフォーカス中の入力欄へ入れる。入れられたら true。
    ///
    /// 選択範囲があればそこを置換、無ければキャレット位置へ挿入する（既存の文章を壊さない）。
    @discardableResult
    static func insert(_ text: String) -> Bool {
        guard !text.isEmpty, let target = focusedTextTarget() else { return false }

        // 選択範囲があるなら、そこへ差し替えるのが最も素直（AXSelectedText）。
        var selectedRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(target, kAXSelectedTextAttribute as CFString, &selectedRef) == .success,
           selectedRef as? String != nil {
            if AXUIElementSetAttributeValue(target, kAXSelectedTextAttribute as CFString, text as CFTypeRef) == .success {
                return true
            }
        }

        // 選択が使えない実装向け: 全体値の読み書きでキャレット位置へ挿入する。
        var valueRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(target, kAXValueAttribute as CFString, &valueRef) == .success,
              let current = valueRef as? String
        else { return false }

        var caret = current.count   // 取れなければ末尾へ足す（消さない）
        var rangeRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(target, kAXSelectedTextRangeAttribute as CFString, &rangeRef) == .success,
           let axValue = rangeRef, CFGetTypeID(axValue) == AXValueGetTypeID() {
            var range = CFRange(location: 0, length: 0)
            if AXValueGetValue(axValue as! AXValue, .cfRange, &range) {
                caret = max(0, min(current.count, range.location + range.length))
            }
        }
        let index = current.index(current.startIndex, offsetBy: caret)
        let merged = String(current[current.startIndex..<index]) + text + String(current[index...])
        return AXUIElementSetAttributeValue(target, kAXValueAttribute as CFString, merged as CFTypeRef) == .success
    }
}

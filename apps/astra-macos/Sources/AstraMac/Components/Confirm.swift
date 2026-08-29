import AppKit

/// 戻せない操作の前に一度だけ聞く。
///
/// これまでアプリ全体に確認が **1 つも無かった**。録音中に「Astra を終了」を押すと
/// 会議が黙って消え、Apps の「切断」は一度の誤クリックで繋ぎ直しになった。
/// 文言は「何が起きるか」を先に書き、既定のボタンは**安全な方**にする。
enum Confirm {
    /// destructive を選んだら true。ボタンの並びは macOS の作法（右が既定＝安全側）。
    @MainActor
    static func destructive(_ title: String, detail: String, confirm: String, cancel: String = "やめる") -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = detail
        alert.addButton(withTitle: cancel)   // 先に足した方が既定になる
        alert.addButton(withTitle: confirm)
        return alert.runModal() == .alertSecondButtonReturn
    }
}

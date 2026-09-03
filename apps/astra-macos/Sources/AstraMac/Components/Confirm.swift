import AppKit

/// 戻せない操作の前に一度だけ聞く。
///
/// これまでアプリ全体に確認が **1 つも無かった**。録音中に「Astra を終了」を押すと
/// 会議が黙って消え、Apps の「切断」は一度の誤クリックで繋ぎ直しになった。
/// 文言は「何が起きるか」を先に書き、既定のボタンは**安全な方**にする。
enum Confirm {
    /// §16/§17 の正式な入口。**確認の要否は risk が決める**（呼び出し側では決めない）。
    /// R0/R1 は聞かずに true を返す。R2/R3 はカードを出して答えを待つ。
    @MainActor
    static func ask(_ confirmation: ActionConfirmation) -> Bool {
        guard confirmation.risk.needsConfirmation else { return true }
        let store = AstraStateStore.shared
        store.requireConfirmation(confirmation)
        // Dock が出ているなら、聞く面は Dock の 1 枚だけ。以前はここで modal panel も
        // 出していて、Dock で答えても modal が 120 秒残った（1 つの判断に 2 つの面）。
        if WindowCoordinator.shared.isVoiceHUDVisible {
            return waitOnDock(store, confirmation)
        }
        let approved = ConfirmationPresenter.present(confirmation)
        store.resolveConfirmation(approved: approved)
        return approved
    }

    /// Dock の確認面（`ConfirmationDock`）が答えるまで回す。答えは bus で受け取る。
    /// 120 秒待って答えが無ければ取消（黙って実行しない）。
    @MainActor
    private static func waitOnDock(_ store: AstraStateStore, _ confirmation: ActionConfirmation) -> Bool {
        var answer: Bool?
        let bus = AstraEventBus.shared
        let token = bus.subscribe { event in
            if case .confirmationResolved(let id, let approved) = event, id == confirmation.id {
                answer = approved
            }
        }
        defer { bus.unsubscribe(token) }
        let deadline = Date().addingTimeInterval(120)
        while answer == nil, Date() < deadline {
            CFRunLoopRunInMode(.defaultMode, 0.05, true)
        }
        if answer == nil { store.resolveConfirmation(approved: false) }
        return answer ?? false
    }

    /// 旧入口。risk を持たない呼び出しが残っている間の橋渡しで、R3 として扱う。
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

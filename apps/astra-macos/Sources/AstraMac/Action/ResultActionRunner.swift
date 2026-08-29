import AppKit

/// 結果面のボタンが**ラベルどおりに**することを、1 か所に置く。
///
/// 一度、「開く」も「複製」も `dismissResult()` を呼ぶだけになっていた。
/// View の中に閉じていると気づけないので、外に出して検査から同じ経路を通す。
@MainActor
enum ResultActionRunner {
    static func run(_ action: AgentResult.Action, title: String) {
        let store = AstraStateStore.shared
        switch action {
        case .openWorkspace:
            MainWindowController.shared.showSection(.tasks)
            store.workspaceOpened()
        case .openNotes:
            MainWindowController.shared.showSection(.meetings)
            store.workspaceOpened()
        case .ask:
            VoiceHUDState.shared.beginListening()
            return   // listening へ移るので結果面は畳まれる
        case .copy:
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(title, forType: .string)
        }
        store.dismissResult()
    }
}

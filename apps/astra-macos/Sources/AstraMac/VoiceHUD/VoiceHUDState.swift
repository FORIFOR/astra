import SwiftUI

/// 上部 Voice OS ピルの状態。idle は静か、listening は声を拾っている、thinking は Agent に問い合わせ中。
/// 実フロー: ショートカット→声/テキストの依頼→`ask()`→thinking→Agent 応答→idle。
@MainActor
final class VoiceHUDState: ObservableObject {
    static let shared = VoiceHUDState()
    /// Dock の表示。**ここには持たない** —— 実体は `AstraStateStore` にある。
    ///
    /// 仕様書 §31「UI ごとに勝手に状態を持たせない」。以前はここが真の置き場だったので、
    /// 全体の活動状態（会議中か / 確認待ちか）と Dock の見た目が別々に動き得た。
    /// いまは読み書きとも Store を通るので、ずれようがない。
    typealias Mode = DockPresentation
    var mode: Mode {
        get { AstraStateStore.shared.dock }
        set {
            objectWillChange.send()
            AstraStateStore.shared.setDock(newValue)
        }
    }
    /// 直近の Agent 応答（HUD 下や通知に出す）。
    @Published var answer = ""

    private var apiBase: String?
    private var apiToken: String?
    private var conversationId: String?

    func configureBackend(base: String, token: String) {
        apiBase = base; apiToken = token; conversationId = nil
    }

    /// 声を使い始める。§26 マイクだけを、この瞬間に要求する。
    func beginListening() {
        PermissionCenter.request(.voice)
        mode = .listening(partial: "")
        AstraEventBus.shared.publish(.voiceStarted)
    }

    /// 認識の途中経過。**確定を待たずに** Dock へ出す（§Listening）。
    func updatePartial(_ text: String) {
        guard case .listening = mode else { return }
        mode = .listening(partial: text)
        AstraEventBus.shared.publish(.voicePartial(text))
    }

    /// Dock 本体のクリック。窓は増やさず、Dock 自身が Quick Actions の姿になる。
    func toggleQuickActions() {
        mode = mode == .quickActions ? .idle : .quickActions
    }

    /// App Context の開閉。閉じているときは 1 行、開くと頼めることを出す。
    func toggleContextExpanded() {
        switch mode {
        case .appContext(let s) where !s.suggestions.isEmpty: mode = .appContextExpanded(s)
        case .appContextExpanded(let s): mode = .appContext(s)
        default: break
        }
    }

    /// 提案を押した。Agent へ渡し、Dock は実行中の姿になる。
    func runSuggestion(_ title: String) {
        RecordingWorkspaceState.shared.runAIAction(title)
    }

    /// 会議 Dock の面を開閉する。**常時 5 枚は並べない**ので、開くのは 1 枚だけ。
    func toggleMeetingPanel(_ panel: DockPresentation.MeetingPanel) {
        guard case .meeting(let open) = mode else { return }
        mode = .meeting(expanded: open == panel ? nil : panel)
    }

    /// 前面アプリを見て、Presence を静かに変える。**巨大な popup は出さない。**
    func refreshContextualApp() {
        // 何かしている最中は割り込まない。
        switch mode {
        case .idle, .appContext, .appContextExpanded: break
        default: return
        }
        guard let summary = AppContextResolver.current() else {
            if case .idle = mode {} else { mode = .idle }
            return
        }
        // 開いている最中に同じアプリなら、開いたままにする。
        if case .appContextExpanded(let current) = mode, current.app == summary.app {
            mode = .appContextExpanded(summary)
        } else {
            mode = .appContext(summary)
        }
    }

    /// 認識した発話の行き先を決める（UI/UX テスト仕様 HUD-004 / P1 Context-aware Voice Routing）。
    ///
    /// 前面アプリにテキスト入力欄があれば**そこへ入れて終わり**。Agent 会話は始めない。
    /// 入力欄が無いときだけ Ask Astra に回す。推測で会話を始めないのが PASS 条件。
    /// 戻り値は「dictation として入れたか」。
    @discardableResult
    func speak(_ text: String) -> Bool {
        if Dictation.insert(text) {
            mode = .idle
            answer = ""
            return true
        }
        ask(text)
        return false
    }

    /// 声/テキストの依頼を Agent に投げる。listening→thinking→answer→idle と状態を進める。
    func ask(_ text: String) {
        guard let base = apiBase, let token = apiToken else {
            answer = "サインインすると使えます。"; mode = .idle; return
        }
        mode = .thinking; answer = ""
        Task.detached { [weak self] in
            do {
                let conv: String
                if let existing = await self?.conversationId { conv = existing }
                else {
                    conv = try AstraCoreBridge.startConversation(base, accessToken: token)
                    await MainActor.run { self?.conversationId = conv }
                }
                let outcome = try AstraCoreBridge.sendTurn(base, accessToken: token, conversationId: conv, text: text)
                let reply = !outcome.answer.isEmpty ? outcome.answer
                    : !outcome.notice.isEmpty ? outcome.notice
                    : outcome.needsClarification ? "もう少し詳しく教えてください。" : "(応答なし)"
                await MainActor.run { self?.answer = reply; self?.mode = .idle }
            } catch {
                await MainActor.run { self?.answer = "失敗しました: \(error)"; self?.mode = .idle }
            }
        }
    }
}

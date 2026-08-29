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
        mode = .listening
        AstraEventBus.shared.publish(.voiceStarted)
    }

    /// Dock 本体のクリック。機能を Dock に並べず、下の Quick Actions Panel を出し入れする。
    func toggleQuickActions() {
        mode = mode == .quickActions ? .idle : .quickActions
        WindowCoordinator.shared.syncDockPanels()
    }

    /// 前面アプリを見て、繋がっていないものがあれば勧める（1 セッション 1 回）。
    func refreshContextualApp() {
        guard mode == .idle || isContextual else { return }
        if let s = AppDiscovery.suggestionForFrontmostApp() {
            mode = .contextualApp(s)
        } else if isContextual {
            mode = .idle
        }
        WindowCoordinator.shared.syncDockPanels()
    }

    private var isContextual: Bool {
        if case .contextualApp = mode { return true }
        return false
    }

    /// 勧誘を断られた。二度と同じセッションでは出さない。
    func dismissSuggestion() {
        if case .contextualApp(let s) = mode { AppDiscovery.dismiss(s) }
        mode = .idle
        WindowCoordinator.shared.syncDockPanels()
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

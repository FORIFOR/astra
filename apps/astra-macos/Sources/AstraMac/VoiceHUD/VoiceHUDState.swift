import SwiftUI

/// 上部 Voice OS ピルの状態。idle は静か、listening は声を拾っている、thinking は Agent に問い合わせ中。
/// 実フロー: ショートカット→声/テキストの依頼→`ask()`→thinking→Agent 応答→idle。
@MainActor
final class VoiceHUDState: ObservableObject {
    static let shared = VoiceHUDState()
    enum Mode { case idle, listening, thinking }
    @Published var mode: Mode = .idle
    /// 直近の Agent 応答（HUD 下や通知に出す）。
    @Published var answer = ""

    private var apiBase: String?
    private var apiToken: String?
    private var conversationId: String?

    func configureBackend(base: String, token: String) {
        apiBase = base; apiToken = token; conversationId = nil
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

import AstraCore
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

    /// Listening と名乗る前の「まだ 1 サンプルも取り込めていない」状態。
    ///
    /// 以前はここが無く、`beginListening()` が**マイクを開かないまま**「聞いています…」と
    /// 名乗っていた（取り込みも文字起こしも起きない＝宣言だけ）。いまは実際に取り込み、
    /// 最初の音声フレームが届いてから名乗る。タイマーでは切り替えない。
    @Published private(set) var listeningAwaitingAudio = true

    /// 検査・golden 用。実マイクを開けない撮影で「取り込めている姿」を作る
    /// （録音側の `markListening` と同じ役割）。
    func markVoiceCaptureLive() { listeningAwaitingAudio = false }

    /// 検査・golden 用。「まだ取り込めていない姿（準備中…）」を作る。
    func beginPreparingForShot() { listeningAwaitingAudio = true }

    private var apiBase: String?
    private var apiToken: String?
    private var conversationId: String?

    func configureBackend(base: String, token: String) {
        apiBase = base; apiToken = token; conversationId = nil
    }

    /// 声を使い始める。§26 マイクだけを、この瞬間に要求する。
    ///
    /// **実際に取り込む。**面は先に出すが、見出しは最初の音声フレームが届くまで「準備中…」で、
    /// 「聞いています…」と名乗るのはそれからにする（UI の意味と実装状態を一致させる）。
    func beginListening() {
        PermissionCenter.request(.voice)
        listeningAwaitingAudio = true
        mode = .listening(partial: "")
        AstraEventBus.shared.publish(.voiceStarted)
        let started = RecordingRuntime.shared.beginVoiceListening(
            onFirstFrame: { [weak self] in self?.listeningAwaitingAudio = false },
            onPartial: { [weak self] text in self?.updatePartial(text) },
            onFinal: { [weak self] text in
                guard let self, !text.isEmpty else { return }
                self.speak(text)
            })
        // 会議の録音中は録音側の STT から partial が流れてくるので、そちらを正とする。
        if !started, RecordingWorkspaceState.shared.isRecording { listeningAwaitingAudio = false }
    }

    /// 聞くのをやめる（Esc）。マイクが開いている面に逃げ道の鍵が無いのは危ない。
    func cancelListening() {
        guard case .listening = mode else { return }
        RecordingRuntime.shared.endVoiceListening()
        listeningAwaitingAudio = true
        mode = .idle
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
        // 聞き終えたらマイクを閉じる（開きっぱなしにしない）。
        RecordingRuntime.shared.endVoiceListening()
        listeningAwaitingAudio = true
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
        // スクショの自動コンテキスト: 参照表現（「これ」「さっき」「この 2 枚」等）なら直近スクショを
        // この会話へ添える。**新しいチャットは作らない。**画像が動くのはこの瞬間だけ（撮っただけでは動かない）:
        // 端末内の受け渡し場所へ写し、cloud へは id とラベルだけ。画素は端末で走るモデル呼び出しが読む。
        let attached = VisualReferenceResolver.resolve(text: text, recent: VisualContextStore.shared.recent).images
        let attachments = VisualContextStore.shared.attach(attached)
        // 「これ返して」: 開いているメール → 選択 → 前面の窓 を、この順で候補として添える（題名だけ）。
        let replyCandidates = ReplyContextResolver.isReplyUtterance(text)
            ? ReplyContextResolver.json(ReplyContextResolver.candidates()) : ""
        mode = .thinking; answer = ""
        Task.detached { [weak self] in
            do {
                let conv: String
                if let existing = await self?.conversationId { conv = existing }
                else {
                    conv = try AstraCoreBridge.startConversation(base, accessToken: token)
                    await MainActor.run { self?.conversationId = conv }
                }
                await MainActor.run { VisualContextStore.shared.bind(conversationID: conv) }
                let outcome = replyCandidates.isEmpty
                    ? try AstraCoreBridge.sendTurn(base, accessToken: token, conversationId: conv,
                                                   text: text, attachments: attachments)
                    : try AstraCoreBridge.sendTurn(base, accessToken: token, conversationId: conv,
                                                   text: text, attachments: attachments, replyCandidatesJson: replyCandidates)
                let reply = try Self.followUp(outcome, base: base, token: token, waitMs: 12_000)
                await MainActor.run {
                    self?.answer = reply.text; self?.mode = .idle
                    if reply.settled { VisualContextStore.shared.markRecent(attached) }
                    // 返信案なら、答えとしてではなく確認カードとして出す（送るのは押されたときだけ）。
                    if reply.settled, !outcome.replyJson.isEmpty, let draft = ReplyFlow.draft(replyJson: outcome.replyJson, body: reply.text) {
                        ReplyFlow.shared.present(draft)
                    }
                }
                // 12 秒で終わらない仕事は、裏で待ち続けて届いたら差し替える（Dock は idle に戻す）。
                if !reply.settled, !outcome.taskId.isEmpty {
                    let later = try Self.followUp(outcome, base: base, token: token, waitMs: 120_000)
                    await MainActor.run {
                        if later.settled {
                            self?.answer = later.text; VisualContextStore.shared.markRecent(attached)
                            if !outcome.replyJson.isEmpty, let draft = ReplyFlow.draft(replyJson: outcome.replyJson, body: later.text) {
                                ReplyFlow.shared.present(draft)
                            }
                        }
                    }
                }
            } catch {
                await MainActor.run { self?.answer = "失敗しました: \(error)"; self?.mode = .idle }
            }
        }
    }

    /// turn の結果を、人に見せる文にする。
    ///
    /// gateway は chat lane を **仕事（task）として始める**ので、202 の時点では答えが無い。
    /// 以前はここで「(応答なし)」と出していた —— 仕事は動いているのに、答えが Dock に届かなかった。
    /// task_id があれば完了を待ち、成果物の本文を答えとして返す。`settled` は「もう変わらない」。
    nonisolated static func followUp(_ outcome: TurnOutcome, base: String, token: String, waitMs: UInt64) throws
        -> (text: String, settled: Bool) {
        if !outcome.answer.isEmpty { return (outcome.answer, true) }
        if outcome.needsClarification { return ("もう少し詳しく教えてください。", true) }
        if !outcome.taskId.isEmpty {
            let done = try AstraCoreBridge.waitTask(base, accessToken: token, taskId: outcome.taskId, timeoutMs: waitMs)
            switch done.status {
            case "COMPLETED":
                guard !done.resultArtifactId.isEmpty else { return ("終わりました。", true) }
                let body = try AstraCoreBridge.artifactContent(base, accessToken: token, artifactId: done.resultArtifactId)
                return (body.isEmpty ? "終わりました。" : body, true)
            case "FAILED": return ("できませんでした。", true)
            case "CANCELLED": return ("取り消されました。", true)
            default: return ("まだ考えています。届いたらここに出します。", false)
            }
        }
        if !outcome.notice.isEmpty { return (outcome.notice, true) }
        return ("(応答なし)", true)
    }
}

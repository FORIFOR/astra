import SwiftUI
import AppKit
import ImageIO
import UniformTypeIdentifiers
import AstraCore

enum RecordingTool: String, CaseIterable, Identifiable {
    case transcript, translation, captions
    var id: String { rawValue }
    var title: String {
        switch self {
        case .transcript: return "文字起こし"
        case .translation: return "翻訳"
        case .captions: return "字幕"
        }
    }
    /// ⌘1 / ⌘2 / ⌘3 で切り替える（マウス無しでも右列を操作できるように）。
    var shortcut: KeyEquivalent {
        switch self {
        case .transcript: return "1"
        case .translation: return "2"
        case .captions: return "3"
        }
    }
    var icon: String {
        switch self {
        case .transcript: return "text.alignleft"
        case .translation: return "character.bubble"
        case .captions: return "captions.bubble"
        }
    }
}

struct TranscriptSegment: Identifiable {
    let id = UUID()
    let speaker: String
    let text: String
    let interim: Bool
}

/// RAG ドロワーの 1 行。並べ替え（score/reason）は core が決める。
struct RankedContext: Identifiable {
    let id: String
    let title: String
    let source: ContextSource
    let score: Double
    let reason: String
}

/// 録音 UI の状態を一か所に。UI から STT/Core を直接呼ばない（後段で bridge 経由にする）。
@MainActor
final class RecordingWorkspaceState: ObservableObject {
    static let shared = RecordingWorkspaceState()

    @Published var isRecording = false
    private var tickTimer: Timer?
    @Published var isPaused = false
    @Published var elapsedSeconds = 0
    @Published var selectedTool: RecordingTool = .transcript
    @Published var ragOpen = false
    @Published var transcript: [TranscriptSegment] = []
    /// RAG コンテキストの並べ替え結果（core の rank_context 由来）。
    @Published var ragResults: [RankedContext] = []
    /// いまの会議 id（スクリーンショット等の保存先に使う）。
    var currentMeetingId = "adhoc"
    /// AI 操作（要約/質問/決定事項/アクション）の結果。
    @Published var aiResult = ""
    @Published var aiRunning = false
    /// 翻訳タブの結果（Agent 経由）。
    @Published var translatedText = ""
    @Published var translating = false
    /// 実バックエンド（サインイン済みのときだけ AI 操作が動く）。
    private var apiBase: String?
    private var apiToken: String?
    private var conversationId: String?
    /// ユーザーが選んだローカルファイル由来の候補（Finder access）。transcript と混ぜて並べ替える。
    var fileCandidates: [ContextCandidate] = []
    @Published var audioLevels: [CGFloat] =
        [0.3, 0.5, 0.8, 0.4, 0.9, 0.6, 0.35, 0.7, 0.5, 0.85, 0.45, 0.6]

    /// 経過・状態の表示は astra-core（Rust）に一本化する（Swift 側で書き直さない）。
    var snapshot: RecordingSnapshot {
        AstraCoreBridge.snapshot(
            elapsedMs: UInt64(elapsedSeconds) * 1000,
            isPaused: isPaused,
            link: .online,
            pendingMs: 0)
    }
    var elapsedText: String { snapshot.elapsedLabel }
    var heroText: String { snapshot.heroText }

    /// §17: 決定的な固定画面。
    func loadDemo(ragOpen: Bool) {
        isRecording = true
        isPaused = false
        elapsedSeconds = 4 * 60 + 21
        selectedTool = .transcript
        self.ragOpen = ragOpen
        transcript = [
            TranscriptSegment(speaker: "田中", text: "それでは 9 月 12 日に出しましょう。", interim: false),
            TranscriptSegment(speaker: "あなた", text: "了解しました。", interim: false),
            TranscriptSegment(speaker: "鈴木", text: "OAuth だけ確認お願いします。", interim: true),
        ]
        refreshRag()
    }

    /// いま話していることに近い文脈を、この会議の中身から core で並べ替える。
    /// 候補は transcript から作る実データ。ランキングは core（Swift 側で書き直さない）。
    /// 外部コネクタ（Gmail/Drive 等）の候補は接続後にここへ足す。
    func refreshRag() {
        let segments = transcript
        guard !segments.isEmpty else { ragResults = []; return }
        // 直近の発話から検索語を作る（小文字化・記号除去）。
        let latest = segments.last?.text ?? ""
        let terms = latest.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count >= 2 }
        var candidates: [ContextCandidate] = segments.enumerated().map { i, seg in
            ContextCandidate(
                id: seg.id.uuidString,
                text: seg.text,
                source: .meeting,
                ageSeconds: UInt64((segments.count - i) * 30),
                projectMatch: true)
        }
        // ローカルファイル（Finder access）由来の候補も同じ土俵で並べ替える。
        candidates.append(contentsOf: fileCandidates)
        // 前面アプリで選択中のテキスト（AX）があれば、外から来た文脈として足す。
        for lite in AccessibilityContext.candidate() {
            candidates.append(ContextCandidate(
                id: lite.id, text: lite.text, source: .message, ageSeconds: 0, projectMatch: true))
        }
        let byId = Dictionary(uniqueKeysWithValues: candidates.map { ($0.id, $0) })
        let ranked = AstraCoreBridge.rankContext(terms: terms, limit: 5, candidates: candidates)
        ragResults = ranked.compactMap { r in
            guard let c = byId[r.id] else { return nil }
            return RankedContext(id: r.id, title: c.text, source: c.source, score: r.score, reason: r.reason)
        }
    }

    /// フォルダを選んで RAG のローカルファイル候補にする（Finder access）。
    func addFileContext(directory: URL) {
        fileCandidates = FileContext.candidates(inDirectory: directory)
        refreshRag()
    }

    /// ユーザーにフォルダを選ばせて RAG のローカルファイル候補にする（Finder access）。
    /// **選んだフォルダだけを読む**（全ディスクを漁らない）。
    func pickFileContext() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "このフォルダを文脈に使う"
        if panel.runModal() == .OK, let dir = panel.url {
            addFileContext(directory: dir)
        }
    }

    func start() {
        isRecording = true
        // 経過時間を実際に進める（一時停止中は止める）。以前は 0 のままだった。
        elapsedSeconds = 0
        tickTimer?.invalidate()
        tickTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, self.isRecording, !self.isPaused else { return }
            self.elapsedSeconds += 1
        }
        // オンデバイス STT の途中経過/確定を transcript に反映する。
        RecordingRuntime.shared.onTranscript = { [weak self] text, isFinal in
            guard let self else { return }
            // 直近の interim を置き換え、確定したら確定行にする（重なりは core の merge に委ねる設計）。
            if let last = self.transcript.last, last.interim {
                self.transcript[self.transcript.count - 1] =
                    TranscriptSegment(speaker: "あなた", text: text, interim: !isFinal)
            } else {
                self.transcript.append(TranscriptSegment(speaker: "あなた", text: text, interim: !isFinal))
            }
            self.refreshRag()
        }
        // 波形を実マイクレベルで更新する（デモの固定値をやめてフラットから始める）。
        audioLevels = Array(repeating: 0.06, count: 12)
        RecordingRuntime.shared.onLevel = { [weak self] level in
            guard let self else { return }
            self.audioLevels.removeFirst()
            self.audioLevels.append(CGFloat(level))
        }
        // 実ランタイム: マイク → astra-core → ディスク断片（許可があればライブ取り込み + 手元 STT）
        let localId = "meeting-\(Int(Date().timeIntervalSince1970))"
        RecordingRuntime.shared.begin(meetingId: localId)
        // スクショ等は実際に journal を作った id に合わせる（サインイン時は gateway id）。
        currentMeetingId = RecordingRuntime.shared.activeMeetingId
        WindowCoordinator.shared.enterRecordingMode()
    }
    func stop() {
        isRecording = false
        tickTimer?.invalidate(); tickTimer = nil
        RecordingRuntime.shared.end()   // 断片を確定（回復候補として残る）
        WindowCoordinator.shared.leaveRecordingMode()
    }
    /// サインイン済みセッションを渡す（Main Window のサインインから）。
    func configureBackend(base: String, token: String) {
        apiBase = base; apiToken = token; conversationId = nil
    }

    /// AI 操作。transcript を Agent（会話）に渡して結果を得る。要約/質問/決定事項/アクション。
    /// 同期 I/O なのでバックグラウンドで回し、結果を main で反映する。
    func runAIAction(_ title: String) {
        guard let base = apiBase, let token = apiToken else {
            aiResult = "サインインすると AI 操作が使えます。"; return
        }
        let transcriptText = transcript.map { "\($0.speaker): \($0.text)" }.joined(separator: "\n")
        let instruction: String
        switch title {
        case "リアルタイム要約": instruction = "次の会議の文字起こしを日本語で3行以内に要約して。"
        case "決定事項": instruction = "次の会議の文字起こしから決定事項だけを箇条書きで出して。"
        case "アクション": instruction = "次の会議の文字起こしから ToDo（担当と期限があれば付けて）を箇条書きで出して。"
        default: instruction = "次の会議の文字起こしについて答えて。"
        }
        aiRunning = true; aiResult = ""
        let prompt = instruction + "\n---\n" + (transcriptText.isEmpty ? "(まだ発話がありません)" : transcriptText)
        Task.detached { [weak self] in
            do {
                let conv: String
                if let existing = await self?.conversationId { conv = existing }
                else {
                    conv = try AstraCoreBridge.startConversation(base, accessToken: token)
                    await MainActor.run { self?.conversationId = conv }
                }
                let outcome = try AstraCoreBridge.sendTurn(base, accessToken: token, conversationId: conv, text: prompt)
                let text = !outcome.answer.isEmpty ? outcome.answer
                    : !outcome.notice.isEmpty ? outcome.notice
                    : outcome.needsClarification ? "詳しく教えてください。"
                    : "(応答なし)"
                await MainActor.run { self?.aiResult = text; self?.aiRunning = false }
            } catch {
                await MainActor.run { self?.aiResult = "AI 操作に失敗しました: \(error)"; self?.aiRunning = false }
            }
        }
    }

    /// 文字起こしを翻訳する（Agent 経由）。翻訳タブに切り替えたときに呼ぶ。
    func translate(to language: String = "英語") {
        guard let base = apiBase, let token = apiToken else {
            translatedText = "サインインすると翻訳できます。"; return
        }
        let source = transcript.map { $0.text }.joined(separator: "\n")
        guard !source.isEmpty else { translatedText = ""; return }
        translating = true; translatedText = ""
        let prompt = "次の文を\(language)に翻訳して。訳文だけ返して。\n---\n" + source
        Task.detached { [weak self] in
            do {
                let conv: String
                if let existing = await self?.conversationId { conv = existing }
                else {
                    conv = try AstraCoreBridge.startConversation(base, accessToken: token)
                    await MainActor.run { self?.conversationId = conv }
                }
                let outcome = try AstraCoreBridge.sendTurn(base, accessToken: token, conversationId: conv, text: prompt)
                let text = !outcome.answer.isEmpty ? outcome.answer
                    : !outcome.notice.isEmpty ? outcome.notice : "(訳を取得できませんでした)"
                await MainActor.run { self?.translatedText = text; self?.translating = false }
            } catch {
                await MainActor.run { self?.translatedText = "翻訳に失敗しました: \(error)"; self?.translating = false }
            }
        }
    }

    func togglePause() {
        isPaused.toggle()
        RecordingRuntime.shared.setPaused(isPaused)   // 実際に録音を止める（core が sample を捨てる）
    }
    /// 画面文脈を 1 枚取り、会議フォルダに保存する（Context Lens / 後追いの手掛かり）。
    /// 保存先パスを返す（失敗時 nil）。実フレーム取得は ScreenContextCapture（画面収録許可が要る）。
    @discardableResult
    func captureScreenshot() -> String? {
        guard #available(macOS 14.0, *), let image = ScreenContextCapture.captureFrameCG() else { return nil }
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Astra/meetings/\(currentMeetingId)/screens", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("screen-\(Int(Date().timeIntervalSince1970)).png")
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return url.path
    }
}

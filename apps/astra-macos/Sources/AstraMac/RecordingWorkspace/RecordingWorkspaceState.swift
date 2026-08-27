import SwiftUI
import AppKit
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
    @Published var isPaused = false
    @Published var elapsedSeconds = 0
    @Published var selectedTool: RecordingTool = .transcript
    @Published var ragOpen = false
    @Published var transcript: [TranscriptSegment] = []
    /// RAG コンテキストの並べ替え結果（core の rank_context 由来）。
    @Published var ragResults: [RankedContext] = []
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
        // 実ランタイム: マイク → astra-core → ディスク断片（許可があればライブ取り込み + 手元 STT）
        RecordingRuntime.shared.begin(meetingId: "meeting-\(Int(Date().timeIntervalSince1970))")
        WindowCoordinator.shared.enterRecordingMode()
    }
    func stop() {
        isRecording = false
        RecordingRuntime.shared.end()   // 断片を確定（回復候補として残る）
        WindowCoordinator.shared.leaveRecordingMode()
    }
    func togglePause() { isPaused.toggle() }
    func captureScreenshot() {}
}

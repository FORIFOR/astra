import SwiftUI
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
    }

    func start() {
        isRecording = true
        // 実ランタイム: マイク → astra-core → ディスク断片（許可があればライブ取り込み）
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

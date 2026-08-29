import Foundation

// 仕様書 §5 / §15 / §16 / §21 / §25 のデータモデル。
// ここは**モデルだけ**。engine は各 Module が持ち、状態は AstraStateStore が一箇所で持つ。

/// §5 Astra の唯一の活動状態。UI ごとに勝手な mode を作らない。
enum AstraMode: String, Equatable {
    case idle, listening, transcribing, thinking, acting
    case awaitingConfirmation, completed, failed
    case meeting, workspace
}

/// Task Dock が何を見せているか。`AstraMode` は「何が起きているか」、こちらは「何を出しているか」。
/// 分けているのは、勧誘や Quick Actions が **活動ではない**ため（idle のまま出る）。
enum DockPresentation: Equatable {
    case idle
    case listening
    case transcribing(String)
    case thinking
    case contextualApp(AppSuggestion)
    case quickActions
    case enteringRecording
}

// MARK: - §7 / §25 Context

/// §7 情報源。数字が小さいほど信頼できる（Browser DOM > AX > ... > OCR）。
enum ContextSourceKind: Int, Comparable, CaseIterable {
    case browserDOM = 1
    case accessibility = 2
    case nativeApp = 3
    case screenVision = 4
    case ocr = 5

    static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }

    var label: String {
        switch self {
        case .browserDOM: return "ブラウザ"
        case .accessibility: return "画面の要素"
        case .nativeApp: return "アプリ連携"
        case .screenVision: return "画面"
        case .ocr: return "文字認識"
        }
    }
}

/// §25 その情報がどれくらい機微か。UI に必ず出す。
enum ContextSensitivity: String {
    case public_ = "public"
    case workspace
    case personal
    case secret
}

/// §7 / §25 AI へ渡す文脈の 1 件（`ContextLensView` の表示用 ContextFact とは別物）。**出所を必ず持つ**。持たない文脈は作らない。
struct ContextFact: Identifiable, Equatable {
    let id = UUID()
    let source: ContextSourceKind
    let application: String
    let sensitivity: ContextSensitivity
    let summary: String
    /// 取り込んだ時刻と有効期限。古い文脈を黙って使い続けない。
    let capturedAt: Date
    let expiresAt: Date

    func isFresh(_ now: Date = Date()) -> Bool { now < expiresAt }
}

/// 束ねたもの。同じことを別の source が言っている場合は**優先度の高い方だけ**残す。
struct ContextBundle: Equatable {
    var items: [ContextFact] = []

    /// UI に出す「AI がいま見ているもの」。
    var visibleSources: [String] { items.map { "\($0.application) · \($0.source.label)" } }

    static func resolved(_ raw: [ContextFact], now: Date = Date()) -> ContextBundle {
        // 期限切れは捨てる。同じ application は最も信頼できる source を 1 件だけ残す。
        var best: [String: ContextFact] = [:]
        for item in raw where item.isFresh(now) {
            if let existing = best[item.application], existing.source <= item.source { continue }
            best[item.application] = item
        }
        return ContextBundle(items: best.values.sorted { $0.source < $1.source })
    }
}

// MARK: - §15 Agent

/// 進行状態。`AstraCore.TaskStatus` とは別物なので名前を分ける。
enum AgentRunState: String, Equatable { case pending, running, success, failed }

struct AgentStep: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let tool: String
    var state: AgentRunState = .pending
}

struct AgentTask: Identifiable, Equatable {
    let id: UUID
    let title: String
    var status: AgentRunState
    var steps: [AgentStep]
    var startedAt: Date
    var context: ContextBundle
}

// MARK: - §16 / §17 Action risk

/// §16 全 Action は 4 段階。**確認の要否はここだけで決める**（呼び出し側の気分で変えない）。
enum ActionRiskLevel: Int, Comparable {
    case r0 = 0   // 読むだけ
    case r1 = 1   // ローカルかつ可逆
    case r2 = 2   // 外部への副作用
    case r3 = 3   // 重大・不可逆

    static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }

    /// 確認カードを出すか。R0/R1 は出さない（毎回聞くと、聞くこと自体が無意味になる）。
    var needsConfirmation: Bool { self >= .r2 }

    var label: String {
        switch self {
        case .r0: return "読み取りのみ"
        case .r1: return "この Mac の中 · 取り消せる"
        case .r2: return "外部に出る"
        case .r3: return "元に戻せない"
        }
    }
}

/// §17 確認は AI の文章で聞かない。カードに出す。
struct ActionConfirmation: Identifiable, Equatable {
    let id = UUID()
    /// 「何が起きるか」を結果の文で書く。「よろしいですか」とは書かない。
    let title: String
    let details: [String]
    let risk: ActionRiskLevel
    /// ボタンの文字も結果を書く（「送信する」「3件削除する」）。
    let confirmLabel: String
}

// MARK: - §18 / §21 Meeting

struct MeetingState: Equatable {
    var meetingId: String?
    /// 会議アプリを検出しただけ。**検出は録音開始ではない**（§18）。
    var detectedApp: String?
    var isRecording: Bool = false
    var canvas: MeetingCanvas = MeetingCanvas()
}

/// §21 Markdown ではなく構造データ。UI はここから描く。
struct MeetingCanvas: Equatable {
    var decisions: [String] = []
    var actions: [String] = []
    var questions: [String] = []
    var concerns: [String] = []
    var notes: [String] = []

    var isEmpty: Bool {
        decisions.isEmpty && actions.isEmpty && questions.isEmpty && concerns.isEmpty && notes.isEmpty
    }
}

// MARK: - §5 全体

struct AstraState: Equatable {
    var mode: AstraMode = .idle
    var dock: DockPresentation = .idle
    var context = ContextBundle()
    var activeTask: AgentTask?
    var meeting = MeetingState()
    var confirmation: ActionConfirmation?
}

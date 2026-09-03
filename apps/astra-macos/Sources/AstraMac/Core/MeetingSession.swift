import Foundation

/// 録音した会議 1 回分。**Home も Dock も Workspace もこれを見る。**
///
/// 「録音ファイル」ではなく「会議」を持つ。だからファイル名や尺ではなく、
/// 題・要約・決まったこと・やること・参加人数が主語になる。
struct MeetingSession: Identifiable, Equatable {
    enum Status: String, Equatable {
        /// いま録っている。
        case recording
        /// 録り終えて、読み取りをしている途中。段階は `processingStage` に持つ。
        case processing
        /// 使える。
        case ready
        /// 途中で異常終了した。**勝手に ready にしない。**
        case interrupted
        case failed

        /// Home のカードに出る 1 行。Dock と同じ語で言う（面ごとに言い換えない）。
        /// 「Interrupted recording」と英語だけ残っていて、Dock の
        /// 「途中で終わっています」と同じ状態に見えなかった（Journey J-C）。
        var label: String {
            switch self {
            case .recording: return "録音中"
            case .processing: return "会話を読み取っています…"
            case .ready: return "使えます"
            case .interrupted: return "途中で終わっています"
            case .failed: return "失敗しました"
            }
        }
    }

    /// どこに置くか。既定は自分だけ。
    enum Visibility: String, Equatable, CaseIterable {
        case mySpace, workspace
        var label: String {
            switch self {
            // 説明文（detail）は日本語なのに、名札だけ英語だった。揃える。
            case .mySpace: return "自分だけ"
            case .workspace: return "みんなに公開"
            }
        }
        var detail: String {
            switch self {
            case .mySpace: return "自分だけが見られます"
            case .workspace: return "ワークスペースの全員が見られます"
            }
        }
    }

    let id: String
    var title: String
    var status: Status
    var startedAt: Date
    var endedAt: Date?
    /// 秒。録音中は startedAt からの経過で出す。
    var duration: TimeInterval {
        if let endedAt { return endedAt.timeIntervalSince(startedAt) }
        return Date().timeIntervalSince(startedAt)
    }

    var calendarEventId: String?
    var projectId: String?
    var visibility: Visibility = .mySpace
    var participantCount: Int = 0
    var summary: String?
    var actionCount: Int = 0
    var decisionCount: Int = 0
    /// processing の段階。spinner だけにしないための文言。
    var processingStage: ProcessingStage?
    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    /// 会議アプリや URL（Google Meet など）。
    var source: String?

    var isLive: Bool { status == .recording }

    /// 「今日 · 42 分」。録音中は経過を出す。
    /// 画面の言葉は日本語で揃える。英語と混ざると、どちらも読み飛ばされる。
    func timeLabel(now: Date = Date()) -> String {
        let minutes = Int((endedAt?.timeIntervalSince(startedAt) ?? now.timeIntervalSince(startedAt)) / 60)
        let cal = Calendar.current
        let day = cal.isDateInToday(startedAt) ? "今日"
            : cal.isDateInYesterday(startedAt) ? "昨日"
            : MeetingSession.dayFormatter.string(from: startedAt)
        return "\(day) · \(minutes) 分"
    }

    /// 録音中の経過（00:00）。
    func elapsedLabel(now: Date = Date()) -> String {
        let total = Int(max(0, now.timeIntervalSince(startedAt)))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }

    static let dayFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "M/d"; return f
    }()
}

/// 読み取りの段階。何をしているかを言うためのもの。
enum ProcessingStage: String, Equatable, CaseIterable {
    case savingTranscript, analyzing, extractingActions, preparingNotes

    var label: String {
        switch self {
        case .savingTranscript: return "文字起こしを保存しています…"
        case .analyzing: return "会話を読み取っています…"
        case .extractingActions: return "やることを拾っています…"
        case .preparingNotes: return "メモを整えています…"
        }
    }
}

/// 予定に紐づく最小限。Calendar から録ったときに引き継ぐ。
struct CalendarLink: Equatable {
    let eventId: String
    let title: String
    let participantCount: Int
    let meetingURL: String?
    /// 予定に project が設定されていれば、それを継承する。
    let projectId: String?
}

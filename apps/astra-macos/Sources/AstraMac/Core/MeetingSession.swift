import Foundation

/// 録音した会議 1 回分。**Home も Dock も Workspace もこれを見る。**
///
/// 「録音ファイル」ではなく「会議」を持つ。だからファイル名や尺ではなく、
/// 題・要約・決まったこと・やること・参加人数が主語になる。
struct MeetingSession: Identifiable, Equatable {
    enum Status: String, Equatable {
        /// いま録っている。
        case recording
        /// 録り終えて、読み取りをしている途中。
        case processing
        /// 使える。
        case ready
        /// 途中で異常終了した。**勝手に ready にしない。**
        case interrupted
        case failed

        var label: String {
            switch self {
            case .recording: return "Recording"
            case .processing: return "Analyzing conversation…"
            case .ready: return "Ready"
            case .interrupted: return "Interrupted recording"
            case .failed: return "Failed"
            }
        }
    }

    /// どこに置くか。既定は自分だけ。
    enum Visibility: String, Equatable, CaseIterable {
        case mySpace, workspace
        var label: String {
            switch self {
            case .mySpace: return "My Space"
            case .workspace: return "Workspace"
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
    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    /// 会議アプリや URL（Google Meet など）。
    var source: String?

    var isLive: Bool { status == .recording }

    /// 「Today · 42 min」。録音中は経過を出す。
    func timeLabel(now: Date = Date()) -> String {
        let minutes = Int((endedAt?.timeIntervalSince(startedAt) ?? now.timeIntervalSince(startedAt)) / 60)
        let cal = Calendar.current
        let day = cal.isDateInToday(startedAt) ? "Today"
            : cal.isDateInYesterday(startedAt) ? "Yesterday"
            : MeetingSession.dayFormatter.string(from: startedAt)
        return "\(day) · \(minutes) min"
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

/// 予定に紐づく最小限。Calendar から録ったときに引き継ぐ。
struct CalendarLink: Equatable {
    let eventId: String
    let title: String
    let participantCount: Int
    let meetingURL: String?
    /// 予定に project が設定されていれば、それを継承する。
    let projectId: String?
}

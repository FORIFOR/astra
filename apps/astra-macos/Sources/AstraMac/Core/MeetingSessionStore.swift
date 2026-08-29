import SwiftUI

/// 録音セッションの**唯一の置き場**。Home も Dock も Session Detail もここを見る。
///
/// 録音を始めた瞬間に 1 件作ってディスクへ書き、状態が変わるたびに同じ id を更新する。
/// 止めたときに新しいカードを作らない —— 同じカードが recording → processing → ready と
/// 姿を変えるのが、この機能のいちばん大事なところ。
@MainActor
final class MeetingSessionStore: ObservableObject {
    static let shared = MeetingSessionStore()

    @Published private(set) var sessions: [MeetingSession] = []

    /// いま録っているもの。無ければ nil。
    var live: MeetingSession? { sessions.first { $0.status == .recording } }

    /// 直近から並べたもの（Home の Recent Sessions）。
    var recent: [MeetingSession] {
        sessions.sorted { $0.startedAt > $1.startedAt }
    }

    func session(id: String) -> MeetingSession? { sessions.first { $0.id == id } }

    // MARK: - 録音の一生

    /// 録音開始。**ここで作って、ここで保存する**（あとで「保存しますか」とは聞かない）。
    @discardableResult
    func begin(id: String, title: String, link: CalendarLink? = nil,
               source: String? = nil, now: Date = Date()) -> MeetingSession {
        let name = link?.title ?? title
        var session = MeetingSession(id: id, title: name, status: .recording, startedAt: now)
        session.calendarEventId = link?.eventId
        // 予定に project があれば継承する。無ければ、同じ題で前に録ったときのものを使う。
        // どちらも無ければ持たない（推測で割り当てない）。
        session.projectId = link?.projectId ?? Self.rememberedProject(forTitle: name)
        session.visibility = .mySpace
        session.participantCount = link?.participantCount ?? 0
        session.createdAt = now
        session.updatedAt = now
        session.source = source ?? link?.meetingURL
        // 同じ id が既にあるなら作り直さない（二重に増やさない）。
        if let index = sessions.firstIndex(where: { $0.id == id }) {
            session.projectId = sessions[index].projectId ?? session.projectId
            sessions[index] = session
        } else {
            sessions.append(session)
        }
        // 予定から継承した project も覚える。次に同じ題で録るとき、
        // 予定に project が付いていなくても引き継げる（recurring meeting）。
        if let projectId = session.projectId {
            Self.rememberProject(projectId, forTitle: session.title)
        }
        persist(session)
        return session
    }

    /// 停止 → 読み取り中。まだ ready にしない。
    func beginProcessing(id: String, now: Date = Date()) {
        update(id) { s in
            s.status = .processing
            s.processingStage = .savingTranscript
            s.endedAt = now
            s.updatedAt = now
        }
    }

    /// 読み取りの段階を進める。「何をしているか」を出すため。
    func setProcessingStage(_ stage: ProcessingStage, for id: String) {
        update(id) { s in
            guard s.status == .processing else { return }
            s.processingStage = stage
            s.updatedAt = Date()
        }
    }

    /// 読み取りが終わった。ここで初めて中身が入る。
    func markReady(id: String, summary: String?, actions: Int, decisions: Int,
                   participants: Int? = nil, now: Date = Date()) {
        update(id) { s in
            s.status = .ready
            s.processingStage = nil
            s.summary = summary
            s.actionCount = actions
            s.decisionCount = decisions
            if let participants { s.participantCount = participants }
            s.updatedAt = now
        }
    }

    func markFailed(id: String, now: Date = Date()) {
        update(id) { s in s.status = .failed; s.updatedAt = now }
    }

    // MARK: - あとから変えられるもの

    func setVisibility(_ visibility: MeetingSession.Visibility, for id: String) {
        update(id) { $0.visibility = visibility; $0.updatedAt = Date() }
    }

    /// project は録音中でも後からでも変えられる。変えたら次の同名会議で引き継ぐ。
    func setProject(_ projectId: String?, for id: String) {
        update(id) { $0.projectId = projectId; $0.updatedAt = Date() }
        if let session = session(id: id) {
            Self.rememberProject(projectId, forTitle: session.title)
        }
    }

    private func update(_ id: String, _ change: (inout MeetingSession) -> Void) {
        guard let index = sessions.firstIndex(where: { $0.id == id }) else { return }
        change(&sessions[index])
        persist(sessions[index])
    }

    // MARK: - 保存と復元（§9）

    private func persist(_ session: MeetingSession) {
        LocalStore.shared.saveSession(session)
    }

    /// 起動時に読み戻す。**recording のまま残っていたものは interrupted にする**
    /// —— 前回落ちただけなのに ready 扱いすると、中身の無い会議が「使える」ことになる。
    func load(now: Date = Date()) {
        var loaded = LocalStore.shared.loadSessions()
        for index in loaded.indices where loaded[index].status == .recording {
            loaded[index].status = .interrupted
            loaded[index].endedAt = loaded[index].endedAt ?? loaded[index].updatedAt
            LocalStore.shared.saveSession(loaded[index])
        }
        sessions = loaded
    }

    /// テスト用。
    func reset() { sessions.removeAll() }

    // MARK: - 会議名 → project の記憶（§6 recurring）

    private static let projectMemoKey = "astra.projectByMeetingTitle"

    static func rememberProject(_ projectId: String?, forTitle title: String) {
        var memo = UserDefaults.standard.dictionary(forKey: projectMemoKey) as? [String: String] ?? [:]
        if let projectId { memo[title] = projectId } else { memo.removeValue(forKey: title) }
        UserDefaults.standard.set(memo, forKey: projectMemoKey)
    }

    /// 同じ題の会議を前に録っていれば、そのときの project を使う（毎回選ばせない）。
    static func rememberedProject(forTitle title: String) -> String? {
        (UserDefaults.standard.dictionary(forKey: projectMemoKey) as? [String: String])?[title]
    }
}

/// project の一覧。いまは端末内の固定＋利用者が使ったもの。
@MainActor
enum Projects {
    static let builtin = ["Product", "Sales", "Research", "1:1"]

    static func all() -> [String] {
        let memo = UserDefaults.standard.dictionary(forKey: "astra.projectByMeetingTitle") as? [String: String] ?? [:]
        let used = Array(memo.values)
        return Array(Set(builtin + used)).sorted()
    }
}

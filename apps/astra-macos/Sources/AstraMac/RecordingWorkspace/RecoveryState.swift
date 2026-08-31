import Foundation
import AstraCore

/// 前回落ちたまま残っている録音（未アップロード断片）を保持する。起動時にスキャンして入れる。
/// サインイン後に `recoverAll()` で gateway へ送って片付ける。
@MainActor
final class RecoveryState: ObservableObject {
    static let shared = RecoveryState()
    @Published var pending: [RecoverableMeeting] = []

    /// まとめて捨てる。**音は消える。戻せない。**呼ぶ前に必ず確認を取ること。
    /// 捨てた件数を返す。
    @discardableResult
    func discardAll() -> Int {
        var n = 0
        for meeting in pending where RecordingRuntime.shared.discard(meetingId: meeting.meetingId) { n += 1 }
        pending = []
        return n
    }

    /// 見つかった録音をまとめて復旧する（サインイン済みのときだけ実際に送れる）。送れたバイト合計を返す。
    @discardableResult
    func recoverAll() -> UInt64 {
        var total: UInt64 = 0
        for meeting in pending {
            total += RecordingRuntime.shared.recover(meetingId: meeting.meetingId)
        }
        pending = []
        return total
    }
}

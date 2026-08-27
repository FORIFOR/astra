import Foundation
import AstraCore

/// 録音の実行時。マイク → astra-core(RecordingSession) → ディスク断片。
/// SwiftUI から直接触らず、State/Bridge 経由で使う。
@MainActor
final class RecordingRuntime {
    static let shared = RecordingRuntime()

    private var session: RecordingSession?
    private var mic: MicCapture?
    /// 実 gateway に作った会議（サインイン時のみ）。無ければローカル録音だけ。
    private var meetingId: String?
    private var apiBase: String?
    private var accessToken: String?

    /// サインイン済みなら、実バックエンドの会議 id を使って録音する。
    func configureBackend(base: String, accessToken: String) {
        self.apiBase = base
        self.accessToken = accessToken
    }

    /// 保存先（Application Support/Astra/meetings）。core の既定と同じ。
    private var root: String {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        return (base ?? URL(fileURLWithPath: NSTemporaryDirectory()))
            .appendingPathComponent("Astra/meetings").path
    }

    /// core にセッションを作り、（可能なら）マイクを開く。live 取り込みは .app + 許可が要る。
    @discardableResult
    func begin(meetingId localId: String, captureMic: Bool = true) -> Bool {
        try? FileManager.default.createDirectory(
            atPath: root, withIntermediateDirectories: true)
        // サインイン済みなら実 gateway に会議を作り、その id で録音する（Tauri を介さない）
        var id = localId
        if let base = apiBase, let token = accessToken,
           let created = try? AstraCoreBridge.createMeeting(base, accessToken: token, title: "会議", language: "ja-JP") {
            id = created
            self.meetingId = created
        }
        guard let session = try? RecordingSession.start(root: root, meetingId: id) else {
            return false
        }
        self.session = session
        if captureMic {
            let mic = MicCapture()
            do {
                try mic.start { [weak session] frame in
                    _ = session?.pushSamples(samples: frame, sampleRate: 16_000)
                }
                self.mic = mic
            } catch {
                // マイクが開けなくてもセッションは成り立たせる（サンプルは外から push できる）
                NSLog("mic capture unavailable: \(error)")
            }
        }
        return true
    }

    /// テスト・外部音源用に直接サンプルを流す（headless E2E で使う）。
    func push(_ samples: [Float], sampleRate: UInt32) {
        _ = session?.pushSamples(samples: samples, sampleRate: sampleRate)
    }

    func snapshot() -> RecordingSnapshot? { session?.snapshot() }
    func recordedMs() -> UInt64 { session?.recordedMs() ?? 0 }
    func setPaused(_ paused: Bool) { session?.setPaused(paused: paused) }

    /// 停止して確定。書けた断片は残り、回復候補になる。
    func end() {
        mic?.stop(); mic = nil
        try? session?.finish()
        session = nil
        // 実 gateway の会議なら、録音を送ってから finalize を投げる（作成→録音→送信→終了）
        if let base = apiBase, let token = accessToken, let id = meetingId {
            _ = try? AstraCoreBridge.uploadMeetingAudio(base, accessToken: token, meetingId: id, journalRoot: root)
            _ = try? AstraCoreBridge.finishMeeting(base, accessToken: token, meetingId: id)
        }
        meetingId = nil
    }
}

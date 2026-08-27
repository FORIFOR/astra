import Foundation
import AstraCore

/// `--selftest record`: Swift → astra-core → 実ディスク の E2E。UI を出さずに検証する。
/// マイク許可の要らない合成サンプルを流し、断片ファイルが実際に書かれることを確かめる。
enum SelfTest {
    @MainActor
    static func run(_ args: [String]) -> Bool {
        guard let i = args.firstIndex(of: "--selftest"), i + 1 < args.count else { return false }
        switch args[i + 1] {
        case "record": recordToDisk(); return true
        case "lifecycle": lifecycle(); return true
        case "api": api(args); return true
        case "shortcut": shortcut(); return true
        default: return false
        }
    }

    /// begin → push → end の実ランタイム経路（I/O のみ、window は触らない）。
    @MainActor
    private static func lifecycle() {
        let runtime = RecordingRuntime.shared
        guard runtime.begin(meetingId: "lifecycle-selftest", captureMic: false) else {
            print("SELFTEST_FAIL lifecycle begin"); exit(2)
        }
        let oneSec = [Float](repeating: 0.1, count: 16_000)
        for _ in 0..<6 { runtime.push(oneSec, sampleRate: 16_000) }
        let elapsed = runtime.snapshot()?.elapsedLabel ?? "?"
        runtime.end()
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Astra/meetings").path
        let ok = scanRecoverable(root: root, active: nil).contains { $0.meetingId == "lifecycle-selftest" }
        try? FileManager.default.removeItem(atPath: root + "/lifecycle-selftest")
        guard elapsed == "00:05", ok else { print("SELFTEST_FAIL lifecycle elapsed=\(elapsed) recovered=\(ok)"); exit(3) }
        print("SELFTEST_OK lifecycle: elapsed=\(elapsed) recovered=\(ok)")
        exit(0)
    }

    /// `--selftest api <base_url>`: Swift → core → gateway → DB の実往復。
    private static func api(_ args: [String]) {
        let base = args.count > (args.firstIndex(of: "--selftest")! + 2)
            ? args[args.firstIndex(of: "--selftest")! + 2] : "http://127.0.0.1:3000"
        guard AstraCoreBridge.reachable(base) else { print("SELFTEST_FAIL api unreachable \(base)"); exit(2) }
        let email = "selftest-api-\(getpid())@astra.local"
        do {
            let tokens = try AstraCoreBridge.devSignIn(base, email: email, displayName: "SelfTest API")
            let me = try AstraCoreBridge.me(base, accessToken: tokens.accessToken)
            guard me.email == email, me.role == "owner" else {
                print("SELFTEST_FAIL api email=\(me.email) role=\(me.role)"); exit(3)
            }
            let mid = try AstraCoreBridge.createMeeting(base, accessToken: tokens.accessToken, title: "SelfTest 会議", language: "ja-JP")
            // 実録音 → 送信 → 終了（すべて core 経由、Tauri なし）
            let root = NSTemporaryDirectory() + "astra-api-rec-\(getpid())"
            try? FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
            let session = try RecordingSession.start(root: root, meetingId: mid)
            let oneSec = [Float](repeating: 0.1, count: 16_000)
            for _ in 0..<6 { _ = session.pushSamples(samples: oneSec, sampleRate: 16_000) }
            try session.finish()
            let sent = try AstraCoreBridge.uploadMeetingAudio(base, accessToken: tokens.accessToken, meetingId: mid, journalRoot: root)
            try? FileManager.default.removeItem(atPath: root)
            let task = try AstraCoreBridge.finishMeeting(base, accessToken: tokens.accessToken, meetingId: mid)
            // 会話/Agent と Apps も core 経由で実 gateway に繋がることを確認
            let conv = try AstraCoreBridge.startConversation(base, accessToken: tokens.accessToken)
            let outcome = try AstraCoreBridge.sendTurn(base, accessToken: tokens.accessToken, conversationId: conv, text: "テスト依頼")
            let apps = try AstraCoreBridge.pluginCatalog(base, accessToken: tokens.accessToken)
            let convOk = outcome.needsClarification || !outcome.answer.isEmpty || !outcome.taskId.isEmpty || !outcome.notice.isEmpty
            // Agent round-trip: echo タスク → COMPLETED + 成果物
            let atask = try AstraCoreBridge.createTask(base, accessToken: tokens.accessToken, kind: "echo", inputJson: "{\"message\":\"selftest\",\"steps\":1}")
            let done = try AstraCoreBridge.waitTask(base, accessToken: tokens.accessToken, taskId: atask, timeoutMs: 15_000)
            let content = try AstraCoreBridge.artifactContent(base, accessToken: tokens.accessToken, artifactId: done.resultArtifactId)
            let library = try AstraCoreBridge.library(base, accessToken: tokens.accessToken)
            guard !mid.isEmpty, sent > 0, !task.isEmpty, !conv.isEmpty, convOk, !apps.isEmpty,
                  done.status == "COMPLETED", !done.resultArtifactId.isEmpty, !content.isEmpty, !library.isEmpty else {
                print("SELFTEST_FAIL api meeting=\(mid) sent=\(sent) conv=\(conv) apps=\(apps.count) agent=\(done.status) content=\(content.count) lib=\(library.count)"); exit(5)
            }
            print("SELFTEST_OK api: meeting=\(mid) uploadedBytes=\(sent) apps=\(apps.count) agent=\(done.status) contentBytes=\(content.count) library=\(library.count)")
            exit(0)
        } catch {
            print("SELFTEST_FAIL api error=\(error)"); exit(4)
        }
    }

    /// `--selftest shortcut`: グローバルホットキーが OS に登録できることを検証する。
    /// TCC も GUI も要らない（押下の live 受信はユーザーが署名済み .app で確かめる）。
    @MainActor
    private static func shortcut() {
        var fired = false
        let ok = GlobalShortcut.shared.register { fired = true }
        let label = GlobalShortcut.label()
        GlobalShortcut.shared.unregister()
        guard ok else { print("SELFTEST_FAIL shortcut register"); exit(2) }
        print("SELFTEST_OK shortcut: registered=\(ok) combo=\(label) firedAtRegister=\(fired)")
        exit(0)
    }

    private static func recordToDisk() {
        let root = NSTemporaryDirectory() + "astra-selftest-\(getpid())"
        try? FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
        guard let session = try? RecordingSession.start(root: root, meetingId: "selftest") else {
            print("SELFTEST_FAIL could not start session"); exit(2)
        }
        // 6 秒相当の合成正弦を 16 kHz で流す（5 秒断片が 1 つ閉じる）。
        let rate: UInt32 = 16_000
        var closed: UInt32 = 0
        for sec in 0..<6 {
            var frame = [Float](repeating: 0, count: Int(rate))
            for n in 0..<frame.count {
                frame[n] = 0.3 * sinf(2.0 * .pi * 440.0 * Float(n) / Float(rate) + Float(sec))
            }
            closed += session.pushSamples(samples: frame, sampleRate: rate)
        }
        let snap = session.snapshot()
        try? session.finish()

        let fragment = root + "/selftest/mic/000001.pcm"
        let exists = FileManager.default.fileExists(atPath: fragment)
        let size = (try? FileManager.default.attributesOfItem(atPath: fragment)[.size] as? Int) ?? 0
        let recoverable = scanRecoverable(root: root, active: nil)

        guard closed == 1, exists, (size ?? 0) > 0, snap.elapsedLabel == "00:05",
              recoverable.count == 1, recoverable[0].meetingId == "selftest"
        else {
            print("SELFTEST_FAIL closed=\(closed) exists=\(exists) size=\(size ?? 0) elapsed=\(snap.elapsedLabel) recoverable=\(recoverable.count)")
            exit(3)
        }
        try? FileManager.default.removeItem(atPath: root)
        print("SELFTEST_OK record: closed=\(closed) fragmentBytes=\(size ?? 0) elapsed=\(snap.elapsedLabel) recoverable=\(recoverable.count)")
        exit(0)
    }
}

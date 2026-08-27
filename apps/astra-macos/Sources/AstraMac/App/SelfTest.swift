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
            let task = try AstraCoreBridge.finishMeeting(base, accessToken: tokens.accessToken, meetingId: mid)
            guard !mid.isEmpty, !task.isEmpty else { print("SELFTEST_FAIL api meeting=\(mid) task=\(task)"); exit(5) }
            print("SELFTEST_OK api: email=\(me.email) meeting=\(mid) finalizeTask=\(task)")
            exit(0)
        } catch {
            print("SELFTEST_FAIL api error=\(error)"); exit(4)
        }
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

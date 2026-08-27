import Foundation
import CoreVideo
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
        case "sysaudio": sysaudio(); return true
        case "calendar": calendar(); return true
        case "screen": screen(); return true
        case "rag": rag(); return true
        case "keychain": keychain(); return true
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
            // 実サインインの refresh/device token を Keychain に保管し読み戻す（access token は保管しない）。
            try SessionStore.persist(tokens)
            let keptRefresh = (try? SessionStore.refreshToken()) ?? nil
            let refreshKept = keptRefresh == tokens.refreshToken && !tokens.refreshToken.isEmpty
            try? SessionStore.clear()
            guard !mid.isEmpty, sent > 0, !task.isEmpty, !conv.isEmpty, convOk, !apps.isEmpty,
                  done.status == "COMPLETED", !done.resultArtifactId.isEmpty, !content.isEmpty, !library.isEmpty, refreshKept else {
                print("SELFTEST_FAIL api meeting=\(mid) sent=\(sent) conv=\(conv) apps=\(apps.count) agent=\(done.status) content=\(content.count) lib=\(library.count) refreshKept=\(refreshKept)"); exit(5)
            }
            print("SELFTEST_OK api: meeting=\(mid) uploadedBytes=\(sent) apps=\(apps.count) agent=\(done.status) contentBytes=\(content.count) library=\(library.count) refreshInKeychain=\(refreshKept)")
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

    /// `--selftest sysaudio`: ScreenCaptureKit の音声取り込み構成を検証する。
    /// live capture は画面収録許可(TCC)が要るが、**構成の組み立ては TCC 無しで確かめられる**。
    @MainActor
    private static func sysaudio() {
        guard #available(macOS 13.0, *) else { print("SELFTEST_FAIL sysaudio needs macOS 13+"); exit(2) }
        let c = SystemAudioCapture.configuration()
        guard c.capturesAudio, c.sampleRate == 48_000, c.channelCount == 2, c.excludesCurrentProcessAudio else {
            print("SELFTEST_FAIL sysaudio config audio=\(c.capturesAudio) rate=\(c.sampleRate) ch=\(c.channelCount) excl=\(c.excludesCurrentProcessAudio)"); exit(3)
        }
        print("SELFTEST_OK sysaudio: capturesAudio=\(c.capturesAudio) sampleRate=\(c.sampleRate) channels=\(c.channelCount) excludesSelf=\(c.excludesCurrentProcessAudio)")
        exit(0)
    }

    /// `--selftest calendar`: EventKit の認可状態がプロンプト無しで読めることを検証する。
    /// 実データ取得はカレンダー許可(TCC)が要るが、状態の読み取りは TCC 無しで確かめられる。
    @MainActor
    private static func calendar() {
        let status = CalendarAccess.status()
        // 許可が無い環境では upcoming は空（推測で埋めない）ことも確かめる。
        let events = CalendarAccess.upcoming(hours: 12)
        let consistent = (status == .granted) || events.isEmpty
        guard consistent else { print("SELFTEST_FAIL calendar status=\(status.rawValue) events=\(events.count)"); exit(2) }
        print("SELFTEST_OK calendar: status=\(status.rawValue) upcoming=\(events.count)")
        exit(0)
    }

    /// `--selftest screen`: ScreenCaptureKit の静止フレーム構成を検証する。
    /// 実フレーム取得は画面収録許可(TCC)が要るが、構成の組み立ては TCC 無しで確かめられる。
    @MainActor
    private static func screen() {
        guard #available(macOS 14.0, *) else { print("SELFTEST_FAIL screen needs macOS 14+"); exit(2) }
        let c = ScreenContextCapture.configuration(width: 1280, height: 800)
        guard c.width == 1280, c.height == 800, !c.capturesAudio, c.pixelFormat == kCVPixelFormatType_32BGRA else {
            print("SELFTEST_FAIL screen config w=\(c.width) h=\(c.height) audio=\(c.capturesAudio)"); exit(3)
        }
        print("SELFTEST_OK screen: width=\(c.width) height=\(c.height) pixelFormat=BGRA audio=\(c.capturesAudio)")
        exit(0)
    }

    /// `--selftest rag`: RAG の並べ替えが core(rank_context) を通って決定的に効くか検証する。
    /// 語彙一致するものが上に来ること・根拠(reason)が付くことを確かめる（外部依存なし）。
    @MainActor
    private static func rag() {
        let candidates = [
            ContextCandidate(id: "a", text: "OAuth の確認をお願いします", source: .meeting, ageSeconds: 30, projectMatch: true),
            ContextCandidate(id: "b", text: "昼食はどこにしましょうか", source: .meeting, ageSeconds: 30, projectMatch: false),
            ContextCandidate(id: "c", text: "OAuth のトークン交換の話", source: .library, ageSeconds: 6000, projectMatch: false),
        ]
        let ranked = AstraCoreBridge.rankContext(terms: ["oauth"], limit: 5, candidates: candidates)
        guard let top = ranked.first, top.id == "a", ranked.count == 3, !top.reason.isEmpty,
              ranked.contains(where: { $0.id == "c" }) else {
            print("SELFTEST_FAIL rag top=\(ranked.first?.id ?? "nil") count=\(ranked.count)"); exit(2)
        }
        // 語彙一致しない b は最下位
        guard ranked.last?.id == "b" else { print("SELFTEST_FAIL rag last=\(ranked.last?.id ?? "nil")"); exit(3) }
        print("SELFTEST_OK rag: order=\(ranked.map { $0.id }.joined(separator: ",")) topScore=\(String(format: "%.2f", top.score)) reason=\(top.reason)")
        exit(0)
    }

    /// `--selftest keychain`: Keychain の set→get→delete→get(absent) 往復を検証する。
    /// 自プロセスの generic-password なので prompt は出ない（TCC/GUI 不要）。
    @MainActor
    private static func keychain() {
        let key = "astra.selftest.\(getpid())"
        let secret = "refresh-\(getpid())-秘密"
        do {
            try KeychainStore.set(key, secret)
            let read = try KeychainStore.get(key)
            try KeychainStore.set(key, secret + "-updated")   // upsert 上書き
            let read2 = try KeychainStore.get(key)
            try KeychainStore.delete(key)
            let afterDelete = try KeychainStore.get(key)
            try KeychainStore.delete(key)                     // 冪等（無くても成功）
            guard read == secret, read2 == secret + "-updated", afterDelete == nil else {
                print("SELFTEST_FAIL keychain read=\(read ?? "nil") read2=\(read2 ?? "nil") afterDelete=\(afterDelete ?? "nil")"); exit(2)
            }
            print("SELFTEST_OK keychain: roundtrip ok, absent=nil, delete idempotent, service=\(KeychainStore.service)")
            exit(0)
        } catch {
            print("SELFTEST_FAIL keychain error=\(error)"); exit(3)
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

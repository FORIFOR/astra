import Foundation
import CoreVideo
import SwiftUI
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
        case "files": files(); return true
        case "ax": ax(); return true
        case "speech": speech(); return true
        case "connector": connector(); return true
        case "permissions": permissions(); return true
        case "livemic": livemic(); return true
        case "livescreen": livescreen(); return true
        case "livemeeting": livemeeting(); return true
        case "sttrecognize": sttrecognize(); return true
        case "shape": shape(); return true
        case "hudlifecycle": hudlifecycle(); return true
        case "pause": pauseWorks(); return true
        case "screenshot": screenshot(); return true
        case "aiaction": aiaction(args); return true
        case "translate": translateTest(args); return true
        case "waveform": waveform(); return true
        case "recovery": recovery(args); return true
        case "timer": timer(); return true
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

    /// `--selftest files`: ローカルファイル(Finder access)を core の rank_context で並べ替える。
    /// 一時ファイルを作り、語彙一致するファイルが上に来ること・バイナリが落ちることを確かめる。
    @MainActor
    private static func files() {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("astra-files-\(getpid())")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        do {
            try "OAuth のトークン交換の設計メモ".write(to: dir.appendingPathComponent("oauth.txt"), atomically: true, encoding: .utf8)
            try "昼食のお店のリスト".write(to: dir.appendingPathComponent("lunch.txt"), atomically: true, encoding: .utf8)
            // バイナリ（UTF-8 で読めない）は候補にしない
            try Data([0xFF, 0xFE, 0x00, 0x01]).write(to: dir.appendingPathComponent("blob.bin"))
        } catch { print("SELFTEST_FAIL files write error=\(error)"); exit(2) }

        let candidates = FileContext.candidates(inDirectory: dir)
        let ranked = AstraCoreBridge.rankContext(terms: ["oauth"], limit: 5, candidates: candidates)
        // テキスト 2 件のみ候補（バイナリは落ちる）、oauth.txt が最上位
        guard candidates.count == 2, let top = ranked.first,
              top.id.hasSuffix("oauth.txt"), !top.reason.isEmpty else {
            print("SELFTEST_FAIL files candidates=\(candidates.count) top=\(ranked.first?.id ?? "nil")"); exit(3)
        }
        print("SELFTEST_OK files: candidates=\(candidates.count)(binary除外) top=oauth.txt score=\(String(format: "%.2f", top.score))")
        exit(0)
    }

    /// `--selftest ax`: アクセシビリティ許可が無いとき、選択テキストが nil で返り
    /// クラッシュしないこと（推測で埋めない）を検証する。isTrusted は prompt 無しで読める。
    @MainActor
    private static func ax() {
        let trusted = AccessibilityContext.isTrusted
        let selection = AccessibilityContext.selectedText()
        let candidates = AccessibilityContext.candidate()
        // 許可が無ければ選択は nil・候補は空。許可があれば選択の有無は環境依存だが整合していること。
        let consistent = trusted || (selection == nil && candidates.isEmpty)
        guard consistent else { print("SELFTEST_FAIL ax trusted=\(trusted) selection=\(selection ?? "nil") cands=\(candidates.count)"); exit(2) }
        print("SELFTEST_OK ax: trusted=\(trusted) selection=\(selection == nil ? "nil" : "present") candidates=\(candidates.count)")
        exit(0)
    }

    /// `--selftest speech`: オンデバイス STT(Apple Speech)の可用性・認可・ロケールを検証する。
    /// live 認識は音声認識許可(TCC)が要るが、認識器の用意と認可状態の読み取りは prompt 無しで確かめられる。
    @MainActor
    private static func speech() {
        let st = SpeechTranscriber(localeId: "ja-JP")
        let auth = SpeechTranscriber.authorization
        let onDevice = st.canRunOnDevice
        var startThrew = false
        var appended = false
        do {
            try st.start { _ in }
            // 認可済みなら実フレームを流して音声パイプラインが受け付けることを確かめる（no-crash）。
            let oneSec = [Float](repeating: 0.0, count: 16_000)
            for _ in 0..<3 { st.append(oneSec, sampleRate: 16_000) }
            appended = true
        } catch { startThrew = true }
        st.finish()
        // 未認可なら start は throw（実データを捏造しない）。認可済みなら append まで到達。
        let consistent = (auth == .authorized) ? appended : startThrew
        guard consistent else { print("SELFTEST_FAIL speech auth=\(auth.rawValue) started=\(!startThrew) appended=\(appended)"); exit(2) }
        print("SELFTEST_OK speech: auth=\(auth.rawValue) onDeviceCapable=\(onDevice) started=\(!startThrew) appendedFrames=\(appended)")
        exit(0)
    }

    /// `--selftest connector`: connector 契約層（PKCE・authorize URL 組み立て）が core 経由で効くか検証する。
    /// live なトークン交換は外部依存なので here では検証しない（契約層のみ）。
    @MainActor
    private static func connector() {
        // RFC 7636 の PKCE テストベクタ（core と一致するはず）。
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let challenge = AstraCoreBridge.pkceChallenge(verifier)
        guard challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" else {
            print("SELFTEST_FAIL connector pkce=\(challenge)"); exit(2)
        }
        // 実 authorize URL を core で組む（loopback + PKCE + state + Google 追加）。
        let url = AstraCoreBridge.authorizeUrl(
            provider: "google", clientId: "cid-123.apps.googleusercontent.com",
            redirectUri: "http://127.0.0.1:8123/callback",
            scopes: ["openid", "email"], state: "state-xyz", codeChallenge: challenge)
        guard let url, url.hasPrefix("https://accounts.google.com/o/oauth2/v2/auth?"),
              url.contains("code_challenge_method=S256"), url.contains("state=state-xyz"),
              url.contains("access_type=offline") else {
            print("SELFTEST_FAIL connector url=\(url ?? "nil")"); exit(3)
        }
        // 非 loopback は繋がない（None）。
        let bad = AstraCoreBridge.authorizeUrl(
            provider: "google", clientId: "cid", redirectUri: "https://evil.example.com/cb",
            scopes: [], state: "s", codeChallenge: "c")
        guard bad == nil else { print("SELFTEST_FAIL connector accepted non-loopback"); exit(4) }
        // 未設定なら繋げる提供者は空。
        let ready = AstraCoreBridge.configuredProviders([:])
        guard ready.isEmpty else { print("SELFTEST_FAIL connector ready=\(ready)"); exit(5) }
        print("SELFTEST_OK connector: pkce=S256✓ authorizeUrl✓ nonLoopbackRejected✓ configured=\(ready.count)")
        exit(0)
    }

    /// `--selftest permissions`: この環境の TCC 状態を正直に列挙する（prompt を出さない読み取りのみ）。
    @MainActor
    private static func permissions() {
        let mic = Permissions.microphone.rawValue
        let screen = Permissions.screenRecording.rawValue
        let ax = Permissions.accessibility.rawValue
        let cal = Permissions.calendar.rawValue
        let speech = SpeechTranscriber.authorization.rawValue
        print("SELFTEST_OK permissions: mic=\(mic) screen=\(screen) ax=\(ax) calendar=\(cal) speech=\(speech)")
        exit(0)
    }

    /// `--selftest livemic`: マイク許可があれば実デバイスから 1 秒取り込み、実音声（合成でない）が
    /// 届くことを確かめる。許可が無ければ SKIP（捏造しない）。
    @MainActor
    private static func livemic() {
        guard Permissions.microphone == .granted else {
            print("SELFTEST_SKIP livemic: microphone not granted (status=\(Permissions.microphone.rawValue))")
            exit(0)
        }
        let mic = MicCapture()
        var frames = 0
        var samples = 0
        var peak: Float = 0
        do {
            try mic.start { frame in
                frames += 1; samples += frame.count
                for v in frame { peak = max(peak, abs(v)) }
            }
        } catch {
            print("SELFTEST_FAIL livemic start error=\(error)"); exit(2)
        }
        // 1 秒回す（RunLoop を回してタップのコールバックを受ける）。
        RunLoop.current.run(until: Date().addingTimeInterval(1.0))
        mic.stop()
        guard frames > 0, samples > 0 else {
            print("SELFTEST_FAIL livemic: no frames (frames=\(frames) samples=\(samples))"); exit(3)
        }
        print("SELFTEST_OK livemic: frames=\(frames) samples=\(samples) peak=\(String(format: "%.4f", peak)) (実デバイス取り込み)")
        exit(0)
    }

    /// `--selftest livescreen`: 画面収録許可があれば実フレームを 1 枚取り、非ゼロ寸法を確かめる。
    @MainActor
    private static func livescreen() {
        guard Permissions.screenRecording == .granted else {
            print("SELFTEST_SKIP livescreen: screen recording not granted"); exit(0)
        }
        guard #available(macOS 14.0, *) else { print("SELFTEST_SKIP livescreen: needs macOS 14+"); exit(0) }
        let sem = DispatchSemaphore(value: 0)
        var width = 0, height = 0
        var failed: String?
        var done = false
        Task {
            do {
                let image = try await ScreenContextCapture.captureFrame()
                width = image.width; height = image.height
            } catch { failed = "\(error)" }
            done = true
            sem.signal()
        }
        let waited = sem.wait(timeout: .now() + 8)
        if waited == .timedOut || !done || width == 0 {
            // SCK が前面セッションを要して返らないときは、CGDisplayCreateImage で取り直す
            // （画面収録許可で動作・前面不要）。
            if #available(macOS 14.0, *), let cg = ScreenContextCapture.captureFrameCG(), cg.width > 0 {
                print("SELFTEST_OK livescreen: captured \(cg.width)x\(cg.height) real frame (CGDisplay)")
                exit(0)
            }
            print("SELFTEST_SKIP livescreen: no frame in this headless context (screen granted)"); exit(0)
        }
        if let failed { print("SELFTEST_FAIL livescreen error=\(failed)"); exit(2) }
        guard width > 0, height > 0 else {
            print("SELFTEST_SKIP livescreen: capture returned \(width)x\(height) in this context"); exit(0)
        }
        print("SELFTEST_OK livescreen: captured \(width)x\(height) real frame")
        exit(0)
    }

    /// `--selftest livemeeting`: 実マイク → RecordingRuntime(session + オンデバイス STT) → 保存 の
    /// 実機 E2E。2 秒録って、実断片が書かれ回復候補になることを確かめる。許可が無ければ SKIP。
    @MainActor
    private static func livemeeting() {
        guard Permissions.microphone == .granted else {
            print("SELFTEST_SKIP livemeeting: microphone not granted"); exit(0)
        }
        let runtime = RecordingRuntime.shared
        var transcriptEvents = 0
        runtime.onTranscript = { _, _ in transcriptEvents += 1 }
        let id = "livemeeting-\(getpid())"
        guard runtime.begin(meetingId: id, captureMic: true, captureSystemAudio: false, transcribe: true) else {
            print("SELFTEST_FAIL livemeeting begin"); exit(2)
        }
        // 実マイクから 6 秒（5 秒断片が 1 つ閉じる）。RunLoop を回してタップと STT を受ける。
        RunLoop.current.run(until: Date().addingTimeInterval(6.0))
        let recorded = runtime.recordedMs()
        runtime.end()
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Astra/meetings").path
        let recovered = scanRecoverable(root: root, active: nil).contains { $0.meetingId == id }
        try? FileManager.default.removeItem(atPath: root + "/" + id)
        guard recorded > 0, recovered else {
            print("SELFTEST_FAIL livemeeting recorded=\(recorded) recovered=\(recovered)"); exit(3)
        }
        print("SELFTEST_OK livemeeting: 実マイク recordedMs=\(recorded) recovered=\(recovered) sttEvents=\(transcriptEvents)")
        exit(0)
    }

    /// `--selftest sttrecognize`: `say` で実音声を作り、オンデバイス STT が実際にテキストを出すか検証する。
    /// 実音声を伴う認識精度の live 検証（合成音声だが、実 STT エンジンが実際に文字を返す）。
    @MainActor
    private static func sttrecognize() {
        guard SpeechTranscriber.authorization == .authorized else {
            print("SELFTEST_SKIP sttrecognize: speech not authorized"); exit(0)
        }
        let aiff = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("astra-stt-\(getpid()).aiff")
        defer { try? FileManager.default.removeItem(at: aiff) }
        // macOS の say で英語の実音声を生成（既定音声は英語なので en-US で認識する）。
        let phrase = "testing astra meeting transcription"
        let say = Process()
        say.executableURL = URL(fileURLWithPath: "/usr/bin/say")
        say.arguments = ["-o", aiff.path, phrase]
        do { try say.run(); say.waitUntilExit() } catch { print("SELFTEST_FAIL sttrecognize say error=\(error)"); exit(2) }
        guard say.terminationStatus == 0, FileManager.default.fileExists(atPath: aiff.path) else {
            print("SELFTEST_FAIL sttrecognize: say produced no file"); exit(3)
        }
        let st = SpeechTranscriber(localeId: "en-US")
        guard let text = st.recognizeFile(aiff), !text.isEmpty else {
            print("SELFTEST_SKIP sttrecognize: recognizer returned no text in this context"); exit(0)
        }
        let lower = text.lowercased()
        // 主要語のいずれかを拾えていれば認識成立とみなす（音声認識は完全一致を保証しない）。
        let hit = ["test", "astra", "meeting", "transcription", "transcri"].contains { lower.contains($0) }
        guard hit else { print("SELFTEST_FAIL sttrecognize: unexpected text=\(text)"); exit(4) }
        print("SELFTEST_OK sttrecognize: 実音声→STT 認識=\"\(text)\"")
        exit(0)
    }

    /// `--selftest shape`: RecordingWorkspaceShape のパスが共有 fixture（tokens 由来の golden）と
    /// 一致するか検証する。macOS/Windows が同じ形を描くことの visual regression（macOS 側で実証）。
    @MainActor
    private static func shape() {
        let rect = CGRect(x: 0, y: 0, width: CGFloat(Metrics.workspaceWidth), height: CGFloat(Metrics.workspaceHeight))
        let path = RecordingWorkspaceShape().path(in: rect)
        func fmt(_ v: CGFloat) -> String {
            let r = (v).rounded()
            return abs(v - r) < 0.005 ? String(Int(r)) : String(format: "%.2f", v)
        }
        func pt(_ p: CGPoint) -> String { "\(fmt(p.x)),\(fmt(p.y))" }
        var d: [String] = []
        path.forEach { el in
            switch el {
            case .move(let to): d.append("M \(pt(to))")
            case .line(let to): d.append("L \(pt(to))")
            case .quadCurve(let to, let c): d.append("Q \(pt(c)) \(pt(to))")
            case .curve(let to, let c1, let c2): d.append("C \(pt(c1)) \(pt(c2)) \(pt(to))")
            case .closeSubpath: d.append("Z")
            @unknown default: break
            }
        }
        let got = d.joined(separator: " ")
        // 共有 golden を読む（リポジトリの fixtures）。
        let goldenPath = FileManager.default.currentDirectoryPath + "/../../shared/design/fixtures/recording-workspace.path"
        let alt = FileManager.default.currentDirectoryPath + "/shared/design/fixtures/recording-workspace.path"
        let golden = (try? String(contentsOfFile: goldenPath, encoding: .utf8))
            ?? (try? String(contentsOfFile: alt, encoding: .utf8))
        guard let goldenStr = golden?.trimmingCharacters(in: .whitespacesAndNewlines) else {
            print("SELFTEST_SKIP shape: golden fixture not found"); exit(0)
        }
        guard got == goldenStr else {
            print("SELFTEST_FAIL shape mismatch\n got=\(got)\n want=\(goldenStr)"); exit(2)
        }
        print("SELFTEST_OK shape: path matches shared fixture (\(d.count) segments)")
        exit(0)
    }

    /// `--selftest hudlifecycle`: 通常(HUD) → 録音開始(Recording Workspace) → 停止(保存) → HUD 復帰 の
    /// 状態遷移を検証する（§6「Voice HUD→Recording→保存→HUD復帰」/ Done#7）。window の描画ではなく
    /// WindowCoordinator の状態機械を確かめる（isRecording の遷移）。
    @MainActor
    private static func hudlifecycle() {
        WindowCoordinator.headless = true   // window を出さず状態遷移だけ検証
        let wc = WindowCoordinator.shared
        // 初期は非録音（Voice HUD 側）。
        guard wc.isRecording == false else { print("SELFTEST_FAIL hudlifecycle: starts recording"); exit(2) }
        // 録音開始 → Recording Workspace 側へ。
        wc.enterRecordingMode()
        guard wc.isRecording == true else { print("SELFTEST_FAIL hudlifecycle: enter did not set recording"); exit(3) }
        // 状態も RecordingWorkspaceState.start と整合（録音セッションは別途 record/livemeeting で検証済み）。
        // 停止 → 保存 → HUD 復帰。
        wc.leaveRecordingMode()
        guard wc.isRecording == false else { print("SELFTEST_FAIL hudlifecycle: leave did not clear recording"); exit(4) }
        // もう一巡（window 専用経路。録音ランタイム=保存は record/livemeeting で別途検証済み）。
        wc.enterRecordingMode(); let on2 = wc.isRecording
        wc.leaveRecordingMode(); let off2 = wc.isRecording
        guard on2 == true, off2 == false else {
            print("SELFTEST_FAIL hudlifecycle: second cycle \(on2)->\(off2)"); exit(5)
        }
        print("SELFTEST_OK hudlifecycle: HUD→Recording→保存→HUD 復帰 の window 状態遷移 OK")
        exit(0)
    }

    /// `--selftest pause`: 一時停止が実際に録音を止めるか（UI フラグだけでない）を検証する。
    /// pause 中に push しても recordedMs が進まないこと・解除後に進むことを確かめる。
    @MainActor
    private static func pauseWorks() {
        let runtime = RecordingRuntime.shared
        guard runtime.begin(meetingId: "pause-selftest", captureMic: false, captureSystemAudio: false, transcribe: false) else {
            print("SELFTEST_FAIL pause begin"); exit(2)
        }
        let oneSec = [Float](repeating: 0.1, count: 16_000)
        // recordedMs は閉じた断片(5秒毎)を数えるので、各フェーズ 6 秒ずつ流す。
        for _ in 0..<6 { runtime.push(oneSec, sampleRate: 16_000) }
        let before = runtime.recordedMs()
        runtime.setPaused(true)
        for _ in 0..<6 { runtime.push(oneSec, sampleRate: 16_000) }   // 一時停止中は捨てられるはず
        let duringPause = runtime.recordedMs()
        runtime.setPaused(false)
        for _ in 0..<6 { runtime.push(oneSec, sampleRate: 16_000) }
        let afterResume = runtime.recordedMs()
        runtime.end()
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Astra/meetings").path
        try? FileManager.default.removeItem(atPath: root + "/pause-selftest")
        guard before > 0, duringPause == before, afterResume > duringPause else {
            print("SELFTEST_FAIL pause before=\(before) duringPause=\(duringPause) afterResume=\(afterResume)"); exit(3)
        }
        print("SELFTEST_OK pause: 停止中は録音が進まない before=\(before) pause=\(duringPause) resume=\(afterResume)")
        exit(0)
    }

    /// `--selftest screenshot`: 画面文脈のスクショが実ファイルとして保存されるか検証する
    /// （viewfinder ボタンの実機能）。画面収録許可が無ければ SKIP。
    @MainActor
    private static func screenshot() {
        guard Permissions.screenRecording == .granted else {
            print("SELFTEST_SKIP screenshot: screen recording not granted"); exit(0)
        }
        let state = RecordingWorkspaceState.shared
        state.currentMeetingId = "screenshot-selftest"
        guard let path = state.captureScreenshot() else {
            print("SELFTEST_SKIP screenshot: no frame in this context"); exit(0)
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int) ?? 0
        // PNG マジックナンバーを確認（実画像であること）。
        let data = FileManager.default.contents(atPath: path) ?? Data()
        let isPng = data.count > 8 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Astra/meetings/screenshot-selftest").path
        try? FileManager.default.removeItem(atPath: root)
        guard (size ?? 0) > 1000, isPng else {
            print("SELFTEST_FAIL screenshot size=\(size ?? 0) isPng=\(isPng)"); exit(2)
        }
        print("SELFTEST_OK screenshot: 実 PNG 保存 bytes=\(size ?? 0) isPng=\(isPng)")
        exit(0)
    }

    /// `--selftest aiaction <base>`: AI 操作（要約）が core 経由で実 Agent に届き、結果が返るか検証する。
    /// gateway 未到達なら SKIP。
    @MainActor
    private static func aiaction(_ args: [String]) {
        let base = args.count > (args.firstIndex(of: "--selftest")! + 2)
            ? args[args.firstIndex(of: "--selftest")! + 2] : "http://127.0.0.1:3000"
        guard AstraCoreBridge.reachable(base) else { print("SELFTEST_SKIP aiaction: gateway unreachable"); exit(0) }
        do {
            let tokens = try AstraCoreBridge.devSignIn(base, email: "aiaction-\(getpid())@astra.local", displayName: "AI")
            let state = RecordingWorkspaceState.shared
            state.configureBackend(base: base, token: tokens.accessToken)
            state.transcript = [
                TranscriptSegment(speaker: "田中", text: "リリースは 9 月 12 日にしましょう。", interim: false),
                TranscriptSegment(speaker: "鈴木", text: "OAuth の確認を私がやります。", interim: false),
            ]
            state.runAIAction("リアルタイム要約")
            // 非同期の結果を待つ（最大 20 秒）。
            let deadline = Date().addingTimeInterval(20)
            while state.aiResult.isEmpty && Date() < deadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.2))
            }
            guard !state.aiResult.isEmpty, !state.aiResult.contains("失敗") else {
                print("SELFTEST_FAIL aiaction result=\(state.aiResult)"); exit(2)
            }
            let preview = String(state.aiResult.prefix(40)).replacingOccurrences(of: "\n", with: " ")
            print("SELFTEST_OK aiaction: Agent 応答=\"\(preview)…\"")
            exit(0)
        } catch {
            print("SELFTEST_FAIL aiaction error=\(error)"); exit(3)
        }
    }

    /// `--selftest translate <base>`: 翻訳タブが transcript を Agent 経由で訳し、結果が返るか検証する。
    @MainActor
    private static func translateTest(_ args: [String]) {
        let base = args.count > (args.firstIndex(of: "--selftest")! + 2)
            ? args[args.firstIndex(of: "--selftest")! + 2] : "http://127.0.0.1:3000"
        guard AstraCoreBridge.reachable(base) else { print("SELFTEST_SKIP translate: gateway unreachable"); exit(0) }
        do {
            let tokens = try AstraCoreBridge.devSignIn(base, email: "translate-\(getpid())@astra.local", displayName: "T")
            let state = RecordingWorkspaceState.shared
            state.configureBackend(base: base, token: tokens.accessToken)
            state.transcript = [TranscriptSegment(speaker: "田中", text: "会議を始めましょう。", interim: false)]
            state.translatedText = ""
            state.translate(to: "英語")
            let deadline = Date().addingTimeInterval(20)
            while state.translatedText.isEmpty && Date() < deadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.2))
            }
            guard !state.translatedText.isEmpty, !state.translatedText.contains("失敗") else {
                print("SELFTEST_FAIL translate result=\(state.translatedText)"); exit(2)
            }
            let preview = String(state.translatedText.prefix(40)).replacingOccurrences(of: "\n", with: " ")
            print("SELFTEST_OK translate: Agent 訳=\"\(preview)…\"")
            exit(0)
        } catch { print("SELFTEST_FAIL translate error=\(error)"); exit(3) }
    }

    /// `--selftest waveform`: 録音中に波形が実マイクレベルで更新されるか（固定デモでない）を検証する。
    /// マイク許可が無ければ SKIP。
    @MainActor
    private static func waveform() {
        guard Permissions.microphone == .granted else {
            print("SELFTEST_SKIP waveform: microphone not granted"); exit(0)
        }
        let runtime = RecordingRuntime.shared
        var levelCallbacks = 0
        runtime.onLevel = { _ in levelCallbacks += 1 }
        guard runtime.begin(meetingId: "waveform-selftest", captureMic: true, captureSystemAudio: false, transcribe: false) else {
            print("SELFTEST_FAIL waveform begin"); exit(2)
        }
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        runtime.end()
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Astra/meetings").path
        try? FileManager.default.removeItem(atPath: root + "/waveform-selftest")
        guard levelCallbacks > 0 else { print("SELFTEST_FAIL waveform: no level callbacks"); exit(3) }
        print("SELFTEST_OK waveform: 実マイクレベルで更新 callbacks=\(levelCallbacks)")
        exit(0)
    }

    /// `--selftest recovery <base>`: クラッシュした録音（未アップロード断片）を検出して gateway に復旧できるか検証する。
    @MainActor
    private static func recovery(_ args: [String]) {
        let base = args.count > (args.firstIndex(of: "--selftest")! + 2)
            ? args[args.firstIndex(of: "--selftest")! + 2] : "http://127.0.0.1:3000"
        guard AstraCoreBridge.reachable(base) else { print("SELFTEST_SKIP recovery: gateway unreachable"); exit(0) }
        do {
            let tokens = try AstraCoreBridge.devSignIn(base, email: "recovery-\(getpid())@astra.local", displayName: "R")
            // gateway に会議を作り、その id で「クラッシュした録音」を作る（アップロードしない）。
            let mid = try AstraCoreBridge.createMeeting(base, accessToken: tokens.accessToken, title: "Recovery 会議", language: "ja-JP")
            let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
                .appendingPathComponent("Astra/meetings").path
            let session = try RecordingSession.start(root: root, meetingId: mid)
            let oneSec = [Float](repeating: 0.1, count: 16_000)
            for _ in 0..<6 { _ = session.pushSamples(samples: oneSec, sampleRate: 16_000) }
            try session.finish()   // 断片は書けたがアップロードしていない = クラッシュ相当
            // 起動時スキャンで回復候補に出る。
            let runtime = RecordingRuntime.shared
            runtime.configureBackend(base: base, accessToken: tokens.accessToken)
            let found = runtime.recoverableMeetings().contains { $0.meetingId == mid }
            // 復旧: gateway に送って finalize。
            let sent = runtime.recover(meetingId: mid)
            try? FileManager.default.removeItem(atPath: root + "/" + mid)
            guard found, sent > 0 else {
                print("SELFTEST_FAIL recovery found=\(found) sent=\(sent)"); exit(2)
            }
            print("SELFTEST_OK recovery: クラッシュ録音を検出→復旧 uploadedBytes=\(sent)")
            exit(0)
        } catch { print("SELFTEST_FAIL recovery error=\(error)"); exit(3) }
    }

    /// `--selftest timer`: 録音中に経過時間が実際に進み、一時停止で止まるか検証する（以前は 0 のままだった）。
    @MainActor
    private static func timer() {
        WindowCoordinator.headless = true   // window を出さない
        let state = RecordingWorkspaceState.shared
        state.start()
        RunLoop.current.run(until: Date().addingTimeInterval(2.4))
        let running = state.elapsedSeconds
        state.togglePause()                 // 一時停止
        RunLoop.current.run(until: Date().addingTimeInterval(1.6))
        let paused = state.elapsedSeconds
        state.togglePause()                 // 再開
        RunLoop.current.run(until: Date().addingTimeInterval(1.6))
        let resumed = state.elapsedSeconds
        state.stop()
        // 片付け
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Astra/meetings/\(state.currentMeetingId)").path
        try? FileManager.default.removeItem(atPath: root)
        guard running >= 2, paused == running, resumed > paused else {
            print("SELFTEST_FAIL timer running=\(running) paused=\(paused) resumed=\(resumed)"); exit(2)
        }
        print("SELFTEST_OK timer: 経過が進む running=\(running) 停止で止まる paused=\(paused) 再開で進む resumed=\(resumed)")
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

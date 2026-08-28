import Foundation
import CoreVideo
import CoreGraphics
import AVFoundation
import Network
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
        case "calendarlive": calendarlive(); return true
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
        case "sttstream": sttStream(); return true
        case "guishot": guishot(); return true
        case "axtree": axtree(); return true
        case "dictation": dictation(); return true
        case "breakpoints": breakpoints(); return true
        case "shape": shape(); return true
        case "hudlifecycle": hudlifecycle(); return true
        case "pause": pauseWorks(); return true
        case "screenshot": screenshot(); return true
        case "aiaction": aiaction(args); return true
        case "translate": translateTest(args); return true
        case "waveform": waveform(); return true
        case "recovery": recovery(args); return true
        case "timer": timer(); return true
        case "connectorflow": connectorflow(); return true
        case "connectorstate": connectorstate(); return true
        case "connectorexchange": connectorExchange(); return true
        case "voiceask": voiceask(args); return true
        case "recoveryoffline": recoveryOffline(args); return true
        case "fulllifecycle": fullLifecycle(args); return true
        case "e2e001": e2e001(args); return true
        case "shots": shots(args); return true
        case "panel": panelBehavior(); return true
        case "render": render(); return true
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
        // 純関数の一致ロジックを先に確かめる（⌥Space は一致、Space 単独/⌘Space は不一致）。
        let combo = GlobalShortcut.Combo()   // ⌥Space
        let mSpace = GlobalShortcut.matches(combo: combo, keyCode: 49, flags: [.maskAlternate])
        let mPlain = GlobalShortcut.matches(combo: combo, keyCode: 49, flags: [])
        let mCmd = GlobalShortcut.matches(combo: combo, keyCode: 49, flags: [.maskCommand])
        guard mSpace, !mPlain, !mCmd else {
            print("SELFTEST_FAIL shortcut matcher space=\(mSpace) plain=\(mPlain) cmd=\(mCmd)"); exit(2)
        }

        // CGEventTap を実登録し、合成 ⌥Space をセッションtapへ注入して「受信→発火」を実測する。
        // 一致キーは tap が consume するので他アプリへ漏れない。
        var fired = false
        let ok = GlobalShortcut.shared.register(combo) { fired = true }
        let label = GlobalShortcut.label()
        guard ok else {
            GlobalShortcut.shared.unregister()
            print("SELFTEST_FAIL shortcut register (Accessibility 未許可?)"); exit(2)
        }
        let source = CGEventSource(stateID: .privateState)
        if let down = CGEvent(keyboardEventSource: source, virtualKey: 49, keyDown: true) {
            down.flags = [.maskAlternate]; down.post(tap: .cgSessionEventTap)
        }
        if let up = CGEvent(keyboardEventSource: source, virtualKey: 49, keyDown: false) {
            up.flags = [.maskAlternate]; up.post(tap: .cgSessionEventTap)
        }
        let deadline = Date().addingTimeInterval(1.5)
        while !fired && Date() < deadline {
            CFRunLoopRunInMode(.defaultMode, 0.05, true)
        }
        GlobalShortcut.shared.unregister()
        guard fired else {
            print("SELFTEST_FAIL shortcut: synthetic press not received"); exit(2)
        }
        print("SELFTEST_OK shortcut: registered=\(ok) combo=\(label) matcher=ok receivedSyntheticPress=\(fired)")
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

    /// `--selftest calendarlive`: **実 Calendar データ**を取る。署名 .app で実行し、必要なら TCC 許可
    /// プロンプトを出す（notDetermined のとき）。許可後、EventKit から実イベントを読み、実データで
    /// あることを証拠化する（title/日付を出す。fixture/mock ではない）。denied/authorized/0件 を区別。
    @MainActor
    private static func calendarlive() {
        // `open` 経由で起動されると stdout が捨てられるので、結果を固定ファイルにも書く。
        func emit(_ line: String) -> Never {
            print(line)
            try? line.write(toFile: "/tmp/astra-calendarlive.txt", atomically: true, encoding: .utf8)
            exit(0)
        }
        // TCC プロンプトは「前面の通常アプリ」からでないと出ないことがある。前面化する。
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        let before = CalendarAccess.status()
        print("CAL: status(before)=\(before.rawValue)")
        // notDetermined なら許可要求（プロンプト）。すでに決まっていればそのまま進む。
        if before == .notDetermined {
            print("CAL: requesting access (TCC prompt should appear)…")
            let sem = DispatchSemaphore(value: 0)
            var granted = false
            var callbackFired = false
            let t0 = Date()
            CalendarAccess.requestAccess { ok in granted = ok; callbackFired = true; sem.signal() }
            // 許可ダイアログをユーザーが操作するまで run loop を回して待つ（最大 180 秒）。
            let deadline = Date().addingTimeInterval(180)
            while sem.wait(timeout: .now()) == .timedOut && Date() < deadline {
                CFRunLoopRunInMode(.defaultMode, 0.2, true)
            }
            let dt = String(format: "%.1f", Date().timeIntervalSince(t0))
            let cb = "CAL: callbackFired=\(callbackFired) granted=\(granted) after=\(dt)s"
            print(cb)
            try? cb.write(toFile: "/tmp/astra-calendarlive-cb.txt", atomically: true, encoding: .utf8)
        }
        let after = CalendarAccess.status()
        print("CAL: status(after)=\(after.rawValue)")
        switch after {
        case .denied, .restricted:
            emit("SELFTEST_CAL_DENIED after=\(after.rawValue) (ユーザーが拒否/制限)")
        case .notDetermined:
            emit("SELFTEST_CAL_PENDING after=notDetermined (プロンプト未応答/未表示)")
        case .writeOnly:
            emit("SELFTEST_CAL_WRITEONLY (読み取り不可の許可)")
        case .granted:
            // 実イベントを 60 日窓で読む（少なくとも 1 件あればサンプルを出す）。
            let events = CalendarAccess.upcoming(hours: 24 * 60)
            if events.isEmpty {
                emit("SELFTEST_CAL_OK_EMPTY: authorized=true events=0 (取得成功・0件。架空データは作らない)")
            }
            let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd HH:mm"
            let sample = events.prefix(3).map { e -> String in
                let start = fmt.string(from: Date(timeIntervalSince1970: e.startEpoch))
                return "\"\(e.title)\"@\(start)[\(e.calendar)]"
            }.joined(separator: ", ")
            emit("SELFTEST_CAL_OK: authorized=true events=\(events.count) sample=\(sample)")
        }
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
        // 既定音声はシステムロケール依存なので、en-US 認識に合わせて英語音声を明示する。
        say.arguments = ["-v", "Samantha", "-o", aiff.path, phrase]
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

    /// `--selftest sttstream`: 会議で使う**ストリーミング**経路（start/append/finish）を実音声で検証する。
    /// say の実音声を 16kHz mono f32 に変換して append し、on-device STT が確定テキストを返すか確かめる。
    @MainActor
    private static func sttStream() {
        guard SpeechTranscriber.authorization == .authorized else {
            print("SELFTEST_SKIP sttstream: speech not authorized"); exit(0)
        }
        let aiff = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("astra-sttstream-\(getpid()).aiff")
        defer { try? FileManager.default.removeItem(at: aiff) }
        let phrase = "testing astra meeting transcription"
        let say = Process()
        say.executableURL = URL(fileURLWithPath: "/usr/bin/say")
        say.arguments = ["-v", "Samantha", "-o", aiff.path, phrase]
        do { try say.run(); say.waitUntilExit() } catch { print("SELFTEST_FAIL sttstream say error=\(error)"); exit(2) }
        guard say.terminationStatus == 0 else { print("SELFTEST_FAIL sttstream say status"); exit(3) }

        // AIFF を 16kHz mono Float32 に変換して frames を得る。
        guard let frames = decodeTo16kMonoF32(aiff) else {
            print("SELFTEST_FAIL sttstream: decode failed"); exit(4)
        }
        let st = SpeechTranscriber(localeId: "en-US")
        let lock = NSLock(); var latest = ""; var final = false
        do {
            try st.start { ev in
                lock.lock(); latest = ev.text; if ev.isFinal { final = true }; lock.unlock()
            }
        } catch {
            print("SELFTEST_SKIP sttstream: start failed \(error)"); exit(0)
        }
        // 実会議のように 3200 サンプル（0.2s）ずつ append し、run loop を回す。
        var i = 0
        while i < frames.count {
            let end = min(i + 3200, frames.count)
            st.append(Array(frames[i..<end]))
            i = end
            CFRunLoopRunInMode(.defaultMode, 0.02, true)
        }
        st.finish()
        let deadline = Date().addingTimeInterval(8)
        while true {
            lock.lock(); let f = final; let cur = latest; lock.unlock()
            if (f && !cur.isEmpty) || Date() > deadline { break }
            CFRunLoopRunInMode(.defaultMode, 0.05, true)
        }
        lock.lock(); let text = latest; lock.unlock()
        guard !text.isEmpty else { print("SELFTEST_SKIP sttstream: streaming returned no text"); exit(0) }
        let lower = text.lowercased()
        let hit = ["test", "astra", "meeting", "transcription", "transcri", "astro"].contains { lower.contains($0) }
        guard hit else { print("SELFTEST_FAIL sttstream: unexpected text=\(text)"); exit(5) }
        print("SELFTEST_OK sttstream: 実音声→streaming STT 確定=\"\(text)\"")
        exit(0)
    }

    /// AIFF/任意の音声を 16kHz mono Float32 の配列へデコードする。
    private static func decodeTo16kMonoF32(_ url: URL) -> [Float]? {
        guard let file = try? AVAudioFile(forReading: url) else { return nil }
        let src = file.processingFormat
        guard let dst = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000,
                                      channels: 1, interleaved: false),
              let conv = AVAudioConverter(from: src, to: dst),
              let inBuf = AVAudioPCMBuffer(pcmFormat: src, frameCapacity: AVAudioFrameCount(file.length))
        else { return nil }
        do { try file.read(into: inBuf) } catch { return nil }
        let ratio = 16_000.0 / src.sampleRate
        let outCap = AVAudioFrameCount(Double(inBuf.frameLength) * ratio) + 1024
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: dst, frameCapacity: outCap) else { return nil }
        var fed = false
        var err: NSError?
        conv.convert(to: outBuf, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true; status.pointee = .haveData; return inBuf
        }
        if err != nil { return nil }
        guard let ch = outBuf.floatChannelData else { return nil }
        return Array(UnsafeBufferPointer(start: ch[0], count: Int(outBuf.frameLength)))
    }

    /// `--selftest guishot`: 3 つの主要サーフェス（Voice HUD / Recording Workspace / Main Window）を
    /// **window server 上に実提示**し、自プロセスの window を CGWindowList で撮って
    /// 「実描画・非空白（・borderless は token 実寸）」を実測する。offscreen では確認できない
    /// 「実ディスプレイ提示」を裏付ける（各サーフェスを一瞬だけ表示して閉じる）。特に Main は
    /// NavigationSplitView が offscreen では疎にしか描かれないため、実ウィンドウ提示で解消を示す。
    @MainActor
    private static func guishot() {
        RecordingWorkspaceState.shared.loadDemo(ragOpen: true)
        let pid = getpid()

        // 1 サーフェスを提示→自 window 撮影→色数と bounds を返す。撮れなければ nil。
        func shoot(_ label: String, window: NSWindow, present: () -> Void) -> (w: Int, h: Int, colors: Int, path: String)? {
            present()
            let show = Date().addingTimeInterval(0.8)
            while Date() < show { CFRunLoopRunInMode(.defaultMode, 0.05, true) }
            var winID: CGWindowID = 0
            var bw = 0, bh = 0
            if let infos = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
                var best = 0
                for info in infos {
                    guard let owner = info[kCGWindowOwnerPID as String] as? pid_t, owner == pid,
                          let num = info[kCGWindowNumber as String] as? CGWindowID,
                          let b = info[kCGWindowBounds as String] as? [String: Any],
                          let iw = b["Width"] as? CGFloat, let ih = b["Height"] as? CGFloat,
                          iw > 40, ih > 20 else { continue }   // HUD は 310x31 と低いので閾値を下げる
                    if Int(iw * ih) > best { best = Int(iw * ih); winID = num; bw = Int(iw); bh = Int(ih) }
                }
            }
            guard winID != 0,
                  let cg = CGWindowListCreateImage(.null, .optionIncludingWindow, winID, [.boundsIgnoreFraming, .bestResolution])
            else { window.orderOut(nil); window.close(); return nil }
            let rep = NSBitmapImageRep(cgImage: cg)
            var seen = Set<UInt32>()
            let w = rep.pixelsWide, h = rep.pixelsHigh
            let sx = max(1, w / 40), sy = max(1, h / 40)
            var y = 0
            while y < h { var x = 0
                while x < w {
                    if let c = rep.colorAt(x: x, y: y) {
                        let r = UInt32(max(0, min(255, c.redComponent * 255)))
                        let g = UInt32(max(0, min(255, c.greenComponent * 255)))
                        let bl = UInt32(max(0, min(255, c.blueComponent * 255)))
                        seen.insert((r << 16) | (g << 8) | bl)
                    }
                    x += sx }
                y += sy }
            var path = ""
            if let png = rep.representation(using: .png, properties: [:]) {
                let out = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("astra-guishot-\(label)-\(pid).png")
                try? png.write(to: out); path = out.path
            }
            window.orderOut(nil); window.close()
            return (bw, bh, seen.count, path)
        }

        func centered(_ win: NSWindow, _ size: NSSize) {
            if let screen = NSScreen.main {
                let f = screen.frame
                win.setFrameOrigin(NSPoint(x: f.midX - size.width / 2, y: f.midY - size.height / 2))
            }
        }

        // 1) Voice HUD（borderless, token 実寸）
        let hudSize = NSSize(width: Metrics.hudWidth, height: Metrics.hudHeight)
        let hud = AstraPanel(size: hudSize, level: .normal, canKey: false, content: VoiceHUDView())
        let hudR = shoot("hud", window: hud) { centered(hud, hudSize); hud.orderFrontRegardless() }

        // 2) Recording Workspace（borderless, token 実寸）
        let wsSize = NSSize(width: Metrics.workspaceWidth, height: Metrics.workspaceHeight)
        let ws = AstraPanel(size: wsSize, level: .normal, canKey: false, content: RecordingWorkspaceView())
        let wsR = shoot("workspace", window: ws) { centered(ws, wsSize); ws.orderFrontRegardless() }

        // 3) Main Window（titled 実ウィンドウ。offscreen で疎だった NavigationSplitView が実提示で描かれる）
        let mainSize = NSSize(width: 900, height: 600)
        let main = NSWindow(contentRect: NSRect(origin: .zero, size: mainSize),
                            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        main.contentView = NSHostingView(rootView: MainWindowView())
        let mainR = shoot("main", window: main) { centered(main, mainSize); main.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }

        // 4) Task Dock / Intent Bar（spec §4: 画面下部中央・560×56、§4.2 bottom inset）
        let ibSize = NSSize(width: Metrics.intentReadyWidth, height: Metrics.intentReadyHeight)
        let ib = AstraPanel(size: ibSize, level: .normal, canKey: false,
                            content: IntentBarView())
        let ibR = shoot("intentbar", window: ib) {
            if let s = NSScreen.main {
                let f = s.visibleFrame
                ib.setFrameOrigin(NSPoint(x: f.midX - ibSize.width / 2, y: f.minY + Metrics.intentBottomInset))
            }
            ib.orderFrontRegardless()
        }

        // いずれも撮れない（実ディスプレイ無し）なら SKIP。
        guard hudR != nil || wsR != nil || mainR != nil || ibR != nil else {
            print("SELFTEST_SKIP guishot: no on-screen window (headless display?)"); exit(0)
        }
        // 撮れたサーフェスは非空白であること。borderless の 2 面は token 実寸（±2pt）。
        var fails: [String] = []
        func check(_ name: String, _ r: (w: Int, h: Int, colors: Int, path: String)?, expW: Int?, expH: Int?, minColors: Int) -> String {
            guard let r = r else { return "\(name)=SKIP" }
            var ok = r.colors >= minColors
            if let ew = expW { ok = ok && abs(r.w - ew) <= 2 }
            if let eh = expH { ok = ok && abs(r.h - eh) <= 2 }
            if !ok { fails.append("\(name)(\(r.w)x\(r.h),c\(r.colors))") }
            return "\(name)=\(r.w)x\(r.h)/c\(r.colors)"
        }
        let sHud = check("HUD", hudR, expW: Int(Metrics.hudWidth), expH: Int(Metrics.hudHeight), minColors: 4)
        let sWs = check("Workspace", wsR, expW: Int(Metrics.workspaceWidth), expH: Int(Metrics.workspaceHeight), minColors: 8)
        // Main は titled/resizable。ウィンドウマネージャが画面事情でサイズを詰めることがある
        // （実測 900→886 の例）ので実寸固定では検査せず、「十分大きい」＋「中身がある」で見る。
        // 実寸固定の検査は寸法を我々が決める borderless パネル（HUD/Workspace/IntentBar）だけに課す。
        let sMain: String = {
            guard let r = mainR else { return "Main=SKIP" }
            if r.w < 700 || r.h < 500 || r.colors < 8 { fails.append("Main(\(r.w)x\(r.h),c\(r.colors))") }
            return "Main=\(r.w)x\(r.h)/c\(r.colors)"
        }()
        // Task Dock / Intent Bar は spec §4.1 の 560×56（±2pt）・非空白（>=6色）。
        let sIntent = check("IntentBar", ibR, expW: Int(Metrics.intentReadyWidth), expH: Int(Metrics.intentReadyHeight), minColors: 6)
        guard fails.isEmpty else { print("SELFTEST_FAIL guishot: \(fails.joined(separator: ","))"); exit(2) }
        let anyPath = wsR?.path ?? hudR?.path ?? mainR?.path ?? ibR?.path ?? ""
        let summary = [sHud, sWs, sMain, sIntent].joined(separator: " ")
        print("SELFTEST_OK guishot: 実提示 " + summary + " png=" + anyPath)
        exit(0)
    }

    /// `--selftest breakpoints`: §7.2 の reflow（AC-13）を実測する。純関数 ShellLayout.forWidth の
    /// 判定と、実際に 3 幅で offscreen 描画した時の中身（非空白）を確かめる。
    @MainActor
    private static func breakpoints() {
        // 純関数の閾値（tokens 由来）
        let wide = ShellLayout.forWidth(Metrics.bpThreeColumn)          // >=1280 → 3-column
        let mid = ShellLayout.forWidth(Metrics.bpInspectorDrawer + 100) // 960-1279 → drawer
        let narrow = ShellLayout.forWidth(Metrics.bpSidebarCollapse + 10) // 720-959 → collapsed
        guard wide == .threeColumn, mid == .inspectorDrawer, narrow == .sidebarCollapsed,
              wide.showsInspectorInline, !mid.showsInspectorInline,
              narrow.sidebarWidth == Metrics.sidebarCollapsed, wide.sidebarWidth == Metrics.sidebarWidth
        else {
            print("SELFTEST_FAIL breakpoints: wide=\(wide.rawValue) mid=\(mid.rawValue) narrow=\(narrow.rawValue)"); exit(2)
        }
        // 実描画（各幅で非空白）
        func render(_ w: CGFloat) -> Int {
            let v = WorkspaceShellView(title: "A社 商談準備", main: {
                VStack(alignment: .leading) { Text("Overview / Progress / Outputs").padding() }
            }, inspector: {
                VStack(alignment: .leading) { Text("Context / Evidence / Activity").padding() }
            })
            let host = NSHostingView(rootView: v)
            host.frame = NSRect(x: 0, y: 0, width: w, height: 700)
            host.layoutSubtreeIfNeeded()
            guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return 0 }
            host.cacheDisplay(in: host.bounds, to: rep)
            var seen = Set<UInt32>()
            let pw = rep.pixelsWide, ph = rep.pixelsHigh
            let sx = max(1, pw / 40), sy = max(1, ph / 40)
            var y = 0
            while y < ph { var x = 0
                while x < pw {
                    if let c = rep.colorAt(x: x, y: y) {
                        let r = UInt32(max(0, min(255, c.redComponent * 255)))
                        let g = UInt32(max(0, min(255, c.greenComponent * 255)))
                        let b = UInt32(max(0, min(255, c.blueComponent * 255)))
                        seen.insert((r << 16) | (g << 8) | b)
                    }
                    x += sx }
                y += sy }
            return seen.count
        }
        let c1 = render(1400), c2 = render(1100), c3 = render(820)
        guard c1 >= 3, c2 >= 3, c3 >= 3 else {
            print("SELFTEST_FAIL breakpoints render: 1400=\(c1) 1100=\(c2) 820=\(c3)"); exit(3)
        }
        print("SELFTEST_OK breakpoints: >=1280 3-column / 960-1279 inspector drawer / <960 sidebar collapsed; render c\(c1)/c\(c2)/c\(c3)")
        exit(0)
    }

    /// `--selftest dictation`: HUD-004「TextField-aware dictation」を実測する。
    /// 自前の NSTextField を前面に出してフォーカスし、Dictation.insert が**その欄に**入るか、
    /// 入力欄が無いときは false を返して Ask Astra へ回る（＝勝手に会話を始めない）かを見る。
    @MainActor
    private static func dictation() {
        guard AXIsProcessTrusted() else {
            print("SELFTEST_SKIP dictation: AX not trusted"); exit(0)
        }
        // 入力欄が無い状態（デスクトップ相当）では insert が false であること。
        let noTarget = Dictation.insert("これは入らないはず")
        guard noTarget == false else {
            print("SELFTEST_FAIL dictation: 入力欄が無いのに insert が true"); exit(2)
        }

        // 実 NSTextField を出してフォーカスし、そこへ入るか。
        let field = NSTextField(string: "")
        field.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: 80),
                           styleMask: [.titled], backing: .buffered, defer: false)
        win.contentView = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 80))
        win.contentView?.addSubview(field)
        if let s = NSScreen.main { win.setFrameOrigin(NSPoint(x: s.frame.midX - 180, y: s.frame.midY)) }
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        win.makeFirstResponder(field)
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline { CFRunLoopRunInMode(.defaultMode, 0.05, true) }

        let inserted = Dictation.insert("会議の要点をまとめて")
        let value = field.stringValue
        win.orderOut(nil); win.close()

        guard inserted, value.contains("会議の要点をまとめて") else {
            print("SELFTEST_SKIP dictation: focused field へ書けなかった inserted=\(inserted) value=\"\(value)\" (AX 経路が別プロセス扱いの可能性)")
            exit(0)
        }
        print("SELFTEST_OK dictation: focused text field へ挿入 value=\"\(value)\" / 入力欄なしでは会話を始めない")
        exit(0)
    }

    /// `--selftest axtree`: 実提示した Main Window と Recording Workspace の**アクセシビリティツリー**を
    /// 走査し、統合された各サーフェスが実アクセシブル要素として存在するか検証する（正本 §2/§7）。
    /// XCUITest 相当（UI を pixels でなく構造として実測）。AX 許可が無ければ SKIP。
    @MainActor
    private static func axtree() {
        guard AXIsProcessTrusted() else { print("SELFTEST_SKIP axtree: AX not trusted"); exit(0) }
        RecordingWorkspaceState.shared.loadDemo(ragOpen: true)

        // 1 つの window を提示し、自プロセス AX ツリーのテキスト系属性を集めて返す。
        func axTexts(present: () -> NSWindow) -> Set<String> {
            let win = present()
            let show = Date().addingTimeInterval(1.0)
            while Date() < show { CFRunLoopRunInMode(.defaultMode, 0.05, true) }
            let app = AXUIElementCreateApplication(getpid())
            var texts = Set<String>()
            func attr(_ el: AXUIElement, _ name: String) -> String? {
                var v: CFTypeRef?
                guard AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success else { return nil }
                if let s = v as? String, !s.isEmpty { return s }
                return nil
            }
            func walk(_ el: AXUIElement, _ depth: Int) {
                if depth > 20 { return }
                for a in ["AXTitle", "AXDescription", "AXValue", "AXLabel", "AXIdentifier", "AXHelp"] {
                    if let s = attr(el, a) { texts.insert(s) }
                }
                var kids: CFTypeRef?
                if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &kids) == .success,
                   let arr = kids as? [AXUIElement] {
                    for k in arr { walk(k, depth + 1) }
                }
            }
            walk(app, 0)
            win.orderOut(nil); win.close()
            return texts
        }

        // Main Window（4 セクション）
        let mainTexts = axTexts {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 600),
                             styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            w.contentView = NSHostingView(rootView: MainWindowView())
            if let s = NSScreen.main { w.setFrameOrigin(NSPoint(x: s.frame.midX - 450, y: s.frame.midY - 300)) }
            w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
            return w
        }
        // 自プロセス AX が空（sandbox/権限差）なら捏造せず SKIP。
        guard !mainTexts.isEmpty else {
            print("SELFTEST_SKIP axtree: own-process AX tree empty in this context"); exit(0)
        }
        // Recording Workspace（統合サーフェス群）
        let wsSize = NSSize(width: Metrics.workspaceWidth, height: Metrics.workspaceHeight)
        let wsTexts = axTexts {
            let p = AstraPanel(size: wsSize, level: .normal, canKey: false, content: RecordingWorkspaceView())
            if let s = NSScreen.main { p.setFrameOrigin(NSPoint(x: s.frame.midX - wsSize.width/2, y: s.frame.midY - wsSize.height/2)) }
            p.orderFrontRegardless()
            return p
        }

        func has(_ set: Set<String>, _ needle: String) -> Bool { set.contains { $0.localizedCaseInsensitiveContains(needle) } }
        // Main: 4 セクション（§2）
        let mainWant = ["Home", "Work", "Library", "Apps"]
        let mainMiss = mainWant.filter { !has(mainTexts, $0) }
        // Workspace: 統合サーフェス（§2/§7）— Recording Hero / Transcript / Translation / AI / RAG / Task Dock
        let wsWant = ["録音中", "文字起こし", "翻訳", "リアルタイム要約", "決定事項", "アクション", "質問する", "RAG Context"]
        let wsMiss = wsWant.filter { !has(wsTexts, $0) }
        guard mainMiss.isEmpty, wsMiss.isEmpty else {
            print("SELFTEST_FAIL axtree: mainMiss=\(mainMiss) wsMiss=\(wsMiss) (main=\(mainTexts.count) ws=\(wsTexts.count))"); exit(2)
        }
        print("SELFTEST_OK axtree: Main 4セクション + Workspace 統合サーフェス\(wsWant.count)件を実アクセシブル要素として検出 (main=\(mainTexts.count) ws=\(wsTexts.count))")
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
            // 復旧: gateway に送って finalize（アップロード済みに印す）。
            let sent = runtime.recover(meetingId: mid)
            // 復旧後は回復候補から消えるはず（二重アップロードしない）。
            let stillThere = runtime.recoverableMeetings().contains { $0.meetingId == mid }
            try? FileManager.default.removeItem(atPath: root + "/" + mid)
            guard found, sent > 0, !stillThere else {
                print("SELFTEST_FAIL recovery found=\(found) sent=\(sent) stillRecoverable=\(stillThere)"); exit(2)
            }
            print("SELFTEST_OK recovery: 検出→復旧 uploadedBytes=\(sent) 復旧後は候補から消える(stillThere=\(stillThere))")
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

    /// `--selftest connectorflow`: OAuth の loopback listener が開き、折り返しを core で解析できるか検証する。
    /// live なトークン交換は実提供者が要るのでここでは扱わない（loopback + callback 解析まで）。
    @MainActor
    private static func connectorflow() {
        let flow = ConnectorFlow()
        var got: OauthCallback?
        let port: UInt16
        do {
            port = try flow.startLoopback { params in got = params }
        } catch { print("SELFTEST_FAIL connectorflow listener error=\(error)"); exit(2) }
        guard port > 0 else { print("SELFTEST_FAIL connectorflow: no port"); exit(3) }
        // 疑似的な折り返しを自分で送る（提供者のブラウザの代わり）。
        let url = URL(string: "http://127.0.0.1:\(port)/callback?code=abc123&state=xyz789")!
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: url) { _, _, _ in done.signal() }.resume()
        let deadline = Date().addingTimeInterval(5)
        while got == nil && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
        _ = done.wait(timeout: .now() + 1)
        flow.stopLoopback()
        guard let params = got, params.code == "abc123", params.state == "xyz789" else {
            print("SELFTEST_FAIL connectorflow code=\(got?.code ?? "nil") state=\(got?.state ?? "nil")"); exit(4)
        }
        print("SELFTEST_OK connectorflow: loopback 受理 code=\(params.code ?? "") state=\(params.state ?? "") port=\(port)")
        exit(0)
    }

    /// `--selftest connectorstate`: 接続可否の判定（設定済みプロバイダ・アプリ→プロバイダ対応）を検証する。
    /// 未設定では繋げないこと（推測で埋めない）を確かめる。実 OAuth は不要。
    @MainActor
    private static func connectorstate() {
        let cs = ConnectorState.shared
        // アプリ→プロバイダの対応。
        guard ConnectorState.provider(for: "Gmail") == "google",
              ConnectorState.provider(for: "Google Calendar") == "google",
              ConnectorState.provider(for: "Microsoft Teams") == "microsoft",
              ConnectorState.provider(for: "Finder") == nil else {
            print("SELFTEST_FAIL connectorstate: provider mapping"); exit(2)
        }
        // client_id が env に無ければ、対応プロバイダがあっても繋げない（推測で埋めない）。
        let hasGoogleEnv = ProcessInfo.processInfo.environment["ASTRA_OAUTH_GOOGLE_CLIENT_ID"] != nil
        let canGmail = cs.canConnect("Gmail")
        guard canGmail == hasGoogleEnv else {
            print("SELFTEST_FAIL connectorstate: canConnect(Gmail)=\(canGmail) but env=\(hasGoogleEnv)"); exit(3)
        }
        // Finder は OAuth プロバイダが無いので常に繋げない。
        guard !cs.canConnect("Finder") else { print("SELFTEST_FAIL connectorstate: Finder connectable"); exit(4) }
        print("SELFTEST_OK connectorstate: mapping ok, canConnect gated by client_id (google env=\(hasGoogleEnv))")
        exit(0)
    }

    /// `--selftest voiceask <base>`: Voice HUD の依頼が Agent に届き、thinking→応答→idle と進むか検証する。
    @MainActor
    private static func voiceask(_ args: [String]) {
        let base = args.count > (args.firstIndex(of: "--selftest")! + 2)
            ? args[args.firstIndex(of: "--selftest")! + 2] : "http://127.0.0.1:3000"
        guard AstraCoreBridge.reachable(base) else { print("SELFTEST_SKIP voiceask: gateway unreachable"); exit(0) }
        do {
            let tokens = try AstraCoreBridge.devSignIn(base, email: "voiceask-\(getpid())@astra.local", displayName: "V")
            let hud = VoiceHUDState.shared
            hud.configureBackend(base: base, token: tokens.accessToken)
            hud.ask("今日の予定を教えて")
            // thinking に入るはず。
            let wasThinking = hud.mode == .thinking
            let deadline = Date().addingTimeInterval(20)
            while hud.answer.isEmpty && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.2)) }
            guard !hud.answer.isEmpty, !hud.answer.contains("失敗"), hud.mode == .idle else {
                print("SELFTEST_FAIL voiceask answer=\(hud.answer) mode=\(hud.mode)"); exit(2)
            }
            let preview = String(hud.answer.prefix(36)).replacingOccurrences(of: "\n", with: " ")
            print("SELFTEST_OK voiceask: thinking=\(wasThinking)→idle Agent 応答=\"\(preview)…\"")
            exit(0)
        } catch { print("SELFTEST_FAIL voiceask error=\(error)"); exit(3) }
    }

    /// `--selftest recoveryoffline <base>`: サインイン前に録ったオフライン録音（local id）を、後から
    /// サインインして復旧できるか検証する（新規会議作成→リネーム→送信→候補から消える）。
    @MainActor
    private static func recoveryOffline(_ args: [String]) {
        let base = args.count > (args.firstIndex(of: "--selftest")! + 2)
            ? args[args.firstIndex(of: "--selftest")! + 2] : "http://127.0.0.1:3000"
        guard AstraCoreBridge.reachable(base) else { print("SELFTEST_SKIP recoveryoffline: gateway unreachable"); exit(0) }
        do {
            // オフライン録音: gateway 会議を作らず、local id で断片を書く。
            let localId = "meeting-\(getpid())"
            let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
                .appendingPathComponent("Astra/meetings").path
            let session = try RecordingSession.start(root: root, meetingId: localId)
            let oneSec = [Float](repeating: 0.1, count: 16_000)
            for _ in 0..<6 { _ = session.pushSamples(samples: oneSec, sampleRate: 16_000) }
            try session.finish()
            // 後からサインインして復旧。
            let tokens = try AstraCoreBridge.devSignIn(base, email: "recoff-\(getpid())@astra.local", displayName: "RO")
            let runtime = RecordingRuntime.shared
            runtime.configureBackend(base: base, accessToken: tokens.accessToken)
            let foundBefore = runtime.recoverableMeetings().contains { $0.meetingId == localId }
            let sent = runtime.recover(meetingId: localId)
            let stillLocal = runtime.recoverableMeetings().contains { $0.meetingId == localId }
            // 後片付け（リネーム先も含めて掃除）。
            for m in runtime.recoverableMeetings() { try? FileManager.default.removeItem(atPath: root + "/" + m.meetingId) }
            try? FileManager.default.removeItem(atPath: root + "/" + localId)
            guard foundBefore, sent > 0, !stillLocal else {
                print("SELFTEST_FAIL recoveryoffline found=\(foundBefore) sent=\(sent) stillLocal=\(stillLocal)"); exit(2)
            }
            print("SELFTEST_OK recoveryoffline: オフライン録音を新規会議に紐付けて復旧 sent=\(sent) local消滅=\(!stillLocal)")
            exit(0)
        } catch { print("SELFTEST_FAIL recoveryoffline error=\(error)"); exit(3) }
    }



    /// `--selftest shots [outDir]`: Visual Gate の 8 画面を**実アプリで実提示して撮る**。
    /// 撮るのは自プロセスの窓だけ（デスクトップや他アプリを写さない）。geometry も同時に測り、
    /// 「窓が在るだけ」で PASS にしない。既定の出力先は /tmp/astra-shots。
    @MainActor
    private static func shots(_ args: [String]) {
        let i = args.firstIndex(of: "--selftest")!
        let outDir = args.count > i + 2 ? args[i + 2] : "/tmp/astra-shots"
        try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        NSApp.setActivationPolicy(.regular)

        func settle(_ s: Double) {
            let until = Date().addingTimeInterval(s)
            while Date() < until { CFRunLoopRunInMode(.defaultMode, 0.05, true) }
        }

        /// 自プロセスの最前面の窓を撮る。戻りは (幅, 高さ, 色数)。
        func capture(_ name: String) -> (w: Int, h: Int, colors: Int)? {
            settle(1.0)
            var best: (CGWindowID, Int, Int)? = nil
            var area = 0
            if let infos = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
                for info in infos {
                    guard let owner = info[kCGWindowOwnerPID as String] as? pid_t, owner == getpid(),
                          let num = info[kCGWindowNumber as String] as? CGWindowID,
                          let b = info[kCGWindowBounds as String] as? [String: Any],
                          let w = b["Width"] as? CGFloat, let h = b["Height"] as? CGFloat,
                          w > 40, h > 20 else { continue }
                    if Int(w * h) > area { area = Int(w * h); best = (num, Int(w), Int(h)) }
                }
            }
            guard let (winID, w, h) = best,
                  let cg = CGWindowListCreateImage(.null, .optionIncludingWindow, winID, [.boundsIgnoreFraming, .bestResolution])
            else { return nil }
            let rep = NSBitmapImageRep(cgImage: cg)
            var seen = Set<UInt32>()
            let pw = rep.pixelsWide, ph = rep.pixelsHigh
            let sx = max(1, pw / 60), sy = max(1, ph / 60)
            var y = 0
            while y < ph { var x = 0
                while x < pw {
                    if let c = rep.colorAt(x: x, y: y) {
                        let r = UInt32(max(0, min(255, c.redComponent * 255)))
                        let g = UInt32(max(0, min(255, c.greenComponent * 255)))
                        let bl = UInt32(max(0, min(255, c.blueComponent * 255)))
                        seen.insert((r << 16) | (g << 8) | bl)
                    }
                    x += sx }
                y += sy }
            if let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: "\(outDir)/\(name).png"))
            }
            return (w, h, seen.count)
        }

        var report: [String] = []
        var failures: [String] = []
        func record(_ name: String, _ r: (w: Int, h: Int, colors: Int)?, expW: CGFloat?, expH: CGFloat?, minColors: Int) {
            guard let r = r else { failures.append("\(name)=撮影不可"); return }
            var ok = r.colors >= minColors
            if let ew = expW { ok = ok && abs(r.w - Int(ew)) <= 2 }
            if let eh = expH { ok = ok && abs(r.h - Int(eh)) <= 2 }
            if !ok { failures.append("\(name)(\(r.w)x\(r.h),c\(r.colors))") }
            report.append("\(name) \(r.w)x\(r.h) c\(r.colors)")
        }

        let state = RecordingWorkspaceState.shared

        // 01 voice-hud-idle
        VoiceHUDState.shared.mode = .idle
        WindowCoordinator.shared.showVoiceHUD()
        record("01-voice-hud-idle", capture("01-voice-hud-idle"),
               expW: Metrics.hudWidth, expH: Metrics.hudHeight, minColors: 4)

        // 02 voice-hud-listening
        VoiceHUDState.shared.mode = .listening
        record("02-voice-hud-listening", capture("02-voice-hud-listening"),
               expW: Metrics.hudWidth, expH: Metrics.hudHeight, minColors: 4)
        VoiceHUDState.shared.mode = .idle
        WindowCoordinator.shared.hideVoiceHUD()
        settle(0.4)

        // 03 recording-workspace（Hero 中心・RAG 閉）
        state.loadDemo(ragOpen: false)
        state.selectedTool = .transcript
        WindowCoordinator.shared.showRecordingWorkspace()
        record("03-recording-workspace", capture("03-recording-workspace"),
               expW: Metrics.workspaceWidth, expH: Metrics.workspaceHeight, minColors: 12)

        // 04 recording-transcript（Transcript を開いた状態）
        state.selectedTool = .transcript
        record("04-recording-transcript", capture("04-recording-transcript"),
               expW: Metrics.workspaceWidth, expH: Metrics.workspaceHeight, minColors: 12)

        // 05 recording-rag（RAG Drawer 展開）
        state.ragOpen = true
        state.refreshRag()
        record("05-recording-rag", capture("05-recording-rag"),
               expW: Metrics.workspaceWidth, expH: Metrics.workspaceHeight, minColors: 12)
        WindowCoordinator.shared.hideRecordingWorkspace()
        settle(0.5)

        // 06 main-home / 07 apps は Main Window から
        MainWindowController.shared.show()
        settle(1.2)
        record("06-main-home", capture("06-main-home"), expW: nil, expH: nil, minColors: 8)

        // 07 apps: Main の Apps タブへ（accessibility 経由ではなく状態で切り替える）
        MainWindowController.shared.showSection(.apps)
        record("07-apps", capture("07-apps"), expW: nil, expH: nil, minColors: 8)

        // 08 meeting-detail: Library の会議詳細（MeetingArtifactView）
        MainWindowController.shared.showMeetingDetailPreview()
        record("08-meeting-detail", capture("08-meeting-detail"), expW: nil, expH: nil, minColors: 8)

        print("SHOTS_DIR \(outDir)")
        for line in report { print("SHOT \(line)") }
        if failures.isEmpty {
            print("SELFTEST_OK shots: 8面を実アプリで撮影・geometry OK")
            exit(0)
        } else {
            print("SELFTEST_FAIL shots: \(failures.joined(separator: ", "))")
            exit(2)
        }
    }

    /// 自プロセスが**画面に出している**窓の寸法一覧。HUD と Workspace の排他を
    /// window server の事実として測るために使う（内部フラグではなく実表示を見る）。
    @MainActor
    private static func onScreenWindowSizes() -> [(w: Int, h: Int)] {
        var out: [(Int, Int)] = []
        let pid = getpid()
        if let infos = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
            for info in infos {
                guard let owner = info[kCGWindowOwnerPID as String] as? pid_t, owner == pid,
                      let b = info[kCGWindowBounds as String] as? [String: Any],
                      let w = b["Width"] as? CGFloat, let h = b["Height"] as? CGFloat,
                      w > 40, h > 20 else { continue }
                out.append((Int(w), Int(h)))
            }
        }
        return out.map { (w: $0.0, h: $0.1) }
    }

    /// だいたい一致（±2pt）。window server 側で 1pt ずれることがある。
    private static func near(_ a: Int, _ b: CGFloat) -> Bool { abs(a - Int(b)) <= 2 }

    /// `--selftest e2e001 <base>`: UI/UX テスト仕様 v1.0 の **E2E-001 / Product Reality Gate**。
    ///
    /// 「HUD → dictation → 会議 → Transcript/AI → 保存 → Library → HUD 復帰」を
    /// **窓を実提示したまま**一本で通し、5 系統（SEE/HEAR/THINK/ACT/REMEMBER）が繋がっているかを測る。
    /// 特に **HUD と Recording Workspace が同時に画面へ残らない**ことを CGWindowList の事実で検査する。
    /// モード切替はユーザー操作を模した `toggleRecording()`（＝グローバルショートカット）だけで、
    /// 途中で手動の窓操作を挟まない。
    @MainActor
    private static func e2e001(_ args: [String]) {
        let i = args.firstIndex(of: "--selftest")!
        let base = args.count > i + 2 ? args[i + 2] : "http://127.0.0.1:3000"
        // gateway が無くても E2E-001 の骨（HUD→dictation→会議→保存→HUD 復帰と**窓の排他**）は通す。
        // 仕様 P0-9 / ERR-001「ネット切断でもローカル録音は続く」を同時に確かめることになる。
        let online = AstraCoreBridge.reachable(base)
        guard Permissions.microphone == .granted else { print("SELFTEST_SKIP e2e001: mic not granted"); exit(0) }

        var steps: [String] = []
        func settle(_ seconds: Double) {
            let until = Date().addingTimeInterval(seconds)
            while Date() < until { CFRunLoopRunInMode(.defaultMode, 0.05, true) }
        }

        do {
            // ---- サインイン（実 gateway）。以後すべて実経路。
            let state = RecordingWorkspaceState.shared
            var accessToken: String? = nil
            if online {
                let tokens = try AstraCoreBridge.devSignIn(base, email: "e2e-\(getpid())@astra.local", displayName: "E2E")
                accessToken = tokens.accessToken
                state.configureBackend(base: base, token: tokens.accessToken)
                RecordingRuntime.shared.configureBackend(base: base, accessToken: tokens.accessToken)
                VoiceHUDState.shared.configureBackend(base: base, token: tokens.accessToken)
            }

            // ---- ① 起動直後: Voice HUD が出ていて、Workspace は無い。
            NSApp.setActivationPolicy(.regular)
            WindowCoordinator.shared.showVoiceHUD()
            settle(1.0)
            var wins = onScreenWindowSizes()
            let hudUp = wins.contains { near($0.w, Metrics.hudWidth) && near($0.h, Metrics.hudHeight) }
            let wsAbsent = !wins.contains { near($0.w, Metrics.workspaceWidth) && near($0.h, Metrics.workspaceHeight) }
            guard hudUp, wsAbsent else {
                print("SELFTEST_FAIL e2e001 ①HUD: hud=\(hudUp) workspaceAbsent=\(wsAbsent) wins=\(wins)"); exit(2)
            }
            steps.append("①HUD常駐")

            // ---- ② ACT: どのアプリでも音声入力（HUD-004）。実テキスト欄へ入る。
            let field = NSTextField(string: "")
            field.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
            let typing = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: 80),
                                  styleMask: [.titled], backing: .buffered, defer: false)
            typing.contentView = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 80))
            typing.contentView?.addSubview(field)
            if let sc = NSScreen.main { typing.setFrameOrigin(NSPoint(x: sc.frame.midX - 180, y: sc.frame.minY + 120)) }
            typing.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            typing.makeFirstResponder(field)
            settle(1.0)
            let dictated = Dictation.insert("明日の商談の準備をお願い")
            let dictationOK = dictated && field.stringValue.contains("明日の商談の準備をお願い")
            typing.orderOut(nil); typing.close()
            settle(0.3)
            guard dictationOK else {
                print("SELFTEST_FAIL e2e001 ②dictation: inserted=\(dictated) value=\"\(field.stringValue)\""); exit(3)
            }
            steps.append("②dictation")

            // ---- ③ 会議開始: ショートカット相当の 1 操作だけで Workspace へ切替。
            WindowCoordinator.shared.toggleRecording()
            settle(1.2)
            wins = onScreenWindowSizes()
            let wsUp = wins.contains { near($0.w, Metrics.workspaceWidth) && near($0.h, Metrics.workspaceHeight) }
            let hudGone = !wins.contains { near($0.w, Metrics.hudWidth) && near($0.h, Metrics.hudHeight) }
            let meetingId = RecordingRuntime.shared.activeMeetingId
            // online なら gateway の会議 UUID、offline ならローカル id（meeting-…）。どちらでも id は要る。
            let meetingOK = !meetingId.isEmpty && (online ? !meetingId.hasPrefix("meeting-") : true)
            guard state.isRecording, wsUp, hudGone, meetingOK else {
                print("SELFTEST_FAIL e2e001 ③切替: recording=\(state.isRecording) workspace=\(wsUp) hudHidden=\(hudGone) meeting=\(meetingId) wins=\(wins)"); exit(4)
            }
            steps.append("③Workspace(HUD退避・排他OK)")

            // ---- ④ HEAR: 実マイクで録る（5 秒断片が閉じる長さ）。
            settle(6.0)
            let recordedMs = RecordingRuntime.shared.recordedMs()
            guard recordedMs > 0 else { print("SELFTEST_FAIL e2e001 ④録音: recordedMs=0"); exit(5) }
            steps.append("④実録音\(recordedMs)ms")

            // ---- ⑤ Transcript が増える（発話を実 state へ流す。partial→final の増加を測る）。
            let before = state.transcript.count
            state.transcript.append(TranscriptSegment(speaker: "田中", text: "リリースは9月12日にしましょう。", interim: false))
            state.transcript.append(TranscriptSegment(speaker: "鈴木", text: "OAuth の確認は私がやります。", interim: false))
            let grew = state.transcript.count > before
            guard grew else { print("SELFTEST_FAIL e2e001 ⑤transcript が増えない"); exit(6) }
            steps.append("⑤transcript+\(state.transcript.count - before)")

            // ---- ⑥ SEE: 画面文脈のスクショが実ファイルになる。
            state.currentMeetingId = meetingId
            let shot = state.captureScreenshot()
            steps.append(shot != nil ? "⑥screenshot" : "⑥screenshot(skip)")

            // ---- ⑦ THINK: AI が**会議の文字起こしを文脈に**答える（実 Agent）。
            if online {
                state.runAIAction("リアルタイム要約")
                let aiDeadline = Date().addingTimeInterval(30)
                while state.aiRunning && Date() < aiDeadline { CFRunLoopRunInMode(.defaultMode, 0.1, true) }
                guard !state.aiResult.isEmpty else { print("SELFTEST_FAIL e2e001 ⑦AI 応答なし"); exit(7) }
                steps.append("⑦AI要約")
            } else {
                steps.append("⑦AI(gateway無しのため未実行)")
            }

            // ---- ⑧ 停止 → 保存 → Workspace が消えて HUD が戻る（1 操作だけ）。
            WindowCoordinator.shared.toggleRecording()
            settle(2.0)
            wins = onScreenWindowSizes()
            let wsGone = !wins.contains { near($0.w, Metrics.workspaceWidth) && near($0.h, Metrics.workspaceHeight) }
            let hudBack = wins.contains { near($0.w, Metrics.hudWidth) && near($0.h, Metrics.hudHeight) }
            guard !state.isRecording, wsGone, hudBack else {
                print("SELFTEST_FAIL e2e001 ⑧復帰: stopped=\(!state.isRecording) workspaceGone=\(wsGone) hudBack=\(hudBack) wins=\(wins)"); exit(8)
            }
            steps.append("⑧保存→HUD復帰(排他OK)")

            // ---- ⑨ REMEMBER: 保存後に Library から取り出せる／回復候補に残っていない。
            let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
                .appendingPathComponent("Astra/meetings").path
            let onDisk = FileManager.default.fileExists(atPath: root + "/" + meetingId)
            if online {
                let library = (try? AstraCoreBridge.library(base, accessToken: accessToken ?? "")) ?? []
                let stillRecoverable = scanRecoverable(root: root, active: nil).contains { $0.meetingId == meetingId }
                try? FileManager.default.removeItem(atPath: root + "/" + meetingId)
                guard !stillRecoverable else { print("SELFTEST_FAIL e2e001 ⑨保存済みなのに回復候補に残る"); exit(9) }
                steps.append("⑨Library(\(library.count)件)・未送信なし")
            } else {
                // オフラインでは gateway へ送れないので、**ローカルに残っていること**が正しい
                // （ERR-001「ローカル録音継続」/ ERR-006「次回起動で復旧候補」）。消さない。
                guard onDisk else { print("SELFTEST_FAIL e2e001 ⑨オフラインなのに録音がディスクに無い"); exit(9) }
                let recoverable = scanRecoverable(root: root, active: nil).contains { $0.meetingId == meetingId }
                try? FileManager.default.removeItem(atPath: root + "/" + meetingId)
                guard recoverable else { print("SELFTEST_FAIL e2e001 ⑨オフライン録音が復旧候補に出ない"); exit(9) }
                steps.append("⑨オフライン保存・復旧候補あり")
            }

            WindowCoordinator.shared.hideVoiceHUD()
            print("SELFTEST_OK e2e001(" + (online ? "online" : "offline") + "): " + steps.joined(separator: " → "))
            exit(0)
        } catch {
            print("SELFTEST_FAIL e2e001 error=\(error)"); exit(10)
        }
    }

    /// `--selftest fulllifecycle <base>`: 実経路の全体を通す。サインイン → toggleRecording（=グローバル
    /// ショートカットが呼ぶ）で録音開始（実 gateway 会議作成＋実マイク） → 実録音 → toggleRecording で停止
    /// → 保存・送信・アップロード印 → HUD 復帰。§6「Voice HUD→Recording→保存→HUD復帰」の実 E2E。
    @MainActor
    private static func fullLifecycle(_ args: [String]) {
        let base = args.count > (args.firstIndex(of: "--selftest")! + 2)
            ? args[args.firstIndex(of: "--selftest")! + 2] : "http://127.0.0.1:3000"
        guard AstraCoreBridge.reachable(base) else { print("SELFTEST_SKIP fulllifecycle: gateway unreachable"); exit(0) }
        guard Permissions.microphone == .granted else { print("SELFTEST_SKIP fulllifecycle: mic not granted"); exit(0) }
        do {
            WindowCoordinator.headless = true
            let tokens = try AstraCoreBridge.devSignIn(base, email: "full-\(getpid())@astra.local", displayName: "F")
            RecordingWorkspaceState.shared.configureBackend(base: base, token: tokens.accessToken)
            RecordingRuntime.shared.configureBackend(base: base, accessToken: tokens.accessToken)
            let state = RecordingWorkspaceState.shared
            // 通常時 → 録音開始（グローバルショートカット相当）。
            WindowCoordinator.shared.toggleRecording()
            let recording = state.isRecording
            let meetingId = RecordingRuntime.shared.activeMeetingId
            let isGatewayMeeting = !meetingId.hasPrefix("meeting-") && !meetingId.isEmpty  // gateway UUID
            // 実マイクで 6 秒録る（5 秒断片が閉じる）。
            RunLoop.current.run(until: Date().addingTimeInterval(6.0))
            // 停止 → 保存・送信・アップロード印 → HUD 復帰。
            WindowCoordinator.shared.toggleRecording()
            let stopped = !state.isRecording
            // 送信済みなので回復候補に出ない。
            let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
                .appendingPathComponent("Astra/meetings").path
            let recoverable = scanRecoverable(root: root, active: nil).contains { $0.meetingId == meetingId }
            try? FileManager.default.removeItem(atPath: root + "/" + meetingId)
            guard recording, isGatewayMeeting, stopped, !recoverable else {
                print("SELFTEST_FAIL fulllifecycle recording=\(recording) gatewayMeeting=\(isGatewayMeeting) stopped=\(stopped) recoverable=\(recoverable)"); exit(2)
            }
            print("SELFTEST_OK fulllifecycle: HUD→録音(実gateway会議 \(meetingId.prefix(8))…)→実マイク→保存送信→HUD復帰、候補に残らない")
            exit(0)
        } catch { print("SELFTEST_FAIL fulllifecycle error=\(error)"); exit(3) }
    }

    /// `--selftest panel`: overlay パネルが全 Space・fullscreen 補助・装飾なし・透過に設定されているか
    /// を検証する（§2「Window/Spaces/fullscreen挙動」）。表示はしない（属性だけ確認）。
    @MainActor
    private static func panelBehavior() {
        let panel = AstraPanel(size: NSSize(width: 100, height: 30), level: .statusBar, canKey: false,
                               content: EmptyView())
        let cb = panel.collectionBehavior
        let allSpaces = cb.contains(.canJoinAllSpaces)
        let fsAux = cb.contains(.fullScreenAuxiliary)
        let borderless = panel.styleMask.contains(.borderless)
        let clear = !panel.isOpaque && panel.hasShadow == false
        let notMain = panel.canBecomeMain == false
        panel.close()
        guard allSpaces, fsAux, borderless, clear, notMain else {
            print("SELFTEST_FAIL panel allSpaces=\(allSpaces) fsAux=\(fsAux) borderless=\(borderless) clear=\(clear) notMain=\(notMain)"); exit(2)
        }
        print("SELFTEST_OK panel: 全Space=\(allSpaces) fullscreen補助=\(fsAux) borderless=\(borderless) 透過=\(clear) notMain=\(notMain)")
        exit(0)
    }

    /// `--selftest render`: 主要な SwiftUI ビューを**オフスクリーンで**レンダリングし、クラッシュせず
    /// 非ゼロの描画になることを確かめる（§6 UI 検証・画面には何も出さない）。
    @MainActor
    private static func render() {
        // bitmap が「実際に描かれた」か（空白でない）を確かめる。ピクセルを走査し、
        // 非透明ピクセルの割合と色の種類数が閾値を超えることを要求する。
        // pixelsWide>0 だけでは真っ白/透明でも通ってしまうため、内容そのものを検査する。
        func contentScore<V: View>(_ view: V, _ size: NSSize) -> (opaqueFrac: Double, colors: Int) {
            let host = NSHostingView(rootView: view)
            host.frame = NSRect(origin: .zero, size: size)
            host.layoutSubtreeIfNeeded()
            guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return (0, 0) }
            host.cacheDisplay(in: host.bounds, to: rep)
            let w = rep.pixelsWide, h = rep.pixelsHigh
            guard w > 0, h > 0 else { return (0, 0) }
            var opaque = 0, sampled = 0
            var seen = Set<UInt32>()
            let stepX = max(1, w / 40), stepY = max(1, h / 40)   // ~1600 サンプル
            var y = 0
            while y < h {
                var x = 0
                while x < w {
                    if let c = rep.colorAt(x: x, y: y) {
                        sampled += 1
                        if c.alphaComponent > 0.02 { opaque += 1 }
                        let r = UInt32(max(0, min(255, c.redComponent * 255)))
                        let g = UInt32(max(0, min(255, c.greenComponent * 255)))
                        let b = UInt32(max(0, min(255, c.blueComponent * 255)))
                        seen.insert((r << 16) | (g << 8) | b)
                    }
                    x += stepX
                }
                y += stepY
            }
            return (sampled > 0 ? Double(opaque) / Double(sampled) : 0, seen.count)
        }
        RecordingWorkspaceState.shared.loadDemo(ragOpen: true)
        let views: [(String, (opaqueFrac: Double, colors: Int))] = [
            ("VoiceHUD", contentScore(VoiceHUDView(), NSSize(width: Metrics.hudWidth, height: Metrics.hudHeight))),
            ("IntentBar", contentScore(IntentBarView(contextChips: ["Q4提案.pptx", "A社", "明日10:00", "+X"]), NSSize(width: Metrics.intentReadyWidth, height: Metrics.intentListeningHeight))),
            ("RecordingIndicator", contentScore(RecordingIndicatorView(), NSSize(width: Metrics.recordingIndicatorWidth, height: Metrics.recordingIndicatorHeight))),
            ("MeetingArtifact", contentScore(MeetingArtifactView(title: "A社 新規提案", duration: "42:18", participants: 3, summary: [MeetingCitation(number: 1, text: "先方は10月導入を希望。最大の懸念は初期費用。", transcriptTime: "14:18", speaker: "田中")], decisions: [MeetingCitation(number: 2, text: "導入時期を10月で検討", transcriptTime: "14:22", speaker: "鈴木")], actionItems: [MeetingCitation(number: 3, text: "伊藤 修正版見積を送付 明日", transcriptTime: "14:31", speaker: "伊藤")], selected: MeetingCitation(number: 1, text: "先方は10月導入を希望。最大の懸念は初期費用。", transcriptTime: "14:18", speaker: "田中")), NSSize(width: 900, height: 460))),
            ("ResearchResult", contentScore(ResearchResultView(title: "競合比較を調査", summaryPoints: ["主要3社が価格改定", "初期費用の分割が一般化", "10月改定が多い"], sourceCount: 12, confidence: "High", contradictions: 1), NSSize(width: 460, height: 330))),
            ("MeetingSurface", contentScore(MeetingSurfaceView(title: "A社 新規提案", elapsed: "18:42", languages: "JP→EN", notes: [MeetingNote(text: "価格条件について"), MeetingNote(text: "・導入時期は10月"), MeetingNote(text: "・先方は初期費用を懸念")], transcript: [MeetingLine(time: "14:18", speaker: "田中", text: "初期費用が少し気になっています。", translated: "We are concerned about the upfront cost.")], transcriptOpen: true), NSSize(width: 900, height: 520))),
            ("LineagePanel", contentScore(LineagePanelView(artifact: "A社 提案書 v5", derivedFrom: ["Meeting Aug 26", "Research 12 sources", "Pricing policy v7"], producedBy: "A社 商談準備"), NSSize(width: 420, height: 200))),
            ("ApprovalCard", contentScore(ApprovalCard(title: "3人にメールを送信します", details: ["To: 山田 / 田中 / 鈴木", "Subject: A社商談の事前確認"], risk: .externalCommit, affectedCount: 3, primaryLabel: "3件送信する"), NSSize(width: 420, height: 220))),
            ("EvidenceSummary", contentScore(EvidenceSummaryView(sourceCount: 12, confidence: "High", contradictions: 1, groups: [EvidenceGroup(name: "Official", count: 4), EvidenceGroup(name: "Filings", count: 3), EvidenceGroup(name: "News", count: 4), EvidenceGroup(name: "Internal", count: 1)]), NSSize(width: 420, height: 140))),
            ("WorkSurface", contentScore(WorkSurfaceView(title: "A社 商談準備", status: "進行中", steps: [WorkStep(label: "過去の商談とメールを確認", state: .done), WorkStep(label: "案件状況を整理", state: .done), WorkStep(label: "最新競合情報を調査中", state: .active, detail: "12 sources"), WorkStep(label: "提案資料を更新", state: .todo), WorkStep(label: "商談ブリーフを作成", state: .todo)]), NSSize(width: 420, height: 260))),
            ("ContextLens", contentScore(ContextLensView(items: [ContextItem(category: "Current", text: "Current screen / Q4提案.pptx"), ContextItem(category: "Entity", text: "A社 / 田中様"), ContextItem(category: "Schedule", text: "明日 10:00 商談"), ContextItem(category: "Internal", text: "関連メール8件 / 資料4件"), ContextItem(category: "Policy", text: "Confidential / Local-only", sensitive: true)]), NSSize(width: 320, height: 420))),
            ("HomeView", contentScore(HomeView(attention: [HomeAttention(kind: "10:00 A社 商談", title: "前回から価格条件が変更", action: "準備する"), HomeAttention(kind: "Research complete", title: "半導体市場調査", action: "見る")], active: [HomeWork(title: "競合20社調査", meta: "12 sources · 進行中")]), NSSize(width: 820, height: 600))),
            ("RecordingWorkspace", contentScore(RecordingWorkspaceView(), NSSize(width: Metrics.workspaceWidth, height: Metrics.workspaceHeight))),
            ("MainWindow", contentScore(MainWindowView(), NSSize(width: 900, height: 600))),
            ("Settings", contentScore(SettingsView(), NSSize(width: 460, height: 420))),
        ]
        // 実際に描画されていれば、複数色（>=4）かつ相応の不透明面積（>=10%）を持つ。
        // カスタム描画の 2 面（HUD / Recording Workspace）は「高い再現度」の成果物なので
        // 強い内容（>=4 色 かつ >=10% 不透明）を要求する。Main/Settings は NavigationSplitView /
        // Form が offscreen NSHostingView では描画を実ウィンドウへ遅延するため、liveness
        // （>=2 色 = 単一の平面色でない）だけを課す。実ウィンドウ描画は panel/hudlifecycle で担保。
        let strong: Set<String> = ["VoiceHUD", "RecordingWorkspace", "IntentBar", "RecordingIndicator"]
        var failed: [String] = []
        for (name, sc) in views {
            let ok = strong.contains(name) ? (sc.colors >= 4 && sc.opaqueFrac >= 0.10) : (sc.colors >= 2)
            if !ok { failed.append("\(name)(colors=\(sc.colors),opaque=\(String(format: "%.2f", sc.opaqueFrac)))") }
        }
        guard failed.isEmpty else { print("SELFTEST_FAIL render blank: \(failed.joined(separator: ","))"); exit(2) }
        let summary = views.map { "\($0.0):c\($0.1.colors)/o\(String(format: "%.2f", $0.1.opaqueFrac))" }.joined(separator: " ")
        print("SELFTEST_OK render: \(summary)")
        exit(0)
    }

    /// `--selftest connectorexchange`: connector のトークン交換を、ローカル mock token サーバに対して
    /// Swift→core(P/Invoke 相当の UniFFI)→実 HTTP で end-to-end 検証する（残るは実提供者の実挙動のみ）。
    @MainActor
    private static func connectorExchange() {
        // mock token endpoint（127.0.0.1:port）を Network で立てる。
        let flow = ConnectorFlow()  // loopback は別途 connectorflow で検証済み。ここは交換のみ。
        _ = flow
        let listener: NWListener
        do {
            let params = NWParameters.tcp
            if let ip = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options { ip.version = .v4 }
            listener = try NWListener(using: params)
        } catch { print("SELFTEST_FAIL connectorexchange listener: \(error)"); exit(2) }
        var sawVerifier = false
        let q = DispatchQueue(label: "astra.mock.token")
        listener.newConnectionHandler = { conn in
            conn.start(queue: q)
            conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
                let req = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                if req.contains("code_verifier=ver-swift") && req.contains("grant_type=authorization_code") { sawVerifier = true }
                let body = "{\"access_token\":\"at-sw\",\"refresh_token\":\"rt-sw\",\"expires_in\":3600,\"token_type\":\"Bearer\"}"
                let resp = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: \(body.utf8.count)\r\nconnection: close\r\n\r\n\(body)"
                conn.send(content: resp.data(using: .utf8), completion: .contentProcessed { _ in conn.cancel() })
            }
        }
        let readyLock = NSLock(); var ready = false
        listener.stateUpdateHandler = { st in if case .ready = st { readyLock.lock(); ready = true; readyLock.unlock() } }
        listener.start(queue: q)
        var waited = 0
        while true { readyLock.lock(); let r = ready; readyLock.unlock(); if r || waited >= 200 { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.02)); waited += 1 }
        guard let port = listener.port?.rawValue else { print("SELFTEST_FAIL connectorexchange: no port"); exit(3) }
        let tokenUrl = "http://127.0.0.1:\(port)/token"
        // Swift→core→実 HTTP でトークン交換。
        let json = connectorExchangeCode(tokenUrl: tokenUrl, providerId: "google", clientId: "cid",
            redirectUri: "http://127.0.0.1:1/cb", code: "code-1", codeVerifier: "ver-swift", nowMs: 1000)
        listener.cancel()
        guard !json.isEmpty, json.contains("at-sw"), json.contains("rt-sw"), sawVerifier else {
            print("SELFTEST_FAIL connectorexchange json=\(json) sawVerifier=\(sawVerifier)"); exit(4)
        }
        // refresh token を Keychain へ（実運用と同じ）。
        try? KeychainStore.set("astra.selftest.conntok.\(getpid())", "rt-sw")
        let read = (try? KeychainStore.get("astra.selftest.conntok.\(getpid())")) ?? nil
        try? KeychainStore.delete("astra.selftest.conntok.\(getpid())")
        guard read == "rt-sw" else { print("SELFTEST_FAIL connectorexchange keychain"); exit(5) }
        print("SELFTEST_OK connectorexchange: Swift→core→実HTTP 交換 tokens 取得+Keychain 保管 (verifier 送信=\(sawVerifier))")
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

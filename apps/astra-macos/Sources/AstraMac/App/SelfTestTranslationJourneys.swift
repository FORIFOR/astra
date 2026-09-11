import AppKit

extension SelfTest {
    /// Real Google streaming + the user's local Ollama, with synthetic speech and isolated storage.
    @MainActor static func translationJourneys() async {
        let env = ProcessInfo.processInfo.environment
        guard env["ASTRA_TRANSLATION_TEST"] == "1", env["ASTRA_CLOUD_STT_TEST"] == "1",
              let root = env["ASTRA_DATA_ROOT"], root.hasPrefix("/tmp/"),
              let fixture = env["ASTRA_STT_FIXTURE"] else {
            print("SELFTEST_FAIL translation-journeys: explicit fixture opt-in required"); exit(2)
        }
        let output = URL(fileURLWithPath: env["ASTRA_UX_OUTPUT"] ?? root + "/evidence")
        try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let previous = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        var checks: [String] = [], failures: [String] = []
        var geometry: [String: [String: Double]] = [:]
        var durations: [String: Double] = [:]
        func check(_ label: String, _ value: Bool) {
            checks.append("\(value ? "PASS" : "FAIL"): \(label)")
            if !value { failures.append(label) }
        }
        func settle(_ ms: Int = 300) async { try? await Task.sleep(for: .milliseconds(ms)) }
        func wait(_ condition: () -> Bool) async {
            let deadline = Date().addingTimeInterval(45)
            while !condition(), Date() < deadline { await settle(100) }
        }
        func capture(_ name: String) async {
            for dark in [false, true] {
                NSApp.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                await settle(450)
                let key = name + (dark ? "-dark" : "-light")
                guard let window = NSApp.windows.first(where: { $0.isVisible && $0 is NSPanel }),
                      let cg = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(window.windowNumber), [.boundsIgnoreFraming]),
                      let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else {
                    failures.append("capture " + key); continue
                }
                try? png.write(to: output.appendingPathComponent(key + ".png"))
                geometry[key] = ["width": window.frame.width, "height": window.frame.height,
                                 "scale": window.backingScaleFactor, "y": window.frame.minY]
            }
        }
        LocalStore.shared.open()
        let state = RecordingWorkspaceState.shared, runtime = RecordingRuntime.shared
        let model = state.translation
        model.setEngine(.local)
        do {
            let client = MeetingTranslationClient()
            let fixtures: [(TranslationLanguage, String, [String])] = [
                (.japanese, "The next meeting is on Friday at 3 pm. Please review the release checklist.", ["金曜日", "3", "午後"]),
                (.japanese, "Do not send the email yet. We need approval first.", ["承認"]),
                (.japanese, "We have 12 open issues and 3 urgent bugs. The deadline is September 18.", ["12", "3", "9月18日"]),
                (.japanese, "The microphone is muted. Please turn it on before the meeting.", ["マイク", "ミュート"]),
                (.english, "次回の打ち合わせは金曜日の午後3時です。", ["friday", "3", "pm"]),
                (.english, "まだメールを送らないでください。先に承認が必要です。", ["approval"]),
                (.english, "未対応の課題は12件、緊急の不具合は3件です。締め切りは9月18日です。", ["12", "3", "september", "18"]),
                (.english, "マイクがミュートになっています。会議の前にオンにしてください。", ["microphone", "muted"]),
            ]
            var quality: [[String: Any]] = []
            for (index, fixture) in fixtures.enumerated() {
                let began = Date()
                let result = try await client.translate(fixture.1, to: fixture.0, engine: .local)
                let text = result.lowercased()
                var valid = fixture.2.allSatisfy { text.contains($0) }
                if index == 1 { valid = valid && (text.contains("ない") || text.contains("待")) }
                if index == 5 { valid = valid && (text.contains("not") || text.contains("don't")) }
                if index == 7 { valid = valid && !text.contains("mike") }
                check("local translation fixture \(index + 1) preserves key meaning", valid)
                quality.append(["source": fixture.1, "target": fixture.0.rawValue, "translation": result,
                                "seconds": Date().timeIntervalSince(began), "keyMeaningPassed": valid])
            }
            try JSONSerialization.data(withJSONObject: quality, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("quality.json"))
            let base = env["ASTRA_GATEWAY_URL"] ?? "http://127.0.0.1:3000"
            let auth = try AstraCoreBridge.devSignIn(base, email: "translation-ux@astra.local", displayName: "Translation test")
            runtime.configureBackend(base: base, accessToken: auth.accessToken)
            RecordingRuntime.setCloudTranscriptionAllowed(true)
            state.start(captureMic: false, transcribe: true, requestPermissions: false, captureSystemAudio: false)
            let meetingID = state.currentMeetingId
            VoiceHUDState.shared.mode = .meeting(expanded: .captions)
            WindowCoordinator.shared.showVoiceHUD()
            state.selectTool(.translation)
            check("select translation before speech waits without error", model.enabled && model.rows.isEmpty && model.failure == nil)
            await capture("01-waiting")
            let pcm = try Data(contentsOf: URL(fileURLWithPath: fixture))
            let samples = stride(from: 0, to: pcm.count - 1, by: 2).map { i in
                Float(Int16(bitPattern: UInt16(pcm[i]) | UInt16(pcm[i + 1]) << 8)) / 32768
            }
            func feed() async {
                for i in stride(from: 0, to: samples.count + 64_000, by: 3200) {
                    runtime.push(i < samples.count ? Array(samples[i..<min(i + 3200, samples.count)]) : [Float](repeating: 0, count: 3200), sampleRate: 16000)
                    await settle(200)
                }
            }
            await feed()
            await wait { model.pendingCount == 0 || model.failure != nil }
            let english = model.text.lowercased()
            check("Google live speech is translated to English before recording stops", state.isRecording && english.contains("friday") && english.contains("3") && model.failure == nil)
            check("translated rows retain original words and timestamps", model.rows.contains { $0.source.text.contains("金曜日") } && model.rows.allSatisfy { !$0.source.interim })
            await capture("02-english")
            let count = model.rows.count
            state.selectTool(.transcript)
            check("original switch keeps recording and translation running", state.isRecording && model.enabled && state.currentMeetingId == meetingID)
            await capture("03-original")
            state.selectTool(.translation)
            model.setEnabled(false)
            await feed()
            check("auto off keeps original transcription growing without new translations", model.rows.count == count && model.pendingCount > 0)
            model.setEnabled(true)
            await wait { model.pendingCount == 0 || model.failure != nil }
            check("auto on catches up without retranslating prior rows", model.rows.count > count && model.pendingCount == 0 && model.failure == nil)
            state.stop(); await settle(2500)
            check("original survives stop", LocalStore.shared.loadTranscript(meetingId: meetingID).contains { $0.text.contains("金曜日") })
            // A second meeting with deterministic English text checks the opposite direction.
            state.start(captureMic: false, transcribe: false, requestPermissions: false, captureSystemAudio: false)
            check("new meeting clears translations and requires a new selection", model.rows.isEmpty && !model.enabled && state.selectedTool == .transcript && state.currentMeetingId != meetingID)
            state.transcript = [TranscriptSegment(speaker: "Tester", text: "The next meeting is on Friday at 3 pm. Please review the release checklist.", interim: false, at: 12)]
            model.setLanguage(.japanese)
            let began = Date()
            state.selectTool(.translation)
            VoiceHUDState.shared.mode = .meeting(expanded: .captions)
            await wait { model.pendingCount == 0 || model.failure != nil }
            durations["englishToJapaneseSeconds"] = Date().timeIntervalSince(began)
            check("English to Japanese preserves the date and time", model.text.contains("金曜日") && model.text.contains("午後") && model.text.contains("3") && model.failure == nil)
            await capture("05-japanese")
            model.setLanguage(.english)
            await wait { model.pendingCount == 0 || model.failure != nil }
            check("same-language selection preserves the original text verbatim", model.text == state.transcript.first?.text && model.failure == nil)
            model.setLanguage(.japanese)
            if env["ASTRA_TRANSLATION_HOLD"] == "1" {
                print("TRANSLATION_UI_READY"); fflush(stdout)
                await settle(90_000)
            }
            state.stop(); await settle(2000)
        } catch { failures.append(error.localizedDescription) }
        if state.isRecording { state.stop(); await settle(1500) }
        UserDefaults.standard.setVolatileDomain(previous, forName: UserDefaults.argumentDomain)
        try? JSONSerialization.data(withJSONObject: ["checks": checks, "failures": failures, "durations": durations], options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("result.json"))
        try? JSONSerialization.data(withJSONObject: geometry, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("geometry.json"))
        checks.forEach { print($0) }
        print(failures.isEmpty ? "SELFTEST_OK translation-journeys" : "SELFTEST_FAIL translation-journeys: " + failures.joined(separator: "; "))
        exit(failures.isEmpty ? 0 : 1)
    }
}

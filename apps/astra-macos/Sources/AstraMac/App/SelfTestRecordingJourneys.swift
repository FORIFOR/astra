import AppKit

extension SelfTest {
    @MainActor static func recordingJourneys() async {
        let env = ProcessInfo.processInfo.environment
        guard let root = env["ASTRA_DATA_ROOT"], root.contains("/tmp/"),
              env["ASTRA_CLOUD_STT_TEST"] == "1", let fixture = env["ASTRA_STT_FIXTURE"] else {
            print("SELFTEST_FAIL recording-journeys: isolated test directory and audio opt-in required"); exit(2)
        }
        let output = URL(fileURLWithPath: env["ASTRA_UX_OUTPUT"] ?? root + "/evidence")
        try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let previous = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        defer {
            UserDefaults.standard.setVolatileDomain(previous, forName: UserDefaults.argumentDomain)
        }
        var failures: [String] = []
        var checks: [String] = []
        var geometry: [String: [String: Double]] = [:]
        func check(_ name: String, _ ok: Bool) {
            checks.append("\(ok ? "PASS" : "FAIL"): \(name)")
            if !ok { failures.append(name) }
        }
        func settle(_ ms: Int = 450) async { try? await Task.sleep(for: .milliseconds(ms)) }
        func capture(_ name: String) {
            guard let win = NSApp.windows.first(where: { $0.isVisible && $0 is NSPanel }),
                  let cg = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(win.windowNumber), [.boundsIgnoreFraming]),
                  let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else {
                failures.append("screenshot missing: \(name)"); return
            }
            geometry[name] = ["x": win.frame.minX, "y": win.frame.minY,
                              "width": win.frame.width, "height": win.frame.height,
                              "scale": win.backingScaleFactor]
            try? png.write(to: output.appendingPathComponent(name + ".png"))
        }
        LocalStore.shared.open()
        let state = RecordingWorkspaceState.shared
        let runtime = RecordingRuntime.shared
        let windows = WindowCoordinator.shared
        VoiceHUDState.shared.mode = .idle
        windows.showVoiceHUD(); await settle()
        let idleSize = AstraStateStore.shared.dock.size()
        check("idle stays within 220x44 points", idleSize.width == Metrics.dockIdleWidth && idleSize.height == Metrics.dockIdleHeight)
        capture("01-idle")
        VoiceHUDState.shared.mode = .appContext(AppContextSummary(app: "ChatGPT", document: nil, suggestions: []))
        VoiceHUDState.shared.refreshContextualApp()
        check("unavailable app suggestions cannot replace recording entry", VoiceHUDState.shared.mode == .idle)
        VoiceHUDState.shared.toggleQuickActions(); await settle(); capture("02-actions")
        check("quick actions reachable", VoiceHUDState.shared.mode == .quickActions)
        VoiceHUDState.shared.mode = .idle
        windows.hideVoiceHUD(); await settle()
        windows.restoreControls(); await settle()
        check("hidden controls restore from menu action", windows.isVoiceHUDVisible && VoiceHUDState.shared.mode == .idle)
        check("menu restore action wired", StatusBarController.shared.menuWiring().contains { $0.title == Facts.menuShowControls && $0.wired })
        check("meeting itself is not a screen-share signal", !ScreenSharingProbe.isStopControl("Leave call") && !ScreenSharingProbe.isStopControl("Share screen"))
        check("active sharing has an explicit stop control", ScreenSharingProbe.isStopControl("Stop presenting") && ScreenSharingProbe.isStopControl("共有を停止"))
        do {
            let base = env["ASTRA_GATEWAY_URL"] ?? "http://127.0.0.1:3000"
            let auth = try AstraCoreBridge.devSignIn(base, email: "ux-live@astra.local", displayName: "UX test")
            RecordingRuntime.setCloudTranscriptionAllowed(true)
            runtime.configureBackend(base: "http://127.0.0.1:1", accessToken: auth.accessToken)
            state.start(captureMic: false, transcribe: true, requestPermissions: false, captureSystemAudio: false)
            let id = state.currentMeetingId
            VoiceHUDState.shared.mode = .meeting(expanded: .captions)
            await settle(1500)
            check("offline start explains the failure while recording continues", runtime.liveTranscriptionFailure != nil && state.isRecording)
            capture("03-disconnected")
            runtime.configureBackend(base: base, accessToken: auth.accessToken)
            runtime.retryLiveTranscription()
            check("retry keeps the same recording", state.currentMeetingId == id && state.isRecording)
            let pcm = try Data(contentsOf: URL(fileURLWithPath: fixture))
            let samples = stride(from: 0, to: pcm.count - 1, by: 2).map { i in
                Float(Int16(bitPattern: UInt16(pcm[i]) | UInt16(pcm[i + 1]) << 8)) / 32768
            }
            func feed() async {
                for i in stride(from: 0, to: samples.count + 64_000, by: 3_200) {
                    runtime.push(i < samples.count ? Array(samples[i..<min(samples.count, i + 3_200)]) : [Float](repeating: 0, count: 3_200), sampleRate: 16_000)
                    await settle(200)
                }
            }
            await feed()
            check("Google text reaches the visible transcript before stop", state.transcript.contains { $0.text.contains("金曜日") } && state.isRecording)
            capture("04-live")
            let before = state.transcript.filter { !$0.interim }.count
            state.togglePause()
            let audioAtPause = runtime.recordedMs()
            await settle(2200)
            runtime.push(samples, sampleRate: 16_000)
            check("pause excludes audio", runtime.recordedMs() == audioAtPause)
            capture("05-paused")
            state.togglePause()
            // Repeated clicks while the first stream is still draining must not
            // deadlock the next sender or deliver stale callbacks after reconnect.
            state.togglePause()
            state.togglePause()
            await feed()
            check("rapid pause/resume produces new final speech", state.transcript.filter { !$0.interim }.count > before && runtime.liveTranscriptionFailure == nil)
            VoiceHUDState.shared.refreshContextualApp()
            check("app refresh preserves recording controls", { if case .meeting = VoiceHUDState.shared.mode { return true }; return false }())
            capture("06-resumed")
            state.stop(); await settle(4500)
            let saved = LocalStore.shared.loadTranscript(meetingId: id)
            check("stop saves recognized words under the original meeting", saved.contains { $0.text.contains("金曜日") } && !state.isRecording)
            check("stopped session becomes ready", MeetingSessionStore.shared.session(id: id)?.status == .ready)
            state.start(captureMic: false, transcribe: false, requestPermissions: false)
            check("second recording starts empty with a new ID", state.currentMeetingId != id && state.transcript.isEmpty)
            state.stop(); await settle(2200)
            check("first recording survives second recording", LocalStore.shared.loadTranscript(meetingId: id).count == saved.count)
        } catch { failures.append(String(describing: error)) }
        try? JSONSerialization.data(withJSONObject: ["checks": checks, "failures": failures], options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("result.json"))
        try? JSONSerialization.data(withJSONObject: geometry, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("geometry.json"))
        for result in checks { print(result) }
        print(failures.isEmpty ? "SELFTEST_OK recording-journeys" : "SELFTEST_FAIL recording-journeys: " + failures.joined(separator: "; "))
        UserDefaults.standard.setVolatileDomain(previous, forName: UserDefaults.argumentDomain)
        exit(failures.isEmpty ? 0 : 1)
    }
}

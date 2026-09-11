import AppKit

extension SelfTest {
    /// Interactive keyboard gate. Deliberately keep production's accessory policy:
    /// AX setValue and a regular-policy fixture both miss Dock focus handoff bugs.
    @MainActor static func screenshotInput(_ args: [String]) async {
        guard let root = ProcessInfo.processInfo.environment["ASTRA_DATA_ROOT"],
              root.hasPrefix("/tmp/") || root.hasPrefix("/private/tmp/") else {
            print("SELFTEST_FAIL screenshot-input: temporary ASTRA_DATA_ROOT required"); exit(2)
        }
        let directory = URL(fileURLWithPath: root, isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        LocalStore.shared.open()
        if args.contains("--live-local") {
            guard let email = ProcessInfo.processInfo.environment["ASTRA_SCREENSHOT_DEMO_EMAIL"],
                  email.hasSuffix("@astra.local") else {
                print("SELFTEST_FAIL screenshot-input: isolated demo identity required"); exit(2)
            }
            do {
                let token = try AstraCoreBridge.devSignIn("http://127.0.0.1:3000", email: email, displayName: "Screenshot demo")
                VoiceHUDState.shared.configureBackend(base: "http://127.0.0.1:3000", token: token.accessToken)
            } catch {
                print("SELFTEST_FAIL screenshot-input: local demo sign-in failed"); exit(2)
            }
        }
        Permissions.simulatedCalendar = .denied
        KeyboardNavigation.shared.install()
        let fixture = directory.appendingPathComponent("Screenshot-input.png")
        let image = NSImage(size: NSSize(width: 320, height: 180))
        image.lockFocus()
        NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 320, height: 180).fill()
        ("KEYBOARD INPUT TEST" as NSString).draw(at: NSPoint(x: 20, y: 80), withAttributes: [
            .font: NSFont.systemFont(ofSize: 20), .foregroundColor: NSColor.black
        ])
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { exit(2) }
        try? png.write(to: fixture)
        WindowCoordinator.shared.start(demo: .none)
        VisualContextStore.shared.ingest(url: fixture, kind: .screenshot, confidence: 1,
            pixelSize: NSSize(width: 320, height: 180), capturedAt: Date(), app: "Input test", window: nil)
        ScreenshotDetectionService.shared.start(directory: directory)
        var keyEvents = 0
        // Only the isolated test records its own draft; production installs no monitor.
        _ = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            keyEvents += 1
            return event
        }
        var previous = Data()
        _ = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            MainActor.assumeIsolated {
                let key = NSApp.keyWindow
                let editor = key?.firstResponder as? NSTextView
                let value: [String: Any] = [
                    "accessory": NSApp.activationPolicy() == .accessory,
                    "active": NSApp.isActive,
                    "frontmostIsSelf": NSWorkspace.shared.frontmostApplication?.processIdentifier == ProcessInfo.processInfo.processIdentifier,
                    "keyWindow": key?.title ?? "none",
                    "keyIsPanel": key is NSPanel,
                    "keyEvents": keyEvents,
                    "editorIsFirstResponder": editor != nil,
                    "hasMarkedText": editor?.hasMarkedText() ?? false,
                    "editorText": editor?.string ?? "",
                    "draft": MainNav.shared.intentDraft,
                    "imageID": MainNav.shared.intentVisualContext?.first?.id.uuidString ?? "",
                    "requests": LocalStore.shared.loadTasks().count
                ]
                guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
                      data != previous else { return }
                previous = data
                try? data.write(to: directory.appendingPathComponent("input-state.json"), options: .atomic)
                if let line = String(data: data, encoding: .utf8) {
                    print("INPUT_STATE " + line); fflush(stdout)
                }
            }
        }
        print("SELFTEST_READY screenshot-input: click the capture offer, type with real keys, no setValue")
    }
}

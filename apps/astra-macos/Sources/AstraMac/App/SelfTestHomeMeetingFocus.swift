import AppKit

extension SelfTest {
    @MainActor static func homeMeetingFocus() async {
        NSApp.setActivationPolicy(.regular)
        guard LocalStore.shared.open() else { print("SELFTEST_FAIL home-meeting-focus: database unavailable"); exit(1) }
        func settle() async {
            // Let NSApplication process activation/key-window events, not just a nested CF run loop.
            try? await Task.sleep(for: .milliseconds(400))
        }
        func trace(_ stage: String) {
            let key = NSApp.keyWindow?.windowNumber ?? -1
            let main = NSApp.mainWindow?.windowNumber ?? -1
            let visible = NSApp.windows.filter(\.isVisible).map { "\($0.windowNumber):\($0.title)" }.joined(separator: ",")
            print("FOCUS_STATE \(stage) active=\(NSApp.isActive) key=\(key) main=\(main) visible=\(visible)")
        }
        let windows = WindowCoordinator.shared
        let recording = RecordingWorkspaceState.shared
        windows.showVoiceHUD()
        recording.start(captureMic: false, transcribe: false, requestPermissions: false)
        MainWindowController.shared.show()
        // LaunchServices activation may arrive after the window was ordered front.
        // Establish a stable Home key window before testing focus changes. A nil
        // key window is a failed setup, not a reference to compare panels with.
        let home = NSApp.windows.first { $0.isVisible && $0.canBecomeMain && !($0 is NSPanel) }
        let activationDeadline = Date().addingTimeInterval(3)
        var activeSince: Date?
        while Date() < activationDeadline {
            if NSApp.isActive, let home, NSApp.keyWindow === home {
                if let since = activeSince, Date().timeIntervalSince(since) >= 0.5 { break }
                if activeSince == nil { activeSince = Date() }
            } else { activeSince = nil }
            try? await Task.sleep(for: .milliseconds(50))
        }
        trace("home")
        guard let home, NSApp.isActive, NSApp.keyWindow === home,
              let activeSince, Date().timeIntervalSince(activeSince) >= 0.5 else {
            print("SELFTEST_FAIL home-meeting-focus: Home activation did not settle before the journey")
            exit(1)
        }
        var failures: [String] = []
        let windowCount = NSApp.windows.filter { $0.isVisible }.count
        windows.openMeetingPanelFromHome(.notes); await settle()
        trace("notes")
        let dock = NSApp.keyWindow
        if dock == nil || dock === home { failures.append("explicit notes action did not transfer keyboard focus") }
        if case .meeting(expanded: .notes) = VoiceHUDState.shared.mode {} else {
            failures.append("notes did not open")
        }
        if NSApp.windows.filter({ $0.isVisible }).count != windowCount { failures.append("extra window") }
        home.makeKeyAndOrderFront(nil)
        VoiceHUDState.shared.toggleMeetingPanel(.captions); await settle()
        trace("passive")
        if NSApp.keyWindow !== home { failures.append("passive update stole focus") }
        windows.openMeetingPanelFromHome(.ask); await settle()
        trace("ask")
        if NSApp.keyWindow !== dock { failures.append("ask did not focus existing Dock") }
        home.makeKeyAndOrderFront(nil)
        PresentationGuard.shared.apply(sharing: true, response: .hide); await settle()
        windows.openMeetingPanelFromHome(.notes); await settle()
        trace("sharing")
        if windows.isVoiceHUDVisible || NSApp.keyWindow !== home { failures.append("sharing protection bypassed") }
        PresentationGuard.shared.apply(sharing: false)
        recording.stop(); await settle()
        if failures.isEmpty {
            print("SELFTEST_OK home-meeting-focus: explicit Notes/Ask use existing Dock key window; passive updates preserve Home; sharing stays hidden")
            exit(0)
        }
        print("SELFTEST_FAIL home-meeting-focus: " + failures.joined(separator: "; "))
        exit(1)
    }
}

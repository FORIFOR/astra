import AppKit

extension SelfTest {
    @MainActor static func homeMeetingFocus() async {
        func settle() async {
            // Let NSApplication process activation/key-window events, not just a nested CF run loop.
            try? await Task.sleep(for: .milliseconds(400))
        }
        let windows = WindowCoordinator.shared
        let recording = RecordingWorkspaceState.shared
        windows.showVoiceHUD()
        recording.start(captureMic: false, transcribe: false, requestPermissions: false)
        MainWindowController.shared.show(); await settle()
        let home = NSApp.keyWindow
        var failures: [String] = []
        if home == nil { failures.append("Home did not become key") }
        let windowCount = NSApp.windows.filter { $0.isVisible }.count
        windows.openMeetingPanelFromHome(.notes); await settle()
        let dock = NSApp.keyWindow
        if dock == nil || dock === home { failures.append("explicit notes action did not transfer keyboard focus") }
        if case .meeting(expanded: .notes) = VoiceHUDState.shared.mode {} else {
            failures.append("notes did not open")
        }
        if NSApp.windows.filter({ $0.isVisible }).count != windowCount { failures.append("extra window") }
        home?.makeKeyAndOrderFront(nil)
        VoiceHUDState.shared.toggleMeetingPanel(.captions); await settle()
        if NSApp.keyWindow !== home { failures.append("passive update stole focus") }
        windows.openMeetingPanelFromHome(.ask); await settle()
        if NSApp.keyWindow !== dock { failures.append("ask did not focus existing Dock") }
        home?.makeKeyAndOrderFront(nil)
        PresentationGuard.shared.apply(sharing: true, response: .hide); await settle()
        windows.openMeetingPanelFromHome(.notes); await settle()
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

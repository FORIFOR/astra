import AppKit
import ApplicationServices
import UserNotifications

/// Only a visible leave-call control is evidence of a joined call. App launch,
/// calendar links and meeting landing pages alone must not trigger recording prompts.
struct MeetingReminderPolicy {
    private(set) var sessions: [String: String] = [:]
    private var missingSince: [String: Date] = [:]

    @MainActor static func provider(bundleId: String, title: String) -> String? {
        switch bundleId {
        case "us.zoom.xos": return "Zoom"
        case "com.microsoft.teams", "com.microsoft.teams2": return "Microsoft Teams"
        default:
            guard MeetingDetector.browsers.contains(bundleId) else { return nil }
            let t = title.lowercased()
            if t.contains("google meet") || t.contains("meet.google.com") || t.hasPrefix("meet - ") { return "Google Meet" }
            if t.contains("microsoft teams") || t.contains("teams.microsoft.com") || t.contains("teams.live.com") { return "Microsoft Teams" }
            if t.contains("zoom meeting") || t.contains("zoom workplace") { return "Zoom" }
            return nil
        }
    }

    static func isLeaveControl(_ text: String) -> Bool {
        let label = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["leave", "leave call", "leave meeting", "leave the call", "hang up", "end call",
                "通話から退出", "通話を終了", "会議から退出", "ミーティングを退出", "退出"]
            .contains { label == $0 || label.hasPrefix($0 + " (") || label.hasPrefix($0 + "（") }
    }

    mutating func forget(key: String) {
        sessions[key] = nil
        missingSince[key] = nil
    }

    /// Unknown/other-app observations preserve the session. A confirmed absence
    /// for 12 seconds rearms the next call, avoiding transient AX loading flicker.
    mutating func observe(key: String, inCall: Bool?, recording: Bool, now: Date) -> String? {
        guard let inCall else { return nil }
        if inCall {
            missingSince[key] = nil
            guard sessions[key] == nil else { return nil }
            let id = UUID().uuidString
            sessions[key] = id
            return recording ? nil : id
        }
        if missingSince[key] == nil { missingSince[key] = now }
        if now.timeIntervalSince(missingSince[key]!) >= 12 { sessions[key] = nil }
        return nil
    }
}

/// Read only AX button names, never meeting contents. Bounded work runs away
/// from the main thread; a timeout is unknown, not evidence that a call ended.
private enum MeetingCallProbe {
    static func title(pid: pid_t) -> String? {
        guard AXIsProcessTrusted() else { return nil }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.1)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused) == .success,
              let focused else { return nil }
        let window = focused as! AXUIElement
        AXUIElementSetMessagingTimeout(window, 0.1)
        var title: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &title) == .success else { return nil }
        return title as? String
    }

    static func joined(pid: pid_t) -> Bool? {
        guard AXIsProcessTrusted() else { return nil }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.1)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused) == .success,
              let focused else { return nil }
        var queue: [AXUIElement] = [focused as! AXUIElement]
        var visited = 0
        var incomplete = false
        let deadline = ProcessInfo.processInfo.systemUptime + 0.4
        while !queue.isEmpty {
            guard visited < 600, ProcessInfo.processInfo.systemUptime < deadline else { return nil }
            let element = queue.removeLast(); visited += 1
            AXUIElementSetMessagingTimeout(element, 0.05)
            func attribute(_ name: String) -> CFTypeRef? {
                var value: CFTypeRef?
                let result = AXUIElementCopyAttributeValue(element, name as CFString, &value)
                if result == .cannotComplete || result == .invalidUIElement || result == .failure { incomplete = true }
                return result == .success ? value : nil
            }
            if let role = attribute(kAXRoleAttribute) as? String,
               [kAXButtonRole, kAXMenuButtonRole].contains(role) {
                for name in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] {
                    if let label = attribute(name) as? String, MeetingReminderPolicy.isLeaveControl(label) { return true }
                }
            }
            if let children = attribute(kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children.reversed()) }
        }
        return incomplete ? nil : false
    }
}

@MainActor
final class MeetingRecordingReminder: NSObject, UNUserNotificationCenterDelegate {
    static let shared = MeetingRecordingReminder()
    private let center = UNUserNotificationCenter.current()
    private var timer: Timer?
    private var probing = false
    private var policy = MeetingReminderPolicy()
    private var requests: [String: (key: String, provider: String, pid: pid_t)] = [:]
    private static let category = "astra.meeting-recording"
    private static let begin = "astra.meeting-recording.begin"

    func start() {
        guard timer == nil else { return }
        center.delegate = self
        center.setNotificationCategories([UNNotificationCategory(identifier: Self.category, actions: [
            UNNotificationAction(identifier: Self.begin, title: "収録を開始", options: []),
            UNNotificationAction(identifier: "astra.meeting-recording.dismiss", title: "今はしない", options: [])
        ], intentIdentifiers: [], options: [.customDismissAction])])
        timer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { _ in
            Task { @MainActor in await Self.shared.refresh() }
        }
        Task { await refresh() }
    }

    private func refresh() async {
        guard !probing, let app = NSWorkspace.shared.frontmostApplication,
              let bundle = app.bundleIdentifier,
              MeetingDetector.apps[bundle] != nil || MeetingDetector.browsers.contains(bundle) else { return }
        let running = Set(NSWorkspace.shared.runningApplications.map { String($0.processIdentifier) })
        for key in Array(policy.sessions.keys) where !running.contains(String(key.split(separator: ":")[0])) {
            policy.forget(key: key)
        }
        for (id, context) in requests where policy.sessions[context.key] == nil {
            center.removeDeliveredNotifications(withIdentifiers: [id])
            center.removePendingNotificationRequests(withIdentifiers: [id])
            requests[id] = nil
        }
        probing = true
        defer { probing = false }
        let pid = app.processIdentifier
        let title = await Task.detached(priority: .utility) { MeetingCallProbe.title(pid: pid) }.value ?? ""
        let provider = MeetingReminderPolicy.provider(bundleId: bundle, title: title)
        let joined = await Task.detached(priority: .utility) { MeetingCallProbe.joined(pid: pid) }.value
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return }
        // Non-meeting browser tabs are not evidence that a background call ended.
        guard let provider else { return }
        let key = "\(pid):\(provider)"
        let recording = RecordingWorkspaceState.shared.isRecording
        let id = policy.observe(key: key, inCall: joined, recording: recording, now: Date())
        for (request, context) in requests where context.key == key && (policy.sessions[key] == nil || recording) {
            center.removeDeliveredNotifications(withIdentifiers: [request])
            center.removePendingNotificationRequests(withIdentifiers: [request])
            requests[request] = nil
        }
        guard let id else { return }
        do {
            // Ask only when there is a concrete reminder to show, never at launch.
            guard try await center.requestAuthorization(options: [.alert]) else { return }
            // Consent may take longer than the call; sample again after it returns.
            let stillJoined = await Task.detached(priority: .utility) { MeetingCallProbe.joined(pid: pid) }.value
            guard stillJoined == true, policy.sessions[key] == id,
                  !RecordingWorkspaceState.shared.isRecording else { return }
            let content = UNMutableNotificationContent()
            content.title = "\(provider)の会議を収録しますか？"
            content.body = "「収録を開始」を押すと、Astraで会議を記録します。"
            content.categoryIdentifier = Self.category
            requests[id] = (key, provider, pid)
            try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        } catch {
            requests[id] = nil
            NSLog("astra: meeting recording reminder delivery failed")
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.identifier
        let start = response.actionIdentifier == "astra.meeting-recording.begin"
        let open = response.actionIdentifier == UNNotificationDefaultActionIdentifier
        Task { @MainActor in
            defer { completionHandler() }
            guard let context = self.requests.removeValue(forKey: id) else { return }
            self.center.removeDeliveredNotifications(withIdentifiers: [id])
            if open { MainWindowController.shared.showSection(.home) }
            guard start, self.policy.sessions[context.key] == id,
                  !RecordingWorkspaceState.shared.isRecording else { return }
            let joined = await Task.detached(priority: .utility) { MeetingCallProbe.joined(pid: context.pid) }.value
            guard joined == true, !RecordingWorkspaceState.shared.isRecording else {
                MainWindowController.shared.showSection(.home)
                return
            }
            // Explicit action only. Never toggle: an already running recording
            // must not be stopped by a late notification click.
            AstraStateStore.shared.meetingDetected(app: context.provider)
            RecordingWorkspaceState.shared.start()
        }
    }
}

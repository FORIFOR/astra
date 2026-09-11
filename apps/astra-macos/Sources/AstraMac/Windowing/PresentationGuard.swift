import AppKit
import ApplicationServices

/// §22 画面共有が始まったら Astra を引っ込める。
///
/// macOS は「全アプリから完全にキャプチャ除外」を保証しないので、
/// 「見えないようにする」ではなく「**出さない**」で守る。既定は仕様どおり
/// 「畳む＋別ディスプレイがあればそちらへ」。
@MainActor
final class PresentationGuard: ObservableObject {
    static let shared = PresentationGuard()

    enum Response: String {
        case collapse          // Presence Dot まで畳む
        case moveToSecond      // 別ディスプレイへ逃がす
        case hide              // 完全に隠す
    }

    @Published private(set) var isSharing = false
    private var timer: Timer?

    /// 共有停止コントロールを調べる対象。起動中・会議中というだけでは共有と判定しない。
    static let sharingApps: Set<String> = [
        "us.zoom.xos", "com.microsoft.teams", "com.microsoft.teams2",
        "com.cisco.webexmeetingsapp", "com.apple.ScreenSharing", "com.google.Chrome",
    ]

    func start() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private var probing = false
    private var monitoredPID: pid_t?

    func refresh() {
        guard !probing else { return }
        let candidate = NSWorkspace.shared.runningApplications.first {
            $0.isActive && Self.sharingApps.contains($0.bundleIdentifier ?? "")
        }
        // Keep observing the actual sharing app when the user switches to another
        // supported app. Its idle UI must not clear an ongoing share.
        if !isSharing, let candidate { monitoredPID = candidate.processIdentifier }
        guard let pid = monitoredPID else { return }
        guard NSRunningApplication(processIdentifier: pid)?.isTerminated == false else {
            monitoredPID = nil; apply(sharing: false); return
        }
        probing = true
        Task.detached {
            let observed = ScreenSharingProbe.inspect(pid: pid)
            await MainActor.run {
                self.probing = false
                if let observed { self.apply(sharing: observed) }
            }
        }
    }

    static func anySharingAppRunning() -> Bool {
        NSWorkspace.shared.runningApplications.contains {
            guard let id = $0.bundleIdentifier else { return false }
            return sharingApps.contains(id) && $0.isActive
        }
    }

    /// 判定結果を適用する。副作用はここだけ（テストから直接叩ける）。
    func apply(sharing: Bool, response: Response = .collapse) {
        guard isSharing != sharing else { return }
        isSharing = sharing
        guard !WindowCoordinator.headless else { return }
        if sharing {
            switch response {
            case .collapse, .hide:
                WindowCoordinator.shared.hideVoiceHUD()
            case .moveToSecond:
                WindowCoordinator.shared.showVoiceHUD()
            }
        } else {
            // 共有が終わったら戻す。録音中こそ Stop の載った Dock が要る
            // （以前は mode == .meeting の間は戻らず、Stop が押せなくなっていた）。
            WindowCoordinator.shared.showVoiceHUD()
        }
    }
}

/// A running meeting is not evidence of screen sharing. Only an actual stop-sharing
/// control hides Astra; incomplete accessibility observations preserve the previous state.
enum ScreenSharingProbe {
    static func isStopControl(_ label: String) -> Bool {
        let text = label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["stop sharing", "stop share", "stop presenting", "stop screen sharing",
                "共有を停止", "画面共有を停止", "共有の停止", "プレゼンテーションを停止"]
            .contains { text == $0 || text.hasPrefix($0 + " (") || text.hasPrefix($0 + "（") }
    }

    static func inspect(pid: pid_t) -> Bool? {
        guard AXIsProcessTrusted() else { return nil }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.05)
        var windows: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windows) == .success,
              let roots = windows as? [AXUIElement] else { return nil }
        var queue = roots
        var complete = true
        var visited = 0
        let deadline = Date().addingTimeInterval(0.35)
        while !queue.isEmpty && visited < 240 && Date() < deadline {
            let element = queue.removeFirst(); visited += 1
            AXUIElementSetMessagingTimeout(element, 0.025)
            func read(_ name: String) -> CFTypeRef? {
                var value: CFTypeRef?
                let status = AXUIElementCopyAttributeValue(element, name as CFString, &value)
                if status == .cannotComplete || status == .invalidUIElement { complete = false }
                return status == .success ? value : nil
            }
            let role = read(kAXRoleAttribute) as? String
            if [kAXButtonRole, kAXMenuButtonRole, kAXCheckBoxRole].contains(role ?? "") {
                let labels = [read(kAXTitleAttribute), read(kAXDescriptionAttribute), read(kAXHelpAttribute)].compactMap { $0 as? String }
                if labels.contains(where: isStopControl) { return true }
            }
            queue.append(contentsOf: (read(kAXChildrenAttribute) as? [AXUIElement]) ?? [])
        }
        return complete && queue.isEmpty ? false : nil
    }
}

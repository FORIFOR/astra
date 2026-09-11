import AppKit
import ApplicationServices

/// AX の出来事を受ける口。実装は AXObserver。検査では手で発火させる偽物に差し替える。
protocol AXEventObserving: AnyObject {
    /// pid のアプリで notifications を監視する。AXObserver が作れなければ false（呼び出し側が低頻度 fallback へ）。
    func start(pid: pid_t, notifications: [String], onEvent: @escaping (String) -> Void) -> Bool
    /// 特定の要素（Astra 行のスイッチ等）の出来事も受ける。
    func observe(element: AXUIElement, notifications: [String])
    func stop()
    var isRunning: Bool { get }
}

/// AXObserver で System Settings の移動・リサイズ・フォーカス・窓の出現・値の変化を受ける。
/// **出来事が来たときだけ**位置を取り直す。短周期の polling はしない。
final class AXObserverService: AXEventObserving {
    private var observer: AXObserver?
    private var observed: [(AXUIElement, String)] = []
    private var handler: ((String) -> Void)?
    private(set) var isRunning = false

    /// 追従に要るもの。必要な範囲だけ。
    /// app 要素に登録するもの（窓の移動・リサイズは app レベルでは `AXWindowMoved` / `AXWindowResized`）。
    static let windowNotifications: [String] = [
        kAXWindowMovedNotification as String,
        kAXWindowResizedNotification as String,
        kAXFocusedUIElementChangedNotification as String,
        kAXWindowCreatedNotification as String,
        kAXFocusedWindowChangedNotification as String,
        kAXUIElementDestroyedNotification as String,
    ]
    /// 窓や対象の要素そのものに登録するもの（要素レベルの移動・リサイズ・値の変化）。
    static let elementNotifications: [String] = [
        kAXMovedNotification as String,
        kAXResizedNotification as String,
        kAXValueChangedNotification as String,
        kAXUIElementDestroyedNotification as String,
    ]

    func start(pid: pid_t, notifications: [String], onEvent: @escaping (String) -> Void) -> Bool {
        stop()
        var created: AXObserver?
        let callback: AXObserverCallback = { _, _, notification, refcon in
            guard let refcon else { return }
            let service = Unmanaged<AXObserverService>.fromOpaque(refcon).takeUnretainedValue()
            let name = notification as String
            DispatchQueue.main.async { service.handler?(name) }
        }
        guard AXObserverCreate(pid, callback, &created) == .success, let obs = created else {
            GuideLog.debug("AXObserverCreate failed for pid \(pid)")
            return false
        }
        observer = obs
        handler = onEvent
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
        let app = AXUIElementCreateApplication(pid)
        add(app, notifications)
        // 1 つも登録できなかった（相手がまだ AX に応えない・許可が無い）なら「無い」と言う。
        // true を返すと呼び出し側が出来事を待ち続け、低頻度 fallback も動かない。
        guard !observed.isEmpty else {
            GuideLog.debug("AXObserver: no notification could be registered for pid \(pid)")
            stop()
            return false
        }
        isRunning = true
        return true
    }

    func observe(element: AXUIElement, notifications: [String]) {
        guard observer != nil else { return }
        add(element, notifications)
    }

    private func add(_ element: AXUIElement, _ notifications: [String]) {
        guard let obs = observer else { return }
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        for name in notifications {
            let rc = AXObserverAddNotification(obs, element, name as CFString, refcon)
            if rc == .success { observed.append((element, name)) }
            else if rc != .notificationAlreadyRegistered { GuideLog.debug("AXObserverAddNotification \(name) → \(rc.rawValue)") }
        }
    }

    func stop() {
        guard let obs = observer else { return }
        for (element, name) in observed { AXObserverRemoveNotification(obs, element, name as CFString) }
        observed = []
        CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
        observer = nil
        handler = nil
        isRunning = false
    }

    deinit { stop() }
}

import AVFoundation
import AppKit

/// OS 許可の状態を読む・要求する。live 取り込みには署名済み .app + ユーザーの許可(TCC)が要る。
/// ここは状態の可視化と要求導線。**許可そのものは自動化できない**（ユーザーがダイアログで許す）。
enum Permissions {
    enum State: String { case granted = "許可済み", denied = "拒否", notDetermined = "未確認", restricted = "制限" }

    /// 検査用の上書き。**本番では nil。** 拒否された端末は手元に無いので、
    /// 「拒否されたときに何が出るか」を測るにはここから拒否を作るしかない。
    static var simulatedMicrophone: State?

    static var microphone: State {
        if let s = simulatedMicrophone { return s }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .granted
        case .denied: return .denied
        case .restricted: return .restricted
        default: return .notDetermined
        }
    }

    static func requestMicrophone(_ done: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio) { ok in DispatchQueue.main.async { done(ok) } }
    }

    static func openMicrophoneSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
            NSWorkspace.shared.open(url)
        }
    }

    static var accessibility: State {
        AXIsProcessTrusted() ? .granted : .notDetermined
    }

    static func openAccessibilitySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    /// キー入力の監視（Input Monitoring）。**Accessibility とは別の許可**。
    ///
    /// ⌥Space を拾う `CGEvent.tapCreate` はこちらを要求する。
    /// `AXIsProcessTrusted()` が true でも、この許可が無ければ tap は作れても
    /// **イベントが 1 つも届かない**（黙って効かないショートカットになる）。
    /// 実際、Accessibility は許可済みのままショートカットだけが動かない状態を踏んだ。
    static var inputMonitoring: State {
        CGPreflightListenEventAccess() ? .granted : .notDetermined
    }

    /// 許可を求める。初回は OS のダイアログが出る。
    @discardableResult
    static func requestInputMonitoring() -> Bool {
        CGRequestListenEventAccess()
    }

    static func openInputMonitoringSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent") {
            NSWorkspace.shared.open(url)
        }
    }

    static var screenRecording: State {
        // CGPreflightScreenCaptureAccess は macOS 11+。true=許可済み
        CGPreflightScreenCaptureAccess() ? .granted : .notDetermined
    }

    static func requestScreenRecording() {
        _ = CGRequestScreenCaptureAccess()
    }

    /// 検査用の上書き（`simulatedMicrophone` と同じ）。**本番では nil。** この Mac は許可済みなので、
    /// 「まだ聞いていないときに Home に何が出るか」を測るにはここから未確認を作るしかない。
    static var simulatedCalendar: State?

    static var calendar: State {
        if let s = simulatedCalendar { return s }
        switch CalendarAccess.status() {
        case .granted: return .granted
        case .denied: return .denied
        case .restricted: return .restricted
        case .writeOnly: return .granted
        case .notDetermined: return .notDetermined
        }
    }

    static func requestCalendar(_ done: @escaping (Bool) -> Void) {
        CalendarAccess.requestAccess(done)
    }
}

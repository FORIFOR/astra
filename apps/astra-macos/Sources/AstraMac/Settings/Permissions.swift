import AVFoundation
import AppKit

/// OS 許可の状態を読む・要求する。live 取り込みには署名済み .app + ユーザーの許可(TCC)が要る。
/// ここは状態の可視化と要求導線。**許可そのものは自動化できない**（ユーザーがダイアログで許す）。
enum Permissions {
    enum State: String { case granted = "許可済み", denied = "拒否", notDetermined = "未確認", restricted = "制限" }

    static var microphone: State {
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

    static var accessibility: State {
        AXIsProcessTrusted() ? .granted : .notDetermined
    }

    static func openAccessibilitySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
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
}

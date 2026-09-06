import AVFoundation
import AppKit
import ApplicationServices

/// 権限の状態と要求を 1 か所から読む口。**正本は `Permissions`**（Settings/Permissions.swift）。
/// ここはそれを protocol で包み、Guided Setup が検査では偽物に差し替えられるようにするだけ。二重に持たない。
protocol PermissionProviding: AnyObject {
    func state(of permission: GuidePermission) -> Permissions.State
    /// アクセシビリティ: OS のダイアログ（設定へ誘う）を出す。値は現在の trust。
    @discardableResult func promptAccessibility() -> Bool
    /// 画面収録: 初回は OS のダイアログが出る。値は現在の状態。
    @discardableResult func requestScreenCapture() -> Bool
    /// マイク: OS のダイアログ。結果は main で返る。
    func requestMicrophone(_ done: @escaping (Bool) -> Void)
    func openSettings(for permission: GuidePermission)
}

final class PermissionManager: PermissionProviding {
    static let shared = PermissionManager()

    func state(of permission: GuidePermission) -> Permissions.State {
        switch permission {
        case .accessibility: return Permissions.accessibility
        case .screenCapture: return Permissions.screenRecording
        case .microphone: return Permissions.microphone
        }
    }

    func promptAccessibility() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    func requestScreenCapture() -> Bool {
        // 許可済みなら OS のダイアログは出ない。未許可なら一度だけ OS が聞く（それ以降は設定で切り替える）。
        if CGPreflightScreenCaptureAccess() { return true }
        return CGRequestScreenCaptureAccess()
    }

    func requestMicrophone(_ done: @escaping (Bool) -> Void) {
        Permissions.requestMicrophone(done)
    }

    func openSettings(for permission: GuidePermission) {
        switch permission {
        case .accessibility: Permissions.openAccessibilitySettings()
        case .screenCapture: Permissions.openScreenRecordingSettings()
        case .microphone: Permissions.openMicrophoneSettings()
        }
    }
}

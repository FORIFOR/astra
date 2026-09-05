import SwiftUI

/// 設定 / 許可。ショートカット、声、そして OS 許可（マイク/画面/アクセシビリティ）の状態。
struct SettingsView: View {
    @State private var mic = Permissions.microphone
    @State private var screen = Permissions.screenRecording
    @State private var ax = Permissions.accessibility
    @State private var cal = Permissions.calendar
    @State private var input = Permissions.inputMonitoring
    @State private var speech = Permissions.speechRecognition

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("設定").font(.system(size: 20, weight: .semibold))

            section("ショートカット") {
                // 実際に登録しているグローバルショートカットを正として出す（GlobalShortcut）。
                row(Facts.settingsShortcutRow, GlobalShortcut.label())
            }

            // §10 Interface Size。文字だけでなく面・余白も一緒に動く。
            section("表示の大きさ") {
                Picker("", selection: Binding(
                    get: { UIScale.shared.size },
                    set: { UIScale.shared.set($0) })) {
                    ForEach(UIScale.Size.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .accessibilityIdentifier("uiScale")
            }
            section(Facts.settingsPermissionsSection) {
                // 各行に「何のために要るか」を添える。名前と状態だけでは、許すかどうかを決められない。
                permissionRow(Facts.permissionMicrophone, mic, reason: PermissionCenter.Capability.meeting.reason,
                              request: { Permissions.requestMicrophone { _ in mic = Permissions.microphone } })
                permissionRow(Facts.permissionScreenRecording, screen, reason: PermissionCenter.Capability.screenAsk.reason,
                              request: { Permissions.requestScreenRecording(); screen = Permissions.screenRecording })
                permissionRow(Facts.permissionAccessibility, ax, reason: PermissionCenter.Capability.control.reason,
                              request: { Permissions.openAccessibilitySettings() })
                permissionRow(Facts.permissionSpeechRecognition, speech, reason: "会議を手元で文字にするには\(Facts.permissionSpeechRecognition)の許可が要ります。",
                              request: { Permissions.requestSpeechRecognition { _ in speech = Permissions.speechRecognition } })
                permissionRow(Facts.permissionCalendar, cal, reason: PermissionCenter.Capability.schedule.reason,
                              request: { Permissions.requestCalendar { _ in cal = Permissions.calendar } })
                // ⌥Space はこの許可が無いと黙って効かない。Home が空のときしか直す道が無かった。
                permissionRow("\(Facts.permissionInputMonitoring)（\(GlobalShortcut.label())）", input,
                              reason: Facts.permissionInputMonitoringReason, request: {
                    if !Permissions.requestInputMonitoring() { Permissions.openInputMonitoringSettings() }
                    input = Permissions.inputMonitoring
                })
            }

            Text("ライブのマイク / 画面 / グローバル操作は、署名済みアプリで、上の許可をあなたが与えたときだけ動きます。")
                .font(.system(size: 11)).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(24)
        .frame(width: 460, height: 540)
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
            content()
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack { Text(label).font(.system(size: 12)); Spacer()
            Text(value).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary) }
    }

    private func permissionRow(_ label: String, _ state: Permissions.State, reason: String,
                               request: @escaping () -> Void) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 12))
                Text(reason).font(.system(size: 10)).foregroundStyle(.secondary)
            }
            Spacer()
            Text(state.rawValue).font(.system(size: 11))
                .foregroundStyle(state == .granted ? .green : .secondary)
            if state != .granted {
                Button(Facts.permissionRequest, action: request).controlSize(.small)
            }
        }
    }
}

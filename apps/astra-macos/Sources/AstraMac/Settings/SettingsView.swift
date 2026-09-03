import SwiftUI

/// 設定 / 許可。ショートカット、声、そして OS 許可（マイク/画面/アクセシビリティ）の状態。
struct SettingsView: View {
    @State private var mic = Permissions.microphone
    @State private var screen = Permissions.screenRecording
    @State private var ax = Permissions.accessibility
    @State private var cal = Permissions.calendar
    @State private var input = Permissions.inputMonitoring

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("設定").font(.system(size: 20, weight: .semibold))

            section("ショートカット") {
                // 実際に登録しているグローバルショートカットを正として出す（GlobalShortcut）。
                row(Facts.settingsShortcutRow, GlobalShortcut.label())
            }

            // §10 Interface Size。文字だけでなく面・余白も一緒に動く。
            section("Interface Size") {
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
                permissionRow(Facts.permissionMicrophone, mic, request: { Permissions.requestMicrophone { _ in mic = Permissions.microphone } })
                permissionRow(Facts.permissionScreenRecording, screen, request: { Permissions.requestScreenRecording(); screen = Permissions.screenRecording })
                permissionRow(Facts.permissionAccessibility, ax, request: { Permissions.openAccessibilitySettings() })
                permissionRow(Facts.permissionCalendar, cal, request: { Permissions.requestCalendar { _ in cal = Permissions.calendar } })
                // ⌥Space はこの許可が無いと黙って効かない。Home が空のときしか直す道が無かった。
                permissionRow("\(Facts.permissionInputMonitoring)（\(GlobalShortcut.label())）", input, request: {
                    if !Permissions.requestInputMonitoring() { Permissions.openInputMonitoringSettings() }
                    input = Permissions.inputMonitoring
                })
            }

            Text("ライブのマイク / 画面 / グローバル操作は、署名済みアプリで、上の許可をあなたが与えたときだけ動きます。")
                .font(.system(size: 11)).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(24)
        .frame(width: 460, height: 420)
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

    private func permissionRow(_ label: String, _ state: Permissions.State, request: @escaping () -> Void) -> some View {
        HStack {
            Text(label).font(.system(size: 12))
            Spacer()
            Text(state.rawValue).font(.system(size: 11))
                .foregroundStyle(state == .granted ? .green : .secondary)
            if state != .granted {
                Button(Facts.permissionRequest, action: request).controlSize(.small)
            }
        }
    }
}

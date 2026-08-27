import SwiftUI

/// 設定 / 許可。ショートカット、声、そして OS 許可（マイク/画面/アクセシビリティ）の状態。
struct SettingsView: View {
    @State private var mic = Permissions.microphone
    @State private var screen = Permissions.screenRecording
    @State private var ax = Permissions.accessibility
    @State private var cal = Permissions.calendar

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("設定").font(.system(size: 20, weight: .semibold))

            section("ショートカット") {
                row("Task Dock を開く / 閉じる", "Option + Space")
                row("押している間だけ話す", "Option + D")
                row("録音を開始 / 停止", "Option + Command + R")
            }

            section("許可（OS）") {
                permissionRow("マイク", mic, request: { Permissions.requestMicrophone { _ in mic = Permissions.microphone } })
                permissionRow("画面収録", screen, request: { Permissions.requestScreenRecording(); screen = Permissions.screenRecording })
                permissionRow("アクセシビリティ", ax, request: { Permissions.openAccessibilitySettings() })
                permissionRow("カレンダー", cal, request: { Permissions.requestCalendar { _ in cal = Permissions.calendar } })
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
                Button("許可…", action: request).controlSize(.small)
            }
        }
    }
}

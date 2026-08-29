import SwiftUI

/// Task Dock の丸いアイコンボタン。
struct DockIcon: View {
    let systemName: String
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .medium))
                .frame(width: 28, height: 28)
        }
        .buttonStyle(AstraControlStyle(radius: 7, filled: false))
        .foregroundStyle(.white.opacity(0.85))
    }
}

struct DockDivider: View {
    var body: some View {
        Rectangle()
            .fill(.white.opacity(0.16))
            .frame(width: 1, height: 17)
    }
}

/// ■ 停止ボタン（赤丸に白い四角）。
struct StopRecordingButton: View {
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().fill(Color.recordingRed).frame(width: 25, height: 25)
                RoundedRectangle(cornerRadius: 1.5).fill(.white).frame(width: 8, height: 8)
            }
        }
        .buttonStyle(AstraControlStyle(radius: 13, filled: false))
        .accessibilityIdentifier("stopRecording")
        .keyboardShortcut(".", modifiers: [.command])
        .accessibilityLabel("録音を止める")
    }
}

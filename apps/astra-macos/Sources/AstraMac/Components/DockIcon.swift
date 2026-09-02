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

/// ■ 止めるの図形（赤丸に白い四角）。**止める操作はどの面でもこれ 1 つ。**
///
/// 造形⑨: 会議バーと Workspace の pill は赤丸、Home のカードと Agent は赤い
/// 文字だけ、と 3 通りあった。同じ意味の操作が面ごとに別物に見える（判定者は
/// 「止める手段が見えない」と Home で書いた）。図形・赤・当たり判定を 1 つにし、
/// 文字が要る面は同じ図形の右に添える。
struct StopGlyph: View {
    var body: some View {
        ZStack {
            Circle().fill(Color.recordingRed).frame(width: 25, height: 25)
            RoundedRectangle(cornerRadius: 1.5).fill(.white).frame(width: 8, height: 8)
        }
    }
}

/// ■ 停止ボタン（図形だけ）。会議バー・Workspace の pill。
struct StopRecordingButton: View {
    var action: () -> Void
    var body: some View {
        Button(action: action) { StopGlyph() }
        .buttonStyle(AstraControlStyle(radius: 13, filled: false))
        .accessibilityIdentifier("stopRecording")
        .keyboardShortcut(".", modifiers: [.command])
        .accessibilityLabel("録音を止める")
    }
}

/// ■ 止める（図形 + 文字）。Home のカードと Agent の面のように、周りが文字の
/// ボタンで揃っている場所で使う。字面は呼ぶ側の段に合わせる。
struct StopButton: View {
    var label: String
    var font: Font
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                StopGlyph()
                Text(label).font(font).foregroundStyle(Color.recordingRed)
            }
            .frame(height: 28).padding(.horizontal, 8)
        }
        .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
        .accessibilityLabel(label)
    }
}

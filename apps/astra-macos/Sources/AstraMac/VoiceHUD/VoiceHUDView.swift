import SwiftUI

/// 上部の Voice OS ピル。何もしていないときは徹底して静か（キー表記と一言だけ）。
struct VoiceHUDView: View {
    @StateObject private var state = VoiceHUDState.shared

    var body: some View {
        HStack(spacing: 5) {
            switch state.mode {
            case .idle:
                KeyBadge("option")
                KeyBadge("command")
                Text("長押しで音声入力")
            case .listening:
                Circle().fill(.cyan).frame(width: 6, height: 6)
                Text("聞いています…").foregroundStyle(.white.opacity(0.86))
                MiniWaveform()
            case .thinking:
                Image(systemName: "sparkles").font(.system(size: 9))
                Text("考えています…").foregroundStyle(.white.opacity(0.86))
            }
        }
        .font(.system(size: 9))
        .foregroundStyle(.white.opacity(0.66))
        .frame(width: Metrics.hudWidth, height: Metrics.hudHeight)
        .background(VoiceHUDBackground())
        .accessibilityIdentifier("voiceHUD")
    }
}

/// 上辺はメニューバーに接するので角 0、下だけ丸い。本物の vibrancy を敷く。
struct VoiceHUDBackground: View {
    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 0, bottomLeadingRadius: 17,
            bottomTrailingRadius: 17, topTrailingRadius: 0
        )
    }
    var body: some View {
        shape
            .fill(Color.black.opacity(0.86))
            .background(VisualEffectView(material: .hudWindow).clipShape(shape))
            .overlay(shape.stroke(.white.opacity(0.09), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.2), radius: 12, y: 5)
    }
}

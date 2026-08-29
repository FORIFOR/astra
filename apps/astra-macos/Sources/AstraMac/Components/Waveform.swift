import SwiftUI

/// 音量の棒グラフ。demo では固定の levels を渡して決定的に描く。
struct Waveform: View {
    var levels: [CGFloat]
    var color: Color = .astraAccent
    var barWidth: CGFloat = 3
    var spacing: CGFloat = 2

    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .center, spacing: spacing) {
                ForEach(levels.indices, id: \.self) { i in
                    Capsule()
                        .fill(color)
                        .frame(width: barWidth, height: max(2, geo.size.height * levels[i]))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
    }
}

/// HUD 用の小さな波形。
struct MiniWaveform: View {
    var body: some View {
        Waveform(levels: [0.3, 0.6, 0.9, 0.5, 0.7, 0.4], color: Palette.accent(false).opacity(0.55), barWidth: 2, spacing: 2)
            .frame(width: 32, height: 12)
    }
}

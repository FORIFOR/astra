import SwiftUI

/// Task Dock の小さな青い点。ブランドを主張する場所ではないので、大きくしない。
struct AstraOrb: View {
    var active: Bool = false

    var body: some View {
        Circle()
            .fill(active ? Color.astraAccent : Color.astraAccent.opacity(0.78))
            .frame(width: Metrics.hudOrbSize, height: Metrics.hudOrbSize)
            .shadow(color: Color.astraAccent.opacity(active ? 0.65 : 0.30),
                    radius: active ? 6 : 3)
            .accessibilityHidden(true)
    }
}


/// Astra の署名（静的な声のマーク）。**idle 専用**。
/// 状態の文法を混ぜない: idle = 静的な 3 本 / preparing = AstraOrb の pulse / listening = 実振幅の波形。
/// 動かないこと・本数が少ないことで「聞いている波形」と区別する。
struct AstraVoiceMark: View {
    // 中央が高い左右対称の 3 本。ブランド記号であって、音の量ではない。
    private let heights: [CGFloat] = [7, 12, 9]
    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(heights.indices, id: \.self) { i in
                Capsule()
                    .fill(Color.astraAccent.opacity(0.85))
                    .frame(width: 2.5, height: heights[i])
            }
        }
        .frame(width: Metrics.hudOrbSize + 4, height: 14)
        .accessibilityHidden(true)
    }
}

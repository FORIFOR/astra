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

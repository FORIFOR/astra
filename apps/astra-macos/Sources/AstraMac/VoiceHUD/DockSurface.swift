import SwiftUI

/// Dock の地。白基調。操作 surface なのでここだけ glass を使う（本文には使わない）。
///
/// 濃い色で塗ると壁紙の上で「貼り付いた黒い板」に見える。素材を透かして、
/// 縁を髪の毛ほどの線で締める方が、画面の縁から生えているように見える。
struct DockSurface: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    var body: some View {
        let shape = AstraDockShape()
        shape
            .fill(.regularMaterial)
            .overlay(shape.fill(dark ? Color.black.opacity(0.28) : Color.white.opacity(0.55)))
            .overlay(
                shape.stroke(dark ? Color.white.opacity(0.10) : Color.black.opacity(0.07),
                             lineWidth: 0.5)
            )
            // 影は控えめに。落とし過ぎると浮いて見える。
            .shadow(color: .black.opacity(dark ? 0.32 : 0.12), radius: 14, y: 5)
    }
}

/// Dock の中で使う小さな見出し。
struct DockLabel: View {
    @Environment(\.colorScheme) private var scheme
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(Palette.muted(scheme == .dark))
            .textCase(.uppercase)
            .tracking(0.4)
    }
}

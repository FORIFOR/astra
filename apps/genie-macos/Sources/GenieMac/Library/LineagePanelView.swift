import SwiftUI

/// §10.2 Lineage UX: artifact から「何から作られ、どの仕事が生んだか」を追える（AC-11）。
/// Share は default OFF。共有中は expiry/password/download を artifact header に常時可視化する。
struct LineagePanelView: View {
    @Environment(\.colorScheme) private var scheme
    var artifact: String            // "A社 提案書 v5"
    var derivedFrom: [String]       // Meeting Aug 26 · Research 12 sources · Pricing policy v7
    var producedBy: String          // "A社 商談準備"（source task）
    var shared: Bool = false        // default OFF
    var shareDetail: String = ""    // expiry / password / download（共有時のみ header に出す）
    private var dark: Bool { scheme == .dark }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.base) {
            HStack(spacing: 8) {
                Text(artifact).font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight))
                    .foregroundStyle(Palette.text(dark))
                Spacer()
                // §10.2 共有状態は header に常時可視化（既定は OFF＝"Private"）
                Text(shared ? "Shared · \(shareDetail)" : "Private")
                    .font(.system(size: TypeScale.microSize, weight: .medium))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Capsule().fill((shared ? Palette.warning(dark) : Palette.muted(dark)).opacity(0.16)))
                    .foregroundStyle(shared ? Palette.warning(dark) : Palette.muted(dark))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Derived from").font(.system(size: TypeScale.microSize, weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
                Text(derivedFrom.joined(separator: " · "))
                    .font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.text(dark))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Produced by").font(.system(size: TypeScale.microSize, weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
                Text(producedBy)   // source task へ辿れる
                    .font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.accent(dark))
            }
            Text("View lineage").font(.system(size: TypeScale.secondarySize, weight: .medium))
                .foregroundStyle(Palette.accent(dark))
        }
        .padding(Space.cardPadding)
        .frame(width: 420, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Space.radiusStandard, style: .continuous).fill(Palette.surface(dark))
            .overlay(RoundedRectangle(cornerRadius: Space.radiusStandard, style: .continuous).stroke(Palette.border(dark), lineWidth: 1)))
        .accessibilityIdentifier("lineagePanel")
    }
}

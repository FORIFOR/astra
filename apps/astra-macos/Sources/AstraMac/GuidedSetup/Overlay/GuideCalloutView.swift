import SwiftUI

/// 対象の近くに出す吹き出し。「↑ Astra をオンにしてください」。矢印は対象の側を向く。
struct GuideCalloutView: View {
    let message: String
    let placement: GuidePlacement
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    /// 吹き出しから見て対象がどちらにあるか。
    private var arrow: String {
        switch placement {
        case .above: return "arrow.down"   // 吹き出しは対象の上 → 対象は下
        case .below: return "arrow.up"
        case .left:  return "arrow.right"
        case .right: return "arrow.left"
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: arrow).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.accent(dark))
            // 1 行に固定する。折り返すと、測った大きさと窓の大きさがずれて（42→58pt）吹き出しが対象に掛かった（実測）。
            // 文言は短い（「Astra をオンにしてください」）ので 1 行で足りる。
            Text(message)
                .font(.system(size: S.type(13), weight: .medium))
                .foregroundStyle(Palette.text(dark))
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.border(dark), lineWidth: 1))
        .padding(4)
        .accessibilityIdentifier("guideCallout")
    }
}

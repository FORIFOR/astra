import SwiftUI

/// 吹き出しの形: 角丸 14 + 対象へ向く小さな尾。矢印の記号ではなく形で指す
/// （盲検: 「矢印と対象の間に距離があり、指し先が繋がっていない」「pointer tip が対象に触れていない」）。
struct CalloutBubbleShape: Shape {
    /// 吹き出しから見て対象がどちらにあるか（placement の逆）。
    let towards: GuidePlacement
    static let tail: CGFloat = 7
    static let radius: CGFloat = 14

    func path(in rect: CGRect) -> Path {
        let t = Self.tail
        var body = rect
        switch towards {
        case .above: body.size.height -= t                                  // 吹き出しは対象の上 → 尾は下
        case .below: body.origin.y += t; body.size.height -= t              // 吹き出しは対象の下 → 尾は上
        case .left:  body.size.width -= t                                   // 吹き出しは対象の左 → 尾は右
        case .right: body.origin.x += t; body.size.width -= t               // 吹き出しは対象の右 → 尾は左
        }
        var p = Path(roundedRect: body, cornerRadius: Self.radius, style: .continuous)
        var tail = Path()
        switch towards {
        case .above:
            let x = body.midX
            tail.move(to: CGPoint(x: x - t, y: body.maxY - 0.5)); tail.addLine(to: CGPoint(x: x, y: rect.maxY)); tail.addLine(to: CGPoint(x: x + t, y: body.maxY - 0.5))
        case .below:
            let x = body.midX
            tail.move(to: CGPoint(x: x - t, y: body.minY + 0.5)); tail.addLine(to: CGPoint(x: x, y: rect.minY)); tail.addLine(to: CGPoint(x: x + t, y: body.minY + 0.5))
        case .left:
            let y = body.midY
            tail.move(to: CGPoint(x: body.maxX - 0.5, y: y - t)); tail.addLine(to: CGPoint(x: rect.maxX, y: y)); tail.addLine(to: CGPoint(x: body.maxX - 0.5, y: y + t))
        case .right:
            let y = body.midY
            tail.move(to: CGPoint(x: body.minX + 0.5, y: y - t)); tail.addLine(to: CGPoint(x: rect.minX, y: y)); tail.addLine(to: CGPoint(x: body.minX + 0.5, y: y + t))
        }
        tail.closeSubpath()
        p.addPath(tail)
        return p
    }
}

/// 対象の近くに出す吹き出し。「AstraDbg をオンにしてください」。尾が対象を指す。
struct GuideCalloutView: View {
    let message: String
    let placement: GuidePlacement
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    var body: some View {
        // 1 行に固定する。折り返すと、測った大きさと窓の大きさがずれて（42→58pt）吹き出しが対象に掛かった（実測）。
        Text(message)
            .font(.system(size: S.type(13), weight: .medium))
            .foregroundStyle(Palette.text(dark))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 12).padding(.vertical, 8)
            .padding(tailEdge, CalloutBubbleShape.tail)
            .background(.regularMaterial, in: CalloutBubbleShape(towards: placement))
            .overlay(CalloutBubbleShape(towards: placement).stroke(Palette.border(dark), lineWidth: 1))
            .padding(3)
            .accessibilityIdentifier("guideCallout")
    }

    private var tailEdge: Edge.Set {
        switch placement {
        case .above: return .bottom
        case .below: return .top
        case .left: return .trailing
        case .right: return .leading
        }
    }
}

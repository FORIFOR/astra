import SwiftUI

/// Task Dock の外形。**画面上辺と一体に見せる**ための形。
///
/// 上辺は面いっぱいに真っすぐ画面の縁へ接する（角丸を付けない）。丸めた瞬間、
/// 「上に置かれたカード」に見えて、OS の一部という感じが消える。
/// 丸いのは下の 2 角だけ。左右や上に**くびれは作らない** —— くびれは
/// 別ブランドの造形であって、上辺との一体感には要らない。
struct AstraDockShape: Shape {
    var bottomRadius: CGFloat = Metrics.hudBottomRadius

    func path(in rect: CGRect) -> Path {
        let r = min(bottomRadius, min(rect.width, rect.height) / 2)
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addQuadCurve(to: CGPoint(x: rect.maxX - r, y: rect.maxY),
                       control: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - r),
                       control: CGPoint(x: rect.minX, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}

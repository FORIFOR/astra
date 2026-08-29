import SwiftUI

/// Task Dock の外形。画面上辺から下へ伸びる面。
///
/// 下の 2 角は大きく、上の 2 角は控えめに丸める。上を角のままにすると、
/// 面の左右の縁が画面の縁に当たるところで角が立って見える。
/// 上を丸め過ぎると今度は「上に置かれたカード」になるので、
/// 上下で半径を変えて、画面から生えている感じを残す。
/// 左右や上に**くびれは作らない**（くびれは別ブランドの造形）。
struct AstraDockShape: Shape {
    var bottomRadius: CGFloat = Metrics.hudBottomRadius
    var topRadius: CGFloat = Metrics.hudTopRadius

    func path(in rect: CGRect) -> Path {
        let limit = min(rect.width, rect.height) / 2
        let rb = min(bottomRadius, limit)
        let rt = min(topRadius, limit)
        var p = Path()
        p.move(to: CGPoint(x: rect.minX + rt, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - rt, y: rect.minY))
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + rt),
                       control: CGPoint(x: rect.maxX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - rb))
        p.addQuadCurve(to: CGPoint(x: rect.maxX - rb, y: rect.maxY),
                       control: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX + rb, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - rb),
                       control: CGPoint(x: rect.minX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + rt))
        p.addQuadCurve(to: CGPoint(x: rect.minX + rt, y: rect.minY),
                       control: CGPoint(x: rect.minX, y: rect.minY))
        p.closeSubpath()
        return p
    }
}

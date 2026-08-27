import SwiftUI

/// 手書きの外枠。上辺中央に Task Dock が食い込む凹み。
/// notchWidth / notchDepth / notchShoulder の 3 つで曲線を詰める。
struct RecordingWorkspaceShape: Shape {
    var cornerRadius: CGFloat = Metrics.workspaceRadius
    var notchWidth: CGFloat = Metrics.notchWidth
    var notchDepth: CGFloat = Metrics.notchDepth
    var notchShoulder: CGFloat = Metrics.notchShoulder

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let cx = rect.midX
        let notchL = cx - notchWidth / 2
        let notchR = cx + notchWidth / 2

        p.move(to: CGPoint(x: cornerRadius, y: 0))
        p.addLine(to: CGPoint(x: notchL - notchShoulder, y: 0))
        // 左肩 → 凹み底
        p.addCurve(
            to: CGPoint(x: notchL, y: notchDepth),
            control1: CGPoint(x: notchL - 14, y: 0),
            control2: CGPoint(x: notchL - 15, y: notchDepth)
        )
        p.addLine(to: CGPoint(x: notchR, y: notchDepth))
        // 凹み → 右肩
        p.addCurve(
            to: CGPoint(x: notchR + notchShoulder, y: 0),
            control1: CGPoint(x: notchR + 15, y: notchDepth),
            control2: CGPoint(x: notchR + 14, y: 0)
        )
        p.addLine(to: CGPoint(x: rect.maxX - cornerRadius, y: 0))
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: cornerRadius),
                       control: CGPoint(x: rect.maxX, y: 0))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - cornerRadius))
        p.addQuadCurve(to: CGPoint(x: rect.maxX - cornerRadius, y: rect.maxY),
                       control: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: cornerRadius, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: 0, y: rect.maxY - cornerRadius),
                       control: CGPoint(x: 0, y: rect.maxY))
        p.addLine(to: CGPoint(x: 0, y: cornerRadius))
        p.addQuadCurve(to: CGPoint(x: cornerRadius, y: 0),
                       control: CGPoint(x: 0, y: 0))
        p.closeSubpath()
        return p
    }
}

import SwiftUI

/// Task Dock の外形。**Capsule ではない**。
///
/// VoiceOS の Task Dock は「画面に浮いた角丸ピル」ではなく、画面の上端から生えた
/// 一枚の面で、上辺は画面外へ抜け、左右に大きい肩があり、下側だけがカプセル状に絞られる。
/// Capsule を上端に寄せた近似だと、肩の張り出しと下部の絞りが出ない。
///
/// 制御点は tokens（`voiceHud.shell*`）から取る。Golden との差分を見て詰めるときは
/// View ではなく `shared/design/tokens.json` を動かす。
struct VoiceDockShellShape: Shape {
    func path(in rect: CGRect) -> Path {
        let topInset = Metrics.hudShellTopInset
        let shoulder = Metrics.hudShellShoulder
        let lowerTop = Metrics.hudShellLowerTop
        let lowerBottom = Metrics.hudShellLowerBottom
        let bottomInset = Metrics.hudShellBottomInset
        let w = rect.width

        let flare = Metrics.hudShellFlarePull
        let pull = Metrics.hudShellCornerPull

        var p = Path()
        // 上辺（画面上端に接する）。ここが一番狭い。
        p.move(to: CGPoint(x: topInset, y: 0))
        p.addLine(to: CGPoint(x: w - topInset, y: 0))
        // 右の肩へ**凹んで**張り出す。上端から真下に降り、肩の手前で外へ逃がす。
        // 制御点を肩の内側へ引くと角丸になってしまい、VoiceOS の張り出しにならない。
        p.addCurve(
            to: CGPoint(x: w - shoulder, y: lowerTop),
            control1: CGPoint(x: w - topInset, y: lowerTop * 0.5),
            control2: CGPoint(x: w - shoulder - flare, y: lowerTop))
        // 右下: 肩から下辺へ大きく丸める（ここが「下部だけ細いカプセル」）。
        p.addCurve(
            to: CGPoint(x: w - bottomInset, y: lowerBottom),
            control1: CGPoint(x: w - shoulder, y: lowerTop + pull),
            control2: CGPoint(x: w - bottomInset + pull, y: lowerBottom))
        p.addLine(to: CGPoint(x: bottomInset, y: lowerBottom))
        // 左下
        p.addCurve(
            to: CGPoint(x: shoulder, y: lowerTop),
            control1: CGPoint(x: bottomInset - pull, y: lowerBottom),
            control2: CGPoint(x: shoulder, y: lowerTop + pull))
        // 左肩
        p.addCurve(
            to: CGPoint(x: topInset, y: 0),
            control1: CGPoint(x: shoulder + flare, y: lowerTop),
            control2: CGPoint(x: topInset, y: lowerTop * 0.5))
        p.closeSubpath()
        return p
    }
}

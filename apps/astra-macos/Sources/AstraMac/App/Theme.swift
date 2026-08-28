import SwiftUI

// 寸法（Metrics / Motion）は shared/design/tokens.json から生成: GeneratedMetrics.swift。

extension Color {
    /// Astra のアクセント。§17.1 の生成トークン（tokens.json → Palette）を単一正として使う。
    /// 直書きの色は持たない（spec: UI を各 OS へ直書きせず tokens から生成する）。
    static let astraAccent = Palette.accentLight
    /// テーマ対応のアクセント（Light/Dark で切替）。
    static func astraAccent(_ dark: Bool) -> Color { Palette.accent(dark) }
    static let recordingRed = Color(red: 1.0, green: 0.27, blue: 0.23)
    static let workspaceSurface = Color(nsColor: NSColor(calibratedWhite: 0.975, alpha: 0.96))
}

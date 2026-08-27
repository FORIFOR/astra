import SwiftUI

// 寸法（Metrics / Motion）は shared/design/tokens.json から生成: GeneratedMetrics.swift。

extension Color {
    /// Astra のアクセント（brand の緑は取らない。落ち着いた青紫）。
    static let astraAccent = Color(red: 0.36, green: 0.36, blue: 0.84)
    static let recordingRed = Color(red: 1.0, green: 0.27, blue: 0.23)
    static let workspaceSurface = Color(nsColor: NSColor(calibratedWhite: 0.975, alpha: 0.96))
}

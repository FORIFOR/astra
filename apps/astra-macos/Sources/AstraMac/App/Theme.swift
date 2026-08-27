import SwiftUI

/// 手書き案の寸法。ここだけを正とし、各 View は数字を直接持たない。
enum Metrics {
    static let workspaceWidth: CGFloat = 920
    static let workspaceHeight: CGFloat = 590
    static let workspaceRadius: CGFloat = 28

    static let notchWidth: CGFloat = 286
    static let notchDepth: CGFloat = 25
    static let notchShoulder: CGFloat = 30

    static let dockWidth: CGFloat = 250
    static let dockHeight: CGFloat = 42

    static let hudWidth: CGFloat = 310
    static let hudHeight: CGFloat = 31

    static let paletteWidth: CGFloat = 150
    static let assistantWidth: CGFloat = 190
}

extension Color {
    /// Astra のアクセント（brand の緑は取らない。落ち着いた青紫）。
    static let astraAccent = Color(red: 0.36, green: 0.36, blue: 0.84)
    static let recordingRed = Color(red: 1.0, green: 0.27, blue: 0.23)
    static let workspaceSurface = Color(nsColor: NSColor(calibratedWhite: 0.975, alpha: 0.96))
}

import AppKit

/// Window の置き場所。上部ピルはメニューバー直下中央、録音 Workspace は画面中央。
enum PanelPositioner {
    static func voiceHUDFrame(screen: NSScreen) -> NSRect {
        // メニューバー**直下**に吊る。screen.frame.maxY だとメニューバー（と notch/Now Playing）の
        // 裏に潜って見えなくなるので、visibleFrame.maxY（メニューバーを除いた上端）を使う。
        let visible = screen.visibleFrame
        return NSRect(
            x: visible.midX - Metrics.hudWidth / 2,
            y: visible.maxY - Metrics.hudHeight,
            width: Metrics.hudWidth,
            height: Metrics.hudHeight
        )
    }

    static func recordingWorkspaceFrame(screen: NSScreen) -> NSRect {
        let visible = screen.visibleFrame
        return NSRect(
            x: visible.midX - Metrics.workspaceWidth / 2,
            y: visible.midY - Metrics.workspaceHeight / 2,
            width: Metrics.workspaceWidth,
            height: Metrics.workspaceHeight
        )
    }
}

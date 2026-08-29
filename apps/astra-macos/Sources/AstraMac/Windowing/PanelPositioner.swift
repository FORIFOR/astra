import AppKit

/// Window の置き場所。Task Dock は画面最上端、録音 Workspace は画面中央。
enum PanelPositioner {
    /// Task Dock は `visibleFrame` ではなく `frame` の上端に**接着**する。
    ///
    /// 「メニューバーの下に浮いている」と「画面上端から生えている」は別物で、
    /// VoiceOS らしさは後者にある。level は `.statusBar` なのでメニューバーより手前に出る
    /// （以前ここを visibleFrame にしたのは level が低く裏へ潜っていたときの手当て）。
    static func voiceHUDFrame(screen: NSScreen,
                              size: CGSize = CGSize(width: Metrics.hudWidth, height: Metrics.hudHeight)) -> NSRect {
        // **top anchor 固定**。高さが変わっても上辺は画面の縁のまま、下へ伸びる。
        NSRect(
            x: (screen.frame.midX - size.width / 2).rounded(),
            y: screen.frame.maxY - size.height,
            width: size.width,
            height: size.height
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

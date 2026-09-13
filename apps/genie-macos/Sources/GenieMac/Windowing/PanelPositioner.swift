import AppKit
import Combine

/// The physical camera band belongs to the screen, not to the content tokens.
@MainActor
final class DockScreenLayout: ObservableObject {
    @Published var topInset: CGFloat = 0
}

/// Window の置き場所。Task Dock は画面最上端、録音 Workspace は画面中央。
enum PanelPositioner {
    /// Task Dock は `visibleFrame` ではなく `frame` の上端に**接着**する。
    ///
    /// 「メニューバーの下に浮いている」と「画面上端から生えている」は別物で、
    /// VoiceOS らしさは後者にある。level は `.statusBar` なのでメニューバーより手前に出る
    /// （以前ここを visibleFrame にしたのは level が低く裏へ潜っていたときの手当て）。
    static func voiceHUDFrame(screen: NSScreen,
                              size: CGSize = CGSize(width: Metrics.hudWidth, height: Metrics.hudHeight)) -> NSRect {
        voiceHUDFrame(screenFrame: screen.frame, topInset: screen.safeAreaInsets.top, size: size)
    }

    static func voiceHUDFrame(screenFrame: NSRect, topInset: CGFloat, size: CGSize) -> NSRect {
        let height = size.height + max(0, topInset)
        // Keep the substrate attached; only the content sits below the camera band.
        return NSRect(
            x: (screenFrame.midX - size.width / 2).rounded(),
            y: screenFrame.maxY - height,
            width: size.width,
            height: height
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

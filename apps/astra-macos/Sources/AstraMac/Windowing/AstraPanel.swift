import AppKit
import SwiftUI

/// Astra の overlay window 共通基盤。装飾なし・透過・全 Space・fullscreen 補助。
/// SwiftUI View を載せるだけ。`canBecomeKey` は用途ごとに上書きする。
class AstraPanel<Content: View>: NSPanel {
    init(size: NSSize, level: NSWindow.Level, canKey: Bool, content: Content) {
        super.init(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        self.level = level
        self.isOpaque = false
        self.backgroundColor = .clear
        self.hasShadow = false
        self.hidesOnDeactivate = false
        self.isMovableByWindowBackground = true
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        self.canKeyOverride = canKey
        let hosting = NSHostingView(rootView: content)
        hosting.frame = NSRect(origin: .zero, size: size)
        self.contentView = hosting
    }

    private var canKeyOverride = false
    override var canBecomeKey: Bool { canKeyOverride }
    override var canBecomeMain: Bool { false }
}

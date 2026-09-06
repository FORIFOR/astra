import AppKit
import SwiftUI

/// 対象 rect + 6〜8pt を角丸で囲う窓。**必ず mouse を通す**（`ignoresMouseEvents = true`）。
@MainActor
final class HighlightOverlayController {
    private var panel: FloatingPanel?

    var isVisible: Bool { panel?.isVisible == true }
    var frame: CGRect? { panel?.frame }
    var panelIgnoresMouse: Bool? { panel?.ignoresMouseEvents }

    func show(around target: CGRect) {
        let frame = CalloutPlacer.highlightFrame(target: target)
        if panel == nil {
            let p = FloatingPanel(size: frame.size, level: .floating, content: AnyView(HighlightView()), passthrough: true)
            panel = p
        }
        panel?.ignoresMouseEvents = true
        panel?.setFrame(frame, display: true)
        panel?.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
        panel = nil
    }
}

import AppKit
import SwiftUI

/// 対象 rect の近くに吹き出し窓を置く。above/below/left/right は `CalloutPlacer` が選び、画面内に clamp する。
/// mouse は通す（System Settings を隠しても操作は妨げない）。
@MainActor
final class GuideCalloutController {
    private var panel: FloatingPanel?
    private(set) var placement: GuidePlacement?

    var isVisible: Bool { panel?.isVisible == true }
    var frame: CGRect? { panel?.frame }
    var panelIgnoresMouse: Bool? { panel?.ignoresMouseEvents }

    func show(message: String, near target: CGRect, screen: NSScreen, preferred: GuidePlacement = .above) {
        hide()
        // 置き場所は矢印の向きに依るので、まず大きさを測ってから決める（矢印はどの向きでも同じ寸法）。
        let probe = NSHostingView(rootView: GuideCalloutView(message: message, placement: preferred))
        let size = probe.fittingSize
        let placed = CalloutPlacer.place(target: target, size: size, within: screen.visibleFrame, preferred: preferred)
        placement = placed.placement
        let p = FloatingPanel(size: size, level: .floating,
                              content: AnyView(GuideCalloutView(message: message, placement: placed.placement)),
                              passthrough: true)
        p.setFrame(placed.frame, display: true)
        p.orderFrontRegardless()
        panel = p
    }

    func hide() {
        panel?.orderOut(nil)
        panel = nil
        placement = nil
    }
}

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
    var window: NSWindow? { panel }
    var panelIgnoresMouse: Bool? { panel?.ignoresMouseEvents }

    private var lastMessage: String?

    func show(message: String, near target: CGRect, screen: NSScreen, preferred: GuidePlacement = .above) {
        // 置き場所は矢印の向きに依るので、まず大きさを測ってから決める（矢印はどの向きでも同じ寸法）。
        let probe = NSHostingView(rootView: GuideCalloutView(message: message, placement: preferred))
        let size = probe.fittingSize
        var placed = CalloutPlacer.place(target: target, size: size, within: screen.visibleFrame, preferred: preferred)
        // 同じ文言なら窓を作り直さない（AX の出来事ごとに作り直すと、吹き出しが点滅し、撮影の瞬間に無いことがあった）。
        // 矢印の向きが変わるときだけ中身を差し替える。
        let p: FloatingPanel
        if let existing = panel, lastMessage == message {
            p = existing
            if placement != placed.placement {
                (p.contentView as? NSHostingView<AnyView>)?.rootView = AnyView(GuideCalloutView(message: message, placement: placed.placement))
            }
        } else {
            hide()
            p = FloatingPanel(size: size, level: .floating,
                              content: AnyView(GuideCalloutView(message: message, placement: placed.placement)),
                              passthrough: true)
        }
        p.setFrame(placed.frame, display: true)
        p.layoutIfNeeded()
        // 実際の大きさが測りと違えば、その大きさで置き直す（対象に掛からないことが先）。
        let actual = p.contentView?.fittingSize ?? size
        if actual != size {
            placed = CalloutPlacer.place(target: target, size: actual, within: screen.visibleFrame, preferred: preferred)
            p.setFrame(placed.frame, display: true)
        }
        placement = placed.placement
        lastTarget = target
        lastMessage = message
        p.orderFrontRegardless()
        panel = p
    }

    /// 検査用: 直近の対象。吹き出しが対象に掛かっていないことを外から確かめる。
    private(set) var lastTarget: CGRect?
    var overlapsTarget: Bool { guard let f = panel?.frame, let t = lastTarget else { return false }; return f.intersects(t) }

    func hide() {
        panel?.orderOut(nil)
        panel = nil
        placement = nil
        lastMessage = nil
    }
}

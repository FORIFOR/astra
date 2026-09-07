import AppKit
import SwiftUI

/// 右下（visibleFrame 基準で右 24pt・下 24pt）のアバター窓。
/// 閉じるボタンだけ受けるので mouse は通さない（窓は小さく、System Settings の上には掛からない）。
@MainActor
final class AvatarOverlayController {
    private var panel: FloatingPanel?
    let model = AvatarHUDModel()
    private var hosting: NSHostingView<AvatarHUDView>?

    var isVisible: Bool { panel?.isVisible == true }
    var panelFrame: CGRect? { panel?.frame }
    var window: NSWindow? { panel }

    func show(on screen: NSScreen, state: AvatarState, message: String, onClose: @escaping () -> Void) {
        model.state = state
        model.message = message
        model.action = nil
        model.onClose = onClose
        if panel == nil {
            let view = AvatarHUDView(model: model)
            let p = FloatingPanel(size: NSSize(width: 120, height: 80), level: .floating, content: AnyView(view), passthrough: false)
            Elevation.apply(to: p, .attached)
            panel = p
        }
        relayout(on: screen)
        panel?.orderFrontRegardless()
    }

    func update(state: AvatarState, message: String, action: AvatarHUDModel.Action? = nil, screen: NSScreen? = nil) {
        model.state = state
        model.message = message
        model.action = action
        if let screen = screen ?? panel?.screen ?? NSScreen.main { relayout(on: screen) }
    }

    /// 吹き出しの長さで窓の大きさが変わる。右下に寄せ直す。
    /// 大きさは**毎回新しく測る**。窓の中の hosting view の fittingSize は前の文言の大きさを返すことがあり、
    /// 短い文言（「設定できました ✓」）の吹き出しが前の幅いっぱいに伸びた（実測）。
    func relayout(on screen: NSScreen) {
        guard let panel else { return }
        let probe = NSHostingView(rootView: AvatarHUDView(model: model))
        let fit = probe.fittingSize
        let size = NSSize(width: max(AvatarLayout.avatarSize + 8, fit.width.rounded(.up)), height: max(AvatarLayout.avatarSize + 8, fit.height.rounded(.up)))
        panel.setFrame(AvatarLayout.frame(size: size, in: screen.visibleFrame), display: true)
    }

    func hide() {
        panel?.orderOut(nil)
        panel = nil
    }
}

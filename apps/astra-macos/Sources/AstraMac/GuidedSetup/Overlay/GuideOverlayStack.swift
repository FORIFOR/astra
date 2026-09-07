import AppKit

/// Coordinator から見た重ね窓の口。検査では偽物に差し替えて「何を出したか」だけ見る。
@MainActor
protocol GuideOverlaying: AnyObject {
    func showAvatar(state: AvatarState, message: String, onClose: @escaping () -> Void)
    /// `action`: 吹き出しの操作子（「システム設定を開く」）。nil なら文だけ。
    func updateAvatar(state: AvatarState, message: String, action: (title: String, run: () -> Void)?)
    func showGuide(message: String, at anchor: GuideAnchor, preferred: GuidePlacement)
    func hideGuide()
    func hideAll()
    var visiblePanelCount: Int { get }
}

/// 実物: アバター + 吹き出し + ハイライトの 3 窓。
@MainActor
final class GuideOverlayStack: GuideOverlaying {
    let avatar = AvatarOverlayController()
    let callout = GuideCalloutController()
    let highlight = HighlightOverlayController()

    /// アバターを置く画面。対象があればその画面、無ければ主画面。
    private var avatarScreen: NSScreen { NSScreen.main ?? NSScreen.screens[0] }

    func showAvatar(state: AvatarState, message: String, onClose: @escaping () -> Void) {
        avatar.show(on: avatarScreen, state: state, message: message, onClose: onClose)
    }

    func updateAvatar(state: AvatarState, message: String, action: (title: String, run: () -> Void)?) {
        avatar.update(state: state, message: message, action: action.map { AvatarHUDModel.Action(title: $0.title, run: $0.run) })
    }

    func showGuide(message: String, at anchor: GuideAnchor, preferred: GuidePlacement) {
        let screen = NSScreen.screens.first { $0.frame.intersects(anchor.rect) } ?? avatarScreen
        highlight.show(around: anchor.rect)
        // 置き場所は対象の種類で決める（呼び出し側）。行のスイッチは**横**（上下は隣の行のスイッチを隠す）、
        // 「+」は**下**（横は隣の「−」を隠す。盲検 3/3 が指摘）。
        callout.show(message: message, near: anchor.rect, screen: screen, preferred: preferred)
        // 対象の画面へアバターも寄せる（別画面で案内が見えないのを避ける）。
        avatar.relayout(on: screen)
    }

    func hideGuide() {
        callout.hide()
        highlight.hide()
    }

    func hideAll() {
        hideGuide()
        avatar.hide()
    }

    var visiblePanelCount: Int {
        [avatar.isVisible, callout.isVisible, highlight.isVisible].filter { $0 }.count
    }
}

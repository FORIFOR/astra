import AppKit
import SwiftUI

/// Astra の overlay window 共通基盤。装飾なし・透過・全 Space・fullscreen 補助。
/// SwiftUI View を載せるだけ。`canBecomeKey` は用途ごとに上書きする。
class AstraPanel<Content: View>: NSPanel {
    init(size: NSSize, level: NSWindow.Level, canKey: Bool, content: Content) {
        super.init(
            contentRect: NSRect(origin: .zero, size: size),
            // `.fullSizeContentView` は borderless では要らないうえ、
            // theme frame の素材が窓の**矩形**に敷かれ、外形の外に明るい帯として見えた
            // （中身を塗りひとつまで削っても残ったので、窓側だと分かった）。
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        self.level = level
        self.isOpaque = false
        self.backgroundColor = .clear
        // 影は窓に任せる。window server がアルファをなぞるので、
        // 角丸や凹みのある外形でも形どおりに落ちる。
        self.hasShadow = true
        self.hidesOnDeactivate = false
        self.isMovableByWindowBackground = true
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        // シークレットモードの既定値をここで反映する（窓を作った後に変えても効く）。
        self.sharingType = SecretMode.shared.isOn ? .none : .readOnly
        self.canKeyOverride = canKey
        let hosting = NSHostingView(rootView: content)
        hosting.frame = NSRect(origin: .zero, size: size)
        // 外形の外（角の外側）に明るい帯が出ていた。中身を塗りひとつまで削っても
        // 残ったので、SwiftUI ではなくホスト側の地。明示的に透明にする。
        hosting.wantsLayer = true
        hosting.layer?.backgroundColor = NSColor.clear.cgColor
        hosting.layer?.isOpaque = false
        // 窓の大きさに追従させる。ここを付けていなかったため、Dock が状態で
        // リサイズしても中身は最初の大きさのままで、**前の大きさの中身が残った**。
        // それが外形の外に見えていた「矩形の帯」の正体。
        hosting.autoresizingMask = [.width, .height]
        self.contentView = hosting
    }

    private var canKeyOverride = false
    override var canBecomeKey: Bool { canKeyOverride }
    override var canBecomeMain: Bool { false }
}

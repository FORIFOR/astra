import AppKit
import SwiftUI

/// Guided Setup の重ね窓。System Settings の上に**透明・非アクティブ**で載せる。
///
/// `AstraPanel`（装飾なし・透過・全 Space・fullscreen 補助）を土台にして、案内に要る性質だけ変える:
/// 影なし・key にならない・main にならない・Space 切替で消えない・⌘Tab の輪に入らない。
/// 全画面の透明 window は作らない。1 つの対象（アバター / 吹き出し / ハイライト）に 1 つの小さな窓。
final class FloatingPanel: AstraPanel<AnyView> {
    private let interactive: Bool
    init(size: NSSize, level: NSWindow.Level = .floating, content: AnyView, passthrough: Bool, interactive: Bool = false) {
        self.interactive = interactive
        super.init(size: size, level: level, canKey: interactive, content: content)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        isFloatingPanel = true
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        isMovableByWindowBackground = false
        var behavior: NSWindow.CollectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        if #available(macOS 13.0, *) {
            // 他アプリの全画面 Space にも付いて行く（System Settings が全画面のときにも案内が見える）。
            behavior.insert(.canJoinAllApplications)
        }
        collectionBehavior = behavior
        // ハイライトと吹き出しはクリックを通す。System Settings をそのまま操作できること。
        ignoresMouseEvents = passthrough
        animationBehavior = .none
    }

    override var canBecomeKey: Bool { interactive }
    override var canBecomeMain: Bool { false }
}

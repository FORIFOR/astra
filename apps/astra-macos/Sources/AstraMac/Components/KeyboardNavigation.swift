import AppKit
import SwiftUI

/// focus リングを **キーボードで動かし始めてから** 見せる。
///
/// 実機で撮って分かったこと: `.focusable(true)` を付けた瞬間、窓を開いただけで
/// Task Dock の先頭ボタンに青いリングが出ていた。macOS はマウスで開いた直後に
/// リングを見せない —— リングは「いまキーボードのどこにいるか」の印であって、
/// 常時出す装飾ではない。Tab / 矢印が来てから出し、クリックで引っ込める。
final class KeyboardNavigation: ObservableObject {
    static let shared = KeyboardNavigation()
    @Published private(set) var active = false

    private var monitor: Any?
    private static let tab: UInt16 = 48
    private static let arrows: Set<UInt16> = [123, 124, 125, 126]

    func install() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown]) { [weak self] event in
            guard let self else { return event }
            if event.type == .keyDown {
                if event.keyCode == Self.tab || Self.arrows.contains(event.keyCode) {
                    if !self.active { self.active = true }
                }
            } else if self.active {
                self.active = false
            }
            return event
        }
    }
}

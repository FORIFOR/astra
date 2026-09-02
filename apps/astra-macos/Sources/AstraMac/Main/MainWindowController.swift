import AppKit
import SwiftUI

/// Astra の Main Window（Home / Work / Library / Apps）。overlay とは別に、必要なときに開く。
@MainActor
final class MainWindowController {
    static let shared = MainWindowController()
    private var window: NSWindow?

    func show() {
        if window == nil {
            // 中身に合う大きさで開く。画面比で大きく取ると、本文が上に寄って
            // 下半分が空きっぱなしになる（実機で余白ばかりに見えた）。
            // 本文の幅は 900pt に絞ってあるので、sidebar 260 + 本文 900 + 余白で足りる。
            let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            let size = NSSize(
                width: min(1240, visible.width - 80),
                height: min(820, visible.height - 80))
            let win = NSWindow(
                contentRect: NSRect(origin: .zero, size: size),
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered, defer: false)
            win.title = "Astra"
            win.titlebarAppearsTransparent = true
            win.isReleasedWhenClosed = false
            win.center()
            win.contentView = NSHostingView(rootView: MainWindowView())
            window = win
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// タブを切り替えて前面に出す（Visual Gate の撮影・外部導線から使う）。
    /// 前面へ。撮影や、他アプリの裏に回ったときに使う。
    func orderFront() { window?.orderFrontRegardless() }

    /// 閉じる（検査と、録音中に邪魔なときに使う）。
    func hide() { window?.orderOut(nil) }

    func showSection(_ section: MainSection) {
        MainNav.shared.select(section)
        show()
    }

    /// Library の会議詳細を開いた状態にする。
    func showMeetingDetailPreview() {
        MainNav.shared.section = .library
        MainNav.shared.meetingDetail = true
        show()
    }
}

import AppKit
import SwiftUI

/// Astra の Main Window（Home / Work / Library / Apps）。overlay とは別に、必要なときに開く。
@MainActor
final class MainWindowController {
    static let shared = MainWindowController()
    private var window: NSWindow?

    func show() {
        if window == nil {
            // 画面に対する割合で開く。固定 1040pt だと大きな画面で「浮いた小窓」に見える
            // （2560pt のデスクトップで実際にそう見えた）。
            let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            let size = NSSize(
                width: max(1120, min(visible.width * 0.72, 1680)),
                height: max(720, min(visible.height * 0.80, 1040)))
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
    func showSection(_ section: MainSection) {
        MainNav.shared.meetingDetail = false
        MainNav.shared.section = section
        show()
    }

    /// Library の会議詳細を開いた状態にする。
    func showMeetingDetailPreview() {
        MainNav.shared.section = .library
        MainNav.shared.meetingDetail = true
        show()
    }
}

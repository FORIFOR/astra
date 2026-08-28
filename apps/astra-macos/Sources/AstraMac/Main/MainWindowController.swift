import AppKit
import SwiftUI

/// Astra の Main Window（Home / Work / Library / Apps）。overlay とは別に、必要なときに開く。
@MainActor
final class MainWindowController {
    static let shared = MainWindowController()
    private var window: NSWindow?

    func show() {
        if window == nil {
            let win = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 1040, height: 680),
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

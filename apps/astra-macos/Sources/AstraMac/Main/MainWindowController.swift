import AppKit
import SwiftUI

/// Astra の Main Window（Home / AI Agents / Library / Apps）。overlay とは別に、必要なときに開く。
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
}

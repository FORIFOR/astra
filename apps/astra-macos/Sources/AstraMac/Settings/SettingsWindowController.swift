import AppKit
import SwiftUI

@MainActor
final class SettingsWindowController {
    static let shared = SettingsWindowController()
    static let didShow = Notification.Name("AstraSettingsDidShow")
    private var window: NSWindow?
    func show() {
        if window == nil {
            let win = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 460, height: 540),
                styleMask: [.titled, .closable, .fullSizeContentView],
                backing: .buffered, defer: false)
            win.title = "Astra 設定"
            win.titlebarAppearsTransparent = true
            win.isReleasedWhenClosed = false
            win.center()
            let content = NSHostingView(rootView: SettingsView())
            win.contentView = content
            win.setContentSize(content.fittingSize)
            window = win
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: Self.didShow, object: nil)
    }
    func resizeToContent() {
        DispatchQueue.main.async { [weak self] in
            guard let window = self?.window, let content = window.contentView else { return }
            content.layoutSubtreeIfNeeded()
            window.setContentSize(content.fittingSize)
        }
    }

    /// Preserve visibility so cancelling permission setup returns to the same place.
    func suspendForPermissionGuide() -> () -> Void {
        guard let window, window.isVisible else { return {} }
        window.orderOut(nil)
        return { [weak window] in window?.orderFrontRegardless() }
    }

}

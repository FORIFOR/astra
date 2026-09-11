import AppKit
import SwiftUI

/// Astra の Main Window（Home / Work / Library / Apps）。overlay とは別に、必要なときに開く。
@MainActor
final class MainWindowController: NSObject {
    static let shared = MainWindowController()
    private var window: NSWindow?
    private var pendingPresentation: UUID?
    private var focusComposerOnPresentation = false

    private override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(didBecomeActive),
            name: NSApplication.didBecomeActiveNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(didBecomeActive),
            name: NSWorkspace.didActivateApplicationNotification, object: nil)
    }

    func show(focusComposer: Bool = false) {
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
            win.contentView = NSHostingView(rootView: MainWindowView(loadBackend: !ProcessInfo.processInfo.arguments.contains("--selftest")))
            window = win
        }
        guard let window else { return }
        let presentation = UUID()
        pendingPresentation = presentation
        focusComposerOnPresentation = focusComposer
        window.orderFront(nil)
        // The Dock is a nonactivating panel. Finish its button event before handing
        // keyboard ownership to a normal window; activation itself is asynchronous.
        DispatchQueue.main.async { [weak self, weak window] in
            guard let self, let window, window.isVisible,
                  self.pendingPresentation == presentation else { return }
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            if NSApp.isActive { self.finishPresentation(presentation) }
        }
        // An unsuccessful activation must not steal focus on a later app switch.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            if self?.pendingPresentation == presentation { self?.pendingPresentation = nil }
        }
    }

    @objc private func didBecomeActive() {
        guard let presentation = pendingPresentation else { return }
        DispatchQueue.main.async { [weak self] in self?.finishPresentation(presentation) }
    }

    private func finishPresentation(_ presentation: UUID) {
        guard pendingPresentation == presentation, NSApp.isActive,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == ProcessInfo.processInfo.processIdentifier,
              let window, window.isVisible else { return }
        pendingPresentation = nil
        window.makeKeyAndOrderFront(nil)
        if focusComposerOnPresentation { MainNav.shared.requestIntentFocus() }
    }

    /// タブを切り替えて前面に出す（Visual Gate の撮影・外部導線から使う）。
    /// 前面へ。撮影や、他アプリの裏に回ったときに使う。
    func orderFront() { window?.orderFrontRegardless() }

    /// 閉じる（検査と、録音中に邪魔なときに使う）。
    func hide() { pendingPresentation = nil; window?.orderOut(nil) }

    func showSection(_ section: MainSection) {
        MainNav.shared.select(section)
        show()
    }

    /// Navigation only: keep the chosen image fixed and focus the existing composer.
    func askAboutScreenshot(_ image: VisualContextArtifact) {
        MainNav.shared.prepareScreenshotQuestion(image)
        NewRecordingSheetOpener.shared.close()
        VisualContextStore.shared.dismissOffer()
        VoiceHUDState.shared.mode = .idle
        show(focusComposer: true)
    }

    /// Work の中の面まで指定して開く（結果の「開く」など、外からの導線）。
    func showWork(_ tab: WorkTab) {
        MainNav.shared.workTab = tab
        showSection(.work)
    }

    /// Library の中の面まで指定して開く（会議の一覧 = Library → Meetings）。
    func showLibrary(_ tab: LibraryTab) {
        MainNav.shared.libraryTab = tab
        showSection(.library)
    }

    /// Library の会議詳細を開いた状態にする。
    func showMeetingDetailPreview() {
        MainNav.shared.section = .library
        MainNav.shared.meetingDetail = true
        show()
    }
    /// Preserve visibility so cancelling permission setup returns to the same place.
    func suspendForPermissionGuide() -> () -> Void {
        pendingPresentation = nil
        guard let window, window.isVisible else { return {} }
        window.orderOut(nil)
        return { [weak window] in window?.orderFrontRegardless() }
    }

}

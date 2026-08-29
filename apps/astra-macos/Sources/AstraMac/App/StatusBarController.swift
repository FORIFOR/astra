import AppKit

/// メニューバーの Astra。**起動後にアプリへ触れる唯一の入口**。
///
/// Astra は Dock アイコンを持たない overlay（`.accessory`）なので、これが無いと
/// 起動後に Main Window も設定も終了も開けない（実機で確認した実際の行き止まり）。
/// macOS の常道どおり status item を置き、Home/録音/設定/終了をここから辿れるようにする。
@MainActor
final class StatusBarController {
    static let shared = StatusBarController()
    private var item: NSStatusItem?

    func install() {
        guard item == nil else { return }
        let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = status.button {
            button.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "Astra")
            button.image?.isTemplate = true
            button.toolTip = "Astra"
        }
        status.menu = buildMenu()
        item = status
    }

    /// 録音中かどうかで文言が変わるので、開くたびに作り直す。
    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.delegate = MenuRefresher.shared
        rebuild(menu)
        return menu
    }

    fileprivate func rebuild(_ menu: NSMenu) {
        menu.removeAllItems()

        let open = NSMenuItem(title: "Astra を開く", action: #selector(openMain), keyEquivalent: "")
        open.target = self
        menu.addItem(open)

        let recording = WindowCoordinator.shared.isRecording
        let rec = NSMenuItem(
            title: recording ? "録音を停止" : "会議を録音",
            action: #selector(toggleRecording),
            keyEquivalent: ""
        )
        rec.target = self
        menu.addItem(rec)

        menu.addItem(.separator())

        // ショートカットは覚えていないと使えないので、ここに書いておく。
        let hint = NSMenuItem(title: "音声入力: \(GlobalShortcut.label()) を長押し", action: nil, keyEquivalent: "")
        hint.isEnabled = false
        menu.addItem(hint)

        let settings = NSMenuItem(title: "設定…", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)

        menu.addItem(.separator())

        let quit = NSMenuItem(title: "Astra を終了", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
    }

    @objc private func openMain() { MainWindowController.shared.showSection(.home) }
    @objc private func toggleRecording() { WindowCoordinator.shared.toggleRecording() }
    @objc private func openSettings() { SettingsWindowController.shared.show() }
    @objc private func quit() { NSApp.terminate(nil) }
}

/// メニューを開く直前に作り直す（録音中の文言を合わせる）。
@MainActor
private final class MenuRefresher: NSObject, NSMenuDelegate {
    static let shared = MenuRefresher()
    func menuNeedsUpdate(_ menu: NSMenu) {
        StatusBarController.shared.rebuild(menu)
    }
}

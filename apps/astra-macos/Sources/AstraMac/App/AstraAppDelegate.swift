import AppKit

final class AstraAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // headless の自己検証（Swift → core → ディスク）。UI を出さずに終了する。
        if SelfTest.run(CommandLine.arguments) { return }
        let demo = DemoMode.fromArguments(CommandLine.arguments)
        WindowCoordinator.shared.start(demo: demo)
        // Dock アイコンが無いので、ここが起動後の唯一の入口になる（Main/録音/設定/終了）。
        StatusBarController.shared.install()
        // focus リングは Tab / 矢印を押してから見せる（開いた瞬間に出さない）。
        KeyboardNavigation.shared.install()
        // グローバル音声ショートカット（⌥Space）で録音を出し入れする。
        // CGEventTap（正本指定）で受信する。Accessibility 権限を使う（§3 と共用）。
        GlobalShortcut.shared.register { WindowCoordinator.shared.toggleRecording() }
        // 前回落ちたまま残っている録音があれば知らせる（§3 meeting recovery）。
        let recoverable = RecordingRuntime.shared.recoverableMeetings()
        if !recoverable.isEmpty {
            NSLog("astra: %d recoverable recording(s) found; will offer recovery once signed in", recoverable.count)
            RecoveryState.shared.pending = recoverable
        }
        NSApp.activate(ignoringOtherApps: true)
    }
}

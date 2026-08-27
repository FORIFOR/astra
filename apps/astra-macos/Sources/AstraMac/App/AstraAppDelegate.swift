import AppKit

final class AstraAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // headless の自己検証（Swift → core → ディスク）。UI を出さずに終了する。
        if SelfTest.run(CommandLine.arguments) { return }
        let demo = DemoMode.fromArguments(CommandLine.arguments)
        WindowCoordinator.shared.start(demo: demo)
        // グローバル音声ショートカット（⌥Space）で録音を出し入れする。
        // Carbon の RegisterEventHotKey は Accessibility 権限を要さない。
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

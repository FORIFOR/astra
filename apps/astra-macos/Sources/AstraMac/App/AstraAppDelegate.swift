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
        // 前面アプリが変わったら、まだ繋がっていないものを 1 度だけ勧める（§14）。
        // 勧誘は Dock の下の別 Panel に出す（Dock 本体は伸ばさない）。
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated { VoiceHUDState.shared.refreshContextualApp() }
        }
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

    /// 録音中の終了は会議を失う操作。黙って落とさず一度だけ聞く。
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard RecordingWorkspaceState.shared.isRecording else { return .terminateNow }
        let go = Confirm.destructive(
            "録音中です。終了しますか？",
            detail: "ここまでの音声はディスクに残り、次の起動で復元できます。",
            confirm: "録音を止めて終了",
            cancel: "録音を続ける")
        guard go else { return .terminateCancel }
        RecordingWorkspaceState.shared.stop()
        return .terminateNow
    }
}

import AppKit

final class AstraAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // headless の自己検証（Swift → core → ディスク）。UI を出さずに終了する。
        if SelfTest.run(CommandLine.arguments) { return }
        // §9 Chrome の Native Messaging host として起動されたとき。UI は出さない。
        if CommandLine.arguments.contains("--native-messaging") {
            LocalStore.shared.open()
            NativeMessagingHost.runLoop()
            NSApp.terminate(nil)
            return
        }
        // §24 ローカル保存を開く。§23 走っていた task を読み戻す。
        LocalStore.shared.open()
        AstraStateStore.shared.restoreRunningTask()
        // §9 前回の会議を読み戻す。録音中のまま落ちていたものは interrupted になる。
        MeetingSessionStore.shared.load()
        let demo = DemoMode.fromArguments(CommandLine.arguments)
        WindowCoordinator.shared.start(demo: demo)
        // Dock アイコンが無いので、ここが起動後の唯一の入口になる（Main/録音/設定/終了）。
        StatusBarController.shared.install()
        // focus リングは Tab / 矢印を押してから見せる（開いた瞬間に出さない）。
        KeyboardNavigation.shared.install()
        // 自動更新。配布先と公開鍵が Info.plist に入っていなければ何もしない
        // （確かめているつもりで何も見ていない状態を作らない）。
        SoftwareUpdate.shared.startIfConfigured()
        // 前面アプリが変わったら、まだ繋がっていないものを 1 度だけ勧める（§14）。
        // 勧誘は Dock の下の別 Panel に出す（Dock 本体は伸ばさない）。
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated {
                VoiceHUDState.shared.refreshContextualApp()
                // §6 Presence: 前面アプリを State と EventBus に流す。
                let app = NSWorkspace.shared.frontmostApplication
                AstraEventBus.shared.publish(.appChanged(
                    bundleId: app?.bundleIdentifier, name: app?.localizedName ?? "?"))
                // §7/§8 文脈を取り直す（取れたものだけ）。
                if let ax = AccessibilityContext.snapshot() {
                    AstraStateStore.shared.updateContext([ax.fact()])
                }
                // §18 会議アプリの検出。**録音は始めない。**
                MeetingDetector.refresh()
            }
        }
        // §22 画面共有が始まったら Astra を出さない。
        PresentationGuard.shared.start()
        // グローバル音声ショートカット（⌥Space）で録音を出し入れする。
        // CGEventTap（正本指定）で受信する。Accessibility 権限を使う（§3 と共用）。
        if !GlobalShortcut.shared.register(handler: { WindowCoordinator.shared.toggleRecording() }) {
            // 入力監視（Input Monitoring）が無いと tap にイベントが 1 つも届かない。
            // **一度も要求していなかったので、誰も ⌥Space を使えなかった。**
            // 許可のダイアログは OS が 1 回だけ出す（以後は黙って false が返る）。
            // 端末から実行していたときは責任プロセス（ターミナル）の許可を継いで
            // いたので、この穴が見えていなかった。
            if Permissions.inputMonitoring != .granted {
                Permissions.requestInputMonitoring()
            }
            NSLog("astra: ⌥Space を登録できない（入力監視の許可が要る）")
        }
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
        // §16 R3: 進行中の会議を失いうる、元に戻せない操作。
        let go = Confirm.ask(ActionConfirmation(
            title: "録音を止めて Astra を終了します",
            details: ["ここまでの音声はディスクに残ります",
                      "次の起動で続きから復元できます"],
            risk: .r3,
            confirmLabel: "録音を止めて終了"))
        guard go else { return .terminateCancel }
        RecordingWorkspaceState.shared.stop()
        return .terminateNow
    }
}

import AppKit

final class AstraAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // headless の自己検証（Swift → core → ディスク）。UI を出さずに終了する。
        if SelfTest.run(CommandLine.arguments) { return }
        let demo = DemoMode.fromArguments(CommandLine.arguments)
        WindowCoordinator.shared.start(demo: demo)
        NSApp.activate(ignoringOtherApps: true)
    }
}

import AppKit
import SwiftUI

extension SelfTest {
    /// Native, offline fixtures. Never use the user's database, microphone or backend.
    @MainActor static func workspaceUX(_ args: [String]) async {
        let i = args.firstIndex(of: "--selftest")!
        guard args.count > i + 2,
              let dataRoot = ProcessInfo.processInfo.environment["ASTRA_DATA_ROOT"],
              dataRoot.hasPrefix("/tmp/") || dataRoot.hasPrefix("/private/tmp/") else {
            print("SELFTEST_FAIL workspace-ux: explicit temporary ASTRA_DATA_ROOT required"); exit(2)
        }
        let output = URL(fileURLWithPath: args[i + 2])
        try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        LocalStore.shared.open()
        Permissions.simulatedCalendar = .denied
        Permissions.simulatedInputMonitoring = .granted
        NSApp.setActivationPolicy(.regular)
        let nav = MainNav.shared
        let task = AgentTask(id: UUID(uuidString: "1EA3310B-813B-401C-8A6D-49DB55F4DF97")!, title: "検証用 · リサーチ結果を確認", status: .failed,
            steps: [AgentStep(title: "資料を確認", tool: "fixture.read", detail: "参照した資料の一覧を確認しました。", state: .success),
                    AgentStep(title: "結果をまとめる", tool: "fixture.write", detail: "接続が切れました。記録を確認してから続けられます。", state: .failed)],
            startedAt: Date(timeIntervalSince1970: 1789063200), context: ContextBundle())
        var geometry: [String: [String: Double]] = [:]
        var failures: [String] = []
        var keptWindow: NSWindow?
        for dark in [false, true] {
            for width in [940.0, 1162.0] {
                nav.select(.home); nav.intentDraft = ""; VoiceHUDState.shared.answer = ""
                let height = width == 940 ? 620.0 : 768.0
                NSApp.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                let host = NSHostingView(rootView: MainWindowView(loadBackend: false).environment(\.colorScheme, dark ? .dark : .light))
                let window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: width, height: height),
                    styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.title = "Astra UX · オフライン検証"
                window.titlebarAppearsTransparent = true
                window.contentView = host; window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
                func capture(_ state: String) async {
                    try? await Task.sleep(for: .milliseconds(400))
                    host.layoutSubtreeIfNeeded(); host.displayIfNeeded()
                    let name = "\(state)-\(Int(width))-\(dark ? "dark" : "light")"
                    // NavigationSplitView renders through AppKit/layer-backed subviews;
                    // cacheDisplay produces an empty shell on macOS 26. Capture our window.
                    guard let cg = CGWindowListCreateImage(.null, .optionIncludingWindow,
                        CGWindowID(window.windowNumber), [.boundsIgnoreFraming, .nominalResolution]),
                        let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else { failures.append(name); return }
                    try? png.write(to: output.appendingPathComponent(name + ".png"))
                    geometry[name] = ["width": host.bounds.width, "height": host.bounds.height]
                }
                await capture("home")
                LocalStore.shared.save(task)
                nav.intentDraft = "YouTube 向けの短い動画の構成を3案考えてください。\n誰に何が伝わるかを明確にしたいです。\n各案に、冒頭の見せ方と最後の一言を入れてください。\nまずは構成の比較までお願いします。"
                VoiceHUDState.shared.answer = "検証用の回答です。文章を選択してコピーできます。\nこの画面の撮影では外部へのリクエストは発生していません。"
                await capture("composer")
                nav.select(.work)
                await capture("tasks")
                nav.openTask = task
                await capture("detail")
                var record = TaskRequestRecord(request: "30秒のAstra紹介動画の構成を3案。撮影は画面収録のみ。", base: "fixture")
                record.phase = .working; record.message = "結果を待っています。別の画面で作業を続けられます。"
                var outcome = AgentTask(requestRecord: record, id: UUID(), title: "30秒で、Astraの価値を伝える", status: .running, steps: [], startedAt: task.startedAt, context: ContextBundle())
                LocalStore.shared.save(outcome); nav.openTask = outcome
                await capture("working")
                record.phase = .unknown; record.message = "受付を確認できませんでした。二重実行を防ぐため、自動では再送しません。"
                outcome.requestRecord = record; outcome.status = .failed; LocalStore.shared.save(outcome)
                await capture("interrupted")
                record.phase = .complete
                record.result = "## 案1 · 30秒で仕事が片付く\n**届けたい相手** · 小さなチームで、企画から制作まで担当する人。\n## 0–3秒 · 結果を先に見せる\n完成した3案を並べ、ひとつを選ぶ瞬間から始める。\n## 3–22秒 · ひと言が、構成案になる\n依頼を入力。画面を切り替え、届いた文章を開く。実際の待ち時間は編集で短縮したと明記する。\n## 22–30秒 · 次の一手へ\n文章を保存し、制作へ。最後の一言は「考えていたことを、つくり始めよう」。\n\nこれは画面検証用の構成案です。動画ファイルは生成していません。"
                outcome.requestRecord = record; outcome.status = .success; LocalStore.shared.save(outcome)
                await capture("result")
                nav.select(.apps); nav.appsTab = .connectors
                await capture("connections")
                if args.contains("--interactive"), dark, width == 1162 {
                    nav.select(.home); keptWindow = window
                } else { window.orderOut(nil); window.close() }
            }
        }
        try? JSONSerialization.data(withJSONObject: geometry, options: [.sortedKeys, .prettyPrinted])
            .write(to: output.appendingPathComponent("geometry.json"))
        print(failures.isEmpty ? "SELFTEST_OK workspace-ux: 32 native captures, 940/1162pt, light/dark; isolated data, backend disabled" : "SELFTEST_FAIL workspace-ux: \(failures)")
        if let keptWindow { retainedWorkspaceUXWindow = keptWindow; return }
        exit(failures.isEmpty ? 0 : 1)
    }
    @MainActor private static var retainedWorkspaceUXWindow: NSWindow?
}

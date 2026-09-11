import AppKit
import SwiftUI

extension SelfTest {
    /// Real UI request -> gateway -> configured device model -> durable document.
    /// Explicit temporary storage + an isolated test identity; no microphone or sends.
    @MainActor static func outcomeLive(_ args: [String]) async {
        guard let root = ProcessInfo.processInfo.environment["ASTRA_DATA_ROOT"], root.hasPrefix("/tmp/"),
              let email = ProcessInfo.processInfo.environment["ASTRA_OUTCOME_EMAIL"], email.hasSuffix("@astra.local") else {
            print("SELFTEST_FAIL outcome-live: isolated data and identity required"); exit(2)
        }
        NSApp.setActivationPolicy(.regular)
        WindowCoordinator.headless = true
        LocalStore.shared.open()
        let base = "http://127.0.0.1:3000"
        do {
            let token = try AstraCoreBridge.devSignIn(base, email: email, displayName: "Outcome validation")
            VoiceHUDState.shared.configureBackend(base: base, token: token.accessToken)
            let prompt = "Astraを紹介する30秒の縦型動画の構成案を日本語で3案作ってください。Astraで使える機能はHomeで依頼文を入力、Workで完成した文章を開く、コピー、Markdown保存の4つです。コードエディタや動画の編集機能はありません。対象は個人開発者。目的は、依頼から成果物まで1つのアプリで進められる価値を伝えること。撮影素材はAstraの画面収録のみで、予算0円。各案にタイトル、冒頭3秒の見せ方、3〜22秒の展開、22〜30秒の締め、撮影に必要な操作を記載してください。最も伝わる1案と理由も選んでください。再生数や売上の保証はしないこと。動画ファイルの生成やSNS投稿はせず、構成案の文章だけを作成してください。"
            let id: UUID
            if args.contains("--reopen") {
                guard let completed = LocalStore.shared.loadTasks().first(where: { $0.requestRecord?.hasResult == true }) else {
                    print("SELFTEST_FAIL outcome-live: no completed request to reopen"); exit(2)
                }
                id = completed.id
            } else {
                guard VoiceHUDState.shared.ask(prompt, newConversation: true), let accepted = VoiceHUDState.shared.latestRequestID else {
                    print("SELFTEST_FAIL outcome-live: request not accepted"); exit(2)
                }
                id = accepted
            }
            for _ in 0..<180 {
                try? await Task.sleep(for: .seconds(1))
                guard let task = LocalStore.shared.loadTasks().first(where: { $0.id == id }), let record = task.requestRecord else { continue }
                if record.hasResult {
                    guard record.result.count > 200 else { print("SELFTEST_FAIL outcome-live: result too short"); exit(2) }
                    let documentURL = URL(fileURLWithPath: root).appendingPathComponent("Astra-video-concepts.md")
                    try task.document.write(to: documentURL, atomically: true, encoding: .utf8)
                    LocalStore.shared.close(); LocalStore.shared.open()
                    guard LocalStore.shared.loadTasks().first(where: { $0.id == id })?.document == task.document else {
                        print("SELFTEST_FAIL outcome-live: restart changed the result"); exit(2)
                    }
                    print("SELFTEST_OK outcome-live: real request, persisted backend ID, \(record.result.count) characters, reopened result, identical Markdown export; job=\(record.backendTaskID)")
                    print("DOCUMENT=\(documentURL.path)")
                    if args.contains("--interactive") {
                        WindowCoordinator.headless = false
                        MainNav.shared.openTask = task
                        let host = NSHostingView(rootView: MainWindowView(loadBackend: false))
                        let window = NSWindow(contentRect: NSRect(x: 150, y: 150, width: 1162, height: 768), styleMask: [.titled,.closable,.resizable], backing: .buffered, defer: false)
                        window.isReleasedWhenClosed = false; window.title = "Astra · 実際に作成した構成案"
                        window.contentView = host; window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
                        retainedOutcomeWindow = window
                        return
                    }
                    exit(0)
                }
                if record.phase == .failed || record.phase == .needsInput || record.phase == .cancelled {
                    print("SELFTEST_FAIL outcome-live: \(record.phase) \(record.message)"); exit(2)
                }
            }
            if let task = LocalStore.shared.loadTasks().first(where: { $0.id == id }) {
                print("SELFTEST_FAIL outcome-live: timed out; \(task.requestRecord?.phase.rawValue ?? "missing") \(task.requestRecord?.message ?? "")")
            }
            exit(2)
        } catch { print("SELFTEST_FAIL outcome-live: \(error)"); exit(2) }
    }
    @MainActor private static var retainedOutcomeWindow: NSWindow?
}

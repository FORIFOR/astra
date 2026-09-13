import AppKit
import SwiftUI

extension SelfTest {
    @MainActor static func consumerJourneyLive() async {
        guard let root = ProcessInfo.processInfo.environment["ASTRA_DATA_ROOT"], root.hasPrefix("/tmp/"),
              let tokenPath = ProcessInfo.processInfo.environment["ASTRA_SELFTEST_AGENT_TOKEN_PATH"], tokenPath.hasPrefix("/tmp/"),
              let token = try? String(contentsOfFile: tokenPath, encoding: .utf8), !token.isEmpty else {
            print("SELFTEST_FAIL consumer-live: temporary data root and test token required"); exit(2)
        }
        WindowCoordinator.headless = true
        LocalStore.shared.open()
        VoiceHUDState.shared.configureBackend(base: "http://127.0.0.1:3000", token: token.trimmingCharacters(in: .whitespacesAndNewlines))
        var draft = ConsumerJourneyDraft(kind: .travel)
        draft.subject = "京都"; draft.area = "東京"; draft.people = 2; draft.budget = "80000"
        draft.dates = "2026年10月10日〜12日の2泊3日"
        draft.preferences = "検証用の架空旅行。徒歩を短めにし、カフェで休憩する時間を入れる。"
        draft.request = "ホテルを予約して、という依頼から作る計画の検証。実際の予約は行わない。"
        guard let prompt = draft.travelItineraryRequest,
              VoiceHUDState.shared.ask(prompt, newConversation: true, visualContext: [], consumerPlanning: .itinerary),
              let id = VoiceHUDState.shared.latestRequestID else { print("SELFTEST_FAIL consumer-live: request not accepted"); exit(2) }
        for _ in 0..<180 {
            try? await Task.sleep(for: .seconds(1))
            guard let task = LocalStore.shared.loadTasks().first(where: { $0.id == id }), let record = task.requestRecord else { continue }
            if record.hasResult {
                guard record.result.count > 200, record.result.contains("京都"), record.result.contains("未確認") else {
                    print("SELFTEST_FAIL consumer-live: incomplete/unqualified itinerary"); exit(2)
                }
                do {
                    try task.document.write(to: URL(fileURLWithPath: root).appendingPathComponent("itinerary.md"), atomically: true, encoding: .utf8)
                    LocalStore.shared.close(); LocalStore.shared.open()
                    guard LocalStore.shared.loadTasks().first(where: { $0.id == id })?.document == task.document else {
                        print("SELFTEST_FAIL consumer-live: reopening changed the result"); exit(2)
                    }
                    print("SELFTEST_OK consumer-live: native request → actual model → persisted itinerary; \(record.result.count) characters; no booking tool, search or payment")
                    exit(0)
                } catch { print("SELFTEST_FAIL consumer-live: unable to persist fixture"); exit(2) }
            }
            if [.failed, .cancelled, .needsInput].contains(record.phase) {
                print("SELFTEST_FAIL consumer-live: \(record.phase.rawValue)"); exit(2)
            }
        }
        print("SELFTEST_FAIL consumer-live: result not confirmed within 180 seconds"); exit(2)
    }

    @MainActor static func consumerJourneyShots(_ args: [String]) async {
        let directory = args.count > 3 ? args[3] : "/tmp/genie-consumer-journeys"
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            NSApp.setActivationPolicy(.regular)
            let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 620, height: 680),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            var geometry: [[String: Any]] = []
            for dark in [false, true] {
                for kind in ConsumerJourneyKind.allCases {
                    var draft = ConsumerJourneyDraft(kind: kind)
                    switch kind {
                    case .movie:
                        draft.subject = "観たい作品をここに入力"; draft.area = "渋谷周辺"; draft.dates = "10月10日の夜"; draft.people = 2
                    case .travel:
                        draft.subject = "京都"; draft.area = "東京"; draft.dates = "10月10日〜12日"; draft.people = 2; draft.budget = "80000"
                    case .delivery:
                        draft.subject = "ビッグマック1個、ポテトM1個"; draft.dates = "今日の19時頃"; draft.budget = "2000"
                    }
                    var closed = false
                    let host = NSHostingView(rootView: ConsumerJourneyView(draft: draft, onClose: { _ in closed = true }, onResearch: { _, _ in false })
                        .environment(\.colorScheme, dark ? .dark : .light))
                    window.contentView = host; window.makeKeyAndOrderFront(nil)
                    try await Task.sleep(for: .milliseconds(400))
                    host.layoutSubtreeIfNeeded()
                    guard UIProbe.exists("consumerOfficialSite"),
                          host.bounds.width == 620, host.bounds.height == 680,
                          let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw URLError(.cannotDecodeContentData) }
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                    guard let png = bitmap.representation(using: .png, properties: [:]) else { throw URLError(.cannotDecodeContentData) }
                    let name = "\(kind.rawValue)-\(dark ? "dark" : "light")"
                    try png.write(to: URL(fileURLWithPath: directory).appendingPathComponent(name + ".png"))
                    geometry.append(["name": name, "width": host.bounds.width, "height": host.bounds.height])
                    guard UIProbe.tap("consumerClose"), closed else { throw URLError(.cannotParseResponse) }
                }
            }
            window.close()
            try JSONSerialization.data(withJSONObject: geometry, options: [.prettyPrinted, .sortedKeys])
                .write(to: URL(fileURLWithPath: directory).appendingPathComponent("geometry.json"))
            print("SELFTEST_OK consumerjourneys: 6 native renders, fields and handoff visible, close action; no model, network, clipboard or purchase")
            exit(0)
        } catch { print("SELFTEST_FAIL consumerjourneys: \(error)"); exit(1) }
    }
}

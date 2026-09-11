import AppKit
import SwiftUI

extension SelfTest {
    @MainActor static func initialProfileShots(_ args: [String]) async {
        let directory = args.count > 3 ? args[3] : "/tmp/astra-initial-profile"
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            let store = InitialProfileStore.shared
            let sections = InitialProfileSections(focus: ["Astra", "LUMI", "MOPITA"], people: ["田中", "佐藤", "山田"], priorities: ["プロダクトレビュー", "リリース準備"], workPattern: ["火・木は会議が多い"], openItems: 4)
            func fixture(_ status: String) -> InitialProfileResult {
                InitialProfileResult(id: "fixture", provider: "google", status: status, startedAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z", outcomes: [
                    InitialProfileProgress(source: "google_calendar", status: "synced", artifacts: 84),
                    InitialProfileProgress(source: "gmail", status: status == "analysing" ? "reading" : "synced", artifacts: status == "analysing" ? 0 : 100)
                ], sections: sections)
            }
            let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 800, height: 680), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            var geometry: [[String: Any]] = []
            for dark in [false, true] {
                let host = NSHostingView(rootView: InitialProfileView().environment(\.colorScheme, dark ? .dark : .light))
                window.contentView = host; window.makeKeyAndOrderFront(nil)
                for stage in ["analysing", "ready", "editing"] {
                    if stage == "editing" {
                        guard UIProbe.tap("initialProfileEdit") else { throw URLError(.cannotParseResponse) }
                    } else { store.installForTesting(fixture(stage)) }
                    try await Task.sleep(for: .milliseconds(450))
                    host.layoutSubtreeIfNeeded()
                    if stage != "analysing", !UIProbe.exists("initialProfileConfirm") { throw URLError(.cannotParseResponse) }
                    guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw URLError(.cannotDecodeContentData) }
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                    guard let png = bitmap.representation(using: .png, properties: [:]) else { throw URLError(.cannotDecodeContentData) }
                    let name = "\(stage)-\(dark ? "dark" : "light")"
                    try png.write(to: URL(fileURLWithPath: directory).appendingPathComponent(name + ".png"))
                    geometry.append(["name": name, "width": host.bounds.width, "height": host.bounds.height, "bytes": png.count])
                }
            }
            store.installForTesting(nil); window.close()
            try JSONSerialization.data(withJSONObject: geometry, options: [.prettyPrinted, .sortedKeys])
                .write(to: URL(fileURLWithPath: directory).appendingPathComponent("geometry.json"))
            print("SELFTEST_OK initialprofile: 6 native captures; review/edit actions present; no external data or send")
            exit(0)
        } catch { print("SELFTEST_FAIL initialprofile: \(error)"); exit(1) }
    }
}

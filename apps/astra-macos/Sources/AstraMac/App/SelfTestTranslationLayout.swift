import AppKit
import SwiftUI

extension SelfTest {
    /// Native layout fixtures only. No speech, model, account or external network access.
    @MainActor static func translationLayout(_ args: [String]) async {
        let i = args.firstIndex(of: "--selftest")!
        guard args.count > i + 2 else { print("SELFTEST_FAIL translation-layout: output directory required"); exit(2) }
        let output = URL(fileURLWithPath: args[i + 2])
        try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        NSApp.setActivationPolicy(.regular)
        var failures: [String] = []
        var geometry: [String: [String: Double]] = [:]
        for dark in [false, true] {
            for width in [320.0, 720.0] {
                var fail = true
                let model = MeetingTranslation { _, _, _ in
                    try await Task.sleep(for: .milliseconds(1200))
                    if fail { throw TranslationFailure(message: "接続を確認して再試行してください。") }
                    return "次の会議は金曜日の午後3時です。"
                }
                model.setEngine(.local); model.setLanguage(.japanese)
                model.update([TranscriptSegment(speaker: "Tester", text: "The next meeting is on Friday at 3 pm.", interim: false, at: 12)])
                let view = MeetingTranslationView(model: model, compact: false)
                    .padding(12).frame(width: width, height: 330)
                    .background(Palette.surface(dark))
                    .environment(\.colorScheme, dark ? .dark : .light)
                let host = NSHostingView(rootView: view)
                let window = NSWindow(contentRect: NSRect(x: 300, y: 300, width: width, height: 330), styleMask: [.borderless], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.contentView = host; window.makeKeyAndOrderFront(nil)
                model.setEnabled(true)
                func capture(_ state: String) {
                    host.layoutSubtreeIfNeeded(); host.displayIfNeeded()
                    let name = "\(state)-\(Int(width))-\(dark ? "dark" : "light")"
                    guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { failures.append(name); return }
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                    guard let png = bitmap.representation(using: .png, properties: [:]) else { failures.append(name); return }
                    try? png.write(to: output.appendingPathComponent(name + ".png"))
                    geometry[name] = ["width": host.bounds.width, "height": host.bounds.height]
                }
                try? await Task.sleep(for: .milliseconds(350))
                if model.displayRows.first?.translation != nil || model.displayRows.first?.source.text.isEmpty != false { failures.append("pending original unavailable") }
                capture("pending")
                try? await Task.sleep(for: .milliseconds(1200))
                if model.failure == nil { failures.append("error fixture missing") }
                capture("error")
                fail = false; model.retry()
                try? await Task.sleep(for: .milliseconds(1500))
                if model.rows.count != 1 || model.failure != nil { failures.append("retry failed") }
                capture("ready")
                window.orderOut(nil); window.close()
            }
        }
        try? JSONSerialization.data(withJSONObject: geometry, options: [.sortedKeys, .prettyPrinted]).write(to: output.appendingPathComponent("layout-geometry.json"))
        print(failures.isEmpty ? "SELFTEST_OK translation-layout: 12 native captures; pending original, error, retry; 320/720pt light/dark" : "SELFTEST_FAIL translation-layout: " + failures.joined(separator: "; "))
        exit(failures.isEmpty ? 0 : 1)
    }
}

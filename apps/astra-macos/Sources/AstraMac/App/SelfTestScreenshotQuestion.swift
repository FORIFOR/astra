import AppKit
import SwiftUI

extension SelfTest {
    /// Offline fixtures for the screenshot → question journey. No provider requests.
    @MainActor static func screenshotQuestion(_ args: [String]) async {
        let i = args.firstIndex(of: "--selftest")!
        guard args.count > i + 2,
              let root = ProcessInfo.processInfo.environment["ASTRA_DATA_ROOT"],
              root.hasPrefix("/tmp/") || root.hasPrefix("/private/tmp/") else {
            print("SELFTEST_FAIL screenshot-question: temporary ASTRA_DATA_ROOT required"); exit(2)
        }
        let output = URL(fileURLWithPath: args[i + 2])
        try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        LocalStore.shared.open()
        Permissions.simulatedCalendar = .denied
        NSApp.setActivationPolicy(.regular)
        let visual = VisualContextStore.shared
        visual.reset()
        let oldScale = UIScale.shared.size
        let fixture = URL(fileURLWithPath: root).appendingPathComponent("Screenshot-example.png")
        let image = NSImage(size: NSSize(width: 640, height: 360))
        image.lockFocus()
        NSColor(calibratedWhite: 0.96, alpha: 1).setFill()
        NSRect(x: 0, y: 0, width: 640, height: 360).fill()
        ("WEBSITE PREVIEW" as NSString).draw(at: NSPoint(x: 36, y: 274), withAttributes: [.font: NSFont.systemFont(ofSize: 20), .foregroundColor: NSColor.darkGray])
        ("Small ideas.\nReal outcomes." as NSString).draw(in: NSRect(x: 36, y: 92, width: 560, height: 150), withAttributes: [.font: NSFont.systemFont(ofSize: 46, weight: .semibold), .foregroundColor: NSColor.black])
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { exit(2) }
        try? png.write(to: fixture)
        guard let shot = visual.ingest(url: fixture, kind: .screenshot, confidence: 1,
            pixelSize: CGSize(width: 640, height: 360), capturedAt: Date(), app: "Example", window: nil) else { exit(2) }
        var failures: [String] = []
        var geometry: [String: [String: Double]] = [:]

        func capture<V: View>(_ view: V, name: String, size: NSSize) async {
            let host = NSHostingView(rootView: view)
            let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = host; window.center(); window.makeKeyAndOrderFront(nil)
            try? await Task.sleep(for: .milliseconds(300))
            host.layoutSubtreeIfNeeded(); host.displayIfNeeded()
            if let cg = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(window.windowNumber), [.boundsIgnoreFraming, .nominalResolution]),
               let bytes = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) {
                try? bytes.write(to: output.appendingPathComponent(name + ".png"))
                geometry[name] = ["width": window.frame.width, "height": window.frame.height]
            } else { failures.append(name) }
            window.orderOut(nil); window.close()
        }

        WindowCoordinator.shared.start(demo: .none)
        for scale in UIScale.Size.allCases {
            UIScale.shared.set(scale)
            for dark in [false, true] {
                let suffix = "\(scale.rawValue)-\(dark ? "dark" : "light")"
                VoiceHUDState.shared.mode = .quickActions
                WindowCoordinator.shared.offerScreenshot()
                if VoiceHUDState.shared.mode != .idle { failures.append("capture kept Quick Actions open") }
                await capture(VoiceTaskDockView(), name: "offer-" + suffix, size: DockPresentation.idle.size())
                MainNav.shared.prepareScreenshotQuestion(shot)
                MainNav.shared.intentDraft = "このサイトの第一印象と、改善できる点を教えてください。"
                await capture(MainWindowView(loadBackend: false).environment(\.colorScheme, dark ? .dark : .light),
                              name: "question-" + suffix, size: NSSize(width: 1162, height: 768))
                MainNav.shared.removeIntentScreenshot()
                await capture(MainWindowView(loadBackend: false).environment(\.colorScheme, dark ? .dark : .light),
                              name: "removed-" + suffix, size: NSSize(width: 1162, height: 768))
            }
        }
        if visual.attachCount != 0 { failures.append("navigation caused image handover") }
        try? JSONSerialization.data(withJSONObject: geometry, options: [.sortedKeys, .prettyPrinted])
            .write(to: output.appendingPathComponent("geometry.json"))
        UIScale.shared.set(oldScale)
        if args.contains("--interactive") {
            MainNav.shared.intentDraft = ""
            MainWindowController.shared.askAboutScreenshot(shot)
            WindowCoordinator.shared.start(demo: .none)
            ScreenshotDetectionService.shared.start(directory: URL(fileURLWithPath: root))
            print("SELFTEST_READY screenshot-question: isolated composer; save a screenshot in \(root)")
            return
        }
        visual.reset()
        print(failures.isEmpty ? "SELFTEST_OK screenshot-question: 18 native captures, three scales, Quick Actions → offer, preview/removal, zero image handover" : "SELFTEST_FAIL screenshot-question: \(failures)")
        exit(failures.isEmpty ? 0 : 1)
    }
}

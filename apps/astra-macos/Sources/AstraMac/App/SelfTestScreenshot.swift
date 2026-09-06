import AppKit
import Foundation

/// `--selftest screenshotcontext`: SCREENSHOT_CONTEXT_GATE。
///
/// 「スクショを撮った瞬間、それが直近の会話コンテキストになる」を人手 0 で確かめる。
/// 検知・分類・会話への紐付け・参照表現の解決・二重取り込み防止・部分ファイル拒否・
/// focus/窓を作らない・質問前は外部へ出さない・外すのは 1 操作、を検査する。
extension SelfTest {
    @MainActor
    static func screenshotContextGate() {
        var fail: [String] = []
        func check(_ ok: Bool, _ msg: String) { if !ok { fail.append(msg) } }

        let store = VisualContextStore.shared
        let svc = ScreenshotDetectionService.shared
        store.reset()

        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("astra-sc-gate-\(getpid())", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        // 有効な PNG を書く。
        func writePNG(_ name: String, w: Int, h: Int) -> URL {
            let url = dir.appendingPathComponent(name)
            let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h,
                                       bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                       colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            for x in 0..<w { for y in 0..<h { rep.setColor(.init(red: 0.2, green: 0.4, blue: 0.9, alpha: 1), atX: x, y: y) } }
            try? rep.representation(using: .png, properties: [:])?.write(to: url)
            return url
        }

        // 1) 標準スクショ検知 + 遅延 < 300ms。
        store.bind(conversationID: "conv-1")
        let shot1 = writePNG("スクリーンショット 2026-09-06 1.png", w: 400, h: 300)
        let t0 = Date()
        svc.ingestFile(url: shot1, dir: dir)
        let latencyMs = Date().timeIntervalSince(t0) * 1000
        check(store.recent.count == 1, "標準スクショを検知できない (recent=\(store.recent.count))")
        check(latencyMs < 300, "検知が遅い \(Int(latencyMs))ms")
        check(store.recent.first?.kind == .screenshot, "kind が screenshot でない")

        // 2) 現在の会話へ紐付く（新しいチャットを作らない）。
        check(store.recent.first?.conversationID == "conv-1", "会話に紐付いていない")
        // 質問前は attached でない = 外部へ出していない。
        check(store.recent.first?.state == .available, "質問前なのに available でない（= 送ってしまう疑い）")

        // 3) 二重取り込み 0（同じ画像を 2 回）。
        svc.ingestFile(url: shot1, dir: dir)
        check(store.recent.count == 1, "同じ画像を 2 回取り込んだ (recent=\(store.recent.count))")

        // 4) 部分ファイル拒否（0 バイト）と、小さすぎる画像（アイコン）を拾わない。
        let empty = dir.appendingPathComponent("スクリーンショット empty.png")
        FileManager.default.createFile(atPath: empty.path, contents: Data())
        svc.ingestFile(url: empty, dir: dir)
        check(store.recent.count == 1, "0 バイトのファイルを取り込んだ")
        let tiny = writePNG("スクリーンショット tiny.png", w: 10, h: 10)
        svc.ingestFile(url: tiny, dir: dir)
        check(store.recent.count == 1, "小さすぎる画像を取り込んだ")

        // 5) focus を奪わない・窓を作らない。
        let windowsBefore = NSApp.windows.count
        let shot2 = writePNG("スクリーンショット 2026-09-06 2.png", w: 420, h: 320)
        svc.ingestFile(url: shot2, dir: dir)
        let windowsAfter = NSApp.windows.count
        check(windowsAfter == windowsBefore, "検知で窓が増えた (\(windowsBefore)→\(windowsAfter))")
        check(store.recent.count == 2, "2 枚目を検知できない (recent=\(store.recent.count))")

        // 6) クリップボード画像も拾う（kind を分ける、体験は同じ）。
        let cbImg = NSImage(size: NSSize(width: 300, height: 200))
        cbImg.lockFocus(); NSColor.systemGreen.setFill(); NSRect(x: 0, y: 0, width: 300, height: 200).fill(); cbImg.unlockFocus()
        svc.ingestClipboard(cbImg)
        check(store.recent.contains { $0.kind == .clipboardImage }, "クリップボード画像を拾えない")

        // 7) 参照表現の解決。いま store には（新しい順）clip, shot2, shot1。
        let recent = store.recent
        let these = VisualReferenceResolver.resolve(text: "これ何？", recent: recent).images
        check(these.count == 1 && these.first?.id == recent.first?.id, "「これ」が最新 1 枚を指さない (\(these.count))")
        let two = VisualReferenceResolver.resolve(text: "この2枚だとどっちがいい？", recent: recent).images
        check(two.count == 2, "「この2枚」が 2 枚にならない (\(two.count))")
        let three = VisualReferenceResolver.resolve(text: "この3枚を比べて", recent: recent).images
        check(three.count == 3, "「この3枚」が 3 枚にならない (\(three.count))")
        let prevNow = VisualReferenceResolver.resolve(text: "さっきのと今のを比べて", recent: recent).images
        check(prevNow.count == 2 && prevNow.last?.id == recent.first?.id, "「さっきのと今の」が 前+最新 にならない")
        let none = VisualReferenceResolver.resolve(text: "今日の天気は？", recent: recent).images
        check(none.isEmpty, "参照でない文でスクショを添付した (\(none.count))")
        check(VisualReferenceResolver.isReferential("このエラーどうすればいい？"), "参照表現を参照でないと判定")
        check(!VisualReferenceResolver.isReferential("会議を録音して"), "非参照を参照と誤判定")

        // 8) 質問で添付 → attached（このときだけ推論対象）。手動添付は不要。
        store.markAttached([recent.first!])
        check(store.recent.first?.state == .attached, "添付後に attached にならない")

        // 9) コンテキストから外すのは 1 操作。
        let removeId = store.recent.first!.id
        store.remove(removeId)
        check(!store.recent.contains { $0.id == removeId }, "1 操作で外せない")

        try? FileManager.default.removeItem(at: dir)
        store.reset()

        if fail.isEmpty {
            print("SCREENSHOT_CONTEXT_GATE=PASS  検知<\(Int(latencyMs))ms・会話紐付け・参照解決・二重0・部分0・窓0・質問前egress0・外す1操作")
            exit(0)
        } else {
            print("SCREENSHOT_CONTEXT_GATE=FAIL  " + fail.joined(separator: " / "))
            exit(2)
        }
    }
}

extension SelfTest {
    /// `--selftest screenshotshot <dir>`: スクショ chip が Dock に出た姿を撮る（目視確認用）。
    @MainActor
    static func screenshotShot(_ args: [String]) {
        let i = args.firstIndex(of: "--selftest")!
        let outDir = args.count > i + 2 ? args[i + 2] : "/tmp/astra-screenshot-shot"
        try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        func settle(_ s: Double) { let u = Date().addingTimeInterval(s); while Date() < u { CFRunLoopRunInMode(.defaultMode, 0.05, true) } }
        WindowCoordinator.shared.showVoiceHUD(); settle(0.6)
        // スクショを撮った直後の状態を作る。
        let dir = FileManager.default.temporaryDirectory
        let url = dir.appendingPathComponent("shot-demo.png")
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 800, pixelsHigh: 500, bitsPerSample: 8,
                                   samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                   bytesPerRow: 0, bitsPerPixel: 0)!
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
        VisualContextStore.shared.reset()
        VisualContextStore.shared.bind(conversationID: "shot")
        VisualContextStore.shared.ingest(url: url, kind: .screenshot, confidence: 0.95,
                                         pixelSize: CGSize(width: 800, height: 500), capturedAt: Date(),
                                         app: "Figma", window: nil)
        settle(0.6)
        guard let win = NSApp.windows.first(where: { $0.isVisible && $0.frame.width > 100 }),
              let cg = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(win.windowNumber),
                                               [.boundsIgnoreFraming, .bestResolution]) else {
            print("SCREENSHOT_SHOT_FAIL: HUD 窓が撮れない"); exit(2)
        }
        let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
        let out = "\(outDir)/screenshot-context-chip.png"
        try? png?.write(to: URL(fileURLWithPath: out))
        print("SCREENSHOT_SHOT_OK \(out)")
        exit(0)
    }
}

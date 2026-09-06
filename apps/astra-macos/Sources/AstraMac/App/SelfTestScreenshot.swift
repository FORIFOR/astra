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
        // 受け渡し場所も検査用に隔離する（利用者の Application Support を汚さない）。
        let handover = dir.appendingPathComponent("handover", isDirectory: true)
        VisualContextStore.handoverDirectoryOverride = handover
        func handoverFiles() -> [String] {
            ((try? FileManager.default.contentsOfDirectory(atPath: handover.path)) ?? []).filter { $0.hasSuffix(".png") }
        }
        func settle(_ s: Double) { let u = Date().addingTimeInterval(s); while Date() < u { CFRunLoopRunInMode(.defaultMode, 0.02, true) } }
        func waitUntil(_ limit: Double, _ cond: () -> Bool) -> Bool {
            let u = Date().addingTimeInterval(limit)
            while Date() < u { if cond() { return true }; CFRunLoopRunInMode(.defaultMode, 0.01, true) }
            return cond()
        }

        // 有効な PNG を作る（描画は 1 回で速く。遅延の測定に描画時間を混ぜない）。
        func pngData(w: Int, h: Int) -> Data {
            let img = NSImage(size: NSSize(width: w, height: h))
            img.lockFocus(); NSColor(red: 0.2, green: 0.4, blue: 0.9, alpha: 1).setFill()
            NSRect(x: 0, y: 0, width: w, height: h).fill(); img.unlockFocus()
            let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
            return rep.representation(using: .png, properties: [:])!
        }
        func writePNG(_ name: String, w: Int, h: Int) -> URL {
            let url = dir.appendingPathComponent(name)
            try? pngData(w: w, h: h).write(to: url)
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

        // 7b) 「さっきの」だけなら 1 つ前。「さっき撮ったやつ」で 1 枚しか無ければそれ。
        let prevOnly = VisualReferenceResolver.resolve(text: "さっきのは何だった？", recent: recent).images
        check(prevOnly.count == 1 && prevOnly.first?.id == recent[1].id, "「さっきの」が 1 つ前を指さない")
        let onlyOne = VisualReferenceResolver.resolve(text: "さっき撮ったやつ見て", recent: [recent[0]]).images
        check(onlyOne.count == 1 && onlyOne.first?.id == recent[0].id, "1 枚しか無いとき「さっき」がそれを指さない")

        // 8) 質問で添える → attached（このときだけ画像が動く）。手動添付は不要。
        //    撮っただけの段階では受け渡し場所に何も無い（= 質問前に画像が動かない）。
        check(handoverFiles().isEmpty, "質問前に受け渡し場所へ画像が写された (\(handoverFiles()))")
        let toAttach = Array(recent.prefix(2))
        let attachments = store.attach(toAttach)
        check(attachments.count == 2, "添付が 2 件にならない (\(attachments.count))")
        check(attachments.first?.label == "クリップボードの画像（たった今）", "添付ラベルが違う (\(attachments.first?.label ?? ""))")
        check(attachments.last?.label == "スクリーンショット（1 つ前）", "2 枚目のラベルが違う (\(attachments.last?.label ?? ""))")
        check(attachments.allSatisfy { $0.id.range(of: "^[a-z0-9-]{1,64}$", options: .regularExpression) != nil }, "添付 id がファイル名として不正")
        check(Set(handoverFiles()) == Set(attachments.map { "\($0.id).png" }), "受け渡し場所の写しが添付と一致しない (\(handoverFiles()))")
        check(store.recent.first?.state == .attached, "添付後に attached にならない")
        // 応答が終わったら recent（しばらく「さっきの」で呼べる）。
        store.markRecent(toAttach)
        check(store.recent.first?.state == .recent, "応答後に recent にならない")

        // 9) コンテキストから外すのは 1 操作。端末に残した写しも消える。
        let removeId = store.recent.first!.id
        store.remove(removeId)
        check(!store.recent.contains { $0.id == removeId }, "1 操作で外せない")
        check(!handoverFiles().contains("\(removeId.uuidString.lowercased()).png"), "外しても写しが残る")

        // 10) 実際の監視経路（フォルダを見張る → 書かれた → 安定 → 登録）で遅延と部分ファイルを測る。
        store.reset()
        let watched = dir.appendingPathComponent("watched", isDirectory: true)
        try? FileManager.default.createDirectory(at: watched, withIntermediateDirectories: true)
        svc.stop(); svc.start(directory: watched)
        settle(0.1)
        let keyBefore = NSApp.keyWindow; let activeBefore = NSApp.isActive
        let firstPNG = pngData(w: 380, h: 260)
        let tw0 = Date()   // 書かれた瞬間から測る（macOS の screencapture が書き終えた時点に相当）
        try? firstPNG.write(to: watched.appendingPathComponent("スクリーンショット 2026-09-07 1.png"))
        let seen = waitUntil(1.5) { store.recent.count == 1 }
        let watchMs = Date().timeIntervalSince(tw0) * 1000
        check(seen, "監視経路で標準スクショを検知できない")
        check(watchMs < 300, "監視経路の検知が遅い \(Int(watchMs))ms")
        check(NSApp.keyWindow === keyBefore && NSApp.isActive == activeBefore, "検知で focus が動いた")
        // 部分ファイル: 前半だけ書いて 120ms 止め、その後に残りを書く。途中で取り込まれず、完成後に 1 回だけ取り込む。
        let full = pngData(w: 360, h: 240)
        let partial = watched.appendingPathComponent("スクリーンショット 2026-09-07 2.png")
        FileManager.default.createFile(atPath: partial.path, contents: full.prefix(full.count / 2))
        settle(0.12)
        check(store.recent.count == 1, "書き込み途中の PNG を取り込んだ")
        let fh = try! FileHandle(forWritingTo: partial); fh.seekToEndOfFile(); fh.write(full.suffix(from: full.count / 2)); try? fh.close()
        check(waitUntil(2.5) { store.recent.count == 2 }, "完成した PNG を取り込めない (recent=\(store.recent.count))")
        settle(0.3)
        check(store.recent.count == 2, "完成後に二重に取り込んだ (recent=\(store.recent.count))")
        svc.stop()

        try? FileManager.default.removeItem(at: dir)
        store.reset()
        VisualContextStore.handoverDirectoryOverride = nil

        if fail.isEmpty {
            print("SCREENSHOT_CONTEXT_GATE=PASS  検知<\(Int(latencyMs))ms・監視経路\(Int(watchMs))ms・会話紐付け・参照解決(これ/さっきの/2枚/3枚/さっきのと今の)・二重0・部分0・窓0・focus0・質問前に画像が動かない・受け渡し=添付時のみ・外す1操作")
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

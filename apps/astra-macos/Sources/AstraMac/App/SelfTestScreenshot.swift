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

        // 11) 受け渡し場所（キャッシュ）の規律: TTL 30 分 / 20 件 / 200MB / 起動時掃除 / 会話を閉じたら消す /
        //     別の会話の画像は添えない / store の知らない artifact は添えない / id は正規パスの中だけ。
        store.reset()
        let now = Date()
        func entry(_ name: String, age: TimeInterval, bytes: Int) -> HandoverCache.Entry {
            HandoverCache.Entry(url: handover.appendingPathComponent(name), bytes: bytes, modified: now.addingTimeInterval(-age))
        }
        let fresh = (0..<5).map { entry("f\($0).png", age: Double($0) * 60, bytes: 1_000) }
        let stale = [entry("old.png", age: 31 * 60, bytes: 1_000)]
        check(HandoverCache.plan(fresh + stale, now: now).map(\.lastPathComponent) == ["old.png"], "TTL 30 分を超えたものだけが消えない")
        let many = (0..<25).map { entry("m\($0).png", age: Double($0), bytes: 10) }
        check(HandoverCache.plan(many, now: now).count == 5, "20 件を超えた古いものが消えない (\(HandoverCache.plan(many, now: now).count))")
        let heavy = (0..<4).map { entry("h\($0).png", age: Double($0), bytes: 60 * 1024 * 1024) }
        let heavyDoomed = HandoverCache.plan(heavy, now: now)
        check(heavyDoomed.map(\.lastPathComponent) == ["h3.png"], "200MB を超えた分が古い方から消えない (\(heavyDoomed.map(\.lastPathComponent)))")
        // 起動時掃除: 実ファイルで。
        try? FileManager.default.createDirectory(at: handover, withIntermediateDirectories: true)
        let staleURL = handover.appendingPathComponent("stale.png")
        try? Data([1, 2, 3]).write(to: staleURL)
        try? FileManager.default.setAttributes([.modificationDate: now.addingTimeInterval(-40 * 60)], ofItemAtPath: staleURL.path)
        let keptURL = handover.appendingPathComponent("kept.png")
        try? Data([1, 2, 3]).write(to: keptURL)
        HandoverCache.cleanup(directory: handover, now: now)
        check(!FileManager.default.fileExists(atPath: staleURL.path) && FileManager.default.fileExists(atPath: keptURL.path), "起動時掃除が期限切れだけを消さない")
        try? FileManager.default.removeItem(at: keptURL)
        // 会話 A で撮って添える → 会話 B に切り替わると A の写しは消え、A の画像は B から添えられない。
        store.bind(conversationID: "conv-A")
        let a1 = writePNG("a1.png", w: 200, h: 120)
        svc.ingestFile(url: a1, dir: dir)
        let aArt = store.recent.first!
        let aAtt = store.attach([aArt])
        check(aAtt.count == 1 && handoverFiles().count == 1, "会話 A で添えられない")
        store.bind(conversationID: "conv-B")
        check(handoverFiles().isEmpty, "会話を閉じても写しが残る (\(handoverFiles()))")
        check(!store.recent.contains { $0.id == aArt.id }, "閉じた会話の画像が文脈に残る")
        check(store.attach([aArt]).isEmpty, "別の会話の画像を添えられてしまう")
        // store の知らない artifact（外から作ったもの）は添えない。
        let foreign = VisualContextArtifact(id: UUID(), conversationID: "conv-B", imageURL: a1, capturedAt: now, sourceApp: nil,
                                            sourceWindow: nil, pixelSize: CGSize(width: 200, height: 120), confidence: 1, kind: .screenshot, state: .available)
        check(store.attach([foreign]).isEmpty && handoverFiles().isEmpty, "store の知らない artifact を添えてしまう")
        // id は受け渡し場所の中の正規パスにしかならない（path traversal 0）。
        for bad in ["../../etc/passwd", "..", "x/y", "ABC", "", "a1b2c3-../x"] {
            check(VisualContextStore.canonicalHandoverURL(id: bad, directory: handover) == nil, "不正な id がパスになる: \(bad)")
        }
        let good = VisualContextStore.canonicalHandoverURL(id: "0a1b2c3d-0000-4000-8000-000000000001", directory: handover)
        check(good?.deletingLastPathComponent().resolvingSymlinksInPath().path == handover.resolvingSymlinksInPath().path, "正規 id が受け渡し場所の中を指さない")
        // 受け渡し場所と写しの権限: 場所は 0700、写しは 0600（利用者だけ）。写しは普通のファイル。
        let hb = writePNG("hb.png", w: 200, h: 120)
        svc.ingestFile(url: hb, dir: dir)
        let hbAtt = store.attach(store.recent)
        check(hbAtt.count == 1, "権限検査用の添付ができない")
        let dirPerm = (try? FileManager.default.attributesOfItem(atPath: handover.path))?[.posixPermissions] as? Int
        check(dirPerm == 0o700, "受け渡し場所の権限が 0700 でない (\(dirPerm.map { String($0, radix: 8) } ?? "nil"))")
        if let name = handoverFiles().first {
            let f = handover.appendingPathComponent(name)
            let perm = (try? FileManager.default.attributesOfItem(atPath: f.path))?[.posixPermissions] as? Int
            check(perm == 0o600, "写しの権限が 0600 でない (\(perm.map { String($0, radix: 8) } ?? "nil"))")
            let v = try? f.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            check(v?.isRegularFile == true && v?.isSymbolicLink != true, "写しが普通のファイルでない")
        }
        // symlink は辿らない: 写す先に外を指すリンクを置いても、リンク先は書き換わらず、リンクは普通のファイルに置き換わる。
        store.reset()
        let outside = dir.appendingPathComponent("outside.txt")
        try? "secret".write(to: outside, atomically: true, encoding: .utf8)
        let sl = writePNG("sl.png", w: 200, h: 120)
        svc.ingestFile(url: sl, dir: dir)
        if let art = store.recent.first {
            let target = handover.appendingPathComponent("\(art.id.uuidString.lowercased()).png")
            try? FileManager.default.createSymbolicLink(at: target, withDestinationURL: outside)
            let refused = store.attach([art])
            check(refused.isEmpty, "写す先が symlink なのに添えた（外へ書く道）")
            check((try? String(contentsOf: outside, encoding: .utf8)) == "secret", "symlink を辿って外のファイルを書き換えた")
            try? FileManager.default.removeItem(at: target)
        }
        // 掃除は symlink を数えない・消さない（受け渡し場所のものではない）。
        let stray = handover.appendingPathComponent("stray.png")
        try? FileManager.default.createSymbolicLink(at: stray, withDestinationURL: outside)
        check(!HandoverCache.entries(in: handover).contains { $0.url.lastPathComponent == "stray.png" }, "掃除が symlink を数えた")
        try? FileManager.default.removeItem(at: stray)
        store.reset()

        // 期限切れは読めない: TTL を過ぎた添付の写しは purge で消える。
        let b1 = writePNG("b1.png", w: 200, h: 120)
        svc.ingestFile(url: b1, dir: dir)
        _ = store.attach(store.recent)
        check(handoverFiles().count == 1, "添えた写しが無い")
        store.purgeExpired(now: now.addingTimeInterval(31 * 60))
        check(handoverFiles().isEmpty && store.recent.isEmpty, "期限切れの写しが読める状態で残る (\(handoverFiles()))")

        try? FileManager.default.removeItem(at: dir)
        store.reset()
        VisualContextStore.handoverDirectoryOverride = nil

        if fail.isEmpty {
            print("SCREENSHOT_CONTEXT_GATE=PASS  検知<\(Int(latencyMs))ms・監視経路\(Int(watchMs))ms・会話紐付け・参照解決(これ/さっきの/2枚/3枚/さっきのと今の)・二重0・部分0・窓0・focus0・質問前に画像が動かない・受け渡し=添付時のみ・外す1操作・TTL30分/20件/200MB/起動時掃除・会話閉じで削除・別会話0・path traversal 0・期限切れ可読0・0700/0600・symlink拒否・regular only")
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


// MARK: - SCREENSHOT_EGRESS_TRUTH

extension SelfTest {
    /// `--selftest screenshotegress`: 画像がどこまで行くかを偽らない。
    ///
    ///   capture_only_egress             = 0   撮っただけでは受け渡しも送信も起きない
    ///   gateway_receives_pixels         = 0   gateway へ行く添付は id / kind / label の 3 文字列だけ
    ///   local_vision_provider_egress    = 0   端末内モデルの方針では「送らない」と言う
    ///   cloud_vision_provider_disclosed = PASS cloud のモデルで見るときは「質問したときだけ送る」と UI で言う
    ///   unasked_screenshot_upload       = 0   参照表現でない質問では画像が動かない
    @MainActor
    static func screenshotEgressGate() {
        var fail: [String] = []
        func check(_ ok: Bool, _ msg: String) { if !ok { fail.append(msg) } }
        let store = VisualContextStore.shared
        let svc = ScreenshotDetectionService.shared
        store.reset()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("astra-egress-\(getpid())", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let handover = dir.appendingPathComponent("handover", isDirectory: true)
        VisualContextStore.handoverDirectoryOverride = handover
        func handoverFiles() -> [String] { ((try? FileManager.default.contentsOfDirectory(atPath: handover.path)) ?? []) }
        func png(_ name: String) -> URL {
            let img = NSImage(size: NSSize(width: 300, height: 200))
            img.lockFocus(); NSColor.systemTeal.setFill(); NSRect(x: 0, y: 0, width: 300, height: 200).fill(); img.unlockFocus()
            let url = dir.appendingPathComponent(name)
            try? NSBitmapImageRep(data: img.tiffRepresentation!)!.representation(using: .png, properties: [:])!.write(to: url)
            return url
        }

        // capture_only_egress = 0
        store.bind(conversationID: "conv-e")
        for i in 0..<3 { svc.ingestFile(url: png("スクリーンショット \(i).png"), dir: dir) }
        check(store.recent.count == 3, "3 枚撮れていない (\(store.recent.count))")
        check(handoverFiles().isEmpty, "撮っただけで受け渡し場所に写しができた (\(handoverFiles()))")
        check(store.attachCount == 0, "撮っただけで attach が起きた")

        // unasked_screenshot_upload = 0: 参照表現でない質問では何も動かない
        let none = VisualReferenceResolver.resolve(text: "今日の天気は？", recent: store.recent).images
        _ = store.attach(none)
        check(none.isEmpty && store.attachCount == 0 && handoverFiles().isEmpty, "参照でない質問で画像が動いた")

        // gateway_receives_pixels = 0: 添付は id / kind / label の 3 文字列だけ。画素も base64 も無い。
        let these = VisualReferenceResolver.resolve(text: "これ何？", recent: store.recent).images
        let atts = store.attach(these)
        check(atts.count == 1, "「これ」で 1 枚添えられない (\(atts.count))")
        let fields = Mirror(reflecting: atts[0]).children.map { ($0.label ?? "", type(of: $0.value)) }
        check(fields.map(\.0) == ["id", "kind", "label"], "gateway へ渡す添付の項目が id/kind/label でない: \(fields.map(\.0))")
        check(fields.allSatisfy { $0.1 == String.self }, "添付に文字列でない項目がある")
        check(atts.allSatisfy { $0.id.count <= 64 && $0.label.count <= 200 && $0.kind.count <= 32 }, "添付の文字列が長すぎる（画素を混ぜている疑い）")
        check(handoverFiles().count == 1, "質問で 1 枚だけ写す (\(handoverFiles()))")

        // provider egress truth
        check(!VisualEgressPolicy.localVision.sendsPixelsOffDevice, "端末内モデルの方針が「送る」になっている")
        check(VisualEgressPolicy.localVision.disclosure == Facts.screenshotEgressLocal, "端末内の文言が Facts と違う")
        let cloud = VisualEgressPolicy.cloudVision(provider: "Claude")
        check(cloud.sendsPixelsOffDevice, "cloud の方針が「送らない」になっている（偽り）")
        check(cloud.disclosure.contains("Claude") && cloud.disclosure.contains("質問したときだけ"), "cloud の開示文が「質問したときだけ…へ送ります」でない: \(cloud.disclosure)")
        check(!cloud.disclosure.contains("出ません") && !cloud.disclosure.contains("出ない"), "cloud なのに「出ない」と言っている")
        // 既定は cloud（端末内で画像を見るモデルはまだ無い。「出ない」と決して言わない）。
        check(VisualEgressPolicy.current == cloud, "既定の方針が cloud(Claude) でない: \(VisualEgressPolicy.current)")
        check(Facts.all.contains { $0.key == "screenshot.egress.cloud" } && Facts.all.contains { $0.key == "screenshot.egress.local" }, "開示文が Facts に無い")

        try? FileManager.default.removeItem(at: dir)
        store.reset()
        VisualContextStore.handoverDirectoryOverride = nil
        if fail.isEmpty {
            print("SCREENSHOT_EGRESS_TRUTH=PASS capture_only_egress=0 gateway_receives_pixels=0 local_vision_provider_egress=0 cloud_vision_provider_disclosed=PASS unasked_screenshot_upload=0 policy=\(VisualEgressPolicy.current)")
            exit(0)
        }
        print("SCREENSHOT_EGRESS_TRUTH=FAIL " + fail.joined(separator: " / ")); exit(2)
    }
}

// MARK: - 実 gateway + 実 worker + 実 Claude Code CLI の E2E（画像の中にしか無い nonce を答えさせる）

extension SelfTest {
    /// `--selftest screenshote2e <base> --email <email> [--out <dir>]`
    ///
    /// 画像の中にしか無い nonce（`ERROR CODE: VX-xxxx`）を描いた PNG を「撮った」ことにし、
    /// 「この画像のエラーコードは？」を実 gateway へ送り、端末の worker が Claude Code CLI で PNG を読んで
    /// 返した答えに nonce が入っているかを機械で確かめる。prompt や file の有無ではなく、**画像を本当に読んだ**ことの証拠。
    /// gateway / worker は `scripts/reality/run-screenshot-e2e.sh` が立てる。
    @MainActor
    static func screenshotE2E(_ args: [String]) {
        func arg(_ name: String) -> String? { args.firstIndex(of: name).flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil } }
        let i = args.firstIndex(of: "--selftest")!
        let base = args.count > i + 2 && !args[i + 2].hasPrefix("--") ? args[i + 2] : "http://127.0.0.1:3399"
        let email = arg("--email") ?? "screenshot-e2e@astra.local"
        let outDir = arg("--out") ?? "/tmp/astra-screenshot-e2e"
        try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        guard AstraCoreBridge.reachable(base) else { print("SCREENSHOT_E2E=SKIP gateway unreachable at \(base)"); exit(0) }

        // 画像の中にしか無い nonce。
        let nonce = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(6)).uppercased()
        let code = "VX-\(nonce)"
        let shotDir = FileManager.default.temporaryDirectory.appendingPathComponent("astra-e2e-shots-\(getpid())", isDirectory: true)
        try? FileManager.default.createDirectory(at: shotDir, withIntermediateDirectories: true)
        let shot = shotDir.appendingPathComponent("スクリーンショット 2026-09-07 e2e.png")
        let img = NSImage(size: NSSize(width: 900, height: 420))
        img.lockFocus()
        NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 900, height: 420).fill()
        let lines = ["ASTRA VISUAL TEST", "ERROR CODE: \(code)", "Button: Retry upload"]
        for (n, line) in lines.enumerated() {
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 44), .foregroundColor: NSColor.black]
            (line as NSString).draw(at: NSPoint(x: 40, y: 320 - CGFloat(n) * 110), withAttributes: attrs)
        }
        img.unlockFocus()
        try? NSBitmapImageRep(data: img.tiffRepresentation!)!.representation(using: .png, properties: [:])!.write(to: shot)
        try? FileManager.default.copyItem(at: shot, to: URL(fileURLWithPath: "\(outDir)/fixture.png"))

        let store = VisualContextStore.shared
        let svc = ScreenshotDetectionService.shared
        store.reset()
        func handoverFiles() -> [String] { ((try? FileManager.default.contentsOfDirectory(atPath: VisualContextStore.handoverDirectory.path)) ?? []).filter { $0.hasSuffix(".png") } }
        let handoverBefore = handoverFiles().count
        svc.ingestFile(url: shot, dir: shotDir)
        guard store.recent.count == 1 else { print("SCREENSHOT_E2E=FAIL fixture not ingested"); exit(2) }
        // 撮っただけでは受け渡し場所に増えない。
        guard handoverFiles().count == handoverBefore, store.attachCount == 0 else { print("SCREENSHOT_E2E=FAIL capture-only egress"); exit(2) }

        do {
            let tokens = try AstraCoreBridge.devSignIn(base, email: email, displayName: "E2E")
            let conv = try AstraCoreBridge.startConversation(base, accessToken: tokens.accessToken)
            store.bind(conversationID: conv)
            let question = "この画像のエラーコードは？ コードだけを答えて"
            let resolved = VisualReferenceResolver.resolve(text: question, recent: store.recent).images
            guard resolved.count == 1 else { print("SCREENSHOT_E2E=FAIL 「この画像」が解けない"); exit(2) }
            let attachments = store.attach(resolved)
            guard attachments.count == 1, handoverFiles().count == handoverBefore + 1 else { print("SCREENSHOT_E2E=FAIL attach"); exit(2) }
            print("SCREENSHOT_E2E attach id=\(attachments[0].id) handover=\(VisualContextStore.handoverDirectory.path)")
            let t0 = Date()
            let outcome = try AstraCoreBridge.sendTurn(base, accessToken: tokens.accessToken, conversationId: conv, text: question, attachments: attachments)
            print("SCREENSHOT_E2E turn task=\(outcome.taskId) clarification=\(outcome.needsClarification) notice=\(outcome.notice)")
            guard !outcome.needsClarification else { print("SCREENSHOT_E2E=FAIL gateway asked back: \(outcome.answer)"); exit(2) }
            guard !outcome.taskId.isEmpty else { print("SCREENSHOT_E2E=FAIL no task started: \(outcome.notice)"); exit(2) }
            let reply = try VoiceHUDState.followUp(outcome, base: base, token: tokens.accessToken, waitMs: 300_000)
            let secs = Int(Date().timeIntervalSince(t0))
            let preview = reply.text.replacingOccurrences(of: "\n", with: " ").prefix(160)
            try? reply.text.write(toFile: "\(outDir)/answer.txt", atomically: true, encoding: .utf8)
            store.markRecent(resolved)
            store.reset()
            try? FileManager.default.removeItem(at: shotDir)
            if reply.settled, reply.text.uppercased().contains(code) {
                print("SCREENSHOT_E2E=PASS nonce=\(code) task=\(outcome.taskId) \(secs)s answer=\"\(preview)\"")
                exit(0)
            }
            print("SCREENSHOT_E2E=FAIL nonce=\(code) settled=\(reply.settled) \(secs)s answer=\"\(preview)\"")
            exit(2)
        } catch {
            print("SCREENSHOT_E2E=FAIL error=\(error)"); exit(3)
        }
    }
}


// MARK: - Atlas: screenshot.detected / screenshot.attached-cloud（`--selftest screenshotshots <outDir> [dark]`）

extension SelfTest {
    /// Dock の 2 面を RC に描かせて撮る。窓は Dock 1 枚だけ。
    ///   screenshot-detected.png        認識した一瞬（〜1 秒）の「スクリーンショットを認識しました」
    ///   screenshot-chip.png            その後の compact な出所「スクリーンショット · たった今」
    ///   screenshot-attached-cloud.png  質問で添えたあと（初回）「質問したときだけ Claude に送信」
    ///   screenshot-attached-compact.png 2 回目以降「Claude に送信」
    @MainActor
    static func screenshotShots(_ args: [String]) {
        let i = args.firstIndex(of: "--selftest")!
        let outDir = args.count > i + 2 ? args[i + 2] : "/tmp/astra-screenshot-shots"
        let dark = args.count > i + 3 && args[i + 3] == "dark"
        try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        NSApp.setActivationPolicy(.regular)
        NSApp.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        func settle(_ s: Double) { let u = Date().addingTimeInterval(s); while Date() < u { CFRunLoopRunInMode(.defaultMode, 0.05, true) } }
        var report: [String] = []
        func shoot(_ name: String) {
            // 大きさは showVoiceHUD が状態から直に置く（dock8 と同じ作法。animator は selftest の run loop では進まない）。
            WindowCoordinator.shared.showVoiceHUD(); settle(0.45)
            guard let win = NSApp.windows.first(where: { $0.isVisible && $0.frame.width > 100 }),
                  let cg = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(win.windowNumber), [.boundsIgnoreFraming, .bestResolution]),
                  let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else { report.append("\(name) MISSING"); return }
            try? png.write(to: URL(fileURLWithPath: "\(outDir)/\(name).png"))
            let want = AstraStateStore.shared.dock.size()
            report.append("\(name) \(Int(win.frame.width))x\(Int(win.frame.height)) want=\(Int(want.width))x\(Int(want.height)) dock=\(AstraStateStore.shared.dock) headless=\(WindowCoordinator.headless)")
        }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("astra-scshots-\(getpid())", isDirectory: true)
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        VisualContextStore.handoverDirectoryOverride = tmp.appendingPathComponent("handover", isDirectory: true)
        VisualContextStore.disclosedOverride = false
        let store = VisualContextStore.shared
        store.reset(); store.bind(conversationID: "atlas")
        WindowCoordinator.shared.showVoiceHUD(); settle(0.5)

        // 撮った絵らしい fixture（窓のタイトルバー + 文の行 + ボタン）。無地だと chip の縮小が「空の四角」に見える。
        let img = NSImage(size: NSSize(width: 800, height: 500))
        img.lockFocus()
        NSColor(calibratedWhite: 0.97, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: 800, height: 500).fill()
        NSColor(calibratedWhite: 0.86, alpha: 1).setFill(); NSRect(x: 0, y: 452, width: 800, height: 48).fill()
        // 固定の RGB で描く。system 色は外観（light / dark）で値が変わり、fixed の面（light == dark）が割れる（実測）。
        let lights: [(CGFloat, CGFloat, CGFloat)] = [(1.0, 0.38, 0.35), (1.0, 0.74, 0.18), (0.16, 0.78, 0.30)]
        for (i, c) in lights.enumerated() {
            NSColor(calibratedRed: c.0, green: c.1, blue: c.2, alpha: 1).setFill()
            NSBezierPath(ovalIn: NSRect(x: 16 + CGFloat(i) * 20, y: 470, width: 12, height: 12)).fill()
        }
        NSColor(calibratedWhite: 0.30, alpha: 1).setFill()
        for (i, w) in [520, 610, 440, 580, 360].enumerated() { NSRect(x: 60, y: 380 - CGFloat(i) * 46, width: CGFloat(w), height: 14).fill() }
        NSColor(calibratedRed: 0.0, green: 0.48, blue: 1.0, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 60, y: 90, width: 160, height: 40), xRadius: 8, yRadius: 8).fill()
        img.unlockFocus()
        let url = tmp.appendingPathComponent("スクリーンショット 2026-09-07 atlas.png")
        try? NSBitmapImageRep(data: img.tiffRepresentation!)!.representation(using: .png, properties: [:])!.write(to: url)
        // 1) 認識の一瞬（トーストは 1 秒。撮り終わるまで justCaptured を留める）
        store.ingest(url: url, kind: .screenshot, confidence: 0.95, pixelSize: CGSize(width: 800, height: 500), capturedAt: Date(), app: "Figma", window: nil)
        shoot("screenshot-detected")
        // 2) その後の chip
        store.justCaptured = nil
        shoot("screenshot-chip")
        // 3) 質問で添えたあと（初回: 明示）
        _ = store.attach(store.recent)
        shoot("screenshot-attached-cloud")
        // 4) 2 回目以降（compact）
        _ = store.attach(store.recent)
        shoot("screenshot-attached-compact")

        store.reset(); VisualContextStore.disclosedOverride = nil; VisualContextStore.handoverDirectoryOverride = nil
        try? FileManager.default.removeItem(at: tmp)
        print("SELFTEST_OK screenshotshots: " + report.joined(separator: ", "))
        exit(0)
    }
}

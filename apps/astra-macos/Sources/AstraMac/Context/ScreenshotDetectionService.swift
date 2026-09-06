import AppKit
import Foundation

/// スクショ保存先とクリップボードを軽く監視し、撮った瞬間を `VisualContextStore` に流す。
///
///   ScreenshotDetectionService
///    ├─ ScreenshotFolderWatcher   （DispatchSource で即時。FSEvents の数秒遅延を避ける）
///    ├─ ClipboardImageWatcher     （changeCount を軽量に polling）
///    ├─ ScreenshotClassifier      （ファイル名だけで決めない）
///    └─ VisualContextStore        （現在の会話へ紐付け・外部へは出さない）

// MARK: - フォルダ監視

final class ScreenshotFolderWatcher {
    private var source: DispatchSourceFileSystemObject?
    private var fd: Int32 = -1
    private let queue = DispatchQueue(label: "astra.screenshot.watch", qos: .userInitiated)
    private let onChange: (URL) -> Void
    private var directory: URL?

    init(onChange: @escaping (URL) -> Void) { self.onChange = onChange }

    func start(directory: URL) {
        stop()
        self.directory = directory
        fd = open(directory.path, O_EVTONLY)
        guard fd >= 0 else { return }
        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd, eventMask: [.write, .extend, .rename], queue: queue)
        src.setEventHandler { [weak self] in
            guard let self, let dir = self.directory else { return }
            self.onChange(dir)
        }
        src.setCancelHandler { [fd] in close(fd) }
        src.resume()
        source = src
    }

    func stop() {
        source?.cancel(); source = nil; fd = -1
    }
}

// MARK: - クリップボード監視

final class ClipboardImageWatcher {
    private var lastChangeCount = NSPasteboard.general.changeCount
    private var timer: Timer?
    private let onImage: (NSImage) -> Void

    init(onImage: @escaping (NSImage) -> Void) { self.onImage = onImage }

    func start() {
        lastChangeCount = NSPasteboard.general.changeCount
        // 0.4s 間隔。クリップボードは軽く見るだけ（CPU をほぼ使わない）。
        let t = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }
    func stop() { timer?.invalidate(); timer = nil }

    func poll() {
        let board = NSPasteboard.general
        guard board.changeCount != lastChangeCount else { return }
        lastChangeCount = board.changeCount
        guard board.canReadObject(forClasses: [NSImage.self], options: nil),
              let img = board.readObjects(forClasses: [NSImage.self], options: nil)?.first as? NSImage
        else { return }
        onImage(img)
    }
}

// MARK: - オーケストレータ

@MainActor
final class ScreenshotDetectionService {
    static let shared = ScreenshotDetectionService()

    private var folderWatcher: ScreenshotFolderWatcher?
    private let clipboard = ClipboardImageWatcherHolder()
    private var knownBefore: Set<String> = []
    private var running = false

    /// 起動時に呼ぶ。保存先を監視し、クリップボード画像も拾う。
    /// `directory` は検査用（実運用は設定された保存先）。
    func start(directory: URL? = nil) {
        guard !running else { return }
        running = true
        // 起動時の掃除: 前回の受け渡し写し（30 分 / 20 件 / 200MB を超えたもの）を消す。
        HandoverCache.cleanup(directory: VisualContextStore.handoverDirectory)
        let dir = directory ?? ScreenshotClassifier.screenshotDirectory()
        knownBefore = Self.imageNames(in: dir)   // 既存ファイルは「新規」に数えない
        let watcher = ScreenshotFolderWatcher { [weak self] dir in
            // watcher は専用 queue。ストアは main で触る。
            Task { @MainActor in self?.scanFolder(dir) }
        }
        watcher.start(directory: dir)
        folderWatcher = watcher
        clipboard.watcher = ClipboardImageWatcher { [weak self] img in
            Task { @MainActor in self?.ingestClipboard(img) }
        }
        clipboard.watcher?.start()
    }

    func stop() {
        folderWatcher?.stop(); folderWatcher = nil
        clipboard.watcher?.stop(); clipboard.watcher = nil
        running = false
    }

    private static func imageNames(in dir: URL) -> Set<String> {
        let items = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        // 隠しファイル（書き込み途中の一時名など）は拾わない。
        return Set(items.filter { !$0.hasPrefix(".") && ScreenshotClassifier.imageExts.contains(($0 as NSString).pathExtension.lowercased()) })
    }

    /// フォルダに来た変化を見て、直近数秒の新しい画像だけを拾う。
    func scanFolder(_ dir: URL) {
        let now = Set(Self.imageNames(in: dir))
        let added = now.subtracting(knownBefore)
        knownBefore = now
        for name in added {
            let url = dir.appendingPathComponent(name)
            // 書き込み途中を読まない。サイズが安定してから取り込む。
            waitStableThenIngest(url: url, dir: dir)
        }
    }

    /// size(t0) と 50ms 後の size(t1) が同じになったら「安定」とみなして読む。
    /// 安定していても**画像として読めなければ**まだ途中（PNG の末尾が来ていない）。
    /// フォルダの監視は中身の追記では鳴らないので、ここで読めるまで待ち直す（最大 ~2s）。
    private func waitStableThenIngest(url: URL, dir: URL, attempt: Int = 0) {
        let s0 = fileSize(url)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            guard let self else { return }
            let s1 = self.fileSize(url)
            if s0 == s1 && s1 > 0 && self.ingestFile(url: url, dir: dir) { return }
            if attempt < 40 { self.waitStableThenIngest(url: url, dir: dir, attempt: attempt + 1) }
        }
    }

    private func fileSize(_ url: URL) -> Int {
        ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int) ?? -1
    }

    /// ファイルを分類して、確度が高ければ会話コンテキストに登録する。**ここでは外部へ出さない。**
    /// 戻り値は「画像として読めたか」（登録したか、または既に登録済みで二重を弾いたか）。
    /// 読めなければ false で、呼び出し側が待ち直す。
    @discardableResult
    func ingestFile(url: URL, dir: URL, now: Date = Date()) -> Bool {
        let inDir = url.deletingLastPathComponent().standardizedFileURL == dir.standardizedFileURL
        let (conf, size, created) = ScreenshotClassifier.confidence(url: url, inScreenshotDir: inDir, now: now)
        guard size.width > 0 else { return false }     // まだ読めない（途中・壊れている・小さすぎる）
        guard conf >= 0.8 else { return true }         // 読めたがスクショらしくない: 待ち直さない
        let front = NSWorkspace.shared.frontmostApplication?.localizedName
        VisualContextStore.shared.ingest(
            url: url, kind: .screenshot, confidence: conf, pixelSize: size,
            capturedAt: created, app: front, window: nil, now: now)
        return true
    }

    /// クリップボードの画像。確実にスクショとは限らないので kind を分ける（体験は同じ）。
    func ingestClipboard(_ img: NSImage, now: Date = Date()) {
        guard let tiff = img.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { return }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("astra-clipboard", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("clip-\(Int(now.timeIntervalSince1970 * 1000)).png")
        guard (try? png.write(to: url)) != nil else { return }
        let size = CGSize(width: rep.pixelsWide, height: rep.pixelsHigh)
        guard size.width >= 64, size.height >= 64 else { return }   // アイコン等は拾わない
        let front = NSWorkspace.shared.frontmostApplication?.localizedName
        VisualContextStore.shared.ingest(
            url: url, kind: .clipboardImage, confidence: 0.8, pixelSize: size,
            capturedAt: now, app: front, window: nil, now: now)
    }
}

/// Sendable でない watcher を @MainActor の外に置くための薄い箱。
final class ClipboardImageWatcherHolder { var watcher: ClipboardImageWatcher? }

import AppKit
import Foundation

/// スクショを撮った瞬間に、それを**直近の会話コンテキスト**として自動で持つ。
///
/// 体験は「⌘⇧4 で撮る → 『これ何？』」だけ。保存先を開く・ドラッグ・貼り付け・添付はゼロ。
/// 撮っただけでは外部へ出さない（`AVAILABLE_AS_CONTEXT` まで）。利用者が参照表現で尋ねた瞬間だけ
/// 推論対象になる（`ATTACHED_TO_TURN`）。検知後に**新しいチャットは作らない**——現在の会話に紐付ける。
///
/// 関連: [[astra-device-boundary]]（鍵も画像も端末から勝手に出さない）。

// MARK: - 種類と状態機械

enum VisualKind: String, Equatable {
    case screenshot          // スクショ保存先に書かれた画像
    case clipboardImage      // ⌃⌘⇧4 等でクリップボードへ来た画像（確実にスクショとは限らない）
}

/// IDLE → CANDIDATE → VALIDATED → AVAILABLE_AS_CONTEXT → ATTACHED_TO_TURN → RECENT_CONTEXT → EXPIRED
enum VisualContextState: String, Equatable {
    case candidate           // ファイルができた（まだ書き込み中かもしれない）
    case validated           // サイズが安定し、画像として読める
    case available           // 会話に紐付いた。まだ外部へ出していない
    case attached            // 利用者の質問に添付された（このときだけ推論対象）
    case recent              // 応答が終わった。しばらくは「さっきの」で呼べる
    case expired             // TTL 切れ
}

/// スクショ 1 枚。**出所を持つ**（どのアプリ・どのウィンドウか、取れれば）。
struct VisualContextArtifact: Identifiable, Equatable {
    let id: UUID
    var conversationID: String?
    let imageURL: URL
    let capturedAt: Date
    var sourceApp: String?
    var sourceWindow: String?
    let pixelSize: CGSize
    let confidence: Double
    var kind: VisualKind
    var state: VisualContextState

    /// 「たった今」「1 分前」。UI の chip に出す。
    func ageLabel(_ now: Date = Date()) -> String {
        let s = Int(now.timeIntervalSince(capturedAt))
        if s < 3 { return "たった今" }
        if s < 60 { return "\(s) 秒前" }
        return "\(s / 60) 分前"
    }
}

// MARK: - 分類（ファイル名だけで決めない）

/// スクショらしさを複数条件でスコア化する。ファイル名は**弱い証拠**にしか使わない
/// （OS 言語や設定で名前が変わっても壊れないように）。誤検知しても外部へは出さないので安全側に広く拾う。
enum ScreenshotClassifier {
    /// 設定されたスクショ保存先（`com.apple.screencapture` の location）。無ければデスクトップ。
    static func screenshotDirectory() -> URL {
        if let path = UserDefaults(suiteName: "com.apple.screencapture")?.string(forKey: "location"),
           !path.isEmpty {
            return URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        }
        return FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask)[0]
    }

    static let imageExts: Set<String> = ["png", "jpg", "jpeg", "heic"]

    /// P(screenshot | file)。0..1。
    /// **前提（ハードゲート）**: 読める画像で寸法が妥当（>= 64px）であること。
    /// 0 バイト・壊れたファイル・アイコンは、ファイル名が何であっても拾わない
    /// （名前は弱い証拠であって、それだけで拾わせない）。
    static func confidence(url: URL, inScreenshotDir: Bool, now: Date = Date()) -> (Double, CGSize, Date) {
        let ext = url.pathExtension.lowercased()
        guard imageExts.contains(ext) else { return (0, .zero, now) }
        // 前提: 実際に読める画像で、寸法が妥当。満たさなければ確度 0。
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? CGFloat,
              let h = props[kCGImagePropertyPixelHeight] as? CGFloat,
              w >= 64, h >= 64 else { return (0, .zero, now) }
        let size = CGSize(width: w, height: h)

        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let created = (attrs?[.creationDate] as? Date) ?? (attrs?[.modificationDate] as? Date) ?? now
        var score = 0.4   // 読める妥当な画像（前提を満たした）
        if now.timeIntervalSince(created) <= 2.0 { score += 0.25 }   // 直近 2 秒
        if inScreenshotDir { score += 0.25 }                          // 保存先に作られた
        // ファイル名の慣例は**弱い証拠**だけ（単独では 0.8 に届かせない）。
        let name = url.lastPathComponent.lowercased()
        if name.contains("screenshot") || name.hasPrefix("スクリーンショット") || name.hasPrefix("cleanshot") {
            score += 0.10
        }
        return (min(1.0, score), size, created)
    }
}

// MARK: - ストア（現在の会話に紐付く）

/// 撮ったスクショの直近リスト。**新しいチャットは作らない**——`bind(conversationID:)` で今の会話に付ける。
@MainActor
final class VisualContextStore: ObservableObject {
    static let shared = VisualContextStore()

    /// 新しい順。UI と resolver が読む。
    @Published private(set) var recent: [VisualContextArtifact] = []
    /// Dock の一瞬のトースト用（撮った直後だけ true、数秒で下げる）。
    @Published var justCaptured: VisualContextArtifact?

    /// 会話に紐付ける前の待ち（会話がまだ無いときも捨てない）。
    private var conversationID: String?
    /// 二重取り込みを防ぐ（path#size を鍵に）。
    private var ingestedKeys: Set<String> = []
    /// 連続撮影を 1 group にまとめる窓（0〜15 秒）。
    static let groupWindow: TimeInterval = 15
    /// RECENT のまま「さっき」で呼べる寿命。
    static let ttl: TimeInterval = 10 * 60
    private var toastTimer: Timer?

    func bind(conversationID: String?) {
        self.conversationID = conversationID
        for i in recent.indices where recent[i].conversationID == nil {
            recent[i].conversationID = conversationID
        }
    }

    /// 検知が拾った 1 枚を登録する。二重・期限切れを弾き、現在の会話へ付ける。**ここでは外部へ出さない。**
    @discardableResult
    func ingest(url: URL, kind: VisualKind, confidence: Double, pixelSize: CGSize,
                capturedAt: Date, app: String?, window: String?, now: Date = Date()) -> VisualContextArtifact? {
        let key = "\(url.standardizedFileURL.path)#\(Int(pixelSize.width))x\(Int(pixelSize.height))"
        guard !ingestedKeys.contains(key) else { return nil }   // 同じ画像を 2 回拾わない
        ingestedKeys.insert(key)
        var art = VisualContextArtifact(
            id: UUID(), conversationID: conversationID, imageURL: url, capturedAt: capturedAt,
            sourceApp: app, sourceWindow: window, pixelSize: pixelSize, confidence: confidence,
            kind: kind, state: .available)
        purgeExpired(now: now)
        recent.insert(art, at: 0)
        if recent.count > 20 { recent.removeLast(recent.count - 20) }
        // 一瞬のトースト。窓は作らない・focus は奪わない（UI 側で chip として描くだけ）。
        justCaptured = art
        WindowCoordinator.shared.syncDockPanels()   // idle Dock を横広トーストへ
        toastTimer?.invalidate()
        toastTimer = Timer.scheduledTimer(withTimeInterval: 2.2, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.justCaptured = nil; WindowCoordinator.shared.syncDockPanels() }
        }
        art.state = .available
        return art
    }

    /// TTL 切れを落とす。
    func purgeExpired(now: Date = Date()) {
        recent.removeAll { now.timeIntervalSince($0.capturedAt) > Self.ttl }
    }

    /// 直近の連続撮影グループ（0〜15 秒以内に固まって撮ったもの、新しい順）。
    func latestGroup(now: Date = Date()) -> [VisualContextArtifact] {
        var group: [VisualContextArtifact] = []
        var prev: Date?
        for a in recent {
            if let p = prev, p.timeIntervalSince(a.capturedAt) > Self.groupWindow { break }
            group.append(a); prev = a.capturedAt
        }
        return group
    }

    /// 質問に添付する（このときだけ推論対象）。添付したものは attached に印す。
    func markAttached(_ arts: [VisualContextArtifact]) {
        let ids = Set(arts.map(\.id))
        for i in recent.indices where ids.contains(recent[i].id) { recent[i].state = .attached }
    }

    /// コンテキストから外す（≤1 操作）。
    func remove(_ id: UUID) { recent.removeAll { $0.id == id } }

    /// 検査・リセット用。
    func reset() { recent = []; ingestedKeys = []; justCaptured = nil; conversationID = nil }
}

// MARK: - 参照表現の解決

/// 「これ」「さっき」「この 2 枚」などを、直近スクショの具体的な集合に変える。
enum VisualReferenceResolver {
    /// 単数の参照表現（→ 最新 1 枚）。
    static let singular = ["これ", "ここ", "この画面", "このエラー", "この写真", "この画像",
                           "今の", "いまの", "さっき", "さっきの", "先ほど", "スクショ",
                           "スクリーンショット", "画像を", "画面を"]
    /// 参照表現かどうか（画像の有無に依らず、文だけで判定）。
    static func isReferential(_ text: String) -> Bool {
        mentionsAny(text, singular) || wantsTwo(text) || wantsThree(text) || wantsPrevAndNow(text)
    }

    private static func mentionsAny(_ text: String, _ words: [String]) -> Bool {
        words.contains { text.contains($0) }
    }
    private static func wantsTwo(_ t: String) -> Bool { t.contains("2枚") || t.contains("２枚") || t.contains("二枚") || t.contains("両方") }
    private static func wantsThree(_ t: String) -> Bool { t.contains("3枚") || t.contains("３枚") || t.contains("三枚") }
    private static func wantsPrevAndNow(_ t: String) -> Bool {
        (t.contains("さっきの") && t.contains("今の")) || (t.contains("前の") && t.contains("今")) || t.contains("さっきのと今")
    }

    struct Resolution { let images: [VisualContextArtifact]; let referential: [VisualContextArtifact] }

    /// 参照表現に対応する画像集合。新しい順。参照でなければ空。
    static func resolve(text: String, recent: [VisualContextArtifact]) -> Resolution {
        guard !recent.isEmpty else { return Resolution(images: [], referential: []) }
        let sorted = recent.sorted { $0.capturedAt > $1.capturedAt }
        if wantsPrevAndNow(text), sorted.count >= 2 {
            return Resolution(images: [sorted[1], sorted[0]], referential: [sorted[1], sorted[0]])
        }
        if wantsThree(text) { let g = Array(sorted.prefix(3)); return Resolution(images: g, referential: g) }
        if wantsTwo(text) { let g = Array(sorted.prefix(2)); return Resolution(images: g, referential: g) }
        if mentionsAny(text, singular) { return Resolution(images: [sorted[0]], referential: [sorted[0]]) }
        return Resolution(images: [], referential: [])
    }
}

import AppKit
import Foundation

/// Journey 1 本ぶんの実測。
///
/// これまでの視覚ゲート（2pt / golden / density）は「崩れていないこと」しか言えない。
/// 同じ Panel で、上辺 0px ずれで、±2pt に収まっていても、**使いにくい製品は作れる**。
/// 優劣は、同じ課題を与えたときの**完遂・所要時間・操作数・邪魔の量**で決める。
///
/// ここが測るのは Astra だけ。競合は人が撮る（このプロセスからは動かせない）。
/// 競合の数字が無いまま「勝った」と言わないことは `ux-benchmark-report` 側の責任。
@MainActor
final class JourneyRecorder {
    struct Step: Codable {
        let name: String
        /// この段が終わるまで（ms）。
        let ms: Int
        /// この段で増えた操作の数（クリック・キー）。
        let interactions: Int
        let note: String?
    }

    struct Result: Codable {
        let journey: String
        let product: String
        let startedAt: String
        /// 完遂したか。**測れたこと**と混同しない。
        var success: Bool
        /// 開始から完遂まで（ms）。
        var totalMs: Int
        var interactions: Int
        /// 増えた窓の数。0 が正。
        var windowsOpened: Int
        /// 前面のアプリを奪った回数。0 が正。
        var focusTheft: Int
        var errors: [String]
        var steps: [Step]
        /// 撮ったもの（画像・動画）の相対パス。
        var artifacts: [String]
        /// 測れなかったもの。**空欄と 0 を区別する**ため、理由を残す。
        var notMeasured: [String]
    }

    private let journey: String
    private let outDir: String
    private var started = Date()
    private var stepStart = Date()
    private var baselineWindows = 0
    private var frontBundleId: String?
    private var result: Result

    init(journey: String, outDir: String) {
        self.journey = journey
        self.outDir = outDir
        try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        let f = ISO8601DateFormatter()
        result = Result(journey: journey, product: "Astra",
                        startedAt: f.string(from: Date()),
                        success: false, totalMs: 0, interactions: 0,
                        windowsOpened: 0, focusTheft: 0, errors: [],
                        steps: [], artifacts: [], notMeasured: [])
    }

    /// 測り始める。ここで窓の数と前面アプリを控えておく。
    func begin() {
        started = Date()
        stepStart = started
        baselineWindows = NSApp.windows.filter(\.isVisible).count
        frontBundleId = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
    }

    /// 1 段終わったところで呼ぶ。窓が増えていないか・前面を奪っていないかも見る。
    ///
    /// `opensWindow` は「この段では窓が増えて当然」という宣言。会議の面を開くなど、
    /// 利用者が頼んだ結果として増えるものまで違反に数えると、数字が意味を失う。
    /// 宣言しないまま増えたものだけを数える。
    func step(_ name: String, interactions: Int = 0, note: String? = nil,
              opensWindow: Bool = false) {
        let now = Date()
        result.steps.append(Step(
            name: name,
            ms: Int(now.timeIntervalSince(stepStart) * 1000),
            interactions: interactions,
            note: note))
        result.interactions += interactions
        stepStart = now

        let visible = NSApp.windows.filter(\.isVisible).count
        if visible > baselineWindows {
            if !opensWindow { result.windowsOpened += visible - baselineWindows }
            baselineWindows = visible
        }
        if let want = frontBundleId,
           NSWorkspace.shared.frontmostApplication?.bundleIdentifier != want {
            result.focusTheft += 1
        }
    }

    func error(_ message: String) { result.errors.append(message) }

    /// 測れなかったものは、0 ではなく**測れなかったと言う**。
    func cannotMeasure(_ what: String) { result.notMeasured.append(what) }

    /// いまの画面を 1 枚撮る。
    @discardableResult
    func shot(_ name: String) -> Bool {
        let path = "\(outDir)/\(name).png"
        guard let win = NSApp.windows.first(where: { $0.isVisible }),
              let cg = CGWindowListCreateImage(
                .null, .optionIncludingWindow, CGWindowID(win.windowNumber),
                [.boundsIgnoreFraming, .bestResolution]),
              let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
        else { return false }
        try? png.write(to: URL(fileURLWithPath: path))
        result.artifacts.append("\(name).png")
        return true
    }

    func finish(success: Bool) {
        result.success = success
        result.totalMs = Int(Date().timeIntervalSince(started) * 1000)
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(result) {
            try? data.write(to: URL(fileURLWithPath: "\(outDir)/result.json"))
        }
        print("JOURNEY \(journey) success=\(success) ms=\(result.totalMs) "
            + "interactions=\(result.interactions) windows=\(result.windowsOpened) "
            + "focusTheft=\(result.focusTheft) errors=\(result.errors.count)")
    }
}

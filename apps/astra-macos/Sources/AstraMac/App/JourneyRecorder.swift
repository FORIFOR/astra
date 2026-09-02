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
    /// 画面に出ている自分の窓 1 つ（層 A: 面の座標と寸法）。
    struct WindowFact: Codable, Equatable {
        let x: Int, y: Int, w: Int, h: Int
        /// key（鍵の入力を受ける窓）か。
        let key: Bool
    }

    struct Step: Codable {
        let name: String
        /// この段が終わるまで（ms）。`settle` の待ちを含むので遅延の指標ではない。
        let ms: Int
        /// この段で増えた操作の数（クリック・キー）。
        let interactions: Int
        let note: String?
        /// この段で見えている自分の窓の数（絶対値。差分ではない）。
        var windows: Int = 0
        /// 自分の窓のどれかが key か。
        var keyWindow: Bool = false
        /// 前面のアプリ。
        var front: String?
        /// いちばん大きい窓の座標と寸法（pt）。面の連続性はこれで見る。
        var surface: WindowFact?
        /// 状態を変えてから窓の寸法が落ち着くまで（ms）。測った段だけ持つ。
        var transitionMs: Int?
        /// 鍵を押した結果。"esc": "listening→idle" のように、何が起きたかを書く。
        var keys: [String: String]?
        /// この段で見えた出所 id。"dock": "meeting-1", "db": "meeting-1" のように。
        var ids: [String: String]?
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
        /// 層 C（未検証の代理）と、直さないと決めた観察。**失敗には数えない。**
        var observations: [String] = []
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
              opensWindow: Bool = false, transitionMs: Int? = nil,
              keys: [String: String]? = nil, ids: [String: String]? = nil,
              surface: NSWindow? = nil) {
        let now = Date()
        let visible = NSApp.windows.filter(\.isVisible).count
        var s = Step(
            name: name,
            ms: Int(now.timeIntervalSince(stepStart) * 1000),
            interactions: interactions,
            note: note)
        s.windows = visible
        s.keyWindow = NSApp.keyWindow != nil
        s.front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        s.surface = (surface ?? Self.largestWindow()).map(Self.fact)
        s.transitionMs = transitionMs
        s.keys = keys
        s.ids = ids
        result.steps.append(s)
        result.interactions += interactions
        stepStart = now

        if visible > baselineWindows {
            if !opensWindow { result.windowsOpened += visible - baselineWindows }
            baselineWindows = visible
        }
        // 頼まれて開いた窓が前に来るのは奪ったのではない。以後はそれを基準にする。
        if opensWindow {
            frontBundleId = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        } else if let want = frontBundleId,
                  NSWorkspace.shared.frontmostApplication?.bundleIdentifier != want {
            result.focusTheft += 1
        }
    }

    func error(_ message: String) { result.errors.append(message) }
    /// ここまでの失敗（Journey の最後に成否を決めるため）。
    var errors: [String] { result.errors }
    var windowsOpened: Int { result.windowsOpened }

    // MARK: - 層 A の測り方

    static func fact(_ w: NSWindow) -> WindowFact {
        let f = w.frame
        return WindowFact(x: Int(f.minX), y: Int(f.minY), w: Int(f.width), h: Int(f.height),
                          key: w.isKeyWindow)
    }

    static func largestWindow() -> NSWindow? {
        NSApp.windows.filter(\.isVisible)
            .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
    }

    /// Dock（画面上端の常駐 panel）。level で見分ける。
    static func dockWindow() -> NSWindow? {
        NSApp.windows.first { $0.isVisible && $0.level == .statusBar }
    }

    /// 状態を変えてから、自分の窓の枠が落ち着くまでの時間（ms）。
    ///
    /// 8ms ごとに全窓の枠を見て、120ms 変わらなければ落ち着いたとみなす。
    /// 返すのは**最後に枠が動いた時刻**まで。待ちの 120ms は含めない。上限 2.5 秒。
    func transition(_ run: () -> Void) -> Int {
        func frames() -> [CGRect] { NSApp.windows.filter(\.isVisible).map(\.frame) }
        let t0 = Date()
        var last = frames()
        var lastChange = t0
        run()
        while Date().timeIntervalSince(t0) < 2.5 {
            CFRunLoopRunInMode(.defaultMode, 0.008, true)
            let now = frames()
            if now != last { last = now; lastChange = Date() }
            else if Date().timeIntervalSince(lastChange) > 0.12 { break }
        }
        return Int(lastChange.timeIntervalSince(t0) * 1000)
    }

    /// 鍵を 1 つ押す。窓を key にしてから送る（key でない窓は鍵を受けない）。
    ///
    /// 何が起きたかは呼び出し側が状態で見る。ここは押しただけ。
    static func press(_ keyCode: UInt16, _ chars: String, mods: NSEvent.ModifierFlags = [],
                      in window: NSWindow) {
        window.makeKey()
        let t = ProcessInfo.processInfo.systemUptime
        guard let down = NSEvent.keyEvent(
                with: .keyDown, location: .zero, modifierFlags: mods, timestamp: t,
                windowNumber: window.windowNumber, context: nil,
                characters: chars, charactersIgnoringModifiers: chars,
                isARepeat: false, keyCode: keyCode),
              let up = NSEvent.keyEvent(
                with: .keyUp, location: .zero, modifierFlags: mods, timestamp: t + 0.01,
                windowNumber: window.windowNumber, context: nil,
                characters: chars, charactersIgnoringModifiers: chars,
                isARepeat: false, keyCode: keyCode)
        else { return }
        NSApp.sendEvent(down)
        NSApp.sendEvent(up)
    }
    static let keyEsc: UInt16 = 53
    static let keyReturn: UInt16 = 36

    /// 測れなかったものは、0 ではなく**測れなかったと言う**。
    func cannotMeasure(_ what: String) { result.notMeasured.append(what) }

    /// 見えたが失敗にはしないもの（層 C、または直さないと決めた観察）。
    func observe(_ what: String) { result.observations.append(what) }

    /// いまの画面を 1 枚撮る。
    ///
    /// **いちばん大きい窓**を撮る。「最初に見つかった窓」にすると、常駐している
    /// Dock（820x76）を撮ってしまい、会議の面を測っているつもりで Dock を
    /// 測っていた（開始直後の白紙を測ろうとして、地 91.9% と出たのがそれ）。
    @discardableResult
    func shot(_ name: String, window: NSWindow? = nil) -> Bool {
        let path = "\(outDir)/\(name).png"
        guard let win = window ?? Self.largestWindow(),
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

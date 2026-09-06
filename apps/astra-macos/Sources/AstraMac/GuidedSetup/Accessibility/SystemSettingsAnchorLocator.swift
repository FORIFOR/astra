import AppKit
import ApplicationServices

/// System Settings（`com.apple.systempreferences`）の中で案内の対象を見つける。
///
/// 固定の絶対座標は使わない。AX 木を写し、複合 selector（日本語 / 英語）で当て、
/// AX 座標を AppKit（対象の画面）へ変換して返す。見つからなければ nil と、探索結果のログ。
final class SystemSettingsAnchorLocator {
    static let bundleID = "com.apple.systempreferences"

    /// 「画面収録とシステムオーディオ録音」の面（サイドバー / 一覧の行）。
    /// 実機（macOS 15 の日本語）では見出しの本文は title ではなく value に入る。
    static let paneTitles = ["画面収録とシステムオーディオ録音", "Screen & System Audio Recording"]
    static let screenCapturePaneSelectors: [AXSelector] = [
        AXSelector(identifier: "Privacy_ScreenCapture"),
        AXSelector(role: kAXStaticTextRole as String, titleAny: paneTitles),
        AXSelector(role: kAXStaticTextRole as String, valueAny: paneTitles),
        AXSelector(role: kAXStaticTextRole as String, titleAny: ["画面収録", "Screen Recording"], titleContains: true),
        AXSelector(role: kAXStaticTextRole as String, valueAny: ["画面収録", "Screen Recording"], valueContains: true),
        AXSelector(descriptionAny: ["画面収録", "Screen Recording", "Screen & System Audio"]),
    ]

    /// Astra 行のスイッチ（オンにしてもらう対象）。
    ///
    /// 実機の System Settings では行のスイッチは **title が空**で、`<アプリ名>_Toggle` という identifier を持つ
    /// （`AXCheckBox` / subrole `AXSwitch`）。名前の静的テキストは `<アプリ名>_Title` で本文は value。
    /// 名前は複数候補（表示名 / バンドル名 / 実行体名）で探す。文字列 1 個に依存しない。
    static func astraRowSelectors(appNames: [String] = ["Astra"]) -> [AXSelector] {
        let names = appNames.filter { !$0.isEmpty }
        return [
            AXSelector(role: kAXCheckBoxRole as String, identifierAny: names.map { "\($0)_Toggle" }),
            AXSelector(role: kAXCheckBoxRole as String, titleAny: names),
            AXSelector(role: "AXSwitch", identifierAny: names.map { "\($0)_Toggle" }),
            AXSelector(role: "AXSwitch", titleAny: names),
            AXSelector(role: kAXCheckBoxRole as String, descriptionAny: names),
            AXSelector(role: kAXStaticTextRole as String, identifierAny: names.map { "\($0)_Title" }),
            AXSelector(role: kAXStaticTextRole as String, valueAny: names),
            AXSelector(role: kAXStaticTextRole as String, titleAny: names),
        ]
    }

    /// 「+」（一覧に Astra が無いときに追加する）ボタン。
    static let addButtonSelectors: [AXSelector] = [
        AXSelector(role: kAXButtonRole as String, descriptionAny: ["追加", "Add"]),
        AXSelector(role: kAXButtonRole as String, titleAny: ["+", "追加", "Add"]),
    ]

    private let tree: AXTreeProviding
    private let screenFrames: () -> [CGRect]
    private let primaryHeight: () -> CGFloat

    init(tree: AXTreeProviding = AXElementService.shared,
         screenFrames: @escaping () -> [CGRect] = { NSScreen.screens.map(\.frame) },
         primaryHeight: @escaping () -> CGFloat = { AXCoordinateConverter.primaryScreenHeight() }) {
        self.tree = tree
        self.screenFrames = screenFrames
        self.primaryHeight = primaryHeight
    }

    /// 探索の結果（見つからなかった理由もログに残す）。
    struct Result {
        var anchor: GuideAnchor?
        var appTree: AXElementSnapshot?
        var reason: String?
    }

    /// target を探す。許可が無い / アプリが無い / 一致しない / 位置が無い、はすべて nil（推測しない）。
    func locate(_ target: GuideTarget, maxDepth: Int = 14, maxNodes: Int = 6000) -> Result {
        guard case let .accessibilityElement(bundleID, selectors) = target else {
            return Result(anchor: nil, appTree: nil, reason: "screenCorner has no AX target")
        }
        guard tree.isTrusted else {
            GuideLog.debug("locate: accessibility not trusted; not walking AX")
            return Result(anchor: nil, appTree: nil, reason: "accessibility not trusted")
        }
        guard let pid = tree.pid(ofBundle: bundleID) else {
            GuideLog.debug("locate: \(bundleID) is not running")
            return Result(anchor: nil, appTree: nil, reason: "\(bundleID) not running")
        }
        guard let app = tree.applicationTree(pid: pid, maxDepth: maxDepth, maxNodes: maxNodes) else {
            GuideLog.debug("locate: no AX tree for pid \(pid)")
            return Result(anchor: nil, appTree: nil, reason: "no AX tree")
        }
        return locate(selectors: selectors, in: app)
    }

    /// 木の中で selectors を当て、AppKit 座標へ変換する。
    func locate(selectors: [AXSelector], in app: AXElementSnapshot) -> Result {
        guard let match = app.find(selectors) else {
            GuideLog.debug("locate: no match in \(app.nodeCount) nodes for \(selectors.count) selectors")
            return Result(anchor: nil, appTree: app, reason: "no match (\(app.nodeCount) nodes)")
        }
        guard let axFrame = match.node.axFrame else {
            GuideLog.debug("locate: matched \(match.node.role ?? "?") '\(match.node.title ?? "")' but it has no frame")
            return Result(anchor: nil, appTree: app, reason: "match has no frame")
        }
        let rect = AXCoordinateConverter.appKitRect(axFrame, primaryScreenHeight: primaryHeight())
        guard AXCoordinateConverter.screenFrame(containing: rect, screenFrames: screenFrames()) != nil else {
            GuideLog.debug("locate: matched rect \(rect) is on no screen")
            return Result(anchor: nil, appTree: app, reason: "match is off screen")
        }
        GuideLog.debug("locate: matched selector #\(match.selectorRank) \(match.node.role ?? "?") '\(match.node.title ?? match.node.axDescription ?? "")' at \(rect)")
        return Result(anchor: GuideAnchor(rect: rect, match: match), appTree: app, reason: nil)
    }
}

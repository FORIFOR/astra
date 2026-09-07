import AppKit
import Foundation

/// Guided Setup のモデル。
///
/// macOS の権限設定のとき、画面右下の Astra アバターが System Settings の操作対象へ
/// 吹き出し・矢印・ハイライトを出し、設定が済んだら OS API で検知して次へ進む。
/// 座標は画像認識や LLM で当てず、**OS API + Accessibility API + 状態機械**で決める。
/// 推測位置には何も出さない（見つからなければ一般ガイドだけ）。

// MARK: - 何を案内するか

/// 案内する権限。順番は `PermissionGuideCoordinator` が決める。
enum GuidePermission: String, CaseIterable, Equatable {
    case accessibility
    case screenCapture
    case microphone
}

/// 吹き出しをどちら側に出すか。
enum GuidePlacement: String, Equatable {
    case above, below, left, right
}

/// 案内の対象。
enum GuideTarget: Equatable {
    /// あるアプリ（bundle id）の AX 要素。selectors は優先順（先に一致したものを使う）。
    case accessibilityElement(bundleID: String, selectors: [AXSelector])
    /// 画面の隅（アバターの脇）。AX に頼らない一般ガイド。
    case screenCorner
}

/// この手順が終わったと見なす条件。**権限は OS API で確かめる。**
enum CompletionCondition: Equatable {
    case accessibilityGranted
    case screenCaptureGranted
    case microphoneGranted
    case manual
}

struct GuideStep: Equatable {
    let id: String
    let target: GuideTarget
    let message: String
    let placement: GuidePlacement
    let completion: CompletionCondition
}

// MARK: - AX selector（文字列 1 個に依存しない）

/// AX 要素の複合条件。title / description / role / identifier を組み合わせる。
/// 日本語と英語の macOS の両方に合わせて、候補文字列は複数持つ。
struct AXSelector: Equatable {
    /// kAXRoleAttribute（"AXButton" 等）。nil なら問わない。
    var role: String?
    /// title がこのどれかに一致（`titleContains` なら部分一致）。空なら問わない。
    var titleAny: [String] = []
    var titleContains: Bool = false
    /// description がこのどれかに一致（部分一致）。空なら問わない。
    var descriptionAny: [String] = []
    /// kAXIdentifierAttribute の完全一致。nil なら問わない。
    var identifier: String?
    /// identifier がこのどれかに完全一致。空なら問わない（System Settings の行は `<App>_Toggle` / `<App>_Title`）。
    var identifierAny: [String] = []
    /// kAXValueAttribute（静的テキストの本文は title ではなく value に入ることがある）。空なら問わない。
    var valueAny: [String] = []
    var valueContains: Bool = false

    init(role: String? = nil, titleAny: [String] = [], titleContains: Bool = false,
         descriptionAny: [String] = [], identifier: String? = nil, identifierAny: [String] = [],
         valueAny: [String] = [], valueContains: Bool = false) {
        self.role = role; self.titleAny = titleAny; self.titleContains = titleContains
        self.descriptionAny = descriptionAny; self.identifier = identifier; self.identifierAny = identifierAny
        self.valueAny = valueAny; self.valueContains = valueContains
    }

    /// 条件が 1 つも無い selector は何にでも一致してしまうので、無効とする。
    var isEmpty: Bool {
        role == nil && titleAny.isEmpty && descriptionAny.isEmpty && identifier == nil && identifierAny.isEmpty && valueAny.isEmpty
    }

    func matches(_ node: AXElementSnapshot) -> Bool {
        if isEmpty { return false }
        if let role, node.role != role { return false }
        if let identifier, node.identifier != identifier { return false }
        if !identifierAny.isEmpty, !identifierAny.contains(node.identifier ?? "") { return false }
        if !valueAny.isEmpty {
            let value = node.value ?? ""
            let ok = valueAny.contains { valueContains ? value.localizedCaseInsensitiveContains($0) : value == $0 }
            if !ok { return false }
        }
        if !titleAny.isEmpty {
            let title = node.title ?? ""
            let ok = titleAny.contains { titleContains ? title.localizedCaseInsensitiveContains($0) : title == $0 }
            if !ok { return false }
        }
        if !descriptionAny.isEmpty {
            let desc = node.axDescription ?? ""
            if !descriptionAny.contains(where: { desc.localizedCaseInsensitiveContains($0) }) { return false }
        }
        return true
    }
}

// MARK: - AX の写し（探索と検査のための値）

/// AX 木の 1 節。実 AXUIElement から写したもの。検査では手で組める。
/// frame は **AX のまま**（左上原点・y 下向き・主画面基準）。AppKit へは `AXCoordinateConverter` で変える。
struct AXElementSnapshot: Equatable {
    var role: String?
    var subrole: String?
    var title: String?
    var axDescription: String?
    var identifier: String?
    var value: String?
    /// AX 座標の矩形。位置が取れなければ nil（推測で埋めない）。
    var axFrame: CGRect?
    var children: [AXElementSnapshot] = []
    /// 実要素（追従の再取得や AXObserver の登録に使う）。検査では nil。比較には使わない。
    var element: AXUIElement?

    static func == (a: AXElementSnapshot, b: AXElementSnapshot) -> Bool {
        a.role == b.role && a.subrole == b.subrole && a.title == b.title && a.axDescription == b.axDescription
            && a.identifier == b.identifier && a.value == b.value && a.axFrame == b.axFrame && a.children == b.children
    }

    /// selectors を優先順に試し、最初に一致した節を返す（深さ優先）。
    /// 同じ selector に複数一致するときは、木の中で先に現れたもの。
    func find(_ selectors: [AXSelector]) -> AXMatch? {
        for (rank, selector) in selectors.enumerated() {
            if let node = firstNode(where: { selector.matches($0) }) {
                return AXMatch(node: node, selectorRank: rank)
            }
        }
        return nil
    }

    func firstNode(where predicate: (AXElementSnapshot) -> Bool) -> AXElementSnapshot? {
        if predicate(self) { return self }
        for child in children { if let hit = child.firstNode(where: predicate) { return hit } }
        return nil
    }

    var nodeCount: Int { 1 + children.reduce(0) { $0 + $1.nodeCount } }

    /// app 直下の窓（追従のため、窓の移動・リサイズを要素レベルでも受ける）。
    var windows: [AXElementSnapshot] { children.filter { $0.role == kAXWindowRole as String } }

    /// 一覧の行の名前。System Settings の行は identifier `<App>_Toggle` / `<App>_Title` に名前を持つ。
    /// ボタン（「+」）など名前の無いものは nil。
    var displayName: String? {
        if let id = identifier {
            for suffix in ["_Toggle", "_Title"] where id.hasSuffix(suffix) { return String(id.dropLast(suffix.count)) }
        }
        if role == kAXCheckBoxRole as String || role == "AXSwitch" || role == kAXStaticTextRole as String {
            if let t = title, !t.isEmpty { return t }
            if role == kAXStaticTextRole as String, let v = value, !v.isEmpty { return v }
        }
        return nil
    }
}

struct AXMatch: Equatable {
    let node: AXElementSnapshot
    /// どの selector で当たったか（0 が最優先）。
    let selectorRank: Int
}

// MARK: - 座標（AX → AppKit、マルチディスプレイ）

/// AX の矩形（主画面の左上が原点、y は下向き）を AppKit の矩形（主画面の左下が原点、y は上向き）へ。
/// 主画面より上にある副画面は AX では y が負、AppKit では主画面の高さより大きい y になる。
enum AXCoordinateConverter {
    static func appKitRect(_ ax: CGRect, primaryScreenHeight: CGFloat) -> CGRect {
        CGRect(x: ax.origin.x, y: primaryScreenHeight - ax.origin.y - ax.height,
               width: ax.width, height: ax.height)
    }

    /// 主画面（AppKit で原点 (0,0) を含む画面）の高さ。`NSScreen.screens.first` が主画面。
    static func primaryScreenHeight(_ screens: [NSScreen] = NSScreen.screens) -> CGFloat {
        screens.first?.frame.height ?? 0
    }

    /// その矩形が主に載っている画面の visibleFrame（重なりが最大の画面）。どの画面にも掛からなければ nil。
    static func screenFrame(containing rect: CGRect, screenFrames: [CGRect]) -> CGRect? {
        var best: (CGRect, CGFloat)?
        for frame in screenFrames {
            let inter = frame.intersection(rect)
            let area = inter.isNull ? 0 : inter.width * inter.height
            if area > 0, area > (best?.1 ?? 0) { best = (frame, area) }
        }
        return best?.0
    }
}

// MARK: - 吹き出しの置き場所（対象の近く・画面内に収める）

enum CalloutPlacer {
    static let gap: CGFloat = 10
    static let margin: CGFloat = 8

    /// 対象 rect（AppKit）に対して吹き出し size をどこへ置くか。
    /// 上→下→右→左の順で、収まる側を選ぶ。どこにも収まらなければ上に置いて clamp する。
    static func place(target: CGRect, size: CGSize, within bounds: CGRect,
                      preferred: GuidePlacement = .above) -> (frame: CGRect, placement: GuidePlacement) {
        let order: [GuidePlacement] = [preferred] + [.above, .below, .right, .left].filter { $0 != preferred }
        for placement in order {
            let frame = candidate(target: target, size: size, placement: placement)
            if bounds.insetBy(dx: margin, dy: margin).contains(frame) { return (frame, placement) }
        }
        let fallback = candidate(target: target, size: size, placement: .above)
        return (clamp(fallback, within: bounds), .above)
    }

    static func candidate(target: CGRect, size: CGSize, placement: GuidePlacement) -> CGRect {
        switch placement {
        case .above: return CGRect(x: target.midX - size.width / 2, y: target.maxY + gap, width: size.width, height: size.height)
        case .below: return CGRect(x: target.midX - size.width / 2, y: target.minY - gap - size.height, width: size.width, height: size.height)
        case .right: return CGRect(x: target.maxX + gap, y: target.midY - size.height / 2, width: size.width, height: size.height)
        case .left:  return CGRect(x: target.minX - gap - size.width, y: target.midY - size.height / 2, width: size.width, height: size.height)
        }
    }

    /// 画面の外へはみ出さないよう寄せる（大きさは変えない）。
    static func clamp(_ frame: CGRect, within bounds: CGRect) -> CGRect {
        let inner = bounds.insetBy(dx: margin, dy: margin)
        var f = frame
        if f.maxX > inner.maxX { f.origin.x = inner.maxX - f.width }
        if f.minX < inner.minX { f.origin.x = inner.minX }
        if f.maxY > inner.maxY { f.origin.y = inner.maxY - f.height }
        if f.minY < inner.minY { f.origin.y = inner.minY }
        return f
    }

    /// 対象 + 余白のハイライト矩形。
    static func highlightFrame(target: CGRect, padding: CGFloat = 7) -> CGRect {
        target.insetBy(dx: -padding, dy: -padding)
    }
}

// MARK: - アバター

enum AvatarState: Equatable {
    case idle, listening, thinking, speaking, guiding, success, warning
}

/// 右下に置くアバターの寸法。visibleFrame 基準で右 24pt・下 24pt。
enum AvatarLayout {
    static let inset: CGFloat = 24
    static let avatarSize: CGFloat = 64
    static let bubbleMaxWidth: CGFloat = 260

    /// アバター窓の frame（吹き出しを含む全体）。右下に寄せる。
    static func frame(size: CGSize, in visibleFrame: CGRect) -> CGRect {
        CGRect(x: visibleFrame.maxX - inset - size.width, y: visibleFrame.minY + inset,
               width: size.width, height: size.height)
    }
}

// MARK: - 見つけたもの

/// 案内の対象として見つけた要素。rect は AppKit 座標。
struct GuideAnchor: Equatable {
    let rect: CGRect
    let match: AXMatch
}

// MARK: - デバッグログ（探索結果を残す）

enum GuideLog {
    static var sink: (String) -> Void = { line in
        if ProcessInfo.processInfo.environment["ASTRA_GUIDE_DEBUG"] != nil { FileHandle.standardError.write(Data((line + "\n").utf8)) }
    }
    static func debug(_ message: @autoclosure () -> String) { sink("[guided-setup] " + message()) }
}

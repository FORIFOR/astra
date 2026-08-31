import AppKit
import ApplicationServices

/// 画面の**実寸**を pt で取り、基準と突き合わせる。
///
/// これまでの視覚ゲートは「画素の何 % が違うか」で見ていた。それでは
/// 「30pt ずれている」も「影が少し濃い」も同じ 0.4% になり、**どちらを先に直すか**が
/// 決まらない。位置・寸法・行のベースラインを pt で測れば、ずれた量がそのまま出るし、
/// 直す順番（まず geometry、次に spacing…）も機械的に決められる。
///
/// 値は AX から取る。画像から輪郭を推定するより正確で、識別子と対応が付く。
enum UIGeometry {

    /// 要素 1 つの実寸（画面座標・pt）。
    struct Box: Codable, Equatable {
        var x: Double
        var y: Double
        var w: Double
        var h: Double

        /// いちばん大きいずれ（pt）。位置と寸法をまとめて 1 つの数にする。
        func maxDelta(from other: Box) -> Double {
            max(abs(x - other.x), abs(y - other.y), abs(w - other.w), abs(h - other.h))
        }

        /// どの辺がどれだけずれたか。報告用。
        func deltas(from other: Box) -> [(String, Double)] {
            [("x", x - other.x), ("y", y - other.y), ("w", w - other.w), ("h", h - other.h)]
                .filter { abs($0.1) >= 0.5 }
        }
    }

    /// 1 つの面のスナップショット。識別子 → 実寸。
    typealias Snapshot = [String: Box]

    /// 直す順番。**上から順に見て、上の段に差があるうちは下を報告しない。**
    ///
    /// 色や影を延々直しているのに面の幅が 30pt 違う、という直し方を防ぐ。
    /// 幅が合ってから spacing、spacing が合ってから typography、という順に進む。
    enum Layer: Int, CaseIterable {
        case geometry      // 位置・寸法
        case spacing       // 要素どうしの間隔
        case typography    // 行の高さ・ベースライン
        case surface       // 面の見え（画素）

        var label: String {
            switch self {
            case .geometry: return "① Geometry（位置・寸法）"
            case .spacing: return "② Spacing（間隔）"
            case .typography: return "③ Typography（行位置）"
            case .surface: return "④ Surface（面の見え）"
            }
        }
    }

    /// いま出ている窓から、識別子の付いた要素の実寸を集める。
    ///
    /// AX 権限が無ければ空を返す（呼ぶ側が SKIP を選べるように、失敗と区別する）。
    @MainActor
    static func snapshot() -> Snapshot? {
        var out: Snapshot = [:]

        // **窓の枠を先に取る。** 中身より外枠のほうが壊れやすく、影響も大きい
        // （幅・上辺の位置・左右の余白）。AX は SwiftUI の階層を畳んでしまい
        // Dock の中身をほとんど出さないので、ここが実質の主役になる。
        let screen = NSScreen.screens.first?.frame ?? .zero
        for win in NSApp.windows where win.isVisible {
            let f = win.frame
            let key = "window:" + (win.identifier?.rawValue ?? String(describing: type(of: win)))
            func r(_ d: CGFloat) -> Double { (Double(d) * 2).rounded() / 2 }
            out[key] = Box(x: r(f.minX), y: r(f.minY), w: r(f.width), h: r(f.height))
            // 画面に対する位置。中央からのずれと上辺からの距離は、これ自体が仕様。
            if screen.width > 0 {
                out[key + ":centerOffset"] = Box(
                    x: r(f.midX - screen.midX), y: r(screen.maxY - f.maxY), w: 0, h: 0)
            }
        }

        guard AXIsProcessTrusted() else { return out.isEmpty ? nil : out }
        let app = AXUIElementCreateApplication(getpid())

        func value(_ el: AXUIElement, _ attr: String) -> CFTypeRef? {
            var v: CFTypeRef?
            guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success else { return nil }
            return v
        }

        func box(_ el: AXUIElement) -> Box? {
            guard let pRef = value(el, kAXPositionAttribute as String),
                  let sRef = value(el, kAXSizeAttribute as String),
                  CFGetTypeID(pRef) == AXValueGetTypeID(),
                  CFGetTypeID(sRef) == AXValueGetTypeID() else { return nil }
            var p = CGPoint.zero, s = CGSize.zero
            guard AXValueGetValue(pRef as! AXValue, .cgPoint, &p),
                  AXValueGetValue(sRef as! AXValue, .cgSize, &s) else { return nil }
            // 0.5pt 未満は丸める。描画の都合で末尾が揺れても差にしない。
            func r(_ d: CGFloat) -> Double { (Double(d) * 2).rounded() / 2 }
            return Box(x: r(p.x), y: r(p.y), w: r(s.width), h: r(s.height))
        }

        func walk(_ el: AXUIElement, _ depth: Int) {
            if depth > 24 { return }
            if let idRef = value(el, "AXIdentifier"), let id = idRef as? String, !id.isEmpty,
               let b = box(el) {
                // 同じ識別子が複数出たときは、最初に見つけたものを採る（撮影は 1 面ずつ）。
                if out[id] == nil { out[id] = b }
            }
            if let kidsRef = value(el, kAXChildrenAttribute as String), let kids = kidsRef as? [AXUIElement] {
                for k in kids { walk(k, depth + 1) }
            }
        }
        walk(app, 0)
        return out
    }

    /// 基準と突き合わせる。**許容は 2pt**（人が見て気づかない範囲）。
    ///
    /// 戻りは層ごとの差。`Layer` の順に見て、上の層に差があれば下は返さない。
    static func compare(_ actual: Snapshot, to reference: Snapshot,
                        tolerance: Double = 2.0) -> [(Layer, [String])] {
        var geometry: [String] = []
        var missing: [String] = []

        for (id, want) in reference.sorted(by: { $0.key < $1.key }) {
            guard let got = actual[id] else { missing.append("\(id) が無い"); continue }
            let d = got.maxDelta(from: want)
            if d > tolerance {
                let detail = got.deltas(from: want)
                    .map { String(format: "%@%+.1f", $0.0, $0.1) }.joined(separator: " ")
                geometry.append(String(format: "%@ が %.1fpt ずれた（%@）", id, d, detail))
            }
        }
        // 無い要素は「置き場所が違う」より重い。同じ段で先に出す。
        let firstLayer = missing + geometry
        if !firstLayer.isEmpty { return [(.geometry, firstLayer)] }
        return []
    }

    // MARK: - 保存と読み出し

    static func write(_ snapshot: Snapshot, to path: String) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(snapshot) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }

    static func read(_ path: String) -> Snapshot? {
        guard let data = FileManager.default.contents(atPath: path) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }
}

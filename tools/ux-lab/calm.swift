import AppKit
import CoreGraphics

// 「邪魔をしていないか」を外から測る。中を見ない。
//
//   occupation      Astra の窓が画面のどれだけを覆っているか
//   occlusion       前面アプリの窓を Astra がどれだけ隠しているか
//   frontmost       いま前面にいるアプリ（焦点を奪ったかの判定に使う）
//   astraFrontmost  Astra が前面か
//
// 出力は 1 行 1 値の key=value。集計側で読む。
let screen = NSScreen.screens.first?.frame ?? .zero
let screenArea = max(1, screen.width * screen.height)

let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                      kCGNullWindowID) as? [[String: Any]] ?? []

func rect(_ w: [String: Any]) -> CGRect? {
    guard let b = w[kCGWindowBounds as String] as? [String: Any] else { return nil }
    return CGRect(dictionaryRepresentation: b as CFDictionary)
}
func owner(_ w: [String: Any]) -> String { w[kCGWindowOwnerName as String] as? String ?? "" }
func isAstra(_ w: [String: Any]) -> Bool {
    let o = owner(w); return o.contains("Astra") || o == "AstraMac"
}

// Astra の占有面積（窓どうしが重なっても二重に数えない）。
var astraRects: [CGRect] = []
for w in list where isAstra(w) {
    if let r = rect(w), r.width > 20, r.height > 20 { astraRects.append(r) }
}
func unionArea(_ rs: [CGRect]) -> CGFloat {
    // 荒いが十分: 4pt 格子で数える。
    guard !rs.isEmpty else { return 0 }
    var seen = Set<Int>()
    let step: CGFloat = 4
    for r in rs {
        var y = r.minY
        while y < r.maxY {
            var x = r.minX
            while x < r.maxX {
                seen.insert(Int(x / step) * 100000 + Int(y / step)); x += step
            }
            y += step
        }
    }
    return CGFloat(seen.count) * step * step
}
let occ = unionArea(astraRects) / screenArea

// 前面アプリの窓を、どれだけ隠しているか。
let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
var occluded: CGFloat = 0, frontArea: CGFloat = 1
for w in list where owner(w) == front && !isAstra(w) {
    guard let r = rect(w), r.width > 40, r.height > 40 else { continue }
    frontArea = max(frontArea, r.width * r.height)
    for a in astraRects { occluded += a.intersection(r).width * a.intersection(r).height }
    break
}

// **上から覆われている割合。** Astra が画面に在っても、他の窓が上に重なって
// いれば利用者には見えない。実際、待機中の HUD が macOS の再生ウィジェットに
// 完全に隠れていたことがある（それで「気付けない」が起きる）。
// CGWindowList は前から後ろの順に返るので、Astra より前にある窓だけを見る。
var covered: CGFloat = 0, astraArea: CGFloat = 0
if let first = list.firstIndex(where: { isAstra($0) }) {
    let above = list[0..<first].compactMap { w -> CGRect? in
        guard !isAstra(w), let r = rect(w), r.width > 8, r.height > 8 else { return nil }
        return r
    }
    for a in astraRects {
        astraArea += a.width * a.height
        for o in above {
            let i = a.intersection(o)
            if !i.isNull { covered += i.width * i.height }
        }
    }
}
let coverage = astraArea > 0 ? min(1, covered / astraArea) : 0

// 何が覆っているか。直すときに要る。
var coverers: [String] = []
if let first = list.firstIndex(where: { isAstra($0) }) {
    for w in list[0..<first] {
        guard !isAstra(w), let r = rect(w) else { continue }
        for a in astraRects where !a.intersection(r).isNull {
            let o = owner(w)
            if !o.isEmpty && !coverers.contains(o) { coverers.append(o) }
        }
    }
}

print("screen=\(Int(screen.width))x\(Int(screen.height))")
print(String(format: "coverage=%.4f", coverage))
print("coveredBy=\(coverers.joined(separator: ","))")
print("astraWindows=\(astraRects.count)")
print(String(format: "occupation=%.4f", occ))
print(String(format: "occlusion=%.4f", min(1, occluded / frontArea)))
print("frontmost=\(front)")
print("astraFrontmost=\(front.contains("Astra"))")

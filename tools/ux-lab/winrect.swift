import AppKit
import CoreGraphics

// 外から Astra の窓の位置と大きさを取る。アプリの中を見ずに済ませるため。
// 出力: x y w h（画面座標・pt）。いちばん大きい窓。無ければ何も出さない。
// `winrect screen` で主画面の pt 寸法。録画の px と突き合わせて倍率を出すのに使う。
if CommandLine.arguments.dropFirst().first == "screen" {
    let f = NSScreen.screens.first?.frame ?? .zero
    print(String(format: "%.0f %.0f", f.width, f.height))
    exit(0)
}

let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
var best: CGRect?
var bestID: CGWindowID = 0
for w in list {
    guard let owner = w[kCGWindowOwnerName as String] as? String,
          owner.contains("Astra") || owner.contains("AstraMac"),
          let b = w[kCGWindowBounds as String] as? [String: Any],
          let r = CGRect(dictionaryRepresentation: b as CFDictionary),
          r.width > 100, r.height > 28 else { continue }
    if best == nil || r.width * r.height > best!.width * best!.height {
        best = r
        bestID = (w[kCGWindowNumber as String] as? CGWindowID) ?? 0
    }
}
if let r = best {
    print(String(format: "%.0f %.0f %.0f %.0f %d", r.minX, r.minY, r.width, r.height, bestID))
}

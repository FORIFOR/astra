import AppKit

// 連続する frame の変化量を出す。動きの長さと形は、寸法ではなく**中身の変化**で見る。
// SCStream は出力の寸法を固定するので、窓が伸び縮みしても画像の大きさは変わらない。
//
//   framediff <ディレクトリ>
// 出力: 通し番号 変化率(0-1)
let dir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? [])
    .filter { $0.hasSuffix(".png") }.sorted()
guard files.count > 1 else { print("NO_FRAMES"); exit(2) }

func gray(_ path: String) -> ([UInt8], Int, Int)? {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    let w = cg.width / 4, h = cg.height / 4        // 1/4 に落として比べる（描画の揺れを拾わない）
    var buf = [UInt8](repeating: 0, count: w * h)
    guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8,
                              bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(),
                              bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    return (buf, w, h)
}

var prev: [UInt8]?
for (i, f) in files.enumerated() {
    guard let (cur, _, _) = gray(dir + "/" + f) else { continue }
    if let p = prev, p.count == cur.count {
        var diff = 0
        for k in 0..<cur.count where abs(Int(cur[k]) - Int(p[k])) > 12 { diff += 1 }
        print(String(format: "%d %.4f", i, Double(diff) / Double(cur.count)))
    }
    prev = cur
}

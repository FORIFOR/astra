import AppKit

/// 塗られた操作の**実寸**を、画素から測る。
///
/// なぜ要るか: ボタンの幅を「文字の墨 + padding」で推定していたら、
/// `minWidth` を入れた瞬間に推定式のほうが外れた。宣言値でも推定でもなく、
/// 描かれた矩形を測る。自プロセスの AX は子を返さないので、経路はここしかない。
///
///     rect <png> [この y から下だけ見る]
///
/// いま見ているのは amber の塗り 1 つ（確認の面の主たる操作）。
let args = CommandLine.arguments
guard args.count > 1 else { print("usage: rect <png> [minY]"); exit(2) }
let yFrom = args.count > 2 ? Int(args[2]) ?? 0 : 0
guard let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil),
      let rep = NSBitmapImageRep(cgImage: cg).converting(to: .sRGB, renderingIntent: .default)
else { exit(2) }

let W = rep.pixelsWide, H = rep.pixelsHigh
func isAmber(_ x: Int, _ y: Int) -> Bool {
    guard let c = rep.colorAt(x: x, y: y) else { return false }
    let r = c.redComponent * 255, g = c.greenComponent * 255, b = c.blueComponent * 255
    return r > 200 && g > 130 && g < 200 && b < 110
}

var best = (x0: 0, x1: 0, run: 0)
var rows: [Int] = []
for y in yFrom..<H {
    var x = 0
    while x < W {
        var run = 0
        let start = x
        while x < W, isAmber(x, y) { run += 1; x += 1 }
        if run > best.run { best = (start, start + run - 1, run) }
        // 字の墨と塗りを分ける。塗りは横に長く続く。
        if run > 20 { rows.append(y) }
        x += 1
    }
}
print("SIZE \(W) \(H)")
if best.run > 0, let y0 = rows.min(), let y1 = rows.max() {
    print("FILL \(best.x0) \(y0) \(best.run) \(y1 - y0 + 1)")
} else {
    print("FILL none")
}

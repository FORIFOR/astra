import AppKit

/// 違った面の**差分画像**を残す。
///
/// 「1.08% 違う」とだけ言われても、どこが違うのか分からないので直せない。
/// 基準・実際・差分を横に並べた 1 枚を置いておけば、開けば分かる。
///
/// 画素は**生バイトで読み書きする**。`NSBitmapImageRep.setColor` は形式によっては
/// 黙って効かず、差分の面だけ 1 色（真っ黒）になった。`NSImage` で包んで描き直す
/// 方法も同じ理由で当てにならない。どちらも実際に踏んだ。
enum UIDiffImage {

    /// 読み書きしやすいよう、必ず 8bit RGBA・平面なしへ揃えたバッファ。
    private struct Buffer {
        let w: Int, h: Int
        var px: [UInt8]   // RGBA

        init?(path: String) {
            guard let data = FileManager.default.contents(atPath: path),
                  let src = NSBitmapImageRep(data: data),
                  let cg = src.cgImage,
                  let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
            w = cg.width; h = cg.height
            var buf = [UInt8](repeating: 0, count: w * h * 4)
            let width = w, height = h
            let ok: Bool = buf.withUnsafeMutableBytes { raw in
                guard let ctx = CGContext(
                    data: raw.baseAddress, width: width, height: height,
                    bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
                ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
                return true
            }
            guard ok else { return nil }
            px = buf
        }

        init(w: Int, h: Int, fill: (UInt8, UInt8, UInt8)) {
            self.w = w; self.h = h
            px = [UInt8](repeating: 255, count: w * h * 4)
            for i in stride(from: 0, to: px.count, by: 4) {
                px[i] = fill.0; px[i + 1] = fill.1; px[i + 2] = fill.2; px[i + 3] = 255
            }
        }

        @inline(__always) func rgb(_ x: Int, _ y: Int) -> (Int, Int, Int) {
            let i = (y * w + x) * 4
            return (Int(px[i]), Int(px[i + 1]), Int(px[i + 2]))
        }

        @inline(__always) mutating func set(_ x: Int, _ y: Int, _ c: (UInt8, UInt8, UInt8)) {
            let i = (y * w + x) * 4
            px[i] = c.0; px[i + 1] = c.1; px[i + 2] = c.2; px[i + 3] = 255
        }

        func png() -> Data? {
            guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
            var copy = px
            let width = w, height = h
            let made: CGImage? = copy.withUnsafeMutableBytes { raw in
                guard let ctx = CGContext(
                    data: raw.baseAddress, width: width, height: height,
                    bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
                return ctx.makeImage()
            }
            guard let image = made else { return nil }
            return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        }
    }

    /// 基準と実際を比べて、違う画素を塗った 3 面並びを書き出す。
    /// 戻りは「違った画素の割合(%)」。書けなければ nil。
    @discardableResult
    static func write(reference: String, actual: String, to out: String) -> Double? {
        guard let ref = Buffer(path: reference), let act = Buffer(path: actual) else { return nil }
        let w = min(ref.w, act.w), h = min(ref.h, act.h)
        guard w > 0, h > 0 else { return nil }

        var diff = Buffer(w: w, h: h, fill: (255, 255, 255))
        var changed = 0
        for y in 0..<h {
            for x in 0..<w {
                let a = ref.rgb(x, y), b = act.rgb(x, y)
                if abs(a.0 - b.0) + abs(a.1 - b.1) + abs(a.2 - b.2) > 24 {
                    changed += 1
                    diff.set(x, y, (255, 38, 51))          // 違うところは赤
                } else {
                    // 合っているところは実際の絵を薄く残す。どのあたりかが分かる。
                    let lum = (b.0 * 299 + b.1 * 587 + b.2 * 114) / 1000
                    let g = UInt8(max(0, min(255, 150 + lum * 105 / 255)))
                    diff.set(x, y, (g, g, g))
                }
            }
        }

        // 基準 | 実際 | 差分 を横に並べる。開いた瞬間に比べられるように。
        let gap = 12
        var canvas = Buffer(w: w * 3 + gap * 2, h: h, fill: (26, 26, 26))
        func place(_ src: Buffer, atX ox: Int) {
            for y in 0..<h {
                for x in 0..<w {
                    let c = src.rgb(x, y)
                    canvas.set(ox + x, y, (UInt8(c.0), UInt8(c.1), UInt8(c.2)))
                }
            }
        }
        place(ref, atX: 0)
        place(act, atX: w + gap)
        place(diff, atX: (w + gap) * 2)

        guard let data = canvas.png() else { return nil }
        try? FileManager.default.createDirectory(
            atPath: (out as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true)
        try? data.write(to: URL(fileURLWithPath: out))
        return Double(changed) / Double(w * h) * 100
    }
}

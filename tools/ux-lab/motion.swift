import AVFoundation
import AppKit
import ScreenCaptureKit

// 窓だけを 60fps で撮る。動きを測るために要る。
//
// 0.25 秒ごとの連写では 180〜220ms の morph が 0〜1 枚しか写らず、
// 「一気に飛ぶ」と読まれた。あれは取り方の限界であって動きの質ではない。
// 60fps なら 180ms ≈ 11 枚、220ms ≈ 13 枚。十分に追える。
//
//   motion <出力ディレクトリ> <秒数>
// 画面全体は撮らない（他アプリと利用者の私物を成果物に残さないため）。

@available(macOS 13.0, *)
final class WindowRecorder: NSObject, SCStreamOutput {
    let outDir: String
    var n = 0
    let queue = DispatchQueue(label: "astra.motion")
    init(outDir: String) { self.outDir = outDir }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sb.isValid,
              let px = CMSampleBufferGetImageBuffer(sb) else { return }
        let ci = CIImage(cvPixelBuffer: px)
        let ctx = CIContext()
        guard let cg = ctx.createCGImage(ci, from: ci.extent) else { return }
        n += 1
        let rep = NSBitmapImageRep(cgImage: cg)
        guard let data = rep.representation(using: .png, properties: [:]) else { return }
        let name = String(format: "%04d.png", n)
        try? data.write(to: URL(fileURLWithPath: outDir + "/" + name))
    }
}

// CoreGraphics を先に起こす。これが無いと CGS_REQUIRE_INIT で落ちる。
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

guard #available(macOS 13.0, *) else { print("MOTION_UNSUPPORTED(macOS<13)"); exit(3) }
let a = CommandLine.arguments
guard a.count > 2 else { print("usage: motion <outDir> <seconds>"); exit(2) }
let outDir = a[1], secs = Double(a[2]) ?? 3

var picked: SCWindow?
let sem = DispatchSemaphore(value: 0)
SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, err in
    defer { sem.signal() }
    guard let content else { return }
    // Astra の窓のうち、いちばん大きいもの。**他アプリは対象にしない。**
    picked = content.windows
        .filter { ($0.owningApplication?.applicationName ?? "").contains("Astra") }
        .filter { $0.frame.width > 100 && $0.frame.height > 28 }
        .max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
}
sem.wait()
guard let win = picked else { print("NO_WINDOW"); exit(4) }

try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
let filter = SCContentFilter(desktopIndependentWindow: win)
let cfg = SCStreamConfiguration()
cfg.width = Int(win.frame.width * 2)
cfg.height = Int(win.frame.height * 2)
cfg.minimumFrameInterval = CMTime(value: 1, timescale: 60)   // 60fps
cfg.showsCursor = false
cfg.queueDepth = 8

let rec = WindowRecorder(outDir: outDir)
let stream = SCStream(filter: filter, configuration: cfg, delegate: nil)
try? stream.addStreamOutput(rec, type: .screen, sampleHandlerQueue: rec.queue)
stream.startCapture { err in
    if let err { print("MOTION_FAILED(\(err.localizedDescription))"); exit(5) }
    print("MOTION_START \(Int(win.frame.width))x\(Int(win.frame.height)) 60fps")
    fflush(stdout)
    DispatchQueue.global().asyncAfter(deadline: .now() + secs) {
        stream.stopCapture { _ in
            print("MOTION_FRAMES \(rec.n)")
            fflush(stdout)
            exit(0)
        }
    }
}
RunLoop.main.run()

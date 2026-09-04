import AVFoundation
import Foundation

/// マイク取り込み（AVAudioEngine）。tap の f32 サンプルを 16 kHz mono へ変換して渡す。
///
/// **注意**: ライブ取り込みは署名済み .app + マイク許可(TCC)が要る。SwiftPM の裸実行では
/// 許可プロンプトが出ないため headless では動かない。ここは実装であり、実許可の検証は .app 側で。
final class MicCapture {
    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let targetRate: Double = 16_000

    /// 16 kHz mono の f32 フレームを繰り返し渡す。
    func start(onFrame: @escaping ([Float]) -> Void) throws {
        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        guard
            let outFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: targetRate, channels: 1, interleaved: false)
        else { throw NSError(domain: "MicCapture", code: 1) }
        converter = AVAudioConverter(from: inFormat, to: outFormat)

        input.installTap(onBus: 0, bufferSize: 1024, format: inFormat) { [weak self] buffer, _ in
            guard let self, let converter = self.converter else { return }
            let capacity = AVAudioFrameCount(
                Double(buffer.frameLength) * self.targetRate / inFormat.sampleRate + 1)
            guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity)
            else { return }
            var error: NSError?
            var fed = false
            converter.convert(to: out, error: &error) { _, status in
                if fed { status.pointee = .noDataNow; return nil }
                fed = true
                status.pointee = .haveData
                return buffer
            }
            if let ch = out.floatChannelData, out.frameLength > 0 {
                onFrame(Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength))))
            }
        }
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    /// 起動を速くするため、資源だけ先に確保する。**IO は始めない・許可も求めない**
    /// （呼ぶ側がマイク許可済みのときだけ呼ぶ）。実測: 新しい engine は start に 200〜770ms、
    /// prepare 済みなら 77ms、止めた engine の再 start は 47〜170ms。最初のバッファは start の +100ms。
    func prewarm() {
        _ = engine.inputNode
        engine.prepare()
    }
}

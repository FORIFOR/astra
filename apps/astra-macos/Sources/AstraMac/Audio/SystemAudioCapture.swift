import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

/// システム音声の取り込み（ScreenCaptureKit）。会議の「相手側の声」を録る。
/// SCStream の音声出力を 16 kHz mono の f32 へ変換して渡す（MicCapture と同じ契約）。
///
/// **注意**: live 取り込みは署名済み .app + 画面収録許可(TCC)が要る。`getShareableContent`
/// が許可プロンプトを出すため headless では動かない。ここは実装であり、実許可の検証は .app 側で。
/// 一方、**構成（SCStreamConfiguration）の組み立ては TCC を要さず検証できる**（`configuration()`）。
@available(macOS 13.0, *)
final class SystemAudioCapture: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private var converter: AVAudioConverter?
    private let targetRate: Double = 16_000
    private var onFrame: (([Float]) -> Void)?
    private let sampleQueue = DispatchQueue(label: "astra.systemaudio.samples")

    /// 音声のみを拾う構成。TCC 無しで組み立てられる（検証可能）。
    static func configuration() -> SCStreamConfiguration {
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 48_000
        config.channelCount = 2
        // 自分（Astra）の音は録らない。相手側とシステム音だけ。
        config.excludesCurrentProcessAudio = true
        // 映像は最小に（音声目的なので）。
        config.width = 2
        config.height = 2
        return config
    }

    /// live 取り込みを始める。画面収録許可が無ければ throw（.app 側でユーザーが許可する）。
    func start(onFrame: @escaping ([Float]) -> Void) async throws {
        self.onFrame = onFrame
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "SystemAudioCapture", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "no display to attach to"])
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: Self.configuration(), delegate: nil)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
        try await stream.startCapture()
        self.stream = stream
    }

    func stop() async {
        if let stream { try? await stream.stopCapture() }
        stream = nil
        onFrame = nil
    }

    // MARK: SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid,
              let frames = Self.floats16kMono(from: sampleBuffer, targetRate: targetRate,
                                              converter: &converter)
        else { return }
        onFrame?(frames)
    }

    /// CMSampleBuffer(音声) → 16 kHz mono f32。失敗したら nil。
    static func floats16kMono(from sampleBuffer: CMSampleBuffer, targetRate: Double,
                              converter: inout AVAudioConverter?) -> [Float]? {
        guard let formatDesc = sampleBuffer.formatDescription,
              let asbd = formatDesc.audioStreamBasicDescription
        else { return nil }
        let inFormat = AVAudioFormat(streamDescription: [asbd].withUnsafeBufferPointer { $0.baseAddress! })
        guard let inFormat else { return nil }
        guard let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                            sampleRate: targetRate, channels: 1, interleaved: false)
        else { return nil }

        let count = CMSampleBufferGetNumSamples(sampleBuffer)
        guard count > 0,
              let inBuffer = AVAudioPCMBuffer(pcmFormat: inFormat,
                                              frameCapacity: AVAudioFrameCount(count))
        else { return nil }
        inBuffer.frameLength = AVAudioFrameCount(count)
        let copyStatus = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer, at: 0, frameCount: Int32(count),
            into: inBuffer.mutableAudioBufferList)
        guard copyStatus == noErr else { return nil }

        if converter == nil || converter?.inputFormat != inFormat {
            converter = AVAudioConverter(from: inFormat, to: outFormat)
        }
        guard let converter else { return nil }
        let capacity = AVAudioFrameCount(Double(count) * targetRate / inFormat.sampleRate + 1)
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity)
        else { return nil }
        var error: NSError?
        var fed = false
        converter.convert(to: out, error: &error) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return inBuffer
        }
        guard error == nil, let ch = out.floatChannelData, out.frameLength > 0 else { return nil }
        return Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
    }
}

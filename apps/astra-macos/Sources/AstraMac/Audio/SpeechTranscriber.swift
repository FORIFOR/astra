import AVFoundation
import Foundation
import Speech

/// オンデバイスの Streaming STT（Apple Speech）。正本 §3「Streaming STT」/ §11「音は手元で文字に」。
///
/// **sherpa-onnx の dylib もモデルも要らず、外部 STT にも送らない。**Apple のオンデバイス認識
/// (`requiresOnDeviceRecognition = true`)で、マイクの 16 kHz mono を途中経過/確定へ変える。
/// live 認識は音声認識許可(TCC)が要る（署名 .app でユーザーが許可）。**許可・可用性・ロケールの確認は
/// prompt 無しで読め**、headless で検証できる。
final class SpeechTranscriber {
    struct Live { let text: String; let isFinal: Bool }

    private let recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let format: AVAudioFormat

    init(localeId: String = "ja-JP") {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId))
        format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000,
                               channels: 1, interleaved: false)!
    }

    /// 認可状態（prompt を出さない）。
    static var authorization: SFSpeechRecognizerAuthorizationStatus {
        SFSpeechRecognizer.authorizationStatus()
    }
    static func requestAuthorization(_ done: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { s in
            DispatchQueue.main.async { done(s == .authorized) }
        }
    }

    /// オンデバイス認識が使えるか（可用性 + オンデバイス対応）。prompt を出さない。
    var canRunOnDevice: Bool {
        guard let recognizer, recognizer.isAvailable else { return false }
        return recognizer.supportsOnDeviceRecognition
    }

    /// 認識を始める。許可が無い / 使えなければ throw。
    func start(onEvent: @escaping (Live) -> Void) throws {
        guard Self.authorization == .authorized else {
            throw NSError(domain: "SpeechTranscriber", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "speech recognition not authorized"])
        }
        guard let recognizer, recognizer.isAvailable else {
            throw NSError(domain: "SpeechTranscriber", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "recognizer unavailable"])
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        request = req
        task = recognizer.recognitionTask(with: req) { result, _ in
            guard let result else { return }
            onEvent(Live(text: result.bestTranscription.formattedString,
                         isFinal: result.isFinal))
        }
    }

    /// マイクの 16 kHz mono f32 フレームを渡す。
    func append(_ frames: [Float], sampleRate: Double = 16_000) {
        guard let request, !frames.isEmpty,
              let buffer = AVAudioPCMBuffer(pcmFormat: format,
                                            frameCapacity: AVAudioFrameCount(frames.count))
        else { return }
        buffer.frameLength = AVAudioFrameCount(frames.count)
        if let ch = buffer.floatChannelData {
            frames.withUnsafeBufferPointer { src in
                ch[0].update(from: src.baseAddress!, count: frames.count)
            }
        }
        request.append(buffer)
    }

    func finish() {
        request?.endAudio()
        task?.finish()
        request = nil
        task = nil
    }
}

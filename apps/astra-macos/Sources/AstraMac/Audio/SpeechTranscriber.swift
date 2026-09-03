import AVFoundation
import Foundation
import Speech

/// オンデバイスの Streaming STT（Apple Speech）。正本 §3「Streaming STT」/ §11「音は手元で文字に」。
///
/// **sherpa-onnx の dylib もモデルも要らず、外部 STT にも送らない。**Apple のオンデバイス認識
/// (`requiresOnDeviceRecognition = true`)で、マイクの 16 kHz mono を途中経過/確定へ変える。
/// live 認識は音声認識許可(TCC)が要る（署名 .app でユーザーが許可）。**許可・可用性・ロケールの確認は
/// prompt 無しで読め**、headless で検証できる。
///
/// **黙ってサーバへ落とさない。**このロケールのオンデバイス資産が無い Mac では、以前は
/// `requiresOnDeviceRecognition = supportsOnDeviceRecognition` で Apple のサーバ認識に切り替わり、
/// 「音は端末から出しません」と言いながら音声が外へ出ていた（de-DE で実測、`docs/privacy-egress.md`）。
/// いまは on-device が使えなければ `start` が throw し、録音だけが続く。クラウド文字起こしを
/// 足すなら、「音声が外部へ送られます」と言う別の opt-in 機能として作る。ここで false にはしない。
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

    /// `start` / `recognizeFile` が「このロケールのオンデバイス資産が無い」で断ったときの code。
    static let onDeviceUnavailableCode = 3

    /// この Mac で認識器は在るがオンデバイス資産が無いロケール（検証が「落とさない」を確かめる材料）。
    static func localesWithoutOnDeviceAsset() -> [String] {
        SFSpeechRecognizer.supportedLocales().map(\.identifier).sorted().filter { id in
            guard let r = SFSpeechRecognizer(locale: Locale(identifier: id)), r.isAvailable else { return false }
            return !r.supportsOnDeviceRecognition
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
        guard recognizer.supportsOnDeviceRecognition else {
            throw NSError(domain: "SpeechTranscriber", code: Self.onDeviceUnavailableCode,
                          userInfo: [NSLocalizedDescriptionKey: "on-device recognition unavailable for \(recognizer.locale.identifier)"])
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = true   // 資産が無ければ error 102。false で再試行しない
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

    /// 音声ファイルを 1 回で認識する（オンデバイス）。会議録音の後処理や検証に使う。
    /// 許可が無い / 使えなければ nil。**オンデバイス資産が無くても nil**（サーバへは出さない）。認識結果の確定文字列を返す。
    ///
    /// **重要**: `SFSpeechRecognitiontask` の完了は現在の run loop 経由で届くため、
    /// セマフォで待つとメインスレッドを塞いで callback が永遠に来ない（空文字になる）。
    /// ここでは run loop を回して待つ（メイン/バックグラウンドどちらから呼んでも成立する）。
    func recognizeFile(_ url: URL, timeout: TimeInterval = 20) -> String? {
        guard Self.authorization == .authorized, let recognizer, recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else { return nil }
        let req = SFSpeechURLRecognitionRequest(url: url)
        req.requiresOnDeviceRecognition = true
        let lock = NSLock()
        var latest = ""            // partial も貯める（isFinal が遅いことがある）
        var done = false
        let t = recognizer.recognitionTask(with: req) { result, error in
            if let result {
                lock.lock(); latest = result.bestTranscription.formattedString
                if result.isFinal { done = true }
                lock.unlock()
            }
            if error != nil { lock.lock(); done = true; lock.unlock() }
        }
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            lock.lock(); let d = done; lock.unlock()
            if d || Date() > deadline { break }
            CFRunLoopRunInMode(.defaultMode, 0.05, true)   // 塞がず回して callback を届かせる
        }
        t.cancel()
        lock.lock(); let out = latest; lock.unlock()
        return out.isEmpty ? nil : out
    }
}

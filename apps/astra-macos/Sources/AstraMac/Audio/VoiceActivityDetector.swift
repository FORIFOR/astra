import Foundation

/// §12 VAD。話していない間まで STT に流さないための門番。
///
/// 無音を延々と認識器へ送ると、電池も CPU も食い、誤認識も増える。
/// ここは「いま声が乗っているか」だけを決める。判断は 2 つ:
///   - フレームの実効値が閾値を超えたか
///   - 一度声が始まったら、少し途切れても切らない（hangover）
///
/// 単語の切れ目で毎回切ると、文の途中で確定してしまう。
struct VoiceActivityDetector {
    /// これを下回るフレームは無音とみなす（RMS）。
    var threshold: Float = 0.012
    /// 声が途切れてから、無音と決めるまでの猶予。
    var hangover: TimeInterval = 0.6

    private(set) var isSpeaking = false
    private var lastVoiceAt: Date?

    /// 1 フレーム入れる。戻り値は「STT へ流すべきか」。
    mutating func accept(_ frame: [Float], now: Date = Date()) -> Bool {
        let level = Self.rms(frame)
        if level >= threshold {
            lastVoiceAt = now
            isSpeaking = true
            return true
        }
        guard let last = lastVoiceAt else {
            isSpeaking = false
            return false
        }
        if now.timeIntervalSince(last) < hangover {
            // 途切れの間も流す。ここで切ると文の途中で確定してしまう。
            return true
        }
        isSpeaking = false
        return false
    }

    mutating func reset() {
        isSpeaking = false
        lastVoiceAt = nil
    }

    static func rms(_ frame: [Float]) -> Float {
        guard !frame.isEmpty else { return 0 }
        var sum: Float = 0
        for v in frame { sum += v * v }
        return (sum / Float(frame.count)).squareRoot()
    }
}

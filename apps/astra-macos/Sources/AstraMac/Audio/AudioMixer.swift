import Foundation

/// §19 マイクとシステム音声を混ぜる。**どちらから来たかを捨てない。**
///
/// 混ぜてから STT に流すと文字は起こせるが、「自分が言ったのか相手が言ったのか」が
/// 分からなくなる。会議の議事録でそれが分からないと、決定事項の主語が消える。
/// そこで混合の前に channel を付けて配り、混合波は記録用にだけ使う。
enum SpeakerChannel: String, CaseIterable {
    case localUser = "local_user"
    case remoteAudio = "remote_audio"

    var label: String {
        switch self {
        case .localUser: return "あなた"
        case .remoteAudio: return "相手"
        }
    }
}

struct ChannelFrame {
    let channel: SpeakerChannel
    let samples: [Float]
}

/// 2 系統を受けて、記録用の混合波と、channel 付きのフレームを出す。
struct AudioMixer {
    /// 記録用に混ぜる。単純な加算だと割れるので平均を取り、範囲に収める。
    static func mix(_ a: [Float], _ b: [Float]) -> [Float] {
        let n = max(a.count, b.count)
        guard n > 0 else { return [] }
        var out = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let l = i < a.count ? a[i] : 0
            let r = i < b.count ? b[i] : 0
            out[i] = max(-1, min(1, (l + r) * 0.5))
        }
        return out
    }

    /// STT へ配る分。**混ぜずに**、channel を付けたまま渡す。
    static func split(local: [Float], remote: [Float]) -> [ChannelFrame] {
        var out: [ChannelFrame] = []
        if !local.isEmpty { out.append(ChannelFrame(channel: .localUser, samples: local)) }
        if !remote.isEmpty { out.append(ChannelFrame(channel: .remoteAudio, samples: remote)) }
        return out
    }
}

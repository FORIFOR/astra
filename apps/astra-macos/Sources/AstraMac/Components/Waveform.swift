import SwiftUI

/// 音量の棒グラフ。demo では固定の levels を渡して決定的に描く。
///
/// **無音は「点線」ではなく「静かな一本線」で描く。**
/// 以前は全部の棒を `max(2, …)` で 2pt にしていたので、音が無いときに
/// 点が飛び飛びに並び、動いていない・壊れているように見えた
/// （「Recording now」の真横でそれが出るので、録れていないと誤解される）。
/// 静かなときは細い線がつながって見えるようにする。
struct Waveform: View {
    var levels: [CGFloat]
    var color: Color = .astraAccent
    var barWidth: CGFloat = 3
    var spacing: CGFloat = 2
    /// まだ一度も音が来ていない（録り始めた直後・入力が無い）。
    /// 「静か」と「聞けていない」は別のことなので、描き分ける。
    var awaitingInput: Bool = false

    /// 何か鳴っているか。全部が底なら静か。
    private var isQuiet: Bool { (levels.max() ?? 0) <= 0.02 }

    var body: some View {
        GeometryReader { geo in
            if levels.isEmpty || isQuiet {
                // 静かなときは、途切れない細い線。振れていないことは分かるが、
                // 壊れているようには見えない。
                Capsule()
                    .fill(color.opacity(awaitingInput ? 0.18 : 0.35))
                    .frame(height: 2)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    .accessibilityLabel(awaitingInput ? "音の入力を待っています" : "静かです")
            } else {
                HStack(alignment: .center, spacing: spacing) {
                    ForEach(levels.indices, id: \.self) { i in
                        Capsule()
                            .fill(color)
                            .frame(width: barWidth, height: max(2, geo.size.height * levels[i]))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .accessibilityLabel("音が入っています")
            }
        }
    }
}

/// HUD 用の小さな波形。
struct MiniWaveform: View {
    var body: some View {
        Waveform(levels: [0.3, 0.6, 0.9, 0.5, 0.7, 0.4], color: Palette.accent(false).opacity(0.55), barWidth: 2, spacing: 2)
            .frame(width: 32, height: 12)
    }
}

import SwiftUI

/// §12.2 minimal recording indicator: `● REC 18:42  A社 新規提案  3 speakers  [Pause][Stop]`。
/// 巨大な録音画面を常駐させず、装飾的な大波形を主役にしない（細い meter のみ）。360–420×48–56。
/// 寸法/色は tokens 由来（Metrics/Palette/TypeScale/Space）。§19: Accessible Name に "Recording"。
struct RecordingIndicatorView: View {
    @Environment(\.colorScheme) private var scheme
    var elapsed: String = "18:42"
    var title: String = "A社 新規提案"
    var speakers: Int = 3
    var level: Double = 0.4
    private var dark: Bool { scheme == .dark }
    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: Metrics.recordingIndicatorRadius, style: .continuous)
    }

    var body: some View {
        HStack(spacing: 9) {
            Circle().fill(Palette.danger(dark)).frame(width: 8, height: 8)
            Text("REC").font(.system(size: TypeScale.microSize, weight: .semibold)).foregroundStyle(Palette.danger(dark))
            Text(elapsed).font(.system(size: TypeScale.secondarySize).monospaced()).foregroundStyle(Palette.text(dark))
            Text(title).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.text(dark)).lineLimit(1)
            Text("\(speakers) speakers").font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
            Spacer(minLength: 6)
            ZStack(alignment: .leading) { // 細い meter のみ（大波形にしない）
                RoundedRectangle(cornerRadius: 2).fill(Palette.muted(dark).opacity(0.3)).frame(width: 40, height: 3)
                RoundedRectangle(cornerRadius: 2).fill(Palette.accent(dark)).frame(width: 40 * max(0, min(1, level)), height: 3)
            }
            Image(systemName: "pause.fill").font(.system(size: 11)).foregroundStyle(Palette.muted(dark))
            Image(systemName: "stop.fill").font(.system(size: 11)).foregroundStyle(Palette.danger(dark))
        }
        .padding(.horizontal, Space.cardPadding)
        .frame(width: Metrics.recordingIndicatorWidth, height: Metrics.recordingIndicatorHeight)
        .background(
            shape.fill(Palette.surface(dark).opacity(0.95))
                .overlay(shape.stroke(Palette.border(dark), lineWidth: 1))
                .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Recording \(title) \(speakers) speakers")
        .accessibilityIdentifier("recordingIndicator")
    }
}

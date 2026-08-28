import SwiftUI

/// §4 Task Dock（universal Intent Bar）の Ready 状態。画面下部中央・560×56・radius16（§4.1/§17.3）。
/// 内容階層（§4.3）: [✦ Astra] [ 何をしますか？ .......... ] [Mic] [+]  ／ 下段に Context chips（最大3 + "+N"）。
/// 色・寸法・余白は shared/design/tokens.json 由来（Palette/Metrics/TypeScale/Space）。直書きしない。
struct IntentBarView: View {
    @Environment(\.colorScheme) private var scheme
    var intent: String = ""
    var contextChips: [String] = []
    private var dark: Bool { scheme == .dark }

    private var barShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: Metrics.intentRadius, style: .continuous)
    }

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: "sparkle")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.accent(dark))
                Text(intent.isEmpty ? "何をしますか？" : intent) // §4.3 placeholder
                    .font(.system(size: TypeScale.bodySize))
                    .foregroundStyle(intent.isEmpty ? Palette.muted(dark) : Palette.text(dark))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(1)
                Image(systemName: "mic").font(.system(size: 14)).foregroundStyle(Palette.muted(dark))
                Image(systemName: "plus").font(.system(size: 14)).foregroundStyle(Palette.muted(dark))
            }
            .padding(.horizontal, Space.cardPadding)
            .frame(height: Metrics.intentReadyHeight)

            if !contextChips.isEmpty { // §4.3 Context chips 最大3 + "+N"、§5 Context Lens の圧縮表示
                HStack(spacing: 6) {
                    ForEach(Array(contextChips.prefix(3)), id: \.self) { chip in
                        Text(chip)
                            .font(.system(size: TypeScale.microSize, weight: .medium))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Capsule().fill(Palette.muted(dark).opacity(0.14)))
                            .foregroundStyle(Palette.text(dark))
                    }
                    if contextChips.count > 3 {
                        Text("+\(contextChips.count - 3)")
                            .font(.system(size: TypeScale.microSize, weight: .medium))
                            .foregroundStyle(Palette.muted(dark))
                    }
                    Spacer()
                }
                .padding(.horizontal, Space.cardPadding)
                .padding(.bottom, 8)
            }
        }
        .frame(width: Metrics.intentReadyWidth)
        .background(
            barShape
                .fill(Palette.surface(dark).opacity(0.92))
                .background(VisualEffectView(material: .hudWindow).clipShape(barShape)) // §17.3 glassmorphism は dock に限定
                .overlay(barShape.stroke(Palette.border(dark), lineWidth: 1))
                .shadow(color: .black.opacity(0.18), radius: 16, y: 6)
        )
        .accessibilityIdentifier("intentBar")
    }
}

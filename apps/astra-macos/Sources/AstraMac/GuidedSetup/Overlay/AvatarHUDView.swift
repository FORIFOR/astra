import SwiftUI

/// 右下の案内カード。**独立したアバターの丸は無い**（本人の設計判断、2026-09-07）。
///
/// 文法: System Settings = 主役、対象行 / toggle = 操作対象、この callout = ガイド、Astra の署名 = カード内の小さな mark。
/// 盲検 8 round で、丸のアバターは情報ではなく CTA と競合する視覚ノイズだと分かった（target-missing / denied で
/// KEEP ↔ FIX_CANDIDATE が揺れた）。署名は CTA より弱い階層に置く。
struct AvatarHUDView: View {
    @ObservedObject var model: AvatarHUDModel
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // 署名（誰が言っているか）。CTA より弱く、状態より小さい。
            HStack(spacing: 6) {
                AstraVoiceMark().scaleEffect(0.75).frame(width: 18, height: 12)
                Text("Astra")
                    .font(.system(size: S.type(11), weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
                Spacer(minLength: 12)
                if model.showsClose {
                    Button(action: { model.onClose?() }) {
                        Image(systemName: "xmark").font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Palette.muted(dark))
                            .frame(width: 22, height: 22)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("案内をやめる")
                    .accessibilityIdentifier("guideAvatarClose")
                }
            }
            // 1 行目 = いまの状態（記号つき）、2 行目 = すること。
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                if let glyph = statusGlyph {
                    Image(systemName: glyph.0).font(.system(size: 12, weight: .bold)).foregroundStyle(glyph.1)
                }
                Text(lines.0)
                    .font(.system(size: S.type(13), weight: .semibold))
                    .foregroundStyle(Palette.text(dark))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let sub = lines.1 {
                Text(sub)
                    .font(.system(size: S.type(12)))
                    .foregroundStyle(Palette.muted(dark))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let action = model.action {
                // 押せるものは押せる形で（塗りのボタン）。カードの中でいちばん強い要素。
                Button(action.title) { action.run() }
                    .buttonStyle(.plain)
                    .font(.system(size: S.type(12), weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(Palette.accent(dark), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .padding(.top, 2)
                    .accessibilityIdentifier("guideAvatarAction")
            }
        }
        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 12)
        .frame(width: AvatarLayout.cardWidth, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Palette.border(dark), lineWidth: 1))
        .overlay(alignment: .leading) {
            // 状態の色を左の細い縁で添える（success / warning）。飾りの丸は置かない。
            if let glyph = statusGlyph {
                RoundedRectangle(cornerRadius: 2).fill(glyph.1).frame(width: 3).padding(.vertical, 12).padding(.leading, 1)
            }
        }
        .padding(6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("guideAvatar")
        .accessibilityLabel("Astra")
        .accessibilityValue(model.message)
    }

    /// 「状態\nすること」。改行が無ければ 1 行。
    private var lines: (String, String?) {
        let parts = model.message.split(separator: "\n", maxSplits: 1).map(String.init)
        return (parts.first ?? "", parts.count > 1 ? parts[1] : nil)
    }

    private var statusGlyph: (String, Color)? {
        switch model.state {
        case .success: return ("checkmark.circle.fill", Palette.success(dark))
        case .warning: return ("exclamationmark.triangle.fill", Palette.warning(dark))
        default: return nil
        }
    }
}

/// カードの状態（View は読むだけ。変えるのは `AvatarOverlayController`）。
@MainActor
final class AvatarHUDModel: ObservableObject {
    struct Action { let title: String; let run: () -> Void }
    @Published var state: AvatarState = .idle
    @Published var message: String = ""
    @Published var action: Action?
    @Published var showsClose = true
    var onClose: (() -> Void)?
}

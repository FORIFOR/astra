import SwiftUI

/// 右下のアバターと、その脇の短い吹き出し。白基調・Material・角丸 16・過剰な装飾なし。
struct AvatarHUDView: View {
    @ObservedObject var model: AvatarHUDModel
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            if !model.message.isEmpty {
                Text(model.message)
                    .font(.system(size: S.type(13), weight: .medium))
                    .foregroundStyle(Palette.text(dark))
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: AvatarLayout.bubbleMaxWidth, alignment: .leading)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Palette.border(dark), lineWidth: 1))
                    .accessibilityIdentifier("guideAvatarBubble")
            }
            avatar
        }
        .padding(4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("guideAvatar")
    }

    private var avatar: some View {
        ZStack {
            Circle().fill(.regularMaterial)
            Circle().stroke(Palette.border(dark), lineWidth: 1)
            switch model.state {
            case .success:
                Image(systemName: "checkmark").font(.system(size: 26, weight: .semibold)).foregroundStyle(Palette.success(dark))
            case .warning:
                Image(systemName: "exclamationmark").font(.system(size: 26, weight: .semibold)).foregroundStyle(Palette.warning(dark))
            case .thinking:
                AstraOrb(active: true)
            default:
                AstraVoiceMark()
            }
            if model.state == .guiding {
                Circle().stroke(Palette.accent(dark).opacity(0.55), lineWidth: 2).padding(2)
            }
        }
        .frame(width: AvatarLayout.avatarSize, height: AvatarLayout.avatarSize)
        .overlay(alignment: .topTrailing) {
            if model.showsClose {
                Button(action: { model.onClose?() }) {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.muted(dark))
                        .frame(width: 18, height: 18).background(Circle().fill(.regularMaterial))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("案内をやめる")
                .accessibilityIdentifier("guideAvatarClose")
            }
        }
        .accessibilityLabel("Astra")
        .accessibilityValue(model.message)
    }
}

/// アバター面の状態（View は読むだけ。変えるのは `AvatarOverlayController`）。
@MainActor
final class AvatarHUDModel: ObservableObject {
    @Published var state: AvatarState = .idle
    @Published var message: String = ""
    @Published var showsClose = true
    var onClose: (() -> Void)?
}

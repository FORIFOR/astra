import SwiftUI

/// 右下のアバターと、その脇の短い吹き出し。白基調・Material・角丸 16・過剰な装飾なし。
///
/// 盲検（3 model）で直したこと: × はアバターの丸ではなく吹き出しの端に置く（丸の縁に重なって帰属が曖昧だった）、
/// 成功の ✓ は丸だけに描く（文にも ✓ があると二重、OCR も読めない）、失敗と成功で丸の地の色を変える、
/// 「システム設定を開く」の操作子を吹き出しに持つ（文章だけで放り出さない）。
struct AvatarHUDView: View {
    @ObservedObject var model: AvatarHUDModel
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            if !model.message.isEmpty { bubble }
            avatar
        }
        .padding(4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("guideAvatar")
    }

    private var bubble: some View {
        HStack(alignment: .center, spacing: 10) {
            Text(model.message)
                .font(.system(size: S.type(13), weight: .medium))
                .foregroundStyle(Palette.text(dark))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: AvatarLayout.bubbleMaxWidth, alignment: .leading)
            if let action = model.action {
                Button(action.title) { action.run() }
                    .buttonStyle(.plain)
                    .font(.system(size: S.type(12), weight: .semibold))
                    .foregroundStyle(Palette.accent(dark))
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Palette.accent(dark).opacity(0.16), in: Capsule())
                    .overlay(Capsule().stroke(Palette.accent(dark).opacity(0.35), lineWidth: 1))
                    .fixedSize()
                    .accessibilityIdentifier("guideAvatarAction")
            }
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
        .padding(.leading, 12).padding(.trailing, 6 + CalloutBubbleShape.tail).padding(.vertical, 7)
        // 吹き出しの尾はアバターを指す: 「誰が言っているか」を形で言う（丸と文が別々に浮いて見えた）。
        .background(.regularMaterial, in: CalloutBubbleShape(towards: .left))
        .overlay(CalloutBubbleShape(towards: .left).stroke(Palette.border(dark), lineWidth: 1))
        .accessibilityIdentifier("guideAvatarBubble")
    }

    /// 状態は丸の地の色と記号で言う（× はここに置かない）。
    private var avatar: some View {
        ZStack {
            Circle().fill(.regularMaterial)
            Circle().fill(tint.opacity(model.state == .guiding || model.state == .idle ? 0.06 : 0.14))
            Circle().stroke(model.state == .guiding ? Palette.accent(dark).opacity(0.55) : Palette.border(dark), lineWidth: model.state == .guiding ? 1.5 : 1)
            switch model.state {
            case .success:
                Image(systemName: "checkmark").font(.system(size: 24, weight: .semibold)).foregroundStyle(Palette.success(dark))
            case .warning:
                Image(systemName: "exclamationmark").font(.system(size: 24, weight: .semibold)).foregroundStyle(Palette.warning(dark))
            case .thinking:
                AstraOrb(active: true)
            default:
                AstraVoiceMark()
            }
        }
        .frame(width: AvatarLayout.avatarSize, height: AvatarLayout.avatarSize)
        .accessibilityLabel("Astra")
        .accessibilityValue(model.message)
    }

    private var tint: Color {
        switch model.state {
        case .success: return Palette.success(dark)
        case .warning: return Palette.warning(dark)
        default: return Palette.accent(dark)
        }
    }
}

/// アバター面の状態（View は読むだけ。変えるのは `AvatarOverlayController`）。
@MainActor
final class AvatarHUDModel: ObservableObject {
    struct Action { let title: String; let run: () -> Void }
    @Published var state: AvatarState = .idle
    @Published var message: String = ""
    @Published var action: Action?
    @Published var showsClose = true
    var onClose: (() -> Void)?
}

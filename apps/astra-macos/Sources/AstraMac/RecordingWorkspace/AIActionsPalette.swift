import SwiftUI

/// 中央右の AI 操作。要約 / 質問 / 決定事項 / アクション。
struct AIActionsPalette: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject var state: RecordingWorkspaceState

    private struct Action: Identifiable {
        let id = UUID()
        let icon: String
        let title: String
    }
    private let actions = [
        Action(icon: "sparkles", title: "リアルタイム要約"),
        Action(icon: "questionmark.bubble", title: "質問する"),
        Action(icon: "checkmark.circle", title: "決定事項"),
        Action(icon: "arrow.right.circle", title: "アクション"),
    ]

    var body: some View {
        // Hero の直下に横一列。以前は独立した白カードで、右の文字起こし面と視覚的な重さが
        // 釣り合わず「浮いた小箱」に見えていた。面を敷かず、操作だけを静かに並べる。
        HStack(spacing: 6) {
            ForEach(actions) { action in
                Button { state.runAIAction(action.title) } label: {
                    HStack(spacing: 5) {
                        Image(systemName: action.icon).font(.system(size: 10))
                            .foregroundStyle(Color.astraAccent)
                        Text(action.title)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.primary)
                    }
                    .padding(.horizontal, 11)
                    // 小さい字でも押せる面を確保する（UI/UX 仕様 §16: hit area 28〜32pt）。
                    .frame(height: 30)
                    .background(
                        RoundedRectangle(cornerRadius: 9).fill(Color.subtleFill(dark, 0.045))
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("ai-\(action.title)")
            }
        }
        .accessibilityIdentifier("aiActions")
    }
}

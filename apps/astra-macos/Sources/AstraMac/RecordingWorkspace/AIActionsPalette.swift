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

    /// 文字起こしが無ければ、この 4 つは何も材料が無いまま走ることになる。
    /// 押せてしまうと「頼んだのに空で返った」になるので、押せなくする。
    private var hasMaterial: Bool { state.transcript.contains { !$0.interim } }

    var body: some View {
        // Hero の直下に横一列。以前は独立した白カードで、右の文字起こし面と視覚的な重さが
        // 釣り合わず「浮いた小箱」に見えていた。面を敷かず、操作だけを静かに並べる。
        // 右レール（320pt）では 1 行に 4 つ入らず、語の途中で折り返していた。
        // 2 列に置いて、名前を最後まで読めるようにする。
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)],
                  spacing: 6) {
            ForEach(actions) { action in
                Button { state.runAIAction(action.title) } label: {
                    HStack(spacing: 5) {
                        Image(systemName: action.icon).font(.system(size: 10))
                            .foregroundStyle(Color.astraAccent)
                        Text(action.title)
                            .font(.system(size: TypeScale.microSize, weight: .medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.9)
                            .foregroundStyle(Color.primary)
                    }
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity)
                    // 小さい字でも押せる面を確保する（UI/UX 仕様 §16: hit area 28〜32pt）。
                    .frame(height: 32)
                    .opacity(hasMaterial ? 1 : 0.4)
                }
                .buttonStyle(AstraControlStyle(radius: 9, base: 0.045))
                .disabled(!hasMaterial)
                .help(hasMaterial ? action.title : "まだ文字起こしがありません")
                .accessibilityIdentifier("ai-\(action.title)")
            }
        }
        .accessibilityIdentifier("aiActions")
    }
}

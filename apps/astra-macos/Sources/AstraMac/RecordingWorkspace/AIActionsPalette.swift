import SwiftUI

/// Ask 入力の右に並ぶ、よく頼むこと。要約 / 決定事項 / アクション。
///
/// 以前は右レールの下に 2×2 の白いボタンで置いていた。「この会議について聞く」の
/// 入力欄と 4 つのボタンが同じ仕事（AI に頼む）を 2 か所でしていて、右下の
/// 4 つは文字起こしの下に**別の道具箱**として浮いていた。頼む場所は 1 つ ——
/// 入力欄の中。よく頼むことはその横に、押せば入力した扱いになる語として置く。
/// 「質問する」は消えた。入力欄そのものが質問するところなので。
struct AIActionsPalette: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject var state: RecordingWorkspaceState

    private struct Action: Identifiable {
        var id: String { title }
        let title: String
        /// `runAIAction` が知っている名前。表示は短く、指示は変えない。
        let command: String
    }
    private let actions = [
        Action(title: "要約", command: "リアルタイム要約"),
        Action(title: "決定事項", command: "決定事項"),
        Action(title: "アクション", command: "アクション"),
    ]

    /// 文字起こしが無ければ、この 3 つは何も材料が無いまま走ることになる。
    /// 押せてしまうと「頼んだのに空で返った」になるので、押せなくする。
    private var hasMaterial: Bool { state.transcript.contains { !$0.interim } }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(actions) { action in
                Button { state.runAIAction(action.command) } label: {
                    Text(action.title)
                        .font(.system(size: TypeScale.microSize, weight: .medium))
                        .foregroundStyle(Palette.muted(dark))
                        .lineLimit(1)
                        .padding(.horizontal, 9)
                        // 小さい字でも押せる面を確保する（UI/UX 仕様 §16: hit area 28〜32pt）。
                        .frame(height: 28)
                        .opacity(hasMaterial ? 1 : 0.4)
                }
                .buttonStyle(AstraControlStyle(radius: 7, base: 0.04))
                .disabled(!hasMaterial)
                .help(hasMaterial ? action.command : "まだ文字起こしがありません")
                .accessibilityIdentifier("ai-\(action.command)")
            }
        }
        .accessibilityIdentifier("aiActions")
    }
}

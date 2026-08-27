import SwiftUI

/// 中央右の AI 操作。要約 / 質問 / 決定事項 / アクション。
struct AIActionsPalette: View {
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
        VStack(spacing: 4) {
            ForEach(actions) { action in
                Button {} label: {
                    HStack(spacing: 9) {
                        Image(systemName: action.icon).frame(width: 15).foregroundStyle(Color.astraAccent)
                        Text(action.title)
                        Spacer(minLength: 0)
                    }
                    .font(.system(size: 11, weight: .medium))
                    .padding(.horizontal, 9)
                    .frame(height: 30)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(7)
        .frame(width: Metrics.assistantWidth)
        .background(
            RoundedRectangle(cornerRadius: 12).fill(.white)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.black.opacity(0.08)))
                .shadow(color: .black.opacity(0.05), radius: 10, y: 3)
        )
        .accessibilityIdentifier("aiActions")
    }
}

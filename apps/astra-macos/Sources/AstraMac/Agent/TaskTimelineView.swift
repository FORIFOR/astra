import SwiftUI

/// §15 Agent が何をしているかを段階で見せる。
///
/// ```text
/// ✓ 文脈を集める
/// ● 会議の文字起こしを読む
/// ○ 答えをまとめる
/// ```
///
/// 進捗バーではなく**手順**を出すのは、待たされている間に「何を見ているか」が
/// 分かるようにするため（§25 と同じ理由）。描画元は `AstraState.activeTask` の 1 箇所だけ。
struct TaskTimelineView: View {
    @ObservedObject private var store = AstraStateStore.shared
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    var body: some View {
        if let task = store.state.activeTask {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(task.title)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Palette.text(dark))
                    Spacer(minLength: 0)
                    if !task.context.items.isEmpty {
                        // §25 「AI がいま何を見ているか」をその場に出す。
                        Text(task.context.visibleSources.joined(separator: " · "))
                            .font(.system(size: 9))
                            .foregroundStyle(Palette.muted(dark))
                            .lineLimit(1)
                    }
                }
                ForEach(task.steps) { step in
                    HStack(spacing: 7) {
                        Image(systemName: icon(step.state))
                            .font(.system(size: 9))
                            .foregroundStyle(tint(step.state))
                            .frame(width: 12)
                        Text(step.title)
                            .font(.system(size: 11))
                            .foregroundStyle(step.state == .pending ? Palette.muted(dark) : Palette.text(dark))
                        Spacer(minLength: 0)
                    }
                    .accessibilityIdentifier("step-\(step.tool)")
                }
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.cardSurface(dark))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.hairline(dark)))
            )
            .accessibilityIdentifier("taskTimeline")
        }
    }

    private func icon(_ s: AgentRunState) -> String {
        switch s {
        case .pending: return "circle"
        case .running: return "circle.fill"
        case .success: return "checkmark"
        case .failed: return "xmark"
        }
    }

    private func tint(_ s: AgentRunState) -> Color {
        switch s {
        case .pending: return Palette.muted(dark)
        case .running: return Palette.accent(dark)
        case .success: return Palette.success(dark)
        case .failed: return Palette.danger(dark)
        }
    }
}

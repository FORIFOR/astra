import SwiftUI

/// §21 Meeting Canvas。Markdown を出すのではなく、分類済みの構造データから描く。
///
/// 会議中に欲しいのは文章ではなく「決まったこと・やること・宿題・懸念」の区別なので、
/// そこを崩さずに出す。空の区分は出さない（空の見出しが並ぶと、何も起きていないのに忙しく見える）。
struct MeetingCanvasView: View {
    @ObservedObject private var store = AstraStateStore.shared
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    var body: some View {
        let canvas = store.state.meeting.canvas
        if !canvas.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                group("決まったこと", canvas.decisions, "checkmark.circle", Palette.success(dark))
                group("やること", canvas.actions, "arrow.right.circle", Palette.accent(dark))
                group("質問", canvas.questions, "questionmark.circle", Palette.muted(dark))
                group("懸念", canvas.concerns, "exclamationmark.triangle", Palette.warning(dark))
            }
            // 左列の幅に揃える。内容幅のままだと、隣の全高カードに対して浮いて見えた。
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.cardSurface(dark))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.hairline(dark)))
            )
            .accessibilityIdentifier("meetingCanvas")
        }
    }

    @ViewBuilder
    private func group(_ title: String, _ lines: [CanvasItem], _ icon: String, _ tint: Color) -> some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Image(systemName: icon).font(.system(size: 9)).foregroundStyle(tint)
                    Text(title).font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.muted(dark))
                }
                // 拾った行には出所を添える。誰がいつ言ったのかが無いと、
                // 拾い間違いに気づけないし、直しようもない。
                ForEach(lines.suffix(3)) { line in
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        if let t = line.timeLabel {
                            Text(t)
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(Palette.muted(dark))
                        }
                        if let who = line.speaker {
                            Text(who)
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(tint)
                        }
                        Text(line.text)
                            .font(.system(size: 11))
                            .foregroundStyle(Palette.text(dark))
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .accessibilityIdentifier("canvas-\(title)")
        }
    }
}

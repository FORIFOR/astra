import SwiftUI

/// 今週の負荷。**事実だけ**（会議時間・期限・未返信・待ち）。推測を止めていても出る。
///
/// 4 本の細い横棒。長さは目安の上限（会議 20h・期限 5・未返信 10・待ち 10）に対する割合で、
/// 数字はその横に小さく。棒だけでは「多いのか」が分からず、数字だけでは目で比べられない。
struct WorkPressureView: View {
    let week: WorkWeekLoad
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    private var rows: [(label: String, value: String, ratio: Double)] {
        [
            ("会議", hours(week.meetingHours), min(1, week.meetingHours / 20)),
            ("期限", "\(week.deadlines)", min(1, Double(week.deadlines) / 5)),
            ("未返信", "\(week.unanswered)", min(1, Double(week.unanswered) / 10)),
            ("待ち", "\(week.waiting)", min(1, Double(week.waiting) / 10)),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(Facts.workWeekTitle)
                .font(.system(size: S.type(TypeScale.microSize), weight: .semibold))
                .foregroundStyle(Palette.muted(dark))
                .tracking(0.4)
            // 2 × 2。縦に 4 本並べると、それだけで 1 件分の高さになる。
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 24), GridItem(.flexible())], alignment: .leading, spacing: 6) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: 8) {
                        Text(row.label)
                            .font(.system(size: S.type(TypeScale.captionSize)))
                            .foregroundStyle(Palette.muted(dark))
                            .frame(width: 40, alignment: .leading)
                        GeometryReader { g in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Palette.border(dark))
                                Capsule()
                                    .fill(Palette.accent(dark).opacity(0.35 + 0.65 * row.ratio))
                                    .frame(width: max(row.ratio > 0 ? 4 : 0, g.size.width * row.ratio))
                            }
                        }
                        .frame(height: 4)
                        Text(row.value)
                            .font(.system(size: S.type(TypeScale.captionSize), design: .monospaced))
                            .foregroundStyle(Palette.text(dark))
                            .frame(width: 36, alignment: .trailing)
                    }
                }
            }
        }
        .padding(.horizontal, S.metric(Space.cardPadding))
        .frame(maxWidth: 520, alignment: .leading)
        .accessibilityIdentifier("workWeekLoad")
    }

    private func hours(_ h: Double) -> String {
        h == h.rounded() ? "\(Int(h))h" : String(format: "%.1fh", h)
    }
}

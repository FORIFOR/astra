import SwiftUI

/// 次の会議の brief。Home の Work Context の下に 1 行、押すと 前回 / その後 / 開いている件 / 今日確認したいこと。
///
/// 事実はすべて出所つき（brief は cloud が artifact から機械で組む）。質問は理由を持つ。
/// 窓は増やさない。[会議を始める] は既存の録音開始（予定を引き継ぐ）。
struct MeetingBriefRow: View {
    @ObservedObject private var store = WorkContextStore.shared
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }

    var body: some View {
        if let b = store.brief {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Image(systemName: "calendar.badge.clock").font(.system(size: 12)).foregroundStyle(Palette.muted(dark))
                    Text(Facts.briefTitle)
                        .font(.system(size: S.type(TypeScale.microSize), weight: .semibold))
                        .foregroundStyle(Palette.muted(dark)).tracking(0.4)
                    Text(WorkFormat.due(b.startsAt) ?? "")
                        .font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                        .foregroundStyle(Palette.text(dark))
                    Text(b.title)
                        .font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                        .foregroundStyle(Palette.text(dark)).lineLimit(1)
                    if !b.openItems.isEmpty {
                        Text("前回から未解決 \(b.openItems.count) 件")
                            .font(.system(size: S.type(TypeScale.captionSize)))
                            .foregroundStyle(Palette.warning(dark))
                    }
                    Spacer(minLength: 8)
                    Button { store.briefOpen.toggle() } label: {
                        Text(store.briefOpen ? Facts.briefClose : Facts.briefPrepare)
                            .font(.system(size: S.type(TypeScale.microSize), weight: .medium))
                            .foregroundStyle(Palette.accent(dark))
                            .frame(height: 26).padding(.horizontal, 10)
                    }
                    .buttonStyle(AstraControlStyle(radius: 7, base: 0.05))
                    .accessibilityIdentifier("briefToggle")
                }
                if store.briefOpen {
                    VStack(alignment: .leading, spacing: 8) {
                        section(Facts.briefPrevious, b.previous, empty: "前回の会議の記録はありません")
                        section(Facts.briefSince, b.sinceLastMeeting, empty: "前回から届いたメールはありません")
                        section(Facts.briefOpen, b.openItems, empty: "開いている件はありません")
                        VStack(alignment: .leading, spacing: 4) {
                            Text(Facts.briefQuestions)
                                .font(.system(size: S.type(TypeScale.captionSize), weight: .semibold))
                                .foregroundStyle(Palette.muted(dark))
                            if b.suggestedQuestions.isEmpty {
                                Text("開いている件が無いので、確かめることはありません")
                                    .font(.system(size: S.type(TypeScale.secondarySize)))
                                    .foregroundStyle(Palette.muted(dark))
                            }
                            ForEach(b.suggestedQuestions) { q in
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("→ \(q.question)")
                                        .font(.system(size: S.type(TypeScale.secondarySize)))
                                        .foregroundStyle(Palette.text(dark))
                                    Text("\(q.reason) · \(Facts.sourceLabel) \(q.sources.count)")
                                        .font(.system(size: S.type(TypeScale.captionSize)))
                                        .foregroundStyle(Palette.muted(dark))
                                }
                            }
                        }
                        HStack {
                            Spacer(minLength: 0)
                            Button {
                                RecordingWorkspaceState.shared.pendingCalendarLink = CalendarLink(
                                    eventId: b.eventId, title: b.title, participantCount: 0, meetingURL: nil, projectId: b.project)
                                RecordingWorkspaceState.shared.start()
                            } label: {
                                HStack(spacing: 5) {
                                    Circle().fill(Color.recordingRed).frame(width: 7, height: 7)
                                    Text(Facts.briefStart).font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                                }
                                .foregroundStyle(Palette.text(dark))
                                .frame(height: 30).padding(.horizontal, 12)
                            }
                            .buttonStyle(AstraControlStyle(radius: 8, base: 0.05))
                            .accessibilityIdentifier("briefStartMeeting")
                        }
                    }
                    .padding(.leading, 22)
                    .accessibilityIdentifier("briefBody")
                }
            }
            .padding(.horizontal, S.metric(Space.cardPadding))
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Color.hairline(dark))))
            .accessibilityIdentifier("meetingBrief")
        }
    }

    private func section(_ title: String, _ facts: [BriefFact], empty: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: S.type(TypeScale.captionSize), weight: .semibold))
                .foregroundStyle(Palette.muted(dark))
            if facts.isEmpty {
                Text(empty).font(.system(size: S.type(TypeScale.secondarySize))).foregroundStyle(Palette.muted(dark))
            }
            ForEach(facts) { f in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("・\(f.text)")
                        .font(.system(size: S.type(TypeScale.secondarySize)))
                        .foregroundStyle(Palette.text(dark))
                    Text("\(Facts.sourceLabel) \(f.sources.count)")
                        .font(.system(size: S.type(TypeScale.captionSize)))
                        .foregroundStyle(Palette.muted(dark))
                }
            }
        }
    }
}

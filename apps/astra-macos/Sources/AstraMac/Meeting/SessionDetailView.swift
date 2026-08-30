import SwiftUI

/// 会議 1 件の中身。Home の Session Card から開く。
///
/// 今回は導線を通すのが目的なので、面は Overview / Transcript / Notes / Actions / Decisions の
/// 5 つだけ。**新しい window は出さない**（Workspace の中で開く）。
struct SessionDetailView: View {
    /// §10 Interface Size を変えたら描き直す（購読していないと変わらない）。
    @ObservedObject private var uiScale = UIScale.shared
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    let session: MeetingSession
    @ObservedObject private var store = AstraStateStore.shared
    @ObservedObject private var recording = RecordingWorkspaceState.shared
    @State private var tab: Tab = .overview

    enum Tab: String, CaseIterable, Identifiable {
        case overview, transcript, notes, actions, decisions
        var id: String { rawValue }
        var title: String {
            switch self {
            case .overview: return "Overview"
            case .transcript: return "Transcript"
            case .notes: return "Notes"
            case .actions: return "Actions"
            case .decisions: return "Decisions"
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(Palette.border(dark))
            ScrollView {
                content
                    .padding(28)
                    .frame(maxWidth: 900, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(Palette.canvas(dark))
        .accessibilityIdentifier("sessionDetail")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Button { MainNav.shared.openSession = nil } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Palette.muted(dark))
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
                .accessibilityIdentifier("sessionBack")
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.title)
                        .font(.system(size: S.type(TypeScale.pageTitleSize), weight: TypeScale.pageTitleWeight))
                        .foregroundStyle(Palette.text(dark))
                    Text("\(session.timeLabel()) · \(session.visibility.label)"
                         + (session.projectId.map { " · \($0)" } ?? ""))
                        .font(.system(size: S.type(TypeScale.secondarySize)))
                        .foregroundStyle(Palette.muted(dark))
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 4) {
                ForEach(Tab.allCases) { t in
                    Button { tab = t } label: {
                        Text(t.title)
                            .font(.system(size: S.type(TypeScale.secondarySize),
                                          weight: tab == t ? .semibold : .regular))
                            .foregroundStyle(tab == t ? Palette.text(dark) : Palette.muted(dark))
                            .frame(height: 30).padding(.horizontal, 12)
                    }
                    .buttonStyle(AstraControlStyle(radius: 8, base: tab == t ? 0.06 : 0.0))
                    .accessibilityIdentifier("sessionTab-\(t.rawValue)")
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 28)
        .padding(.top, 20)
        .padding(.bottom, 14)
    }

    @ViewBuilder private var content: some View {
        let canvas = store.state.meeting.canvas
        switch tab {
        case .overview:
            VStack(alignment: .leading, spacing: 14) {
                if let summary = session.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.system(size: S.type(TypeScale.bodySize)))
                        .foregroundStyle(Palette.text(dark))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("要約はまだありません。")
                        .font(.system(size: S.type(TypeScale.bodySize)))
                        .foregroundStyle(Palette.muted(dark))
                }
                HStack(spacing: 18) {
                    stat("\(session.participantCount)", "participants")
                    stat("\(session.actionCount)", "actions")
                    stat("\(session.decisionCount)", "decisions")
                    Spacer(minLength: 0)
                }
            }
        case .transcript:
            lines(recording.transcript.map { "\($0.speaker): \($0.text)" },
                  empty: "文字起こしはまだありません。")
        case .notes:
            lines(canvas.notes.map(\.text), empty: "ノートはまだありません。")
        case .actions:
            lines(canvas.actions.map(\.text), empty: "やることはまだありません。")
        case .decisions:
            lines(canvas.decisions.map(\.text), empty: "決まったことはまだありません。")
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value)
                .font(.system(size: S.type(TypeScale.sectionTitleSize), weight: .semibold))
                .foregroundStyle(Palette.text(dark))
            Text(label)
                .font(.system(size: S.type(TypeScale.microSize)))
                .foregroundStyle(Palette.muted(dark))
        }
    }

    @ViewBuilder private func lines(_ items: [String], empty: String) -> some View {
        if items.isEmpty {
            Text(empty)
                .font(.system(size: S.type(TypeScale.bodySize)))
                .foregroundStyle(Palette.muted(dark))
        } else {
            VStack(alignment: .leading, spacing: 9) {
                ForEach(items, id: \.self) { line in
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Text("·").foregroundStyle(Palette.muted(dark))
                        Text(line)
                            .font(.system(size: S.type(TypeScale.bodySize)))
                            .foregroundStyle(Palette.text(dark))
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }
}

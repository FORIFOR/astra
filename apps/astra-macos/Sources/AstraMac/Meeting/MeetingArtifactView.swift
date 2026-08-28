import SwiftUI

/// §12.6 Meeting Artifact: Summary / Decisions / Action items に**引用番号**を付け、押すと
/// 該当 Transcript + timestamp（+ audio jump）を Inspector に出す（AC-09）。
/// 引用は「番号だけ」を出し、根拠で画面を埋めない（§1.2 Evidence on Demand）。
struct MeetingCitation: Identifiable {
    let id = UUID()
    let number: Int
    let text: String
    let transcriptTime: String   // jump 先の timestamp
    let speaker: String
}

struct MeetingArtifactView: View {
    @Environment(\.colorScheme) private var scheme
    var title: String
    var duration: String
    var participants: Int
    var summary: [MeetingCitation]
    var decisions: [MeetingCitation]
    var actionItems: [MeetingCitation]
    /// 引用番号を押した時に Inspector に出る内容（nil なら未選択）。
    var selected: MeetingCitation? = nil
    private var dark: Bool { scheme == .dark }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: Space.largePadding) {
                HStack {
                    Text(title).font(.system(size: TypeScale.sectionTitleSize, weight: TypeScale.sectionTitleWeight))
                        .foregroundStyle(Palette.text(dark))
                    Spacer()
                    Text("\(duration) · \(participants) participants")
                        .font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                }
                section("Summary", summary)
                section("Decisions \(decisions.count)", decisions)
                section("Action items \(actionItems.count)", actionItems)
                HStack(spacing: 6) {
                    ForEach(["Transcript", "Recording", "Related files", "Evidence"], id: \.self) { t in
                        Text(t)
                            .font(.system(size: TypeScale.microSize, weight: .medium))
                            .foregroundStyle(Palette.text(dark))
                            .padding(.horizontal, 10)
                            .frame(height: 28)   // §16 hit area
                            .background(RoundedRectangle(cornerRadius: 8).fill(Palette.muted(dark).opacity(0.10)))
                            .contentShape(Rectangle())
                    }
                }
                Spacer()
            }
            .padding(Space.cardPadding)
            .frame(maxWidth: .infinity, alignment: .leading)

            if let c = selected {   // AC-09: 引用 → transcript + timestamp を Inspector に
                Divider().overlay(Palette.border(dark))
                VStack(alignment: .leading, spacing: 6) {
                    Text("Evidence [\(c.number)]").font(.system(size: TypeScale.microSize, weight: .semibold))
                        .foregroundStyle(Palette.muted(dark))
                    HStack(spacing: 6) {
                        Text(c.transcriptTime).font(.system(size: TypeScale.microSize).monospaced())
                            .foregroundStyle(Palette.muted(dark))
                        Text(c.speaker).font(.system(size: TypeScale.microSize, weight: .semibold))
                            .foregroundStyle(Palette.accent(dark))
                    }
                    Text(c.text).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.text(dark))
                    Text("▶ audio jump \(c.transcriptTime)")
                        .font(.system(size: TypeScale.microSize, weight: .medium)).foregroundStyle(Palette.accent(dark))
                    Spacer()
                }
                .padding(Space.cardPadding)
                .frame(width: 320, alignment: .leading)   // §7.1 inspector 320px
                .background(Palette.surface(dark))
            }
        }
        .background(Palette.canvas(dark))
        .accessibilityIdentifier("meetingArtifact")
    }

    private func section(_ label: String, _ items: [MeetingCitation]) -> some View {
        // 見出しは小さく静かに、中身は 1 段大きく。余白ではなく**文字の重み**で階層を作る。
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.system(size: TypeScale.microSize, weight: .semibold))
                .kerning(0.6)
                .foregroundStyle(Palette.muted(dark))
            ForEach(items) { c in
                HStack(alignment: .top, spacing: 6) {
                    Text(c.text).font(.system(size: TypeScale.bodySize)).foregroundStyle(Palette.text(dark))
                    Text("[\(c.number)]")   // 押すと Inspector へ jump
                        .font(.system(size: TypeScale.microSize, weight: .semibold))
                        .foregroundStyle(Palette.accent(dark))
                    Spacer()
                }
            }
        }
    }
}

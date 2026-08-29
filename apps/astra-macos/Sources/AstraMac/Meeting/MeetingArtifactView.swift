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
    /// 音声へ飛ぶ手当て。無いときはリンクを出さない（押して何も起きない状態を作らない）。
    var onAudioJump: ((String) -> Void)?
    static let tabs = ["文字起こし", "録音", "関連ファイル", "根拠"]
    @State private var tab = MeetingArtifactView.tabs[0]
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
                    Text("\(duration) · \(participants) 人")
                        .font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                }
                // 画面の言語を揃える（ここだけ英語で、他は日本語だった）。
                section("要約", summary)
                section("決定事項 \(decisions.count)", decisions)
                section("アクション \(actionItems.count)", actionItems)
                // 箱に入った Text で、押せそうに見えて押せなかった（実機で判明）。
                // 実際に選べるボタンにし、いま見ている面を選択状態で示す。
                HStack(spacing: 6) {
                    ForEach(MeetingArtifactView.tabs, id: \.self) { t in
                        Button { tab = t } label: {
                            Text(t)
                                .font(.system(size: TypeScale.microSize, weight: .medium))
                                .foregroundStyle(Palette.text(dark))
                                .padding(.horizontal, 10)
                                .frame(height: 28)   // §16 hit area
                        }
                        .buttonStyle(AstraControlStyle(radius: 8, base: tab == t ? 0.10 : 0.04))
                        .accessibilityIdentifier("meetingTab-\(t)")
                    }
                }
                Spacer()
            }
            .padding(Space.cardPadding)
            .frame(maxWidth: .infinity, alignment: .leading)

            if let c = selected {   // AC-09: 引用 → transcript + timestamp を Inspector に
                Divider().overlay(Palette.border(dark))
                VStack(alignment: .leading, spacing: 6) {
                    Text("根拠 [\(c.number)]").font(.system(size: TypeScale.microSize, weight: .semibold))
                        .foregroundStyle(Palette.muted(dark))
                    HStack(spacing: 6) {
                        Text(c.transcriptTime).font(.system(size: TypeScale.microSize).monospaced())
                            .foregroundStyle(Palette.muted(dark))
                        Text(c.speaker).font(.system(size: TypeScale.microSize, weight: .semibold))
                            .foregroundStyle(Palette.accent(dark))
                    }
                    Text(c.text).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.text(dark))
                    // 押せる手当てが無いのにリンク色で出すと、押して何も起きない。
                    // 実際に飛べるときだけボタンとして見せる。
                    if let jump = onAudioJump {
                        Button { jump(c.transcriptTime) } label: {
                            Text("▶ \(c.transcriptTime) の音声へ")
                                .font(.system(size: TypeScale.microSize, weight: .medium))
                                .foregroundStyle(Palette.accent(dark))
                                .frame(height: 28).padding(.horizontal, 8)
                        }
                        .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
                        .accessibilityIdentifier("meetingAudioJump")
                    } else {
                        Text("音声 \(c.transcriptTime)")
                            .font(.system(size: TypeScale.microSize))
                            .foregroundStyle(Palette.muted(dark))
                    }
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

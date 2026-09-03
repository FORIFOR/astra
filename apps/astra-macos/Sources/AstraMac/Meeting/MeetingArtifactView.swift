import SwiftUI

/// §12.6 Meeting Artifact: Summary / Decisions / Action items に**引用番号**を付け、押すと
/// 該当 Transcript + timestamp（+ audio jump）を Inspector に出す（AC-09）。
/// 引用は「番号だけ」を出し、根拠で画面を埋めない（§1.2 Evidence on Demand）。
struct MeetingCitation: Identifiable {
    let id = UUID()
    /// 引用番号。要約・決定・アクションから引かれている発言だけが持つ。
    /// 文字起こしの他の行は nil（番号が無いものに [0] を付けない）。
    let number: Int?
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
    /// 一覧へ戻る。Library から開いた 1 件なので、出る道を面の中に持つ（`SessionDetailView` と同じ）。
    var onBack: (() -> Void)?
    /// 語は Dock / Workspace と同じ「出所」。面ごとに 根拠／出典 と言い換えない。
    static let tabs = ["文字起こし", "録音", "関連ファイル", Facts.sourceLabel]
    @State private var tab = MeetingArtifactView.tabs[0]
    var summary: [MeetingCitation]
    var decisions: [MeetingCitation]
    var actionItems: [MeetingCitation]
    /// Dock の Notes と同じ 5 つの群。無い群は出さない（空の見出しを並べない）。
    var questions: [MeetingCitation] = []
    var concerns: [MeetingCitation] = []
    var notes: [MeetingCitation] = []
    /// 引用番号を押した時に Inspector に出る内容（nil なら未選択）。
    var selected: MeetingCitation? = nil
    /// この会議の文字起こし。無ければ「まだ無い」と言う（タブだけ在って中身が無い状態を作らない）。
    var transcript: [MeetingCitation] = []
    /// 会議に紐づくファイル。
    var relatedFiles: [String] = []
    /// 録音が残っているか。
    var hasAudio: Bool = false

    /// 押された引用。外から渡された `selected` を初期値にする。
    ///
    /// 以前は `selected` が外からの指定だけで、`[1]` は「押すと Inspector へ jump」と
    /// 書いてあるただの `Text` だった。押しても何も起きず、AC-09 の導線は死んでいた。
    @State private var picked: MeetingCitation?
    private var shown: MeetingCitation? { picked ?? selected }

    /// 同じ発言か。`id` は生成のたびに変わる UUID なので、突き合わせには使えない
    /// （本文の引用とタブの一覧が別々に作られるため、一致せず光る行がずれていた）。
    /// 「いつ・誰が」で見る。
    private func isShown(_ c: MeetingCitation) -> Bool {
        guard let s = shown else { return false }
        return s.transcriptTime == c.transcriptTime && s.speaker == c.speaker
    }
    private var dark: Bool { scheme == .dark }

    /// 引用は 3 節にまたがるので、番号で引ける形にしておく。
    private var allCitations: [MeetingCitation] {
        // 要約は決まったこと／メモの 1 件目と同じ発言なので、出所の一覧では重ねない。
        let body = decisions + actionItems + questions + concerns + notes
        let extra = summary.filter { s in !body.contains { $0.transcriptTime == s.transcriptTime && $0.speaker == s.speaker } }
        return extra + body
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: Space.largePadding) {
                HStack(spacing: 10) {
                    if let back = onBack {
                        Button(action: back) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Palette.muted(dark))
                                .frame(width: 30, height: 30)
                        }
                        .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
                        .help("一覧へ戻る")
                        .accessibilityIdentifier("meetingBack")
                    }
                    Text(title).font(.system(size: TypeScale.sectionTitleSize, weight: TypeScale.sectionTitleWeight))
                        .foregroundStyle(Palette.text(dark))
                    Spacer()
                    Text("\(duration) · \(participants) 人")
                        .font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                }
                // 画面の言語を揃える（ここだけ英語で、他は日本語だった）。
                // 群の名前は Dock の Notes と同じ語（決まったこと／やること／質問／懸念／メモ）。
                if !summary.isEmpty { section(Facts.notesSummary, summary) }
                section("\(Facts.notesDecisions) \(decisions.count)", decisions)
                section("\(Facts.notesActions) \(actionItems.count)", actionItems)
                if !questions.isEmpty { section("質問 \(questions.count)", questions) }
                if !concerns.isEmpty { section("懸念 \(concerns.count)", concerns) }
                if !notes.isEmpty { section("\(Facts.meetingNotes) \(notes.count)", notes) }
                // 箱に入った Text で、押せそうに見えて押せなかった（実機で判明）。
                // 実際に選べるボタンにし、いま見ている面を選択状態で示す。
                HStack(spacing: 6) {
                    ForEach(MeetingArtifactView.tabs, id: \.self) { t in
                        Button { tab = t } label: {
                            Text(t)
                                .font(.system(size: TypeScale.microSize, weight: .medium))
                                .foregroundStyle(tab == t ? Palette.accent(dark) : Palette.text(dark))
                                .padding(.horizontal, 10)
                                .frame(height: 28)   // §16 hit area
                        }
                        .buttonStyle(AstraControlStyle(radius: 8, base: tab == t ? 0.10 : 0.04))
                        .accessibilityIdentifier("meetingTab-\(t)")
                    }
                }
                // タブは自分の色を変えるだけで、切り替わる中身が無かった。
                // 押した先を必ず出す。中身が無いものは「無い」と言う。
                tabContent
                Spacer(minLength: 0)
            }
            .padding(Space.cardPadding)
            .frame(maxWidth: .infinity, alignment: .leading)

            if let c = shown {   // AC-09: 引用 → transcript + timestamp を Inspector に
                Divider().overlay(Palette.border(dark))
                VStack(alignment: .leading, spacing: 6) {
                    Text(c.number.map { "\(Facts.sourceLabel) [\($0)]" } ?? "発言").font(.system(size: TypeScale.microSize, weight: .semibold))
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
        // 検査が「いま右に何が出ているか」を読む口。speaker|time。
        .onAppear { UIProbe.fact("meetingShown", shown.map { "\($0.speaker)|\($0.transcriptTime)" }) }
        .onChange(of: picked?.id) { _ in
            UIProbe.fact("meetingShown", shown.map { "\($0.speaker)|\($0.transcriptTime)" })
        }
        .onDisappear { UIProbe.fact("meetingShown", nil) }
    }

    /// 選んだタブの中身。持っていないものは、空欄ではなく理由を出す。
    @ViewBuilder private var tabContent: some View {
        switch tab {
        case "文字起こし":
            if transcript.isEmpty { emptyTab("この会議の文字起こしはまだありません。") }
            else { citationList(transcript) }
        case "録音":
            if hasAudio, let jump = onAudioJump {
                Button { jump(shown?.transcriptTime ?? "00:00") } label: {
                    Text("▶ 録音を再生")
                        .font(.system(size: TypeScale.secondarySize, weight: .medium))
                        .foregroundStyle(Palette.accent(dark))
                        .frame(height: 30).padding(.horizontal, 12)
                }
                .buttonStyle(AstraControlStyle(radius: 8, base: 0.05))
                .accessibilityIdentifier("meetingPlayAudio")
            } else {
                emptyTab("この会議の録音は残っていません。")
            }
        case "関連ファイル":
            if relatedFiles.isEmpty { emptyTab("紐づいたファイルはありません。") }
            else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(relatedFiles, id: \.self) { f in
                        HStack(spacing: 6) {
                            Image(systemName: "doc").font(.system(size: 10))
                                .foregroundStyle(Palette.muted(dark))
                            Text(f).font(.system(size: TypeScale.secondarySize))
                                .foregroundStyle(Palette.text(dark))
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
        default:   // 出所
            if allCitations.isEmpty { emptyTab("出所はまだありません。") }
            else { citationList(allCitations) }
        }
    }

    private func emptyTab(_ s: String) -> some View {
        Text(s)
            .font(.system(size: TypeScale.secondarySize))
            .foregroundStyle(Palette.muted(dark))
    }

    /// 発言の一覧。押すと右にその 1 件を出す（本文の引用番号と同じ動き）。
    private func citationList(_ items: [MeetingCitation]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(items) { c in
                ProbeButton(id: "citation-\(c.number.map(String.init) ?? c.transcriptTime)",
                            action: { picked = c }) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(c.transcriptTime)
                            .font(.system(size: TypeScale.microSize, design: .monospaced))
                            .foregroundStyle(Palette.muted(dark))
                            .frame(width: 42, alignment: .leading)
                        // 話者は位置で分かる。色は参照 [1][2][3] と選択行に取っておく（craftL）。
                        Text(c.speaker)
                            .font(.system(size: TypeScale.microSize, weight: .semibold))
                            .foregroundStyle(Palette.muted(dark))
                            .frame(width: 52, alignment: .leading)
                        Text(c.text)
                            .font(.system(size: TypeScale.secondarySize))
                            .foregroundStyle(Palette.text(dark))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                }
                .buttonStyle(AstraControlStyle(radius: 7, base: isShown(c) ? 0.08 : 0.0))
            }
        }
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
                    // 番号は**押せる**。以前はリンク色の Text で、押しても何も起きなかった。
                    // 出所の無い行（発言に結べなかった要約）には番号を付けない。[0] は嘘になる。
                    if let n = c.number {
                        ProbeButton(id: "citationRef-\(n)", action: { picked = c }) {
                            Text("[\(n)]")
                                .font(.system(size: TypeScale.microSize, weight: .semibold))
                                .foregroundStyle(Palette.accent(dark))
                                .padding(.horizontal, 5)
                                .frame(height: 24)   // §16 hit area
                        }
                        .buttonStyle(AstraControlStyle(radius: 6, base: isShown(c) ? 0.10 : 0.0))
                        .help("出所の発言を見る")
                    }
                    Spacer()
                }
            }
        }
    }
}

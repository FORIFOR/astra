import SwiftUI

/// 道具箱の選択に応じて中身を出す面: 文字起こし / 翻訳 / 字幕。
/// transcript は STT が埋める実データ。翻訳は Agent 経由。字幕は直近の 1 行を大きく。
struct TranscriptPanel: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject var state: RecordingWorkspaceState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            content
        }
        .padding(11)
        .frame(maxWidth: .infinity, minHeight: 190, maxHeight: .infinity, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 12).fill(Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.hairline(dark)))
                .shadow(color: .black.opacity(0.05), radius: 10, y: 3)
        )
        .accessibilityIdentifier("transcriptPanel")
    }

    @ViewBuilder private var content: some View {
        switch state.selectedTool {
        case .transcript:
            if state.transcript.isEmpty {
                // 「まだ発話がありません」は、聞けているのに誰も話していない、という意味になる。
                // 許可が無くて聞けていないなら、そう言う。待っても何も出ないので。
                empty(state.permissionIssue == nil
                      ? "まだ発話がありません。"
                      : "マイクが使えないので、聞き取れていません。")
            } else {
                // 時刻・話者・本文の 3 列。時刻が無いと、後から音のどこに戻ればよいか分からない。
                // まだ確定していない行は、薄いだけでは「小声」と見分けが付かないので、
                // 左に印を出して**まだ書き換わる行**だと分かるようにする。
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(state.transcript) { seg in
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Text(seg.timeLabel)
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundStyle(.tertiary)
                                        .frame(width: 34, alignment: .leading)
                                    Text(seg.speaker).font(.system(size: 11, weight: .semibold))
                                        .foregroundStyle(Color.astraAccent)
                                        .frame(width: 46, alignment: .leading)
                                        .lineLimit(1)
                                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                                        if seg.interim {
                                            Circle().fill(Color.astraAccent.opacity(0.55))
                                                .frame(width: 5, height: 5)
                                                .accessibilityLabel("確定前")
                                        }
                                        Text(seg.text).font(.system(size: 12))
                                            .foregroundStyle(seg.interim ? .secondary : .primary)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                                .id(seg.id)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                    // 話が進んだら最新行へ寄せる。手で追いかけさせない。
                    .onChange(of: state.transcript.count) {
                        guard let last = state.transcript.last else { return }
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
        case .translation:
            if state.translating { empty("翻訳中…") }
            else if state.translatedText.isEmpty { empty("「翻訳」を選ぶと文字起こしを訳します。") }
            else { ScrollView { Text(state.translatedText).font(.system(size: 11)).frame(maxWidth: .infinity, alignment: .leading) } }
        case .captions:
            VStack { Spacer()
                Text(state.transcript.last?.text ?? "…")
                    .font(.system(size: 16, weight: .medium)).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                Spacer() }
        }
    }

    private func empty(_ s: String) -> some View {
        Text(s).font(.system(size: 11)).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

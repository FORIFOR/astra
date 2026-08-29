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
                empty("まだ発話がありません。")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(state.transcript) { seg in
                            HStack(alignment: .top, spacing: 6) {
                                Text(seg.speaker).font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(Color.astraAccent).frame(width: 42, alignment: .leading)
                                Text(seg.text).font(.system(size: 11))
                                    .foregroundStyle(seg.interim ? .secondary : .primary)
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
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

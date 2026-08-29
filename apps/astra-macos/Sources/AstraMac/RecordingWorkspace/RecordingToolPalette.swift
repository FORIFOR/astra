import SwiftUI

/// 右列の見出し兼切替（文字起こし / 翻訳 / 字幕）。
///
/// 以前は左端に浮かぶ縦カードだった。**切替と結果が画面の左右に離れていて**目が往復するうえ、
/// カードが 1 枚増えるぶん情報が散らかっていたので、結果（TranscriptPanel）の真上に置く
/// 横並びのセグメントへ変えた。カード地は敷かず、面の一部として静かに見せる。
struct RecordingToolPalette: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @Binding var selection: RecordingTool

    var body: some View {
        HStack(spacing: 2) {
            ForEach(RecordingTool.allCases) { tool in
                Button {
                    selection = tool
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: tool.icon).font(.system(size: 10))
                        Text(tool.title)
                    }
                    .font(.system(size: 11, weight: selection == tool ? .semibold : .regular))
                    .foregroundStyle(selection == tool ? Color.primary : Color.secondary)
                    .padding(.horizontal, 10)
                    // 小さい字でも押せる面を確保する（UI/UX 仕様 §16: hit area 28〜32pt）。
                    .frame(height: 28)
                    .background {
                        if selection == tool {
                            RoundedRectangle(cornerRadius: 7).fill(Color.subtleFill(dark, 0.06))
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("tool-\(tool.rawValue)")
            }
            Spacer(minLength: 0)
        }
        .padding(3)
        .background(
            RoundedRectangle(cornerRadius: 10).fill(Color.subtleFill(dark, 0.035))
        )
        .accessibilityIdentifier("toolPalette")
    }
}

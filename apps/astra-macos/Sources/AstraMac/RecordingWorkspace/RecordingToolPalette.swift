import SwiftUI

/// 左の道具箱。文字起こし / 翻訳 / 字幕 の切替。
struct RecordingToolPalette: View {
    @Binding var selection: RecordingTool

    var body: some View {
        VStack(spacing: 3) {
            ForEach(RecordingTool.allCases) { tool in
                Button {
                    selection = tool
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: tool.icon).frame(width: 15)
                        Text(tool.title)
                        Spacer(minLength: 0)
                    }
                    .font(.system(size: 11, weight: .medium))
                    .padding(.horizontal, 9)
                    .frame(height: 31)
                    .background {
                        if selection == tool {
                            RoundedRectangle(cornerRadius: 7).fill(Color.black.opacity(0.065))
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(6)
        .frame(width: Metrics.paletteWidth)
        .background(cardBackground)
        .accessibilityIdentifier("toolPalette")
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 12).fill(.white)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.black.opacity(0.08)))
            .shadow(color: .black.opacity(0.05), radius: 10, y: 3)
    }
}

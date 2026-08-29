import SwiftUI

/// AI 操作の結果を出す面。**押した結果がどこにも出ない**状態だったので足した。
///
/// UI/UX 仕様 §6「AI が何を見ているか・何をしたかが分かる」/ §18「AI 処理開始表示 < 200ms」に沿い、
/// 走っている間は何をしているかを即出し（spinner だけにしない）、
/// 応答が無いうちは**空の箱を置かない**（左列の余白のままにする）。
struct AIResultPanel: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject var state: RecordingWorkspaceState

    var body: some View {
        if state.aiRunning || !state.aiResult.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles").font(.system(size: 10))
                        .foregroundStyle(Color.astraAccent)
                    Text(state.aiRunning ? "会議の文字起こしを読んでいます…" : "AI の結果")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    if !state.aiResult.isEmpty {
                        Button { state.aiResult = "" } label: {
                            Image(systemName: "xmark").font(.system(size: 9))
                                .foregroundStyle(.secondary)
                                .frame(width: 28, height: 28)   // §16 hit area
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("aiResultClose")
                    }
                }
                if !state.aiResult.isEmpty {
                    ScrollView {
                        Text(state.aiResult)
                            .font(.system(size: 12))
                            .foregroundStyle(.primary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 12).fill(Color.cardSurface(dark).opacity(0.85))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.hairline(dark)))
            )
            .accessibilityIdentifier("aiResult")
        }
    }
}

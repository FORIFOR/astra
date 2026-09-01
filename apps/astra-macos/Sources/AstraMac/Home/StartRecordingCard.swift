import SwiftUI

/// Home から会議を録り始める入口。
///
/// 押したら**その場で録音が始まる**。設定シートを挟まない
/// —— マイクも保存先も既定があるので、毎回聞く必要がない。
/// 設定を変えたいときだけ ⌄ から開く。
struct StartRecordingCard: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    /// 撮影や外の導線から開けるようにする。
    @ObservedObject private var opener = NewRecordingSheetOpener.shared

    var body: some View {
        HStack(spacing: 0) {
            // 本体は「録音を始めるボタン」。設定画面を開くボタンではない。
            Button { RecordingWorkspaceState.shared.start() } label: {
                HStack(spacing: 12) {
                    Circle().fill(Color.recordingRed).frame(width: 10, height: 10)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("録音を始める")
                            .font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight))
                            .foregroundStyle(Palette.text(dark))
                        Text("前回の設定でその場で録り始めます")
                            .font(.system(size: TypeScale.secondarySize))
                            .foregroundStyle(Palette.muted(dark))
                    }
                    Spacer(minLength: 0)
                }
                .padding(16)
                .contentShape(Rectangle())
            }
            .buttonStyle(AstraControlStyle(radius: 12, base: 0.0))
            .accessibilityIdentifier("startRecording")

            Divider().frame(height: 34).overlay(Palette.border(dark))

            // ⌄ は設定つきで始めるとき。
            Button { opener.open() } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
                    .frame(width: 44, height: 60)
            }
            .buttonStyle(AstraControlStyle(radius: 12, base: 0.0))
            .help("録音の設定を決めて始める")
            .accessibilityIdentifier("startRecordingOptions")
        }
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.hairline(dark)))
        )
        // 面は Home の上に重ねる（`.sheet` は macOS では実際に window を 1 枚増やすので使わない）。
    }
}

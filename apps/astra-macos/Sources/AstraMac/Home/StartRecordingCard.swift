import SwiftUI

/// Home から会議を録り始める入口。
///
/// 押したら**その場で録音が始まる**。設定シートを挟まない
/// —— マイクも保存先も既定があるので、毎回聞く必要がない。
/// 設定を変えたいときだけ ⌄ から開く。
struct StartRecordingCard: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @State private var showsOptions = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Circle().fill(Color.recordingRed).frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Start recording")
                        .font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight))
                        .foregroundStyle(Palette.text(dark))
                    Text("会議や打ち合わせをその場で録り始めます")
                        .font(.system(size: TypeScale.secondarySize))
                        .foregroundStyle(Palette.muted(dark))
                }
                Spacer(minLength: 12)
                Button { showsOptions.toggle() } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Palette.muted(dark))
                        .frame(width: 30, height: 30)   // §16 hit area
                }
                .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
                .help("録音の設定")
                .accessibilityIdentifier("startRecordingOptions")
            }
            .padding(16)
            .contentShape(Rectangle())
            .onTapGesture { RecordingWorkspaceState.shared.start() }

            if showsOptions {
                Divider().overlay(Palette.border(dark))
                VStack(alignment: .leading, spacing: 10) {
                    optionRow("マイク", Permissions.microphone == .granted ? "使えます" : "許可が要ります",
                              ok: Permissions.microphone == .granted)
                    optionRow("相手の音声", Permissions.screenRecording == .granted ? "取り込みます" : "画面の許可が要ります",
                              ok: Permissions.screenRecording == .granted)
                    optionRow("保存先", "この Mac の中（My Space）", ok: true)
                    optionRow("音声の保存", "残しません（文字起こしとノートだけ）", ok: true)
                }
                .padding(16)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.cardSurface(dark))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.hairline(dark)))
        )
        .accessibilityIdentifier("startRecording")
    }

    private func optionRow(_ title: String, _ value: String, ok: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: ok ? "checkmark.circle" : "exclamationmark.triangle")
                .font(.system(size: 11))
                .foregroundStyle(ok ? Palette.success(dark) : Palette.warning(dark))
            Text(title)
                .font(.system(size: TypeScale.secondarySize))
                .foregroundStyle(Palette.muted(dark))
                .frame(width: 90, alignment: .leading)
            Text(value)
                .font(.system(size: TypeScale.secondarySize))
                .foregroundStyle(Palette.text(dark))
            Spacer(minLength: 0)
        }
    }
}

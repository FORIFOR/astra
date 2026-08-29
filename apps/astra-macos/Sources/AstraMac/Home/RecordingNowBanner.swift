import SwiftUI

/// 録音中に Home の最上部へ出るバー。
///
/// 録音のために画面を切り替えさせない。ここから直接ノートを開ける／止められる。
struct RecordingNowBanner: View {
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var store = AstraStateStore.shared
    @ObservedObject private var recording = RecordingWorkspaceState.shared

    var body: some View {
        HStack(spacing: 14) {
            Circle().fill(Color.recordingRed).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text("Recording now")
                    .font(.system(size: TypeScale.microSize, weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
                Text(store.state.meeting.detectedApp ?? "会議")
                    .font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight))
                    .foregroundStyle(Palette.text(dark))
            }
            Waveform(levels: recording.audioLevels)
                .frame(width: 64, height: 18)
            Text(recording.elapsedText)
                .font(.system(size: TypeScale.bodySize, design: .monospaced))
                .foregroundStyle(Palette.muted(dark))
            Spacer(minLength: 12)
            Button("Open live notes") { VoiceHUDState.shared.toggleMeetingPanel(.notes) }
                .font(.system(size: TypeScale.secondarySize, weight: .medium))
                .foregroundStyle(Palette.accent(dark))
                .frame(height: 30).padding(.horizontal, 12)
                .buttonStyle(AstraControlStyle(radius: 8, base: 0.0))
                .accessibilityIdentifier("openLiveNotes")
            Button("Stop") { RecordingWorkspaceState.shared.stop() }
                .font(.system(size: TypeScale.secondarySize, weight: .medium))
                .foregroundStyle(Palette.danger(dark))
                .frame(height: 30).padding(.horizontal, 12)
                .buttonStyle(AstraControlStyle(radius: 8, base: 0.05))
                .accessibilityIdentifier("stopFromHome")
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.recordingRed.opacity(dark ? 0.14 : 0.07))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.recordingRed.opacity(0.28)))
        )
        .accessibilityIdentifier("recordingNow")
    }
}

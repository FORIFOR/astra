import SwiftUI

/// 録音中に Home の最上部へ出るカード。
///
/// **Recent Sessions の同じ Session を指す**（別の状態を持たない）。
/// 録音のために画面を切り替えさせない。ここからライブノートを開ける／止められる。
struct RecordingNowCard: View {
    /// §10 Interface Size を変えたら描き直す（購読していないと変わらない）。
    @ObservedObject private var uiScale = UIScale.shared
    @Environment(\.colorScheme) private var scheme
    private var dark: Bool { scheme == .dark }
    @ObservedObject private var recording = RecordingWorkspaceState.shared
    let session: MeetingSession

    @State private var tick = Date()
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Circle().fill(Color.recordingRed).frame(width: 9, height: 9)
                Text("Recording now")
                    .font(.system(size: S.type(TypeScale.microSize), weight: .semibold))
                    .foregroundStyle(Palette.muted(dark))
                Spacer(minLength: 0)
                Text(session.elapsedLabel(now: tick))
                    .font(.system(size: S.type(TypeScale.bodySize), design: .monospaced))
                    .foregroundStyle(Palette.text(dark))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(session.title)
                    .font(.system(size: S.type(TypeScale.sectionTitleSize), weight: TypeScale.sectionTitleWeight))
                    .foregroundStyle(Palette.text(dark))
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: S.type(TypeScale.secondarySize)))
                    .foregroundStyle(Palette.muted(dark))
            }
            Waveform(levels: recording.audioLevels)
                .frame(height: 22)
            HStack(spacing: 8) {
                Button("Open live notes") { VoiceHUDState.shared.toggleMeetingPanel(.notes) }
                    .font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                    .foregroundStyle(Palette.accent(dark))
                    .frame(height: 32).padding(.horizontal, 14)
                    .buttonStyle(AstraControlStyle(radius: 8, base: 0.05))
                    .accessibilityIdentifier("openLiveNotes")
                Button("Ask Astra") { VoiceHUDState.shared.toggleMeetingPanel(.ask) }
                    .font(.system(size: S.type(TypeScale.secondarySize), weight: .medium))
                    .foregroundStyle(Palette.text(dark))
                    .frame(height: 32).padding(.horizontal, 14)
                    .buttonStyle(AstraControlStyle(radius: 8, base: 0.05))
                    .accessibilityIdentifier("askFromHome")
                Spacer(minLength: 0)
                Button("Stop") { RecordingWorkspaceState.shared.stop() }
                    .font(.system(size: S.type(TypeScale.secondarySize), weight: .semibold))
                    .foregroundStyle(Palette.danger(dark))
                    .frame(height: 32).padding(.horizontal, 16)
                    .buttonStyle(AstraControlStyle(radius: 8, base: 0.06))
                    .accessibilityIdentifier("stopFromHome")
            }
        }
        .padding(S.metric(Space.cardPadding))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.recordingRed.opacity(dark ? 0.13 : 0.06))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.recordingRed.opacity(0.3)))
        )
        .onReceive(timer) { tick = $0 }
        .accessibilityIdentifier("recordingNow")
    }

    private var subtitle: String {
        var parts: [String] = []
        if let source = session.source { parts.append(source) }
        if session.participantCount > 0 { parts.append("\(session.participantCount) participants") }
        if let project = session.projectId { parts.append(project) }
        return parts.isEmpty ? session.visibility.label : parts.joined(separator: " · ")
    }
}

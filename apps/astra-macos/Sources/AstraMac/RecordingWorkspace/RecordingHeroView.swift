import SwiftUI

/// 画面の主役: 録音状態を大きく見せる。● 録音中 / 04:21 / 波形。
struct RecordingHeroView: View {
    @ObservedObject var state: RecordingWorkspaceState

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.recordingRed.opacity(0.12)).frame(width: 72, height: 72)
                Circle().fill(state.isPaused ? Color.secondary : Color.recordingRed)
                    .frame(width: 18, height: 18)
            }
            Text(state.isPaused ? "一時停止中" : "録音中")
                .font(.system(size: 18, weight: .semibold))
            Text(state.elapsedText)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(.secondary)
            Waveform(levels: state.audioLevels)
                .frame(width: 180, height: 30)
        }
        .accessibilityIdentifier("recordingHero")
    }
}

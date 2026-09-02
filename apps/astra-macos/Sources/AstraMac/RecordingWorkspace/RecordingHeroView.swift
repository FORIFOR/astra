import SwiftUI

/// 画面の主役: 録音状態を大きく見せる。● 録音中 / 04:21 / 波形。
struct RecordingHeroView: View {
    @ObservedObject var state: RecordingWorkspaceState

    /// 音が入っていないとき、主役だけ元気に動いていると画面が嘘をつく。
    private var silent: Bool { state.permissionIssue != nil }

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.recordingRed.opacity(silent ? 0.06 : 0.12)).frame(width: 72, height: 72)
                Circle().fill(state.isPaused || silent ? Color.secondary : Color.recordingRed)
                    .frame(width: 18, height: 18)
            }
            // 見出しも合わせる。「録音中」だけだと、下のバナーと画面が食い違って見える。
            Text(silent ? "\(state.heroText)（音声なし）" : state.heroText)
                .font(.system(size: TypeScale.cardTitleSize, weight: TypeScale.cardTitleWeight))
            Text(state.elapsedText)
                .font(.system(size: TypeScale.secondarySize, design: .monospaced))
                .foregroundStyle(.secondary)
            // 許可が無いときは平らにする（動いていると「録れている」と読めてしまう）。
            Waveform(levels: silent ? Array(repeating: 0.04, count: state.audioLevels.count) : state.audioLevels)
                .frame(width: 180, height: 30)
                .opacity(silent ? 0.45 : 1)
        }
        .accessibilityIdentifier("recordingHero")
    }
}

import SwiftUI

/// 上辺の凹みに食い込む録音コントローラ。● 04:21 ⏸ CC □ … ■
struct TaskDockView: View {
    @ObservedObject var state: RecordingWorkspaceState

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(Color.recordingRed).frame(width: 7, height: 7)
            Text(state.elapsedText)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
            DockDivider()
            DockIcon(systemName: state.isPaused ? "play.fill" : "pause.fill") { state.togglePause() }
            DockIcon(systemName: "captions.bubble") { state.selectedTool = .transcript }
            DockIcon(systemName: "viewfinder") { state.captureScreenshot() }
            DockIcon(systemName: "ellipsis") {}
            DockDivider()
            StopRecordingButton { state.stop() }
        }
        .padding(.horizontal, 11)
        .frame(width: Metrics.dockWidth, height: Metrics.dockHeight)
        .foregroundStyle(.white)
        .background {
            Capsule().fill(Color.black.opacity(0.9))
                .background(VisualEffectView(material: .hudWindow).clipShape(Capsule()))
        }
        .overlay(Capsule().stroke(.white.opacity(0.1), lineWidth: 0.5))
        // continuity-bad: 濃い影で浮かせ、別の窓のように見せる。
        .shadow(color: .black.opacity(Fixture.current == .continuityBad ? 0.6 : 0.27),
                radius: Fixture.current == .continuityBad ? 30 : 14,
                y: Fixture.current == .continuityBad ? 16 : 5)
        .accessibilityIdentifier("taskDock")
    }
}

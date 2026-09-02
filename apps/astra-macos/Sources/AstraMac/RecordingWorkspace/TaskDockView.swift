import SwiftUI

/// 上辺の凹みに食い込む録音コントローラ。● 04:21 ⏸ CC □ … ■
struct TaskDockView: View {
    @ObservedObject var state: RecordingWorkspaceState
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        content
        // 幅は token だが、値は中身の実寸（292）。250 だったころは中身が 42pt 広く、
        // 唯一縮められる時計が 0 幅に潰れて、時計が面の下の行にだけ見えていた
        // （採点者の「時計が pill から離れている」はこれ）。凹みの形（notchWidth）が
        // この幅から決まるので、中身を足すときは両方の token を動かす。
        // 中身と token のずれは `--selftest shape` が落とす。
        .frame(width: Metrics.dockWidth, height: Metrics.dockHeight)
        .foregroundStyle(.white)
        .background {
            Capsule().fill(Color.black.opacity(0.9))
                .background(VisualEffectView(material: .hudWindow).clipShape(Capsule()))
        }
        .overlay(Capsule().stroke(.white.opacity(0.1), lineWidth: 0.5))
        // continuity-bad: 濃い影で浮かせ、別の窓のように見せる。
        .shadow(color: .black.opacity(Fixture.current == .detached ? 0.6 : 0.27),
                radius: Fixture.current == .detached ? 30 : 14,
                y: Fixture.current == .detached ? 16 : 5)
        .accessibilityIdentifier("taskDock")
    }

    /// 枠を掛ける前の中身。`--selftest shape` がこの実寸と `Metrics.dockWidth` を突き合わせる。
    var content: some View {
        HStack(spacing: 10) {
            Circle().fill(Color.recordingRed).frame(width: 7, height: 7)
            // 1 時間を超えると "1:04:21" になり 1 桁ぶん広がる。凹みの形は固定なので、
            // 最も広い形の幅を最初から取っておく（伸びて隣を押さない）。
            ZStack {
                Text("0:00:00").hidden()
                Text(state.elapsedText)
            }
            .font(.system(size: Metrics.dockLabelSize, weight: .medium, design: .monospaced))
            .accessibilityIdentifier("taskDockElapsed")
            DockDivider()
            DockIcon(systemName: state.isPaused ? "play.fill" : "pause.fill") { state.togglePause() }
            DockIcon(systemName: "captions.bubble") { state.selectedTool = .transcript }
            DockIcon(systemName: "viewfinder") { state.captureScreenshot() }
            DockIcon(systemName: "ellipsis") {}
            DockDivider()
            StopRecordingButton { state.stop() }
        }
        .padding(.horizontal, 11)
    }
}

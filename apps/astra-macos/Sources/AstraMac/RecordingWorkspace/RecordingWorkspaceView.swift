import SwiftUI

/// 手書き案の 1 枚。外枠だけ Shape、中身はすべて SwiftUI のカードを自由配置。
/// 上辺の凹みに Task Dock を ZStack で重ねる（Workspace の内側には入れない）。
struct RecordingWorkspaceView: View {
    @StateObject private var state = RecordingWorkspaceState.shared

    var body: some View {
        ZStack(alignment: .top) {
            RecordingSurface()

            workspaceContent
                .padding(.top, 55)

            TaskDockView(state: state)
                .offset(y: 3)

            if state.ragOpen {
                RAGDrawerView(state: state)
                    .padding(.horizontal, 18)
                    .padding(.bottom, 16)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .frame(width: Metrics.workspaceWidth, height: Metrics.workspaceHeight)
        .animation(.easeOut(duration: Motion.drawerMs), value: state.ragOpen)
        .accessibilityIdentifier("recordingWorkspace")
    }

    private var workspaceContent: some View {
        GeometryReader { geo in
            ZStack {
                RecordingHeroView(state: state)
                    .position(x: geo.size.width * 0.5, y: 175)

                RecordingToolPalette(selection: $state.selectedTool)
                    .position(x: 120, y: 300)

                AIActionsPalette(state: state)
                    .position(x: geo.size.width * 0.5, y: 380)

                Button {
                    state.ragOpen.toggle()
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "plus")
                        Text("RAG")
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.astraAccent)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("ragToggle")
                .position(x: geo.size.width * 0.5, y: geo.size.height - 30)
            }
        }
    }
}

/// 白い面 + 本物の vibrancy + 凹み。手書きは白基調なので黒パネルにはしない。
struct RecordingSurface: View {
    var body: some View {
        RecordingWorkspaceShape()
            .fill(Color.workspaceSurface)
            .background(RecordingWorkspaceShape().fill(.ultraThinMaterial))
            .overlay(RecordingWorkspaceShape().stroke(Color.black.opacity(0.075), lineWidth: 0.7))
            .shadow(color: .black.opacity(0.17), radius: 30, y: 13)
    }
}

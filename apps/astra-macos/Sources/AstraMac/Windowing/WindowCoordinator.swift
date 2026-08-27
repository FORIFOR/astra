import AppKit
import SwiftUI

/// Astra UI の中心。通常は Voice OS ピル、録音中は Recording Workspace。
/// 上↔下はフェードで切り替える（黒いバーが画面中央を横切らないように、移動アニメはしない）。
@MainActor
final class WindowCoordinator {
    static let shared = WindowCoordinator()

    private var hudPanel: AstraPanel<VoiceHUDView>?
    private var recordingPanel: AstraPanel<RecordingWorkspaceView>?

    func start(demo: DemoMode) {
        switch demo {
        case .none:
            VoiceHUDState.shared.mode = .idle
            showVoiceHUD()
        case .hudListening:
            VoiceHUDState.shared.mode = .listening
            showVoiceHUD()
        case .hudThinking:
            VoiceHUDState.shared.mode = .thinking
            showVoiceHUD()
        case .recording:
            RecordingWorkspaceState.shared.loadDemo(ragOpen: false)
            showRecordingWorkspace()
        case .recordingRAG:
            RecordingWorkspaceState.shared.loadDemo(ragOpen: true)
            showRecordingWorkspace()
        case .main:
            MainWindowController.shared.show()
        }
    }

    func enterRecordingMode() {
        RecordingWorkspaceState.shared.start()
        hideVoiceHUD()
        showRecordingWorkspace()
    }

    func leaveRecordingMode() {
        hideRecordingWorkspace()
        showVoiceHUD()
    }

    func showVoiceHUD() {
        if hudPanel == nil {
            hudPanel = AstraPanel(
                size: NSSize(width: Metrics.hudWidth, height: Metrics.hudHeight),
                level: .statusBar,
                canKey: false,
                content: VoiceHUDView()
            )
        }
        guard let panel = hudPanel, let screen = NSScreen.main else { return }
        panel.setFrame(PanelPositioner.voiceHUDFrame(screen: screen), display: false)
        fadeIn(panel, makeKey: false)
    }

    func hideVoiceHUD() {
        guard let panel = hudPanel else { return }
        fadeOut(panel)
    }

    func showRecordingWorkspace() {
        if recordingPanel == nil {
            recordingPanel = AstraPanel(
                size: NSSize(width: Metrics.workspaceWidth, height: Metrics.workspaceHeight),
                level: .floating,
                canKey: true,
                content: RecordingWorkspaceView()
            )
        }
        guard let panel = recordingPanel, let screen = NSScreen.main else { return }
        panel.setFrame(PanelPositioner.recordingWorkspaceFrame(screen: screen), display: false)
        fadeIn(panel, makeKey: true)
    }

    func hideRecordingWorkspace() {
        guard let panel = recordingPanel else { return }
        fadeOut(panel)
    }

    private func fadeIn(_ panel: NSPanel, makeKey: Bool) {
        panel.alphaValue = 0
        if makeKey {
            panel.makeKeyAndOrderFront(nil)
        } else {
            panel.orderFrontRegardless()
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = Motion.showMs
            panel.animator().alphaValue = 1
        }
    }

    private func fadeOut(_ panel: NSPanel) {
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = Motion.hideMs
            panel.animator().alphaValue = 0
        }, completionHandler: {
            panel.orderOut(nil)
            panel.alphaValue = 1
        })
    }
}

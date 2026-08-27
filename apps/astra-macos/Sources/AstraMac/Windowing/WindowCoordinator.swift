import AppKit
import SwiftUI

/// Astra UI の中心。通常は Voice OS ピル、録音中は Recording Workspace。
/// 上↔下はフェードで切り替える（黒いバーが画面中央を横切らないように、移動アニメはしない）。
@MainActor
final class WindowCoordinator {
    static let shared = WindowCoordinator()

    private var hudPanel: AstraPanel<VoiceHUDView>?
    private var recordingPanel: AstraPanel<RecordingWorkspaceView>?
    /// グローバルショートカットが録音を出し入れするための状態。
    private(set) var isRecording = false

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
        case .settings:
            SettingsWindowController.shared.show()
        }
    }

    func enterRecordingMode() {
        RecordingWorkspaceState.shared.start()
        isRecording = true
        hideVoiceHUD()
        showRecordingWorkspace()
    }

    func leaveRecordingMode() {
        isRecording = false
        hideRecordingWorkspace()
        showVoiceHUD()
    }

    /// グローバル音声ショートカットの入口。押すたびに録音を出し入れする。
    /// 正本 §2「通常時 Top HUD → 録音開始で Recording Workspace → 終了で HUD 復帰」。
    func toggleRecording() {
        if isRecording { leaveRecordingMode() } else { enterRecordingMode() }
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

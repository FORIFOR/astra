import AppKit
import SwiftUI

/// Astra UI の中心。通常は Voice OS ピル、録音中は Recording Workspace。
/// 上↔下はフェードで切り替える（黒いバーが画面中央を横切らないように、移動アニメはしない）。
@MainActor
final class WindowCoordinator {
    static let shared = WindowCoordinator()

    /// テスト用: window を実際に出さずに状態遷移だけ回す（本番は false のまま）。
    static var headless = false

    private var hudPanel: AstraPanel<VoiceTaskDockView>?
    private var recordingPanel: AstraPanel<RecordingWorkspaceView>?
    /// Dock の下に出す第二 Panel。Dock 本体を伸ばさないために分けている（§13）。
    private var discoveryPanel: AstraPanel<AppDiscoveryView>?
    private var quickActionsPanel: AstraPanel<QuickActionsView>?
    /// Dock を置く画面。切り替えは 500ms 安定してから（画面間でバタつかせない）。
    private var dockScreen: NSScreen?
    private var pendingScreen: (screen: NSScreen, since: Date)?
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

    /// window 専用: Recording Workspace を出して HUD を退ける。録音ランタイムの開始は
    /// RecordingWorkspaceState.start() が持つ（ここから start を呼ぶと相互再帰になるので呼ばない）。
    func enterRecordingMode() {
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
        // 録音の単一エントリは RecordingWorkspaceState。start/stop がランタイムと window の両方を回す。
        if RecordingWorkspaceState.shared.isRecording {
            RecordingWorkspaceState.shared.stop()
        } else {
            RecordingWorkspaceState.shared.start()
        }
    }

    func showVoiceHUD() {
        if Self.headless { return }
        if hudPanel == nil {
            hudPanel = AstraPanel(
                size: NSSize(width: Metrics.hudWidth, height: Metrics.hudHeight),
                level: .statusBar,
                canKey: false,
                content: VoiceTaskDockView()
            )
        }
        guard let panel = hudPanel, let screen = activeScreen() else { return }
        panel.setFrame(PanelPositioner.voiceHUDFrame(screen: screen), display: false)
        fadeIn(panel, makeKey: false)
        syncDockPanels()
    }

    func hideVoiceHUD() {
        if Self.headless { return }
        hideDockPanels()
        guard let panel = hudPanel else { return }
        fadeOut(panel)
    }

    /// Dock の状態に合わせて第二 Panel を出し入れする。Dock 本体の寸法は決して変えない。
    func syncDockPanels() {
        if Self.headless { return }
        guard let screen = activeScreen() else { return }
        switch VoiceHUDState.shared.mode {
        case .contextualApp(let suggestion):
            hide(&quickActionsPanel)
            let size = NSSize(width: Metrics.discoveryWidth, height: Metrics.discoveryHeight)
            if discoveryPanel == nil {
                discoveryPanel = AstraPanel(size: size, level: .statusBar, canKey: false,
                                            content: AppDiscoveryView(suggestion: suggestion))
            }
            show(discoveryPanel, frame: PanelPositioner.belowDockFrame(screen: screen, size: size))
        case .quickActions:
            hide(&discoveryPanel)
            let size = NSSize(width: Metrics.quickActionsWidth, height: Metrics.quickActionsHeight)
            if quickActionsPanel == nil {
                quickActionsPanel = AstraPanel(size: size, level: .statusBar, canKey: false,
                                               content: QuickActionsView())
            }
            show(quickActionsPanel, frame: PanelPositioner.belowDockFrame(screen: screen, size: size))
        default:
            hideDockPanels()
        }
    }

    private func hideDockPanels() {
        hide(&discoveryPanel)
        hide(&quickActionsPanel)
    }

    private func show<V: View>(_ panel: AstraPanel<V>?, frame: NSRect) {
        guard let panel else { return }
        panel.setFrame(frame, display: false)
        fadeIn(panel, makeKey: false)
    }

    private func hide<V: View>(_ panel: inout AstraPanel<V>?) {
        panel?.orderOut(nil)
        panel = nil
    }

    /// Dock を置く画面。使っているアプリの窓がある画面へ移すが、跨いだ瞬間には動かさない。
    ///
    /// 画面を跨ぐたびに Dock が飛ぶと、上端の静けさが壊れる。500ms 同じ画面に居続けたときだけ移す。
    func activeScreen(now: Date = Date()) -> NSScreen? {
        let candidate = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) }
            ?? NSScreen.main
        guard let candidate else { return dockScreen }
        if dockScreen == nil { dockScreen = candidate; return candidate }
        if candidate == dockScreen { pendingScreen = nil; return candidate }
        if let pending = pendingScreen, pending.screen == candidate {
            if now.timeIntervalSince(pending.since) >= 0.5 {
                dockScreen = candidate
                pendingScreen = nil
                return candidate
            }
        } else {
            pendingScreen = (candidate, now)
        }
        return dockScreen
    }

    func showRecordingWorkspace() {
        if Self.headless { return }
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
        if Self.headless { return }
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

import XCTest
@testable import GenieMac

@MainActor
final class RecordingUXTests: XCTestCase {
    func testForegroundContextDoesNotReplaceRecordingEntryOrActiveWork() {
        let state = VoiceHUDState.shared
        let previous = state.mode
        let headless = WindowCoordinator.headless
        WindowCoordinator.headless = true
        defer { state.mode = previous; WindowCoordinator.headless = headless }
        state.mode = .appContext(AppContextSummary(app: "ChatGPT", document: nil, suggestions: []))
        state.refreshContextualApp()
        XCTAssertEqual(state.mode, .idle)
        for mode: DockPresentation in [.idle, .quickActions, .meeting(expanded: .captions), .thinking] {
            state.mode = mode
            state.refreshContextualApp()
            XCTAssertEqual(state.mode, mode)
        }
    }
    func testOnlyActualSharingControlsTriggerHiding() {
        for label in ["Leave call", "Share screen", "Google Meet", "ChatGPT", "画面を共有", "退出"] {
            XCTAssertFalse(ScreenSharingProbe.isStopControl(label), label)
        }
        for label in ["Stop presenting", "Stop sharing (⌘⇧S)", "共有を停止", "画面共有を停止（⌘⇧S）"] {
            XCTAssertTrue(ScreenSharingProbe.isStopControl(label), label)
        }
    }
    func testRestoreControlsHasARealMenuAction() {
        XCTAssertTrue(StatusBarController.shared.menuWiring().contains { $0.title == Facts.menuShowControls && $0.wired })
    }

    func testShortAnswerStaysInTaskDockAndCanBeDismissed() {
        let store = GenieStateStore.shared
        let previousDock = store.dock
        let previousMode = store.state.mode
        defer {
            store.setDock(previousDock)
            store.setMode(previousMode)
        }

        store.setDock(.answer("金曜日の15時です。"))
        XCTAssertEqual(store.dock, .answer("金曜日の15時です。"))
        XCTAssertEqual(store.state.mode, .completed)

        store.dismissResult()
        XCTAssertEqual(store.dock, .idle)
    }
}

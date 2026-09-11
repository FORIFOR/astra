import XCTest
@testable import AstraMac

@MainActor
final class WorkspaceUXTests: XCTestCase {
    func testDraftSurvivesNavigationAndTaskDetailsClose() {
        let nav = MainNav()
        nav.intentDraft = "目的を確認\n動画の構成を3案作る"
        nav.openTask = fixture()
        nav.select(.apps)
        XCTAssertNil(nav.openTask)
        XCTAssertEqual(nav.intentDraft, "目的を確認\n動画の構成を3案作る")
        XCTAssertEqual(nav.appsTab, .connectors)
        nav.select(.home)
        XCTAssertFalse(nav.intentDraft.isEmpty)
        nav.openTask = fixture()
        nav.openSession = "another-meeting"
        XCTAssertNil(nav.openTask)
        nav.openTask = fixture()
        XCTAssertNil(nav.openSession)
    }

    func testEmptyAndUnavailableRequestsAreNotAccepted() {
        let voice = VoiceHUDState()
        let headless = WindowCoordinator.headless
        WindowCoordinator.headless = true
        defer { WindowCoordinator.headless = headless }
        XCTAssertFalse(voice.ask(" \n\t"))
        XCTAssertFalse(voice.requestInFlight)
        XCTAssertFalse(voice.ask("検証用の依頼"))
        XCTAssertFalse(voice.requestInFlight)
        XCTAssertTrue(voice.answer.contains("接続"))
    }

    func testStoredDetailsSurviveRestartAndSpecialCharacters() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite").path
        defer { for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: path + suffix) } }
        let task = fixture()
        let store = LocalStore(path: path)
        store.save(task)
        store.close()
        XCTAssertTrue(store.open(path))
        let restored = try XCTUnwrap(store.loadTasks().first)
        XCTAssertEqual(restored.id, task.id)
        XCTAssertEqual(restored.steps.first?.detail, task.steps.first?.detail)
        XCTAssertEqual(restored.failureReason, task.failureReason)
        store.close()
    }

    func testLegacyTaskRowsRemainReadable() throws {
        let store = LocalStore(path: ":memory:")
        defer { store.close() }
        let id = UUID()
        XCTAssertTrue(store.exec("INSERT INTO tasks VALUES ('\(id)', '旧形式', 'success', 1, 'read\u{1}資料を確認\u{1}success')"))
        let restored = try XCTUnwrap(store.loadTasks().first)
        XCTAssertEqual(restored.steps.first?.title, "資料を確認")
        XCTAssertEqual(restored.steps.first?.state, .success)
        store.save(restored)
        XCTAssertEqual(store.loadTasks().first?.steps.first?.title, "資料を確認")
    }

    func testSearchCombinesStateAndDetailsWithoutExecutingWork() {
        let task = fixture()
        XCTAssertTrue(TaskHistoryFilter.failed.includes(task, query: "再接続"))
        XCTAssertFalse(TaskHistoryFilter.finished.includes(task, query: "再接続"))
        XCTAssertTrue(TaskHistoryFilter.all.includes(task, query: "  \n"))
        XCTAssertFalse(TaskHistoryFilter.active.includes(task, query: ""))
        XCTAssertFalse(TaskHistoryFilter.all.includes(task, query: "存在しない語"))
    }

    private func fixture() -> AgentTask {
        AgentTask(id: UUID(), title: "リサーチ結果を確認", status: .failed,
            steps: [AgentStep(title: "資料を読む", tool: "test.read", detail: "再接続してください。\n出所: A\u{1}B\u{2}C \"引用\"", state: .failed)],
            startedAt: Date(), context: ContextBundle())
    }
}

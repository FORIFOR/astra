import XCTest
import AstraCore
@testable import AstraMac

@MainActor final class TaskOutcomeTests: XCTestCase {
    func testRequestAndResultSurviveRestartAndExportWithoutModel() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite").path
        defer { for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: path + suffix) } }
        let store = LocalStore(path: path)
        var record = TaskRequestRecord(request: "動画の構成を3案\n予算は0円", base: "http://localhost:3000")
        record.conversationID = "conversation"; record.backendTaskID = "existing-job"
        record.phase = .complete; record.result = "## 案1\n撮影した素材から組み立てる。\n日本語・引用\"と\u{1}制御文字"
        let task = AgentTask(requestRecord: record, id: UUID(), title: "動画の構成を3案", status: .success, steps: [], startedAt: Date(), context: ContextBundle())
        XCTAssertTrue(store.save(task)); store.close()
        XCTAssertTrue(store.open(path))
        let restored = try XCTUnwrap(store.loadTasks().first)
        XCTAssertEqual(restored.requestRecord, record)
        XCTAssertTrue(restored.document.contains(record.result))
        XCTAssertTrue(restored.document.contains(record.request))
        XCTAssertTrue(TaskHistoryFilter.finished.includes(restored, query: "予算は0円"))
        XCTAssertTrue(TaskHistoryFilter.finished.includes(restored, query: "撮影した素材"))
        XCTAssertFalse(record.canRefresh)
        store.close()
    }

    func testLegacyDatabaseMigratesWithoutRemovingHistory() throws {
        let store = LocalStore(path: ":memory:")
        defer { store.close() }
        XCTAssertTrue(store.exec("DROP TABLE task_requests"))
        XCTAssertTrue(store.exec("INSERT INTO tasks VALUES ('\(UUID())','以前の仕事','success',1,'read\u{1}資料を読む\u{1}success')"))
        XCTAssertTrue(store.migrate())
        let old = try XCTUnwrap(store.loadTasks().first)
        XCTAssertNil(old.requestRecord)
        XCTAssertEqual(old.steps.first?.title, "資料を読む")
        XCTAssertEqual(old.document, "")
    }

    func testAtomicSaveRollsBackIfResultCannotBeSaved() {
        let store = LocalStore(path: ":memory:")
        defer { store.close() }
        XCTAssertTrue(store.exec("DROP TABLE task_requests"))
        let task = AgentTask(requestRecord: TaskRequestRecord(request: "依頼", base: "test"), id: UUID(), title: "依頼", status: .running, steps: [], startedAt: Date(), context: ContextBundle())
        XCTAssertFalse(store.save(task))
        XCTAssertTrue(store.migrate())
        XCTAssertTrue(store.loadTasks().isEmpty)
    }

    func testBackendFailureCancellationAndEmptyOutputAreNeverSuccess() {
        var reads = 0
        for status in ["FAILED", "CANCELLED", "WAITING_APPROVAL", "RUNNING"] {
            let reply = VoiceHUDState.taskReply(status: status, artifactID: "") { reads += 1; return "unexpected" }
            XCTAssertNotEqual(reply.phase, .complete)
        }
        XCTAssertEqual(reads, 0)
        XCTAssertEqual(VoiceHUDState.taskReply(status: "COMPLETED", artifactID: "") { "" }.phase, .needsInput)
        XCTAssertEqual(VoiceHUDState.taskReply(status: "COMPLETED", artifactID: "artifact") { " \n" }.phase, .needsInput)
        XCTAssertEqual(VoiceHUDState.taskReply(status: "COMPLETED", artifactID: "artifact") { "実際の成果物" }.text, "実際の成果物")
    }

    func testOnlyKnownUnfinishedJobsCanBeRefreshed() {
        var record = TaskRequestRecord(request: "依頼", base: "test")
        record.phase = .unknown
        XCTAssertFalse(record.canRefresh, "Unknown submission must never be automatically resent")
        record.backendTaskID = "existing-job"
        XCTAssertTrue(record.canRefresh)
        record.phase = .failed
        XCTAssertFalse(record.canRefresh)
        record.phase = .waiting
        XCTAssertTrue(record.canRefresh)
    }

    func testClarificationIsNotReportedAsACompletedArtifact() throws {
        let result = try VoiceHUDState.followUp(TurnOutcome(needsClarification: true, answer: "対象を教えてください", taskId: "", notice: "", replyJson: ""), base: "unreachable", token: "unused", waitMs: 1)
        XCTAssertEqual(result.phase, .needsInput)
        XCTAssertEqual(result.text, "対象を教えてください")
    }
}

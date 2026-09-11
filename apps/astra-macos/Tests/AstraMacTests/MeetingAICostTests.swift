import XCTest
@testable import AstraMac

@MainActor
final class MeetingAICostTests: XCTestCase {
    private func key(_ text: String, action: String = "summary", meeting: String = "one") -> MeetingAIRequests.Key {
        .init(scope: "test", meeting: meeting, action: action, transcript: text)
    }
    func testNoSpeechAndRepeatedSuccessfulActionAvoidNewRequests() async throws {
        let model = MeetingAIRequests(); var calls = 0
        let submit = { calls += 1; return MeetingAIRequests.Submission(answer: "summary", taskId: "") }
        do { _ = try await model.run(key("  "), submit: submit, poll: { _ in XCTFail(); return "" }); XCTFail() } catch {}
        XCTAssertEqual(calls, 0)
        for _ in 0..<5 { _ = try await model.run(key("spoken"), submit: submit, poll: { _ in XCTFail(); return "" }) }
        XCTAssertEqual(calls, 1)
        _ = try await model.run(key("new words"), submit: submit, poll: { _ in "" })
        _ = try await model.run(key("spoken", action: "actions"), submit: submit, poll: { _ in "" })
        _ = try await model.run(key("spoken", meeting: "two"), submit: submit, poll: { _ in "" })
        XCTAssertEqual(calls, 4)
    }
    func testLostPollResponseResumesSameJobWithoutResubmitting() async throws {
        let model = MeetingAIRequests(); var sends = 0; var polls: [String] = []
        let submit = { sends += 1; return MeetingAIRequests.Submission(answer: "", taskId: "paid-job") }
        do {
            _ = try await model.run(key("words"), submit: submit, poll: { job in
                polls.append(job); throw URLError(.timedOut)
            }); XCTFail()
        } catch {}
        let answer = try await model.run(key("words"), submit: submit, poll: { job in polls.append(job); return "completed" })
        XCTAssertEqual(answer, "completed"); XCTAssertEqual(sends, 1)
        XCTAssertEqual(polls, ["paid-job", "paid-job"])
    }
    func testKnownFailedJobCanBeExplicitlySubmittedAgain() async throws {
        let model = MeetingAIRequests(); var sends = 0
        let submit = { sends += 1; return MeetingAIRequests.Submission(answer: "", taskId: "job") }
        do { _ = try await model.run(key("words"), submit: submit, poll: { _ in throw MeetingAIRequests.TerminalJobFailure() }); XCTFail() } catch {}
        XCTAssertEqual(sends, 1)
        _ = try await model.run(key("words"), submit: submit, poll: { _ in "completed" })
        XCTAssertEqual(sends, 2)
    }
    func testRepeatedClicksWhileGenerationRunsDoNotSubmit() async throws {
        let model = MeetingAIRequests(); var continuation: CheckedContinuation<MeetingAIRequests.Submission, Never>?
        let first = Task { try await model.run(key("words"), submit: {
            await withCheckedContinuation { continuation = $0 }
        }, poll: { _ in "" }) }
        while continuation == nil { await Task.yield() }
        do {
            _ = try await model.run(key("words"), submit: { XCTFail("duplicate submission"); return .init(answer: "bad", taskId: "") }, poll: { _ in "" })
            XCTFail("duplicate should be rejected")
        } catch {}
        continuation?.resume(returning: .init(answer: "done", taskId: ""))
        let result = try await first.value
        XCTAssertEqual(result, "done")
    }
}

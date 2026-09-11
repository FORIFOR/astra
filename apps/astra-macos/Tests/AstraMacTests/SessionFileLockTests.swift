import XCTest
@testable import AstraMac

final class SessionFileLockTests: XCTestCase {
    func testIndependentSessionsSerializeTheirRefreshCriticalSections() async throws {
        actor State {
            var entered = false
            func enter() { entered = true }
            func value() -> Bool { entered }
        }
        let state = State()
        let key = "test-\(UUID().uuidString)"
        let first = try await SessionFileLock.acquire(key)
        let second = Task {
            let lock = try await SessionFileLock.acquire(key)
            await state.enter()
            SessionFileLock.release(lock)
        }
        try await Task.sleep(for: .milliseconds(80))
        let early = await state.value()
        XCTAssertFalse(early, "another session must not read the same refresh token while a rotation is in flight")
        SessionFileLock.release(first)
        try await second.value
        let entered = await state.value()
        XCTAssertTrue(entered)
        let restarted = try await SessionFileLock.acquire(key)
        SessionFileLock.release(restarted)
    }
}

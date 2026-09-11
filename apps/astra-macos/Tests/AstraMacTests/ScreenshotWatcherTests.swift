import XCTest
@testable import AstraMac

@MainActor
final class ScreenshotWatcherTests: XCTestCase {
    func testBlockedDirectoryReadDoesNotBlockMainThreadOrStop() async throws {
        let entered = expectation(description: "directory read started")
        let heartbeat = expectation(description: "main thread remains responsive")
        let release = DispatchSemaphore(value: 0)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer {
            release.signal()
            try? FileManager.default.removeItem(at: directory)
        }
        let watcher = ScreenshotFolderWatcher(readNames: { _ in
            XCTAssertFalse(Thread.isMainThread)
            entered.fulfill()
            _ = release.wait(timeout: .now() + 5)
            return []
        }, onChange: { _ in XCTFail("No new captures were created") })
        watcher.start(directory: directory)
        await fulfillment(of: [entered], timeout: 1)
        watcher.stop()
        DispatchQueue.main.async { heartbeat.fulfill() }
        await fulfillment(of: [heartbeat], timeout: 1)
    }
}

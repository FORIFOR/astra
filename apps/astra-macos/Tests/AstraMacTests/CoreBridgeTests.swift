import XCTest
import AstraCore
@testable import AstraCore

/// astra-core を Swift から使う契約テスト（bindings freshness と併せて回帰を止める）。
final class CoreBridgeTests: XCTestCase {
    func testVersionRoundTrip() {
        XCTAssertEqual(astraCoreVersion(), "0.1.0")
    }

    func testSnapshotDerivedByCore() {
        let snap = recordingSnapshot(input: RecordingInput(
            elapsedMs: 261_000, isPaused: false, link: .reconnecting, pendingMs: 12_000))
        XCTAssertEqual(snap.mode, .recording)
        XCTAssertEqual(snap.elapsedLabel, "04:21")
        XCTAssertEqual(snap.heroText, "録音中")
        XCTAssertEqual(snap.linkText, "オフライン保存中…")
        XCTAssertTrue(snap.unsynced)
    }

    func testSessionWritesFragments() throws {
        let root = NSTemporaryDirectory() + "astra-xctest-\(getpid())"
        try FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
        let session = try RecordingSession.start(root: root, meetingId: "x")
        let oneSec = [Float](repeating: 0, count: 16_000)
        var closed: UInt32 = 0
        for _ in 0..<6 { closed += session.pushSamples(samples: oneSec, sampleRate: 16_000) }
        XCTAssertEqual(closed, 1)
        try session.finish()
        XCTAssertTrue(FileManager.default.fileExists(atPath: root + "/x/mic/000001.pcm"))
        XCTAssertEqual(scanRecoverable(root: root, active: nil).count, 1)
        try? FileManager.default.removeItem(atPath: root)
    }
}

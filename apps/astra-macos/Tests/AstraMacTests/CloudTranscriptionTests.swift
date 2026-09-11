import XCTest
@testable import AstraMac

@MainActor
final class CloudTranscriptionTests: XCTestCase {
    func testRevokedConsentStopsBeforeReadingOrSendingAudio() async {
        let key = RecordingRuntime.cloudTranscriptionDefaultsKey
        let previous = UserDefaults.standard.object(forKey: key)
        defer {
            if let previous { UserDefaults.standard.set(previous, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
        RecordingRuntime.setCloudTranscriptionAllowed(false)
        do {
            try await CloudMeetingTranscription.finalize(base: "https://invalid.invalid", token: "unused", localId: "does-not-exist", root: "/does-not-exist")
            XCTFail("revoked consent must stop before transport")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("送信を停止"))
        }
    }
    func testLiveConsentRevocationAndInsecureEndpoint() throws {
        let key = RecordingRuntime.cloudTranscriptionDefaultsKey
        let previous = UserDefaults.standard.object(forKey: key)
        defer {
            if let previous { UserDefaults.standard.set(previous, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
        RecordingRuntime.setCloudTranscriptionAllowed(false)
        let live = GoogleLiveTranscriber(base: "http://127.0.0.1:1", token: "unused")
        XCTAssertThrowsError(try live.start())
        var failed = false
        live.onFailure = { _ in failed = true }
        live.append([0.2, 0.1])
        XCTAssertTrue(failed)
        RecordingRuntime.setCloudTranscriptionAllowed(true)
        XCTAssertThrowsError(try GoogleLiveTranscriber(base: "http://example.com", token: "unused").start())
    }
    func testResultDecodingPreservesTimingAndUnknownSpeaker() throws {
        let data = Data("[{\"text\":\"金曜日の午後三時です\",\"start_ms\":62000,\"end_ms\":65000,\"speaker_tag\":null}]".utf8)
        let rows = try JSONDecoder().decode([CloudTranscriptRow].self, from: data)
        XCTAssertEqual(rows[0].start_ms, 62000)
        XCTAssertNil(rows[0].speaker_tag)
    }
}

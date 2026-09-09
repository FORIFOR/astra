import XCTest
@testable import AstraMac

final class RecordingAudioBufferTests: XCTestCase {
    func testTwoInputsProduceOneRecordingTimeline() {
        var buffer = RecordingAudioBuffer()
        buffer.append(Array(repeating: 0.25, count: 320), channel: .localUser)
        buffer.append(Array(repeating: 0.5, count: 320), channel: .remoteAudio)
        XCTAssertEqual(buffer.take(320), Array(repeating: 0.75, count: 320))
        XCTAssertEqual(buffer.take(320), Array(repeating: 0, count: 320))
    }

    func testDifferentCallbackSizesRetainOrder() {
        var buffer = RecordingAudioBuffer()
        buffer.append([0.1, 0.2, 0.3], channel: .remoteAudio)
        XCTAssertEqual(buffer.take(2), [0.1, 0.2])
        buffer.append([0.4], channel: .remoteAudio)
        XCTAssertEqual(buffer.take(3), [0.3, 0.4, 0])
    }

    func testMissingMicrophoneDoesNotAttenuateVideoAndMixCannotClip() {
        var buffer = RecordingAudioBuffer()
        buffer.append([0.8], channel: .remoteAudio)
        XCTAssertEqual(buffer.take(1), [0.8])
        buffer.append([0.8, -0.8], channel: .remoteAudio)
        buffer.append([0.8, -0.8], channel: .localUser)
        XCTAssertEqual(buffer.take(2), [1, -1])
    }

    func testBacklogIsBoundedAndPauseResetDropsOldAudio() {
        var buffer = RecordingAudioBuffer()
        buffer.append(Array(repeating: 0.5, count: RecordingAudioBuffer.capacity + 100), channel: .remoteAudio)
        XCTAssertEqual(buffer.take(RecordingAudioBuffer.capacity + 1).last, 0)
        buffer.append([0.5], channel: .remoteAudio)
        buffer = RecordingAudioBuffer()
        XCTAssertEqual(buffer.take(1), [0])
    }
}

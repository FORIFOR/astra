import XCTest
import AVFoundation
@testable import AstraMac

final class SystemAudioFormatTests: XCTestCase {
    func testScreenAudioPCMFormatIsPreserved() {
        let input = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000,
                                  channels: 2, interleaved: false)!
        for _ in 0..<100 {
            let output = SystemAudioCapture.pcmFormat(input.streamDescription.pointee)
            XCTAssertEqual(output?.sampleRate, 48_000)
            XCTAssertEqual(output?.channelCount, 2)
            XCTAssertEqual(output?.commonFormat, .pcmFormatFloat32)
        }
    }

    func testInvalidDescriptionIsRejectedBeforeAllocatingPCMBuffer() {
        XCTAssertNil(SystemAudioCapture.pcmFormat(AudioStreamBasicDescription()))
        var d = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!.streamDescription.pointee
        d.mSampleRate = .nan
        XCTAssertNil(SystemAudioCapture.pcmFormat(d))
        d.mSampleRate = 48_000; d.mFormatID = kAudioFormatMPEG4AAC
        XCTAssertNil(SystemAudioCapture.pcmFormat(d))
    }
}

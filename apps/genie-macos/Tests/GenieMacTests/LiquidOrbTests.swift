import XCTest
@testable import GenieMac

final class LiquidOrbTests: XCTestCase {
    func testOnlyActiveVisibleWorkAnimates() {
        for mode in GenieOrbMode.allCases {
            XCTAssertFalse(LiquidOrbMotion.shouldAnimate(mode: mode, visible: false, reduceMotion: false))
            XCTAssertFalse(LiquidOrbMotion.shouldAnimate(mode: mode, visible: true, reduceMotion: true))
        }
        XCTAssertFalse(LiquidOrbMotion.shouldAnimate(mode: .preparing, visible: true, reduceMotion: false))
        XCTAssertFalse(LiquidOrbMotion.shouldAnimate(mode: .idle, visible: true, reduceMotion: false))
        XCTAssertTrue(LiquidOrbMotion.shouldAnimate(mode: .thinking, visible: true, reduceMotion: false))
    }
    func testMicrophoneSilenceAndInvalidMetersDoNotInventActivity() {
        XCTAssertEqual(LiquidOrbMotion.clampedLevel(.nan), 0)
        XCTAssertEqual(LiquidOrbMotion.clampedLevel(.infinity), 0)
        for mode in [GenieOrbMode.preparing, .thinking] {
            var silent = LiquidOrbMotion(), loud = LiquidOrbMotion()
            silent.setMode(mode, now: 0); loud.setMode(mode, now: 0)
            for i in 0...30 { XCTAssertEqual(silent.sample(now: Double(i)/30, level: 0), loud.sample(now: Double(i)/30, level: 1)) }
        }
        var mic = LiquidOrbMotion();mic.setMode(.listening, now: 0)
        _ = mic.sample(now: 0, level: 0)
        for i in 1...30 { _ = mic.sample(now: Double(i)/30, level: 1) }
        let loud = mic.sample(now: 1.1, level: 1)[4]
        for i in 34...90 { _ = mic.sample(now: Double(i)/30, level: 0) }
        XCTAssertGreaterThan(loud, mic.sample(now: 3.1, level: 0)[4])
        XCTAssertLessThanOrEqual(loud, 0.77501)
    }
    func testReducedMotionIsStableEvenWithAudio() {
        var motion = LiquidOrbMotion();motion.setMode(.speaking, now: 0)
        XCTAssertEqual(motion.sample(now: 1, level: 0, reduced: true),motion.sample(now: 10, level: 1, reduced: true))
    }
    func testReferencePresetAndRealMetalAlpha() throws {
        let gpu = try LiquidOrbGPU()
        let idle = try XCTUnwrap(gpu.image(mode: .idle))
        let active = try XCTUnwrap(gpu.image(mode: .thinking))
        let a = try XCTUnwrap(idle.tiffRepresentation), b = try XCTUnwrap(active.tiffRepresentation)
        XCTAssertNotEqual(a,b)
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: b))
        XCTAssertEqual(bitmap.colorAt(x: 0,y: 0)?.alphaComponent,0)
        XCTAssertGreaterThan(bitmap.colorAt(x: 96,y: 96)?.alphaComponent ?? 0,0.8)
        XCTAssertEqual(LiquidOrbAssets.active.count,136)
        XCTAssertEqual(LiquidOrbAssets.active[15],9)
        XCTAssertEqual(LiquidOrbAssets.active[3],0.82,accuracy:0.0001)
    }
    @MainActor func testPreparingRejectsLevelsAndStoppedCaptureDoesNotReact() {
        let voice = VoiceHUDState.shared
        let previous = voice.mode, headless = WindowCoordinator.headless
        WindowCoordinator.headless = true
        defer { voice.mode = previous;WindowCoordinator.headless = headless }
        voice.mode = .listening(partial: "");voice.beginPreparingForShot()
        voice.receiveInputLevel(1);XCTAssertEqual(voice.inputLevel,0)
        voice.markVoiceCaptureLive();voice.receiveInputLevel(0.8);XCTAssertEqual(voice.inputLevel,0.8)
        voice.cancelListening();voice.receiveInputLevel(1);XCTAssertEqual(voice.inputLevel,0)
    }
    @MainActor func testSpeechStripsFormattingAndCode() {
        XCTAssertEqual(GenieSpeechOutput.spokenText("## Hello\n**Genie**\n```swift\nsecret()\n```\n[Guide](https://example.com)"),"Hello\nGenie\n\nGuide")
        XCTAssertEqual(GenieSpeechOutput.spokenText(String(repeating:"あ",count:20_000)).count,20_000)
    }
}

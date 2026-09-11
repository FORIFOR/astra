import AppKit
import XCTest
@testable import AstraMac

final class PanelPositionerTests: XCTestCase {
    func testContentClearsCameraWhileBackgroundRemainsAttached() {
        let screen = NSRect(x: 0, y: 0, width: 1728, height: 1117)
        for size in [CGSize(width: 220, height: 44), CGSize(width: 820, height: 76),
                     CGSize(width: 600, height: 460)] {
            let frame = PanelPositioner.voiceHUDFrame(screenFrame: screen, topInset: 32, size: size)
            XCTAssertEqual(frame.maxY, screen.maxY)
            XCTAssertEqual(frame.midX, screen.midX)
            XCTAssertEqual(frame.width, size.width)
            XCTAssertEqual(frame.height - 32, size.height)
            XCTAssertEqual(frame.minY + size.height, screen.maxY - 32)
        }
    }

    func testExternalScreenUsesItsOwnCoordinatesWithoutCameraBand() {
        let screen = NSRect(x: -1920, y: 200, width: 1920, height: 1080)
        let size = CGSize(width: 220, height: 44)
        let frame = PanelPositioner.voiceHUDFrame(screenFrame: screen, topInset: 0, size: size)
        XCTAssertEqual(frame.size, size)
        XCTAssertEqual(frame.midX, screen.midX)
        XCTAssertEqual(frame.maxY, screen.maxY)
    }
}

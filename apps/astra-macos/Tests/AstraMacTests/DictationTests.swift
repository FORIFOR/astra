import XCTest
import CoreFoundation
@testable import AstraMac

final class DictationTests: XCTestCase {
    func testSelectionIsReplacedRatherThanAppendedAfter() {
        XCTAssertEqual(Dictation.replacingSelection(in: "見積は昨日送ります", range: CFRange(location: 3, length: 2), with: "明日"), "見積は明日送ります")
    }

    func testCaretUsesUTF16AfterEmoji() {
        XCTAssertEqual(Dictation.replacingSelection(in: "📅予定", range: CFRange(location: 2, length: 0), with: "明日の"), "📅明日の予定")
    }

    func testEmojiSelectionCanBeReplaced() {
        XCTAssertEqual(Dictation.replacingSelection(in: "a👩‍💻b", range: CFRange(location: 1, length: 5), with: "担当者"), "a担当者b")
    }

    func testInvalidOrSplitSurrogateRangeDoesNotWrite() {
        for range in [CFRange(location: -1, length: 0), CFRange(location: 0, length: -1),
                      CFRange(location: 4, length: 0), CFRange(location: 0, length: Int.max),
                      CFRange(location: 1, length: 0)] {
            XCTAssertNil(Dictation.replacingSelection(in: "📅a", range: range, with: "X"))
        }
    }

    func testEmptyFieldAndEndOfField() {
        XCTAssertEqual(Dictation.replacingSelection(in: "", range: CFRange(location: 0, length: 0), with: "商談"), "商談")
        XCTAssertEqual(Dictation.replacingSelection(in: "📅", range: CFRange(location: 2, length: 0), with: "明日"), "📅明日")
    }
}

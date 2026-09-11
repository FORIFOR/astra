import XCTest
@testable import AstraMac

@MainActor
final class InitialProfileTests: XCTestCase {
    func testEmojiUsesTheSameUTF16LimitAsTheAPI() {
        var s = InitialProfileSections(focus: [String(repeating: "🙂", count: 100)], people: [], priorities: [], workPattern: [], openItems: 0)
        XCTAssertTrue(InitialProfileStore.valid(s))
        s.focus = [String(repeating: "🙂", count: 101)]
        XCTAssertFalse(InitialProfileStore.valid(s))
    }
    func testAbsentProfileDoesNotShowSetupAgain() throws {
        XCTAssertNil(try InitialProfileStore.decode("{\"profile\":null}"))
    }
    func testRejectsReadyWithoutRealResult() {
        let json = """
        {"profile":{"id":"x","provider":"google","status":"ready","started_at":"2026-09-09T00:00:00Z","updated_at":"2026-09-09T00:00:00Z","outcomes":[],"sections":null}}
        """
        XCTAssertThrowsError(try InitialProfileStore.decode(json))
    }
    func testEditsRespectFieldLimitsAndAllowNoInferredData() {
        var s = InitialProfileSections(focus: [], people: [], priorities: [], workPattern: [], openItems: 0)
        XCTAssertTrue(InitialProfileStore.valid(s))
        s.focus = Array(repeating: "project", count: 6)
        XCTAssertFalse(InitialProfileStore.valid(s))
        s.focus = [" "]; XCTAssertFalse(InitialProfileStore.valid(s))
        s.focus = []; s.openItems = -1; XCTAssertFalse(InitialProfileStore.valid(s))
    }
}

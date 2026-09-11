import XCTest
@testable import AstraMac

@MainActor
final class MeetingReminderTests: XCTestCase {
    func testUndeliveredReminderRetriesWithoutInvalidatingNewerSession() {
        var p = MeetingReminderPolicy(); let now = Date()
        let first = p.observe(key: "meet", inCall: true, recording: false, now: now)!
        p.retryUndelivered(key: "meet", id: first)
        let second = p.observe(key: "meet", inCall: true, recording: false, now: now)!
        XCTAssertNotEqual(first, second)
        p.retryUndelivered(key: "meet", id: first)
        XCTAssertEqual(p.sessions["meet"], second)
        XCTAssertNil(p.observe(key: "meet", inCall: true, recording: false, now: now))
    }

    func testMeetingIdentityRejectsUnrelatedAndLookalikeHosts() {
        XCTAssertTrue(MeetingReminderPolicy.isMeetingDocument("https://meet.google.com/aaa-bbbb-ccc", provider: "Google Meet"))
        XCTAssertFalse(MeetingReminderPolicy.isMeetingDocument("https://meet.google.com.example.org/", provider: "Google Meet"))
        XCTAssertFalse(MeetingReminderPolicy.isMeetingDocument("https://example.org/help", provider: "Google Meet"))
        XCTAssertFalse(MeetingReminderPolicy.isMeetingDocument("http://meet.google.com/aaa", provider: "Google Meet"))
    }
    func testDistinctBrowserCallsRearmAfterTheFirstTabCloses() {
        var policy = MeetingReminderPolicy()
        let first = MeetingReminderPolicy.sessionKey(pid: 42, provider: "Google Meet", document: "https://meet.google.com/aaa-bbbb-ccc")
        let next = MeetingReminderPolicy.sessionKey(pid: 42, provider: "Google Meet", document: "https://meet.google.com/ddd-eeee-fff")
        XCTAssertNotNil(policy.observe(key: first, inCall: true, recording: false, now: Date()))
        // No absence event is available when the first tab closes.
        XCTAssertNotNil(policy.observe(key: next, inCall: true, recording: false, now: Date()))
        XCTAssertNil(policy.observe(key: next, inCall: true, recording: false, now: Date()))
        XCTAssertFalse(next.contains("meet.google.com"))
    }
    func testProvidersIncludeNativeAndBrowserMeetings() {
        for (bundle, title, expected) in [
            ("us.zoom.xos", "Zoom Workplace", "Zoom"),
            ("com.microsoft.teams2", "Weekly call", "Microsoft Teams"),
            ("com.microsoft.teams", "会議", "Microsoft Teams"),
            ("com.google.Chrome", "Meet - abc-defg-hij", "Google Meet"),
            ("com.apple.Safari", "Google Meet — Weekly", "Google Meet"),
            ("com.microsoft.edgemac", "Microsoft Teams", "Microsoft Teams"),
            ("com.google.Chrome", "Zoom Meeting", "Zoom")
        ] { XCTAssertEqual(MeetingReminderPolicy.provider(bundleId: bundle, title: title), expected) }
        XCTAssertNil(MeetingReminderPolicy.provider(bundleId: "com.apple.finder", title: "Google Meet"))
        XCTAssertNil(MeetingReminderPolicy.provider(bundleId: "com.google.Chrome", title: "Calendar"))
    }

    func testOnlyLeaveCallControlsCount() {
        for label in ["Leave", "Leave (⌘W)", "Leave call", "Leave meeting (⌘W)", "通話から退出", "ミーティングを退出", "Hang up", "退出"] {
            XCTAssertTrue(MeetingReminderPolicy.isLeaveControl(label), label)
        }
        for label in ["Join meeting", "会議に参加", "退出方法について", "Leave feedback", "Google Meet"] {
            XCTAssertFalse(MeetingReminderPolicy.isLeaveControl(label), label)
        }
    }

    func testNoPromptForLaunchLobbyOrUnknownPermission() {
        var p = MeetingReminderPolicy()
        XCTAssertNil(p.observe(key: "zoom", inCall: false, recording: false, now: .distantPast))
        XCTAssertNil(p.observe(key: "zoom", inCall: nil, recording: false, now: .distantPast))
        XCTAssertTrue(p.sessions.isEmpty)
    }

    func testOnePromptDespiteFocusSwitchAndRepeatedObservations() {
        var p = MeetingReminderPolicy()
        let now = Date()
        let first = p.observe(key: "meet", inCall: true, recording: false, now: now)
        XCTAssertNotNil(first)
        XCTAssertNil(p.observe(key: "meet", inCall: nil, recording: false, now: now.addingTimeInterval(300)))
        XCTAssertNil(p.observe(key: "meet", inCall: true, recording: false, now: now.addingTimeInterval(600)))
        XCTAssertEqual(p.sessions["meet"], first)
    }

    func testTransientMissingControlsDoNotRearm() {
        var p = MeetingReminderPolicy(); let now = Date()
        _ = p.observe(key: "teams", inCall: true, recording: false, now: now)
        _ = p.observe(key: "teams", inCall: false, recording: false, now: now)
        XCTAssertNil(p.observe(key: "teams", inCall: true, recording: false, now: now.addingTimeInterval(8)))
    }

    func testConfirmedExitRearmsNextMeeting() {
        var p = MeetingReminderPolicy(); let now = Date()
        let first = p.observe(key: "zoom", inCall: true, recording: false, now: now)
        _ = p.observe(key: "zoom", inCall: false, recording: false, now: now)
        _ = p.observe(key: "zoom", inCall: false, recording: false, now: now.addingTimeInterval(12))
        let next = p.observe(key: "zoom", inCall: true, recording: false, now: now.addingTimeInterval(16))
        XCTAssertNotNil(next); XCTAssertNotEqual(first, next)
    }

    func testRecordingConsumesReminderWithoutPromptingAgainAfterStop() {
        var p = MeetingReminderPolicy(); let now = Date()
        XCTAssertNil(p.observe(key: "meet", inCall: true, recording: true, now: now))
        XCTAssertNil(p.observe(key: "meet", inCall: true, recording: false, now: now.addingTimeInterval(4)))
        XCTAssertNotNil(p.observe(key: "teams", inCall: true, recording: false, now: now))
    }

    func testTerminatedAppInvalidatesOldActionAndRearms() {
        var p = MeetingReminderPolicy(); let now = Date()
        let old = p.observe(key: "zoom", inCall: true, recording: false, now: now)
        p.forget(key: "zoom")
        XCTAssertNil(p.sessions["zoom"])
        XCTAssertNotEqual(old, p.observe(key: "zoom", inCall: true, recording: false, now: now))
    }
}

import XCTest
@testable import AstraMac

@MainActor
final class ConnectorConfigurationTests: XCTestCase {
    func testMicrosoftRequiresDistinctReadAndSendClients() {
        let env = ["ASTRA_OAUTH_MICROSOFT_CLIENT_ID": "legacy",
                   "ASTRA_OAUTH_MICROSOFT_READ_CLIENT_ID": "read",
                   "ASTRA_OAUTH_MICROSOFT_WRITE_CLIENT_ID": "send"]
        XCTAssertEqual(ConnectorState.connectionClientId(provider: "microsoft", readOnly: true, env: env), "read")
        XCTAssertEqual(ConnectorState.connectionClientId(provider: "microsoft", readOnly: false, env: env), "send")
        XCTAssertNil(ConnectorState.connectionClientId(provider: "microsoft", readOnly: true,
                                                       env: ["ASTRA_OAUTH_MICROSOFT_CLIENT_ID": "legacy"]))
        var shared = env
        shared["ASTRA_OAUTH_MICROSOFT_WRITE_CLIENT_ID"] = "read"
        XCTAssertNil(ConnectorState.connectionClientId(provider: "microsoft", readOnly: true, env: shared))
        XCTAssertNil(ConnectorState.connectionClientId(provider: "microsoft", readOnly: false, env: shared))
    }

    func testGoogleKeepsItsConfiguredClient() {
        XCTAssertEqual(ConnectorState.connectionClientId(provider: "google", readOnly: false,
                        env: ["ASTRA_OAUTH_GOOGLE_CLIENT_ID": "google"]), "google")
    }

    func testMicrosoftRejectsBroaderOrMissingScopeAttestations() {
        let required = ["Mail.Read", "Calendars.Read", "offline_access"]
        XCTAssertTrue(ConnectorState.microsoftScopesMatch(
            granted: ["https://graph.microsoft.com/Mail.Read", "Calendars.Read", "User.Read"], required: required))
        XCTAssertFalse(ConnectorState.microsoftScopesMatch(granted: ["Mail.Read"], required: required))
        XCTAssertFalse(ConnectorState.microsoftScopesMatch(granted: required + ["Mail.Send"], required: required))
        XCTAssertFalse(ConnectorState.microsoftScopesMatch(granted: ["Mail.ReadWrite", "Calendars.Read"], required: required))
        XCTAssertFalse(ConnectorState.microsoftScopesMatch(granted: ["Mail.Send", "Mail.Read"], required: ["Mail.Send"]))
    }
}

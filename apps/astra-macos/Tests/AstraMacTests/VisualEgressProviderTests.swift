import XCTest
@testable import AstraMac

final class VisualEgressProviderTests: XCTestCase {
    func testUnconfiguredProviderKeepsSendConditionInCompactProvenance() {
        let policy = VisualEgressPolicy.configured(environment: [:])
        XCTAssertEqual(policy.provenance(firstTime: true), "質問したときだけ クラウド に送信")
        XCTAssertTrue(policy.disclosure.contains("接続したモデルの提供元"))
        XCTAssertTrue(policy.sendsPixelsOffDevice)
        XCTAssertTrue(VisualEgressPolicy.configured(environment: ["ASTRA_LLM_CLI": "codex"])
            .provenance(firstTime: true)?.contains("OpenAI") == true)
    }

    func testSelectedCliDeterminesDisclosure() {
        XCTAssertEqual(VisualEgressPolicy.configured(environment: ["ASTRA_LLM_CLI": "codex"]), .cloudVision(provider: "OpenAI"))
        XCTAssertEqual(VisualEgressPolicy.configured(environment: ["ASTRA_LLM_CLI": "claude_code"]), .cloudVision(provider: "Claude"))
        XCTAssertEqual(VisualEgressPolicy.configured(environment: [:]), .cloudVision(provider: "接続したモデルの提供元"))
    }
}

import XCTest
@testable import AstraMac

@MainActor
final class MeetingTranslationTests: XCTestCase {
    private func line(_ text: String, interim: Bool = false) -> TranscriptSegment {
        TranscriptSegment(speaker: "Tester", text: text, interim: interim, at: 12)
    }
    private func wait(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<200 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("translation did not settle", file: file, line: line)
    }
    func testSelectBeforeSpeechThenIncrementalFinals() async {
        var calls: [String] = []
        let model = MeetingTranslation { text, _, _ in calls.append(text); return "translated: " + text }
        model.setEnabled(true)
        model.update([line("typing", interim: true), line("  ")])
        await Task.yield()
        XCTAssertTrue(calls.isEmpty)
        let first = line("first"), second = line("second")
        model.update([first]); await wait { model.rows.count == 1 }
        model.update([first, second]); await wait { model.rows.count == 2 }
        model.update([first, second]); await Task.yield()
        XCTAssertEqual(calls, ["first", "second"])
        XCTAssertEqual(model.rows.map(\.source.id), [first.id, second.id])
        XCTAssertEqual(model.rows.first?.source.at, 12)
    }
    func testLanguageSwitchFinishesOneRequestAndReusesItsPaidResult() async {
        var continuations: [CheckedContinuation<String, Error>] = []
        var languages: [TranslationLanguage] = []
        let model = MeetingTranslation { _, language, _ in
            languages.append(language)
            return try await withCheckedThrowingContinuation { continuations.append($0) }
        }
        model.update([line("hello")]); model.setEnabled(true)
        await wait { continuations.count == 1 }
        model.setLanguage(.japanese)
        await Task.yield(); XCTAssertEqual(continuations.count, 1)
        XCTAssertNil(model.displayRows.first?.translation)
        continuations[0].resume(returning: "hello")
        await wait { continuations.count == 2 }
        XCTAssertTrue(model.rows.isEmpty)
        continuations[1].resume(returning: "こんにちは")
        await wait { model.text == "こんにちは" }
        model.setLanguage(.english)
        XCTAssertEqual(model.text, "hello")
        model.setLanguage(.japanese)
        XCTAssertEqual(model.text, "こんにちは")
        XCTAssertEqual(languages, [.english, .japanese])
    }
    func testRetryKeepsCompletedRowsAndProcessesOnlyBacklog() async {
        var calls: [String] = []; var offline = true
        let model = MeetingTranslation { text, _, _ in
            calls.append(text)
            if text == "two" && offline { throw TranslationFailure(message: "offline") }
            return text.uppercased()
        }
        let one = line("one"), two = line("two"), three = line("three")
        model.update([one, two]); model.setEnabled(true)
        await wait { model.failure != nil }
        XCTAssertEqual(model.text, "ONE")
        model.update([one, two, three]); await Task.yield()
        XCTAssertEqual(calls, ["one", "two"])
        offline = false; model.retry()
        await wait { model.rows.count == 3 }
        XCTAssertNil(model.failure)
        XCTAssertEqual(calls, ["one", "two", "two", "three"])
    }
    func testAutoOffRetainsSubmittedResultButDoesNotStartBacklog() async {
        var continuations: [CheckedContinuation<String, Error>] = []
        let model = MeetingTranslation { _, _, _ in
            try await withCheckedThrowingContinuation { continuations.append($0) }
        }
        model.update([line("one"), line("two")]); model.setEnabled(true)
        await wait { continuations.count == 1 }
        model.setEnabled(false)
        continuations[0].resume(returning: "ONE")
        await wait { !model.isTranslating }
        XCTAssertEqual(model.text, "ONE"); XCTAssertEqual(continuations.count, 1)
        model.setEnabled(true); await wait { continuations.count == 2 }
        model.reset()
        model.update([line("new meeting")]); model.setEnabled(true)
        await wait { continuations.count == 3 }
        continuations[1].resume(returning: "old meeting result")
        continuations[2].resume(returning: "new meeting result")
        await wait { model.rows.count == 1 }
        XCTAssertEqual(model.text, "new meeting result")
        model.reset()
        XCTAssertFalse(model.enabled); XCTAssertTrue(model.rows.isEmpty)
    }
    func testRepeatedSelectionDoesNotAutomaticallyRetryFailure() async {
        var calls = 0
        let model = MeetingTranslation { _, _, _ in calls += 1; throw TranslationFailure(message: "limited") }
        model.update([line("one")]); model.setEnabled(true)
        await wait { model.failure != nil }
        for _ in 0..<10 { model.setEnabled(true) }
        await Task.yield(); XCTAssertEqual(calls, 1)
        model.retry(); await wait { calls == 2 }
    }
    func testEngineSwitchDoesNotMixResults() async {
        let model = MeetingTranslation { _, _, engine in engine.rawValue }
        model.update([line("hello")]); model.setEngine(.local); model.setEnabled(true)
        await wait { model.text == "local" }
        model.setEngine(.api); await wait { model.text == "api" }
        model.setEngine(.local); XCTAssertEqual(model.text, "local")
    }
    func testEmptyTranslationIsAnErrorNotSuccess() async {
        let model = MeetingTranslation { _, _, _ in "  " }
        model.update([line("hello")]); model.setEnabled(true)
        await wait { model.failure != nil }
        XCTAssertTrue(model.rows.isEmpty)
    }
    func testEndpointRulesPreventAccidentalExternalLocalTranslation() {
        for url in ["https://example.com/v1", "http://example.com/v1", "http://u:p@localhost/v1", "http://localhost/v1?key=secret", "http://localhost/v1#fragment"] {
            XCTAssertFalse(MeetingTranslationClient.validEndpoint(URL(string: url)!, engine: .local), url)
        }
        XCTAssertTrue(MeetingTranslationClient.validEndpoint(URL(string: "http://127.0.0.1:11434/v1")!, engine: .local))
        XCTAssertTrue(MeetingTranslationClient.validEndpoint(URL(string: "https://example.com/v1")!, engine: .api))
        XCTAssertFalse(MeetingTranslationClient.validEndpoint(URL(string: "http://example.com/v1")!, engine: .api))
    }
    func testOutputLimitMatchesDirectOpenAIAndLocalProtocol() {
        XCTAssertEqual(MeetingTranslationClient.outputLimitField(URL(string: "https://api.openai.com/v1")!), "max_completion_tokens")
        XCTAssertEqual(MeetingTranslationClient.outputLimitField(URL(string: "http://localhost:11434/v1")!), "max_tokens")
    }
    func testMalformedTruncatedAndEmptyResponsesFailClosed() throws {
        func response(_ content: String, finish: String = "stop") throws -> Data {
            try JSONSerialization.data(withJSONObject: ["choices": [["message": ["content": content], "finish_reason": finish]]])
        }
        XCTAssertEqual(try MeetingTranslationClient.decode(response("{\"translation\":\"Hello\"}")), "Hello")
        for content in ["service unavailable", "{}", "{\"translation\":\" \"}"] {
            XCTAssertThrowsError(try MeetingTranslationClient.decode(response(content)))
        }
        XCTAssertThrowsError(try MeetingTranslationClient.decode(response("{\"translation\":\"cut off\"}", finish: "length")))
    }
}

private final class TranslationHTTPStub: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class MeetingTranslationHTTPTests: XCTestCase {
    private func client() -> MeetingTranslationClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [TranslationHTTPStub.self]
        return MeetingTranslationClient(session: URLSession(configuration: config)) { _ in
            MeetingTranslationClient.Configuration(endpoint: URL(string: "http://127.0.0.1:11434/v1")!, model: "fixture", apiKey: nil)
        }
    }
    override func tearDown() { TranslationHTTPStub.handler = nil }
    func testLongUtterancePreservesTailAndCannotInvokeTools() async throws {
        let original = String(repeating: "あ", count: 450) + String(repeating: "い", count: 450) + "う Friday 3 pm"
        var parts: [String] = []
        TranslationHTTPStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/v1/chat/completions")
            XCTAssertEqual(request.httpMethod, "POST")
            let stream = try XCTUnwrap(request.httpBodyStream)
            stream.open(); defer { stream.close() }
            var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertNil(body["tools"])
            let messages = try XCTUnwrap(body["messages"] as? [[String: String]])
            let quoted = try XCTUnwrap(messages.last?["content"]?.data(using: .utf8))
            let text = try JSONDecoder().decode(String.self, from: quoted)
            XCTAssertLessThanOrEqual(text.count, 450)
            parts.append(text)
            let payload = String(data: try JSONSerialization.data(withJSONObject: ["translation": "This is the translated part."]), encoding: .utf8)!
            return (200, try JSONSerialization.data(withJSONObject: ["choices": [["message": ["content": payload], "finish_reason": "stop"]]]))
        }
        let result = try await client().translate(original, to: .english, engine: .local)
        XCTAssertEqual(parts.joined(), original)
        XCTAssertEqual(parts.count, 3)
        XCTAssertEqual(result.components(separatedBy: "\n").count, 3)
    }
    func testRetryOfLongUtteranceDoesNotResendSuccessfulChunks() async throws {
        let original = String(repeating: "あ", count: 450) + String(repeating: "い", count: 450) + "終わり"
        var calls = 0
        TranslationHTTPStub.handler = { _ in
            calls += 1
            if calls == 2 { return (503, Data()) }
            return (200, Data(#"{"choices":[{"message":{"content":"{\"translation\":\"This is a translated sentence.\"}"},"finish_reason":"stop"}]}"#.utf8))
        }
        let translator = client()
        do { _ = try await translator.translate(original, to: .english, engine: .api); XCTFail("expected failure") } catch {}
        XCTAssertEqual(calls, 2)
        let result = try await translator.translate(original, to: .english, engine: .api)
        XCTAssertEqual(calls, 4) // first successful chunk reused; second + third only
        XCTAssertEqual(result.components(separatedBy: "\n").count, 3)
        _ = try await translator.translate(original, to: .english, engine: .api)
        XCTAssertEqual(calls, 4)
    }
    func testAlreadyEnglishDoesNotCallTheModelOrRewriteText() async throws {
        TranslationHTTPStub.handler = { _ in XCTFail("Already-English text was sent to the model"); return (500, Data()) }
        let source = "The next meeting is on Friday at 3 pm. Please review the release checklist."
        let text = try await client().translate(source, to: .english, engine: .local)
        XCTAssertEqual(text, source)
        XCTAssertFalse(MeetingTranslationClient.isAlreadyTargetLanguage("明日は Product Review の会議です。", target: .japanese))
        XCTAssertTrue(MeetingTranslationClient.isWrongLanguage("下一个会议是周五下午3点。请查阅发布检查清单。", target: .english))
    }
    func testServiceErrorAndRedirectAreNotSuccessfulTranslation() async {
        for status in [302, 429, 503] {
            TranslationHTTPStub.handler = { _ in (status, Data("upstream unavailable".utf8)) }
            do {
                _ = try await client().translate("次の会議を始めましょう。", to: .english, engine: .local)
                XCTFail("HTTP \(status) was accepted")
            } catch { XCTAssertTrue(error is TranslationFailure) }
        }
    }
}

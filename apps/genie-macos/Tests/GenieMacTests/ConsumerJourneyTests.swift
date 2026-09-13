import XCTest
@testable import GenieMac

final class ConsumerJourneyTests: XCTestCase {
    func testDirectPersonalRequestsOpenTheMatchingJourney() {
        for text in ["映画を予約して", "今夜の映画のチケットを取りたい", "映画を予約したい", "Book movie tickets for two"] {
            XCTAssertEqual(ConsumerJourneyKind.detect(text), .movie)
        }
        for text in ["京都旅行を計画して", "ホテルを予約して", "Plan a trip to Tokyo"] {
            XCTAssertEqual(ConsumerJourneyKind.detect(text), .travel)
        }
        for text in ["マクドナルドを家まで注文して", "マックを届けて", "Order McDonald's delivery"] {
            XCTAssertEqual(ConsumerJourneyKind.detect(text), .delivery)
        }
    }

    func testProductWorkExistingBookingsAndMixedRequestsAreNotHijacked() {
        for text in ["映画の予約機能を実装して", "ホテル予約のAPIを調べて", "マックデリバリーとは", "映画の予約をキャンセルして", "注文済みのマックが届かない", "映画を予約しないで", "Explain how to book movie tickets", "映画を予約して旅行も計画して", "スクショを解説して", "新しいマックを注文して", "映画の予約サイトを作って", "映画を予約するな", "映画を予約してはいけない", "映画を予約したので確認して"] {
            XCTAssertNil(ConsumerJourneyKind.detect(text), text)
        }
    }

    func testRequiredFieldsAndInvalidBudgetsDoNotStartResearch() {
        var draft = ConsumerJourneyDraft(kind: .travel)
        XCTAssertEqual(draft.missing, ["行き先", "出発地", "出発日・帰着日"])
        XCTAssertNil(draft.travelResearchRequest)
        draft.subject = "京都"; draft.area = "東京"; draft.dates = "2026年10月10日〜12日"
        for value in ["-1", "1.5", "10000001", "一万円", "999999999999999999999999"] {
            draft.budget = value
            XCTAssertNotNil(draft.validationIssue)
            XCTAssertNil(draft.travelResearchRequest)
        }
        draft.budget = "50000"; draft.people = 2
        XCTAssertNil(draft.validationIssue)
        XCTAssertTrue(draft.travelResearchRequest?.contains("予算上限（合計）: 50000円") == true)
        XCTAssertTrue(draft.travelResearchRequest?.contains("予約・購入・メール送信は行わない") == true)
        XCTAssertTrue(draft.travelResearchRequest?.contains("公式の情報源と確認日") == true)
        XCTAssertTrue(draft.travelResearchRequest?.contains("人数: 2人") == true)
    }

    func testMerchantURLsNeverContainRequestData() {
        let hosts = ["www.tohotheater.jp", "www.booking.com", "www.mcdonalds.co.jp"]
        for kind in ConsumerJourneyKind.allCases {
            XCTAssertEqual(kind.officialURL.scheme, "https")
            XCTAssertTrue(hosts.contains(kind.officialURL.host ?? ""))
            XCTAssertNil(kind.officialURL.query)
            XCTAssertNil(kind.officialURL.user)
        }
    }

    func testTravelDraftAndLiveResearchAreDistinctReadOnlyTasks() throws {
        var draft = ConsumerJourneyDraft(kind: .travel)
        draft.subject = "京都"; draft.area = "東京"; draft.dates = "10月10日〜12日"
        draft.request = "ホテルを予約して\n引用\"と改行"
        let prompt = try XCTUnwrap(draft.travelItineraryRequest)
        XCTAssertTrue(prompt.contains("Web検索は使いません"))
        XCTAssertTrue(prompt.contains("最新情報・空き状況は未確認"))
        XCTAssertEqual(ConsumerPlanningMode.itinerary.taskKind, "plugin:com.astra.general:assistant")
        let input = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(ConsumerPlanningMode.itinerary.inputJSON(prompt).utf8)) as? [String: String])
        XCTAssertEqual(input["instruction"], prompt)
        XCTAssertEqual(input["message"], prompt)
        XCTAssertEqual(ConsumerPlanningMode.research.taskKind, "research")
        let research = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(ConsumerPlanningMode.research.inputJSON("q").utf8)) as? [String: String])
        XCTAssertNil(research["instruction"])
    }

    func testDeliveryDoesNotRequireOrInferAnAddressAndDoesNotUseAModel() {
        var draft = ConsumerJourneyDraft(kind: .delivery)
        draft.subject = "ビッグマック1個、ポテトM1個"; draft.dates = "今日の19時頃"
        XCTAssertNil(draft.validationIssue)
        XCTAssertNil(draft.travelResearchRequest)
        XCTAssertTrue(draft.memo.contains("未予約・未注文"))
        XCTAssertTrue(draft.memo.contains("料金・空き状況は未確認"))
        XCTAssertFalse(draft.missing.contains("住所"))
        XCTAssertFalse(draft.memo.contains("undefined"))
    }

    @MainActor func testClosingAndReopeningPreservesSeparateDrafts() {
        let store = ConsumerJourneyStore()
        store.present(.movie, request: "映画を予約して")
        var movie = store.active!
        movie.subject = "映画A"; movie.people = 2
        store.close(movie)
        XCTAssertNil(store.active)
        store.present(.delivery)
        XCTAssertEqual(store.active?.subject, "")
        store.present(.movie)
        XCTAssertEqual(store.active?.subject, "映画A")
        XCTAssertEqual(store.active?.people, 2)
        XCTAssertEqual(store.active?.request, "映画を予約して")
    }
}

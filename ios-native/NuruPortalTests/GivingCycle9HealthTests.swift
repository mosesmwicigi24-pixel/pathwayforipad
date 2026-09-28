// Giving Cycle 9 — "How collection is going", the top of Recurring gifts
// (web Recurring.tsx CollectionHealthCard; financeRecurring.test.tsx on the
// other side): the subtitle, the success rate rounded like the web, the gifts
// our side could not send (1 gift / many gifts), the outage banner on and
// off, failures by reason with whose answer it was, the empty states, the
// forecast per currency never added — and the read itself: beside the
// schedules, never holding the page, a failed read showing no card.
import XCTest
@testable import NuruPortal

final class GivingCycle9HealthTests: XCTestCase {
    private typealias W = FinBCollectionHealthWords

    /// The web test's HEALTH fixture.
    static let webFixture = #"""
    {"window_days":30,"prompts":13,"paid":6,"failed":6,"waiting":1,"success_rate":0.5,
     "by_reason":[{"code":"unreachable","count":3,"reason":"We couldn't reach the phone.","member_answered":false},
                  {"code":"cancelled","count":2,"reason":"The M-Pesa prompt was cancelled.","member_answered":true}],
     "not_sent_by_us":1,
     "outage":{"suspected":true,"evidence":"8 of the last 10 M-Pesa prompts in the past hour never reached the phone.",
               "resolved":10,"unreached":8,"unsent":0},
     "month_end":"2026-09-30",
     "forecast":[{"currency":"KES","gifts":2,"prompts":3,"scheduled_minor":700000,"expected_minor":600000}]}
    """#

    private func health(_ json: String) throws -> FinCollectionHealth { try Wire.decode(FinCollectionHealth.self, json) }

    // MARK: The words

    func testTheWebsFixtureReadsAsTheWebSaysIt() throws {
        let h = try health(Self.webFixture)
        XCTAssertTrue(h.isUsable)
        XCTAssertEqual(h.monthEnd, "2026-09-30")
        XCTAssertEqual(W.title, "How collection is going")
        XCTAssertEqual(W.subtitle(h), "M-Pesa prompts in the last 30 days — 6 paid of 12 answered, 1 still waiting.")
        XCTAssertEqual(W.successRate(h.successRate), "50%")
        XCTAssertEqual(W.notSentByUs(h.notSentByUs), "1 recurring gift not sent by us today — the givers were not told.")
        let banner = try XCTUnwrap(W.outage(h.outage))
        XCTAssertEqual(banner.lead, "M-Pesa looks unwell right now.")
        XCTAssertEqual(banner.rest, "8 of the last 10 M-Pesa prompts in the past hour never reached the phone. Gifts may fail until it recovers — nothing to fix on our side.")
        XCTAssertEqual(h.byReason.map { W.reasonParts($0).count }, ["3", "2"])
        XCTAssertEqual(h.byReason.map { W.reasonParts($0).reason }, ["We couldn't reach the phone.", "The M-Pesa prompt was cancelled."])
        XCTAssertEqual(h.byReason.map { W.reasonParts($0).whose }, ["(never reached them)", "(their answer)"])
        let kes = try XCTUnwrap(W.forecastLines(h).first)
        XCTAssertEqual(W.forecastParts(kes).expected, "KES 6,000.00")
        XCTAssertEqual(W.forecastParts(kes).scheduled, " of KES 7,000.00 scheduled")
        XCTAssertEqual(W.forecastParts(kes).detail, " · 3 prompts, 2 gifts")
        XCTAssertEqual([W.successRateTitle, W.reasonsTitle, W.forecastTitle].map { $0.uppercased() },
                       ["SUCCESS RATE", "WHY PROMPTS FAILED", "REST OF THE MONTH, EXPECTED"])
    }

    func testTheSubtitleSaysWaitingOnlyWhenSomeAre() throws {
        let none = try health(#"{"window_days":7,"paid":1234,"failed":5678,"waiting":0}"#)
        XCTAssertEqual(W.subtitle(none), "M-Pesa prompts in the last 7 days — 1,234 paid of 6,912 answered.")
        let some = try health(#"{"window_days":30,"paid":0,"failed":0,"waiting":1500}"#)
        XCTAssertEqual(W.subtitle(some), "M-Pesa prompts in the last 30 days — 0 paid of 0 answered, 1,500 still waiting.")
    }

    func testTheRateIsAWholePercentRoundedLikeTheWeb() {
        XCTAssertEqual(W.successRate(nil), "—")
        XCTAssertEqual(W.successRate(.nan), "—")
        XCTAssertEqual(W.successRate(0), "0%")
        XCTAssertEqual(W.successRate(1), "100%")
        XCTAssertEqual(W.successRate(0.5), "50%")
        XCTAssertEqual(W.successRate(0.125), "13%")      // 12.5 → 13: halves go up (Math.round)
        XCTAssertEqual(W.successRate(0.875), "88%")
        XCTAssertEqual(W.successRate(0.004), "0%")
        XCTAssertEqual(W.successRate(0.667), "67%")
    }

    func testGiftsNotSentByUsSaysGiftOrGifts() {
        XCTAssertNil(W.notSentByUs(0))
        XCTAssertEqual(W.notSentByUs(1), "1 recurring gift not sent by us today — the givers were not told.")
        XCTAssertEqual(W.notSentByUs(2), "2 recurring gifts not sent by us today — the givers were not told.")
        XCTAssertEqual(W.notSentByUs(1_200), "1,200 recurring gifts not sent by us today — the givers were not told.")
    }

    func testTheOutageBannerOnlyWhileSuspected() throws {
        XCTAssertNil(W.outage(nil))
        let calm = try health(#"{"window_days":30,"outage":{"suspected":false,"evidence":"leftover words","resolved":3,"unreached":0,"unsent":0}}"#)
        XCTAssertNil(W.outage(calm.outage))
        let unsent = try health(#"{"window_days":30,"outage":{"suspected":true,"evidence":"3 scheduled prompts in the past hour could not be sent to M-Pesa at all.","resolved":0,"unreached":0,"unsent":3}}"#)
        XCTAssertEqual(W.outage(unsent.outage)?.rest,
                       "3 scheduled prompts in the past hour could not be sent to M-Pesa at all. Gifts may fail until it recovers — nothing to fix on our side.")
        let wordless = try health(#"{"window_days":30,"outage":{"suspected":true,"evidence":null}}"#)
        XCTAssertEqual(W.outage(wordless.outage)?.lead, "M-Pesa looks unwell right now.")
        XCTAssertEqual(W.outage(wordless.outage)?.rest, "Gifts may fail until it recovers — nothing to fix on our side.")
    }

    func testTheEmptyStates() throws {
        let quiet = try health(#"{"window_days":30,"prompts":0,"paid":0,"failed":0,"waiting":0,"success_rate":null,"by_reason":[],"not_sent_by_us":0,"forecast":[]}"#)
        XCTAssertEqual(W.successRate(quiet.successRate), "—")
        XCTAssertTrue(quiet.byReason.isEmpty)
        XCTAssertEqual(W.noFailures, "None failed.")
        XCTAssertTrue(W.forecastLines(quiet).isEmpty)
        XCTAssertEqual(W.noForecast, "No recurring prompts left this month.")
        XCTAssertNil(W.notSentByUs(quiet.notSentByUs))
        XCTAssertNil(W.outage(quiet.outage))
    }

    func testTwoCurrenciesAreNeverAddedTogether() throws {
        let h = try health(#"""
            {"window_days":30,"forecast":[
               {"currency":"USD","gifts":1,"prompts":2,"scheduled_minor":10000,"expected_minor":5000},
               {"currency":"KES","gifts":2,"prompts":3,"scheduled_minor":700000,"expected_minor":600000}]}
            """#)
        let lines = W.forecastLines(h).map { f -> String in
            let p = W.forecastParts(f)
            return p.expected + p.scheduled + p.detail
        }
        XCTAssertEqual(lines, [
            "KES 6,000.00 of KES 7,000.00 scheduled · 3 prompts, 2 gifts",
            "USD 50.00 of USD 100.00 scheduled · 2 prompts, 1 gift",
        ])
    }

    func testDecodesLeniently() throws {
        // Numbers as text, no outage, no lists, a null rate.
        let h = try health(#"{"window_days":"30","prompts":"4","paid":"3","failed":"1","waiting":null,"success_rate":null,"not_sent_by_us":"2"}"#)
        XCTAssertTrue(h.isUsable)
        XCTAssertEqual(h.paid, 3)
        XCTAssertEqual(h.failed, 1)
        XCTAssertEqual(h.waiting, 0)
        XCTAssertNil(h.successRate)
        XCTAssertNil(h.outage)
        XCTAssertEqual(h.byReason.count, 0)
        XCTAssertEqual(h.forecast.count, 0)
        XCTAssertEqual(W.notSentByUs(h.notSentByUs), "2 recurring gifts not sent by us today — the givers were not told.")
        // Not a health answer at all: shown as nothing.
        XCTAssertFalse(try health("{}").isUsable)
    }

    // MARK: The read

    override func tearDown() {
        StubHTTP.uninstall()
        super.tearDown()
    }

    private static let scheduleRow = #"{"data":[{"schedule_id":"s-1","user_id":"u-1","full_name":"Amina Wanjiru","fund":"tithe","amount_minor":500000,"currency":"KES","frequency":"monthly","status":"active","consecutive_failures":0,"needs_attention":false}]}"#

    /// Schedules and config answer; collection-health answers `health`.
    private func install(health: StubHTTP.Reply) {
        StubHTTP.install { seen in
            switch seen.path {
            case "/v1/admin/finance/collection-health": return health
            case "/v1/admin/finance/schedules": return .init(status: 200, json: Self.scheduleRow)
            case "/v1/admin/finance/config": return .init(status: 200, json: #"{"funds":[],"providers":[]}"#)
            default: return .init(status: 404, json: #"{"error":{"code":"NOT_FOUND","message":"Not found"}}"#)
            }
        }
    }
    private var healthReads: Int { StubHTTP.seen.filter { $0.path == "/v1/admin/finance/collection-health" }.count }

    func testItIsAGetForThirtyDays() async throws {
        install(health: .init(status: 200, json: Self.webFixture))
        let h = try await FinanceERPAPI.collectionHealth(days: 30)
        XCTAssertEqual(h.paid, 6)
        let sent = try XCTUnwrap(StubHTTP.seen.last)
        XCTAssertEqual(sent.method, "GET")
        XCTAssertEqual(sent.path, "/v1/admin/finance/collection-health")
        XCTAssertEqual(sent.query, "days=30")
    }

    @MainActor
    func testTheCardIsReadBesideTheSchedules() async {
        install(health: .init(status: 200, json: Self.webFixture))
        let vm = FinanceRecurringModel()
        await vm.load()
        XCTAssertEqual(vm.phase, .loaded)
        XCTAssertEqual(vm.rows.map(\.scheduleId), ["s-1"])
        XCTAssertEqual(vm.health?.paid, 6)
        XCTAssertEqual(healthReads, 1)
        // A filter change reads the schedules again, not the card.
        vm.filter.status = "active"
        await vm.load()
        XCTAssertEqual(healthReads, 1)
        XCTAssertNotNil(vm.health)
        // Pull-to-refresh reads it again.
        await vm.load(refreshHealth: true)
        XCTAssertEqual(healthReads, 2)
    }

    @MainActor
    func testAFailedReadShowsNoCardAndTheRowsStillLoad() async {
        install(health: .init(status: 404, json: #"{"error":{"code":"NOT_FOUND","message":"Route not found"}}"#))
        let vm = FinanceRecurringModel()
        await vm.load()
        XCTAssertNil(vm.health)
        XCTAssertEqual(vm.phase, .loaded)
        XCTAssertEqual(vm.rows.count, 1)
        XCTAssertNil(vm.refreshError)
    }

    @MainActor
    func testAnUnusableAnswerShowsNoCard() async {
        install(health: .init(status: 200, json: "{}"))
        let vm = FinanceRecurringModel()
        await vm.load()
        XCTAssertNil(vm.health)
        XCTAssertEqual(vm.rows.count, 1)
    }

    @MainActor
    func testARefreshThatFailsTakesTheCardAway() async {
        install(health: .init(status: 200, json: Self.webFixture))
        let vm = FinanceRecurringModel()
        await vm.load()
        XCTAssertNotNil(vm.health)
        install(health: .init(status: 500, json: #"{"error":{"code":"INTERNAL","message":"boom"}}"#))
        await vm.load(refreshHealth: true)
        XCTAssertNil(vm.health, "a card that could not be read again is not left showing old numbers")
        XCTAssertEqual(vm.rows.count, 1)
    }
}

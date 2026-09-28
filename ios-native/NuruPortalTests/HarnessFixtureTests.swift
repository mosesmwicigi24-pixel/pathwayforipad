// The DEBUG preview harnesses' fixtures (FinanceBFixtures, FinAFixtureData)
// carry every Giving Cycle 7 + 9 state, so the pages can be seen on screen
// without a backend. Hand-edited JSON: these pin that it still decodes into
// the real models and still shows each state.
#if DEBUG
import XCTest
@testable import NuruPortal

final class HarnessFixtureTests: XCTestCase {
    private func b(_ key: String) throws -> String { try XCTUnwrap(FinanceBFixtures.json[key], key) }

    func testRecurringFixturesShowEveryState() throws {
        struct Page: Decodable { let data: [FinSchedule] }
        let rows = try Wire.decode(Page.self, try b("schedules")).data
        let by = Dictionary(uniqueKeysWithValues: rows.map { ($0.scheduleId, $0) })
        XCTAssertEqual(by["s-1"]?.pauseReasonLabel, "Stopped after failed prompts")
        XCTAssertEqual(by["s-1"]?.failureWords, "The M-Pesa prompt was cancelled.")
        XCTAssertEqual(by["s-2"]?.failureWords, "The M-Pesa PIN was entered incorrectly.")
        XCTAssertEqual(by["s-2"]?.failureDetail, "The initiator information is invalid (M-Pesa 2001)")
        XCTAssertEqual(by["s-3"]?.nextAskLabel, "Next: nothing — the pledge is already paid")
        XCTAssertEqual(by["s-4"]?.nextAskLabel, "Next: KES 3,000.00 — the rest of the pledge")
        XCTAssertEqual(by["s-4"]?.promptOrProfileNumber, "+254722000111")
        XCTAssertEqual(by["s-5"]?.officeAlert?.hasPrefix("We couldn't send the last prompt"), true)
        XCTAssertEqual(by["s-6"]?.pauseReasonLabel, "The member paused it until 20 Oct 2026")
        XCTAssertEqual(by["s-7"]?.pauseReasonLabel, "Paused with its pledge")
        XCTAssertEqual(by["s-7"]?.officeActions, [.cancel])
        XCTAssertEqual(rows.filter(\.needsAttention).map(\.scheduleId).sorted(), ["s-1", "s-2", "s-5"],
                       "the server's rule: failing, stopped after failures, or not sent by us")
    }

    func testHealthClaimsAndPartnerFixtures() throws {
        let h = try Wire.decode(FinCollectionHealth.self, try b("collection_health"))
        XCTAssertTrue(h.isUsable)
        XCTAssertEqual(h.outage?.suspected, true)
        XCTAssertEqual(FinBCollectionHealthWords.forecastLines(h).map(\.currency), ["KES", "USD"])

        struct Claims: Decodable { let data: [PledgeClaimRow] }
        let claims = try Wire.decode(Claims.self, try b("claims")).data
        XCTAssertEqual(claims.filter(\.currencyMismatch).map(\.currencyMismatchNote), ["Pledge is in USD"])

        let john = try Wire.decode(PartnerDetail.self, try b("partner_details/u-john"))
        XCTAssertEqual(john.schedules.compactMap(\.failureReason), ["The M-Pesa PIN was entered incorrectly."])
        XCTAssertEqual(john.schedules.compactMap(\.pauseReasonLabel), ["The member paused it until 20 Oct 2026"])
    }

    func testOverviewFixtureCarriesTheOutageAndAttentionAlerts() throws {
        let o = try Wire.decode(FinOverview.self, FinAFixtureData.overview)
        let outage = try XCTUnwrap(o.alerts.first { $0.kind == "collection_outage" })
        XCTAssertEqual(FinanceARules.alertText(kind: outage.kind, message: outage.message),
                       "8 of the last 10 M-Pesa prompts in the past hour never reached the phone.")
        XCTAssertNotNil(o.alerts.first { $0.kind == "failing_schedules" })
    }
}
#endif

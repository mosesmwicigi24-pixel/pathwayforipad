// Giving Cycle 7 — Finance → Overview's "Needs attention": the failing-schedules
// hint is the register's one rule, collection_outage is known ahead of the
// server raising it, an alert may carry the server's own words (`message`,
// shown instead of the hint), and a kind this app does not know reads in
// plain words (web financeAPages.test.tsx on the other side).
import XCTest
@testable import NuruPortal

final class GivingCycle7OverviewTests: XCTestCase {

    func testTheOutageAlertSpeaksPlainly() {
        let copy = FinanceARules.alertCopy("collection_outage")
        XCTAssertEqual(copy.title(1), "M-Pesa looks unwell right now")
        XCTAssertEqual(copy.title(7), "M-Pesa looks unwell right now")
        XCTAssertEqual(copy.hint, "Most prompts in the past hour never reached members' phones — gifts may fail until it recovers. Nothing to fix here.")
        XCTAssertEqual(copy.fallbackLink, "/finance/recurring")
        XCTAssertEqual(copy.tone, .error)
        // Where it opens: the server's in-app link, else Recurring gifts.
        XCTAssertEqual(FinanceARules.alertLink(kind: "collection_outage", link: nil), "/finance/recurring")
        XCTAssertEqual(FinanceARules.alertLink(kind: "collection_outage", link: "https://evil.example"), "/finance/recurring")
        XCTAssertEqual(FinanceARules.alertLink(kind: "collection_outage", link: "/finance/recurring?attention=true"),
                       "/finance/recurring?attention=true")
        XCTAssertEqual(FinanceLink.fromWebRoute(FinanceARules.alertLink(kind: "collection_outage", link: nil))?.section, .financeRecurring)
    }

    func testFailingSchedulesIsNeverAMembersOwnPause() {
        let copy = FinanceARules.alertCopy("failing_schedules")
        XCTAssertEqual(copy.hint, "Failing, stopped after failed prompts, or not sent by us — never a member's own pause.")
        XCTAssertEqual(copy.title(1), "1 recurring gift needs attention")
        XCTAssertEqual(copy.tone, .warn)
        XCTAssertEqual(copy.fallbackLink, "/finance/recurring?attention=true")
    }

    func testAKindThisAppDoesNotKnowReadsInPlainWords() {
        let copy = FinanceARules.alertCopy("some_future_alert")
        XCTAssertEqual(copy.title(2), "2 × some future alert")
        XCTAssertEqual(copy.hint, "")
        XCTAssertEqual(copy.tone, .info)
        XCTAssertEqual(FinanceARules.alertLink(kind: "some_future_alert", link: "/finance/somewhere"), "/finance/somewhere")
    }

    func testTheServersWordsReplaceTheHintWhenItSendsThem() throws {
        let alerts = try Wire.decode([FinOverview.Alert].self, #"""
            [{"kind":"collection_outage","count":1,"link":"/finance/recurring",
              "message":"8 of the last 10 M-Pesa prompts in the past hour never reached the phone."},
             {"kind":"failing_schedules","count":"3","link":"/finance/recurring?attention=true"},
             {"kind":"pending_claims","count":2,"link":"/finance/claims","message":null},
             {"kind":"partners_behind","count":1,"link":"/finance/partners?status=behind","message":"   "},
             {"kind":"some_future_alert","count":2,"link":"/finance/somewhere","message":"Something new, in the server's words."}]
            """#)
        XCTAssertEqual(alerts.map(\.message), [
            "8 of the last 10 M-Pesa prompts in the past hour never reached the phone.", nil, nil, "   ",
            "Something new, in the server's words.",
        ])
        XCTAssertEqual(alerts[1].count, 3)
        let lines = alerts.map { FinanceARules.alertText(kind: $0.kind, message: $0.message) }
        XCTAssertEqual(lines, [
            "8 of the last 10 M-Pesa prompts in the past hour never reached the phone.",
            "Failing, stopped after failed prompts, or not sent by us — never a member's own pause.",
            "Members who say they paid another way — confirm or reject each one.",
            "A pledge instalment is overdue.",                  // blank words fall back to the hint
            "Something new, in the server's words.",
        ])
        // Without a message at all, the outage says its own hint.
        XCTAssertEqual(FinanceARules.alertText(kind: "collection_outage", message: nil),
                       "Most prompts in the past hour never reached members' phones — gifts may fail until it recovers. Nothing to fix here.")
    }
}

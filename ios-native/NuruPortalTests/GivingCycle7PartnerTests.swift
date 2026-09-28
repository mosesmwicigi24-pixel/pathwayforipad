// Giving Cycle 7 — the partner drawer's schedules (GET /admin/partners/{userId}
// schedules[]): why a gift is paused under its status, and why it is failing
// — in the words the member was told — under the failure count (web
// Partners.tsx ScheduleRow).
import XCTest
@testable import NuruPortal

final class GivingCycle7PartnerTests: XCTestCase {

    func testTheDrawerSaysWhyAGiftIsPausedOrFailing() throws {
        let d = try Wire.decode(PartnerDetail.self, #"""
            {"member":{"user_id":"u-1","full_name":"Amina Wanjiru"},
             "pledges":[],"payments":[],"reminders":[],
             "schedules":[
               {"schedule_id":"s-1","status":"paused","frequency":"monthly","method":"mpesa","amount_minor":"500000",
                "currency":"KES","next_run_at":null,"last_run_at":null,"consecutive_failures":0,"pledge_id":null,
                "fund":"tithe","pause_reason":"member","resume_on":"2026-10-20","last_failure":null},
               {"schedule_id":"s-2","status":"active","frequency":"weekly","method":"mpesa","amount_minor":"62500",
                "currency":"KES","next_run_at":"2026-10-05 06:00:00+00","last_run_at":null,"consecutive_failures":2,
                "pledge_id":"p-1","fund":"missions","pause_reason":null,"resume_on":null,
                "last_failure":{"code":"expired","reason":"The M-Pesa prompt timed out before it was answered.",
                                "hint":"Try again and enter your PIN when the prompt appears.","retryable":true}},
               {"schedule_id":"s-3","status":"paused","frequency":"monthly","method":"mpesa","amount_minor":"100000",
                "currency":"KES","consecutive_failures":3,"fund":"building","pause_reason":"failures","resume_on":null,
                "last_failure":{"code":"declined","reason":"M-Pesa declined the payment.","hint":"Nothing was taken."}},
               {"schedule_id":"s-4","status":"paused","frequency":"monthly","amount_minor":"100000","currency":"KES",
                "consecutive_failures":0,"fund":"youth","pause_reason":"pledge"}
             ]}
            """#)
        let s = Dictionary(uniqueKeysWithValues: d.schedules.map { ($0.scheduleId, $0) })
        XCTAssertEqual(s["s-1"]?.pauseReasonLabel, "The member paused it until 20 Oct 2026")
        XCTAssertNil(s["s-1"]?.failureReason)
        XCTAssertNil(s["s-2"]?.pauseReasonLabel)
        XCTAssertEqual(s["s-2"]?.failureReason, "The M-Pesa prompt timed out before it was answered.")
        XCTAssertEqual(s["s-2"]?.lastFailure?.retryable, true)
        XCTAssertEqual(s["s-3"]?.pauseReasonLabel, "Stopped after failed prompts")
        XCTAssertEqual(s["s-3"]?.failureReason, "M-Pesa declined the payment.")
        XCTAssertEqual(s["s-4"]?.pauseReasonLabel, "Paused with its pledge")
        XCTAssertEqual(s["s-2"]?.amountMinor, 62_500)
    }

    func testAnOlderServersSchedulesStillRead() throws {
        let d = try Wire.decode(PartnerDetail.self, #"""
            {"member":{"user_id":"u-1"},
             "schedules":[{"schedule_id":"s-9","status":"paused","frequency":"monthly","amount_minor":"100000",
                           "currency":"KES","consecutive_failures":3,"fund":"tithe"}]}
            """#)
        let s = try XCTUnwrap(d.schedules.first)
        XCTAssertNil(s.pauseReason)
        XCTAssertNil(s.resumeOn)
        XCTAssertNil(s.lastFailure)
        XCTAssertEqual(s.pauseReasonLabel, "Stopped after failed prompts")   // no reason on record
        XCTAssertNil(s.failureReason)                                        // the count still shows
    }
}

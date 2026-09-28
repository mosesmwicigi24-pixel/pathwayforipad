// Giving Cycle 7 — Finance → Recurring gifts, the office's view (pathway
// docs/GIVING.md §10; the web's financeRecurring.test.tsx on the other side):
// why a gift is paused (the member's own choice is not a failure), why it is
// failing in the member's words, our own outage flagged, the pledge a gift
// collects and what its next prompt asks — and, with finance:manage, pause /
// resume / cancel at the member's request with a required reason.
import XCTest
@testable import NuruPortal

final class GivingCycle7RecurringTests: XCTestCase {

    // MARK: The words

    func testPauseReadsAsWhoseChoiceItWas() {
        typealias W = FinBScheduleWords
        XCTAssertNil(W.pauseReason(status: "active", pauseReason: nil, resumeOn: nil))
        XCTAssertNil(W.pauseReason(status: "cancelled", pauseReason: "member", resumeOn: nil))
        XCTAssertEqual(W.pauseReason(status: "paused", pauseReason: "member", resumeOn: nil), "The member paused it")
        XCTAssertEqual(W.pauseReason(status: "paused", pauseReason: "member", resumeOn: ""), "The member paused it")
        XCTAssertEqual(W.pauseReason(status: "paused", pauseReason: "member", resumeOn: "2026-10-20"),
                       "The member paused it until 20 Oct 2026")
        XCTAssertEqual(W.pauseReason(status: "paused", pauseReason: "pledge", resumeOn: nil), "Paused with its pledge")
        XCTAssertEqual(W.pauseReason(status: "paused", pauseReason: "failures", resumeOn: nil), "Stopped after failed prompts")
        // An older row has no reason on record: it was stopped by failures.
        XCTAssertEqual(W.pauseReason(status: "paused", pauseReason: nil, resumeOn: nil), "Stopped after failed prompts")
    }

    func testOnlyAPauseAfterFailuresIsTheOfficesToChase() {
        XCTAssertTrue(FinBScheduleWords.pauseIsFailure("failures"))
        XCTAssertTrue(FinBScheduleWords.pauseIsFailure(nil))
        XCTAssertTrue(FinBScheduleWords.pauseIsFailure(""))
        XCTAssertFalse(FinBScheduleWords.pauseIsFailure("member"))
        XCTAssertFalse(FinBScheduleWords.pauseIsFailure("pledge"))
    }

    func testTheNextPromptIsNamedOnlyWhenItDiffersFromTheGift() {
        typealias W = FinBScheduleWords
        XCTAssertNil(W.nextAsk(status: "active", amountMinor: 500_000, currency: "KES", nextAmountMinor: 500_000))
        XCTAssertNil(W.nextAsk(status: "active", amountMinor: 500_000, currency: "KES", nextAmountMinor: nil))
        XCTAssertEqual(W.nextAsk(status: "active", amountMinor: 500_000, currency: "KES", nextAmountMinor: 300_000),
                       "Next: KES 3,000.00 — the rest of the pledge")
        XCTAssertEqual(W.nextAsk(status: "active", amountMinor: 500_000, currency: "KES", nextAmountMinor: 0),
                       "Next: nothing — the pledge is already paid")
        XCTAssertNil(W.nextAsk(status: "paused", amountMinor: 500_000, currency: "KES", nextAmountMinor: 0))
        XCTAssertNil(W.nextAsk(status: "cancelled", amountMinor: 500_000, currency: "KES", nextAmountMinor: 300_000))
    }

    func testTomorrowIsNairobisTomorrowEvenLateAtNightUTC() {
        // 22:30 UTC on 30 Sep is 01:30 on 1 Oct in Nairobi.
        XCTAssertEqual(FinBScheduleWords.nairobiTomorrow(now: Wire.at("2026-09-30T22:30:00Z")), "2026-10-02")
        XCTAssertEqual(FinBScheduleWords.nairobiTomorrow(now: Wire.at("2026-09-30T12:00:00Z")), "2026-10-01")
        XCTAssertEqual(FinBScheduleWords.nairobiTomorrow(now: Wire.at("2026-12-31T21:00:00Z")), "2027-01-02")
        // The latest a pause may end: a year from Nairobi's today (the route takes ≤ 366 days).
        XCTAssertEqual(FinBScheduleWords.nairobiYearAhead(now: Wire.at("2026-09-30T22:30:00Z")), "2027-10-01")
        XCTAssertEqual(FinBScheduleWords.nairobiYearAhead(now: Wire.at("2028-02-29T09:00:00Z")), "2029-02-28")
    }

    // MARK: The row, as the server sends it

    private static let cycle7Row = #"""
    {"schedule_id":"s-1","user_id":"u-1","full_name":"Amina Wanjiru","phone_number":"+254711222333",
     "fund":"tithe","fund_name":"Tithe","amount_minor":500000,"currency":"KES","frequency":"monthly","method":"mpesa",
     "status":"active","next_run_at":"2026-10-05T06:00:00.000Z","last_run_at":null,
     "consecutive_failures":2,"last_error":"raw provider text","last_failed_at":"2026-09-21T06:00:40.000Z",
     "paused_at":null,"created_at":"2026-09-01T06:00:00.000Z",
     "pause_reason":null,"resume_on":null,"heads_up":true,"anchor_day":5,
     "prompt_number":"+254722000111","retry_at":"2026-09-21T07:00:00.000Z",
     "needs_attention":true,
     "last_failure":{"code":"insufficient_funds","reason":"There wasn't enough in the M-Pesa account.",
                     "hint":"Nothing was taken. Top up, or try a smaller amount.","retryable":false},
     "office_alert":null,"pledge":{"pledge_id":"p-1","title":"Kenya trip"},"next_amount_minor":300000}
    """#

    func testDecodesARowWithTheCycle7Fields() throws {
        let s = try Wire.decode(FinSchedule.self, Self.cycle7Row)
        XCTAssertEqual(s.scheduleId, "s-1")
        XCTAssertEqual(s.fundName, "Tithe")
        XCTAssertEqual(s.lastFailure?.code, "insufficient_funds")
        XCTAssertEqual(s.lastFailure?.reason, "There wasn't enough in the M-Pesa account.")
        XCTAssertEqual(s.lastFailure?.hint, "Nothing was taken. Top up, or try a smaller amount.")
        XCTAssertEqual(s.lastFailure?.retryable, false)
        XCTAssertNil(s.officeAlert)
        XCTAssertNil(s.pauseReason)
        XCTAssertNil(s.resumeOn)
        XCTAssertEqual(s.headsUp, true)
        XCTAssertEqual(s.promptNumber, "+254722000111")
        XCTAssertEqual(s.retryAt, "2026-09-21T07:00:00.000Z")
        XCTAssertEqual(s.pledge?.pledgeId, "p-1")
        XCTAssertEqual(s.pledge?.title, "Kenya trip")
        XCTAssertEqual(s.nextAmountMinor, 300_000)
        XCTAssertTrue(s.needsAttention)
        // What the row shows.
        XCTAssertEqual(s.failureWords, "There wasn't enough in the M-Pesa account.")
        XCTAssertEqual(s.failureDetail, "raw provider text")
        XCTAssertEqual(s.promptOrProfileNumber, "+254722000111")
        XCTAssertEqual(s.nextAskLabel, "Next: KES 3,000.00 — the rest of the pledge")
        XCTAssertNil(s.pauseReasonLabel)
    }

    func testDecodesARowFromAnOlderServer() throws {
        // The pre-cycle-7 row: none of the new fields.
        let s = try Wire.decode(FinSchedule.self, #"""
            {"schedule_id":"s-2","user_id":"u-2","full_name":"Old Row","phone_number":"+254700000002","fund":"tithe",
             "amount_minor":"62500","currency":"KES","frequency":"weekly","method":"mpesa","status":"paused",
             "next_run_at":null,"last_run_at":"2026-09-21T06:00:00.000Z","consecutive_failures":3,
             "last_error":"The initiator information is invalid (M-Pesa 2001)","last_failed_at":"2026-09-21T06:00:40.000Z",
             "paused_at":"2026-09-21T06:01:00.000Z","created_at":"2026-01-10T08:00:00.000Z","needs_attention":true}
            """#)
        XCTAssertEqual(s.amountMinor, 62_500)
        XCTAssertNil(s.fundName)
        XCTAssertNil(s.lastFailure)
        XCTAssertNil(s.officeAlert)
        XCTAssertNil(s.pauseReason)
        XCTAssertNil(s.resumeOn)
        XCTAssertNil(s.headsUp)
        XCTAssertNil(s.promptNumber)
        XCTAssertNil(s.retryAt)
        XCTAssertNil(s.pledge)
        XCTAssertNil(s.nextAmountMinor)
        // It still reads: the provider's words, the profile number, the failure pause.
        XCTAssertEqual(s.failureWords, "The initiator information is invalid (M-Pesa 2001)")
        XCTAssertNil(s.failureDetail)
        XCTAssertEqual(s.promptOrProfileNumber, "+254700000002")
        XCTAssertEqual(s.pauseReasonLabel, "Stopped after failed prompts")
        XCTAssertTrue(s.pauseIsFailure)
        XCTAssertNil(s.nextAskLabel)
    }

    func testDecodesLeniently() throws {
        // A member's pause with its day; a BIGINT sent as text; a null pledge
        // and failure; an office alert; no needs_attention at all.
        let s = try Wire.decode(FinSchedule.self, #"""
            {"schedule_id":"s-3","full_name":"Resting Giver","status":"paused","amount_minor":"500000","currency":"KES",
             "frequency":"monthly","consecutive_failures":0,"pause_reason":"member","resume_on":"2026-10-20",
             "prompt_number":null,"pledge":null,"last_failure":null,"next_amount_minor":null,
             "office_alert":"We couldn't send the last prompt (UPSTREAM). The giver has not been told; it tries again within the hour."}
            """#)
        XCTAssertEqual(s.pauseReasonLabel, "The member paused it until 20 Oct 2026")
        XCTAssertFalse(s.pauseIsFailure)
        XCTAssertFalse(s.needsAttention)
        XCTAssertNil(s.promptOrProfileNumber)
        XCTAssertEqual(s.officeAlert?.hasPrefix("We couldn't send the last prompt"), true)
        let n = try Wire.decode(FinSchedule.self, #"{"schedule_id":"s-4","status":"active","amount_minor":500000,"next_amount_minor":"0"}"#)
        XCTAssertEqual(n.nextAmountMinor, 0)
        XCTAssertEqual(n.nextAskLabel, "Next: nothing — the pledge is already paid")
    }

    // MARK: The office acts, at the member's request

    private func row(status: String, pauseReason: String? = nil, name: String = "Amina Wanjiru") throws -> FinSchedule {
        try Wire.decode(FinSchedule.self, """
            {"schedule_id":"s-1","full_name":"\(name)","status":"\(status)","amount_minor":500000,"currency":"KES",
             "frequency":"monthly","pause_reason":\(pauseReason.map { "\"\($0)\"" } ?? "null")}
            """)
    }

    func testWhichActionsARowOffers() throws {
        XCTAssertEqual(try row(status: "active").officeActions, [.pause, .cancel])
        XCTAssertEqual(try row(status: "paused", pauseReason: "member").officeActions, [.resume, .cancel])
        XCTAssertEqual(try row(status: "paused", pauseReason: "failures").officeActions, [.resume, .cancel])
        XCTAssertEqual(try row(status: "paused").officeActions, [.resume, .cancel])
        // Paused with its pledge: resume the pledge instead — no Resume here.
        XCTAssertEqual(try row(status: "paused", pauseReason: "pledge").officeActions, [.cancel])
        XCTAssertEqual(try row(status: "cancelled").officeActions, [])
    }

    func testTheDialogSaysWhatHappensAndThatTheMemberIsTold() throws {
        let gift = try row(status: "active").giftDescription
        XCTAssertEqual(gift, "Amina Wanjiru's monthly gift of KES 5,000.00")
        XCTAssertEqual(FinScheduleOfficeAction.pause.consequence(gift),
                       "No prompts go to Amina Wanjiru's monthly gift of KES 5,000.00 while it is paused.")
        XCTAssertEqual(FinScheduleOfficeAction.resume.consequence(gift),
                       "Amina Wanjiru's monthly gift of KES 5,000.00 picks up at its next occurrence — nothing missed is charged.")
        XCTAssertEqual(FinScheduleOfficeAction.cancel.consequence(gift),
                       "Amina Wanjiru's monthly gift of KES 5,000.00 stops for good. Only do this when the member asked.")
        XCTAssertEqual(FinScheduleOfficeAction.memberIsTold, "The member is told the office did it, at their request.")
        XCTAssertEqual(FinScheduleOfficeAction.pause.title, "Pause this gift?")
        XCTAssertEqual(FinScheduleOfficeAction.resume.confirmLabel, "Resume gift")
        XCTAssertEqual(FinScheduleOfficeAction.cancel.confirmLabel, "Cancel gift")
        // No name on record: "the member", capitalised where it starts the sentence.
        let nameless = try row(status: "active", name: "").giftDescription
        XCTAssertEqual(nameless, "the member's monthly gift of KES 5,000.00")
        XCTAssertTrue(FinScheduleOfficeAction.cancel.consequence(nameless).hasPrefix("The member's monthly gift"))
        // The toast.
        XCTAssertEqual(FinScheduleOfficeAction.pause.done(name: "Amina Wanjiru"), "Paused Amina Wanjiru's gift — they have been told")
        XCTAssertEqual(FinScheduleOfficeAction.resume.done(name: "Amina Wanjiru"), "Resumed Amina Wanjiru's gift — they have been told")
        XCTAssertEqual(FinScheduleOfficeAction.cancel.done(name: ""), "Cancelled the member's gift — they have been told")
    }

    func testTheReasonIsRequiredThreeToThreeHundredAfterTrimming() {
        typealias B = FinScheduleActionBody
        XCTAssertFalse(B.noteIsValid(""))
        XCTAssertFalse(B.noteIsValid("  ab  "))
        XCTAssertTrue(B.noteIsValid(" abc "))
        XCTAssertTrue(B.noteIsValid(String(repeating: "x", count: 300)))
        XCTAssertFalse(B.noteIsValid(String(repeating: "x", count: 301)))
        // Counted as the route counts (UTF-16), so an emoji is two.
        XCTAssertEqual(B.noteLength("🙏 ok"), 5)
        XCTAssertFalse(B.noteIsValid(String(repeating: "x", count: 299) + "🙏"))
    }

    func testTheBodyTrimsTheNoteAndCarriesADayOnlyForAPause() throws {
        let pause = try Wire.object(FinScheduleActionBody.make(.pause, note: "  Called: travelling in October \n", until: "2026-10-20"))
        XCTAssertEqual(pause["note"] as? String, "Called: travelling in October")
        XCTAssertEqual(pause["resume_on"] as? String, "2026-10-20")
        XCTAssertEqual(Set(pause.keys), ["note", "resume_on"])

        let open = try Wire.object(FinScheduleActionBody.make(.pause, note: "Called", until: nil))
        XCTAssertEqual(Set(open.keys), ["note"])
        XCTAssertEqual(Set(try Wire.object(FinScheduleActionBody.make(.pause, note: "Called", until: "  ")).keys), ["note"])

        for action in [FinScheduleOfficeAction.resume, .cancel] {
            let body = try Wire.object(FinScheduleActionBody.make(action, note: " At their request ", until: "2026-10-20"))
            XCTAssertEqual(Set(body.keys), ["note"], "\(action) never carries resume_on")
            XCTAssertEqual(body["note"] as? String, "At their request")
        }
    }

    // MARK: On the wire

    override func tearDown() {
        StubHTTP.uninstall()
        super.tearDown()
    }

    func testPauseIsAPostToTheScheduleWithTheBodyAndAnswersTheRow() async throws {
        StubHTTP.install { _ in
            .init(status: 200, json: #"{"schedule_id":"s-1","full_name":"Amina Wanjiru","status":"paused","amount_minor":500000,"currency":"KES","pause_reason":"member","resume_on":"2026-10-20","needs_attention":false}"#)
        }
        let row = try await FinanceERPAPI.scheduleAction("s-1", .pause,
                                                         .make(.pause, note: " Called: travelling ", until: "2026-10-20"))
        XCTAssertEqual(row.status, "paused")
        XCTAssertEqual(row.pauseReasonLabel, "The member paused it until 20 Oct 2026")
        let sent = try XCTUnwrap(StubHTTP.seen.last)
        XCTAssertEqual(sent.method, "POST")
        XCTAssertEqual(sent.path, "/v1/admin/finance/schedules/s-1/pause")
        XCTAssertEqual(sent.json?["note"] as? String, "Called: travelling")
        XCTAssertEqual(sent.json?["resume_on"] as? String, "2026-10-20")
    }

    func testResumeAndCancelPostTheirOwnRoutesWithTheNoteOnly() async throws {
        StubHTTP.install { _ in .init(status: 200, json: #"{"schedule_id":"s-9"}"#) }
        _ = try await FinanceERPAPI.scheduleAction("s-9", .resume, .make(.resume, note: "Back from travel", until: "2026-10-20"))
        _ = try await FinanceERPAPI.scheduleAction("s-9", .cancel, .make(.cancel, note: "Asked to stop", until: nil))
        let seen = StubHTTP.seen
        XCTAssertEqual(seen.map(\.path), ["/v1/admin/finance/schedules/s-9/resume", "/v1/admin/finance/schedules/s-9/cancel"])
        XCTAssertEqual(seen.map { $0.json.map { Set($0.keys) } }, [["note"], ["note"]])
    }

    func testTheServersWordsReachTheSheet() async throws {
        StubHTTP.install { seen in
            seen.path.hasSuffix("/resume")
                ? .init(status: 422, json: #"{"error":{"code":"UNPROCESSABLE","message":"This gift is paused with its pledge — resume the pledge instead."}}"#)
                : .init(status: 400, json: #"{"error":{"code":"VALIDATION_FAILED","message":"Choose a date from tomorrow to a year from now.","details":{"resume_on":"2030-01-01"}}}"#)
        }
        do {
            _ = try await FinanceERPAPI.scheduleAction("s-1", .resume, .make(.resume, note: "Asked", until: nil))
            XCTFail("a 422 must throw")
        } catch {
            XCTAssertEqual(error.apiStatus, 422)
            XCTAssertEqual(FinBError.message(error, fallback: "Could not change the gift."),
                           "This gift is paused with its pledge — resume the pledge instead.")
        }
        do {
            _ = try await FinanceERPAPI.scheduleAction("s-1", .pause, .make(.pause, note: "Asked", until: "2030-01-01"))
            XCTFail("a 400 must throw")
        } catch {
            XCTAssertEqual(error.apiStatus, 400)
            XCTAssertEqual(FinBError.message(error, fallback: "Could not change the gift."),
                           "Choose a date from tomorrow to a year from now.")
        }
    }
}

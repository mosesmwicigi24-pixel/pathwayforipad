// DEBUG-only self-check for the B pages' pure helpers — run with the kit's
// FinanceSelfCheck at every Debug launch (NuruPortalApp.init; the project has
// no unit-test target): the recurring run-rate, the budget spread and its
// remainder, month cells and the 12-value rule, the no-overlap rule, the
// maker-checker states and sentences, year-to-date months, fund impact,
// report footing, queue ages, the faithfulness summary, planning years,
// deadline and campaign timing words. Release builds carry none of it.
#if DEBUG
import Foundation

extension FinanceSelfCheck {
    static func pagesB() -> (checks: Int, failures: [String]) {
        var checks = 0
        var failures: [String] = []
        func expect(_ ok: Bool, _ what: @autoclosure () -> String) {
            checks += 1
            if !ok { failures.append("B: " + what()) }
        }
        func expectEqual<T: Equatable>(_ got: T, _ want: T, _ what: String) {
            expect(got == want, "\(what): got \(got), want \(want)")
        }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
            do { return try decoder.decode(T.self, from: Data(json.utf8)) }
            catch { expect(false, "decode \(T.self): \(error)"); return nil }
        }
        let iso = ISO8601DateFormatter()
        func at(_ s: String) -> Date { iso.date(from: s) ?? Date(timeIntervalSince1970: 0) }

        // Run-rate: (Σ weekly × 52 + Σ monthly × 12) ÷ 12, half up, ACTIVE only, per currency.
        typealias S = FinBMath.Schedule
        func rate(_ items: [S]) -> [FinBMath.RunRate] { FinBMath.runRates(items) }
        expectEqual(rate([S(frequency: "weekly", amountMinor: 100_000, currency: "KES", status: "active")]).first?.monthlyMinor,
                    433_333, "weekly KES 1,000 ≈ KES 4,333.33 a month")
        expectEqual(rate([S(frequency: "weekly", amountMinor: 5, currency: "KES", status: "active")]).first?.monthlyMinor,
                    22, "weekly 5 → 21.67 rounds half up to 22")
        expectEqual(rate([S(frequency: "monthly", amountMinor: 200_000, currency: "KES", status: "active")]).first?.monthlyMinor,
                    200_000, "monthly passes through")
        expectEqual(rate([S(frequency: "weekly", amountMinor: 1, currency: "KES", status: "active"),
                          S(frequency: "weekly", amountMinor: 1, currency: "KES", status: "active")]).first?.monthlyMinor,
                    9, "summed before dividing: 104 ÷ 12 = 8.67 → 9 (not 4 + 4)")
        let mixed = rate([S(frequency: "weekly", amountMinor: 100_000, currency: "KES", status: "paused"),
                          S(frequency: "monthly", amountMinor: 5_000, currency: "USD", status: "active"),
                          S(frequency: "yearly", amountMinor: 9_999, currency: "KES", status: "active")])
        expectEqual(mixed.map(\.currency), ["KES", "USD"], "run-rates KES first")
        expectEqual(mixed.first?.monthlyMinor, 0, "paused and unknown frequencies bring nothing in")
        expectEqual(mixed.first?.active, 1, "one active KES schedule (the yearly one)")
        expectEqual(mixed.first?.listed, 2, "two KES schedules listed")
        expectEqual(mixed.first?.unrated, 1, "the yearly one is unrated, not guessed")
        expectEqual(mixed.last?.monthlyMinor, 5_000, "USD kept apart")
        expectEqual(FinBMath.perMonth(fromAnnual: -18), -2, "half up is symmetric below zero")

        // Budget spread: equal whole-cent months, the remainder on December.
        expectEqual(FinBMath.spreadEvenly(100), Array(repeating: 8, count: 11) + [12], "100 → 8 × 11 + 12")
        let annual = 10_000_000                                   // KES 100,000.00
        let spread = FinBMath.spreadEvenly(annual)
        expectEqual(spread.first, 833_333, "KES 100,000 → 8,333.33 a month")
        expectEqual(spread.last, 833_337, "December takes the remainder (8,333.37)")
        for a in [0, 1, 11, 12, 13, 99_999, 123_456_789] {
            let s = FinBMath.spreadEvenly(a)
            expect(s.count == 12 && s.reduce(0, +) == a, "spread(\(a)) sums back exactly")
        }
        expectEqual(FinBMath.spreadEvenly(11), Array(repeating: 0, count: 11) + [11], "11 → all on December")

        // Month cells: blank = 0, two decimals, 0 … KES 1,000,000,000.00.
        let cells: [(String, Result<Int, FinBCellError>)] = [
            ("", .success(0)), ("  ", .success(0)), ("0", .success(0)), ("25,000", .success(2_500_000)),
            ("1.5", .success(150)), (".5", .success(50)), ("1000000000", .success(100_000_000_000)),
            ("1000000000.01", .failure(.tooLarge)), ("1.234", .failure(.tooManyDecimals)),
            ("-1", .failure(.negative)), ("abc", .failure(.invalid)), ("1.2.3", .failure(.invalid)),
        ]
        for (input, want) in cells { expectEqual(FinBMath.parseMonthCell(input), want, "parseMonthCell(\"\(input)\")") }

        // Twelve values.
        expect(FinBMath.twelveProblem(Array(repeating: 0, count: 11)) != nil, "11 months is refused")
        expect(FinBMath.twelveProblem(Array(repeating: 0, count: 12)) == nil, "12 zeros are fine")
        expect(FinBMath.twelveProblem([0, 0, -1] + Array(repeating: 0, count: 9)) != nil, "a negative month is refused")
        expect(FinBMath.twelveProblem([FinBMath.budgetMonthMaxMinor + 1] + Array(repeating: 0, count: 11)) != nil, "over the max is refused")

        // No overlapping lines.
        typealias K = FinBMath.LineKey
        let name: (String) -> String = { $0 }
        expect(FinBMath.overlapProblem([K(kind: "income", fund: "tithe", category: nil), K(kind: "income", fund: "tithe", category: nil)],
                                       fundName: name, categoryName: name) != nil, "two income lines on one fund overlap")
        expect(FinBMath.overlapProblem([K(kind: "expense", fund: nil, category: "rent"), K(kind: "expense", fund: "tithe", category: "rent")],
                                       fundName: name, categoryName: name) != nil, "church-wide + per-fund on one category overlap")
        expect(FinBMath.overlapProblem([K(kind: "expense", fund: "tithe", category: "rent"), K(kind: "expense", fund: nil, category: "rent")],
                                       fundName: name, categoryName: name) != nil, "per-fund then church-wide also overlap")
        expect(FinBMath.overlapProblem([K(kind: "expense", fund: nil, category: "rent"), K(kind: "expense", fund: nil, category: "rent")],
                                       fundName: name, categoryName: name) != nil, "two church-wide lines overlap")
        expect(FinBMath.overlapProblem([K(kind: "expense", fund: "tithe", category: "rent"), K(kind: "expense", fund: "missions", category: "rent"),
                                        K(kind: "income", fund: "tithe", category: nil), K(kind: "expense", fund: nil, category: "utilities")],
                                       fundName: name, categoryName: name) == nil, "distinct funds per category are fine")

        // The editor's lines → PUT body.
        var line = FinBBudgetEditLine(kind: "income", fund: "tithe", label: "Sunday tithes", months: Array(repeating: "1,000", count: 12))
        if case .ok(let body) = FinBBudgetLines.inputs([line], fundName: name, categoryName: name) {
            expectEqual(body.first?.monthlyMinor.reduce(0, +), 1_200_000, "twelve KES 1,000 months = KES 12,000")
            expectEqual(body.first?.category, nil, "an income line sends no category")
        } else { expect(false, "a valid income line parses") }
        line.label = "x"
        if case .problems(let p) = FinBBudgetLines.inputs([line], fundName: name, categoryName: name) {
            expect(p.contains { $0.contains("2–80") }, "a 1-character label is refused")
        } else { expect(false, "a 1-character label is refused") }

        // Maker-checker.
        let checker = FinanceCaps(view: true, export: true, manage: true, approve: true, userId: "u-2")
        typealias M = FinBMakerChecker
        expectEqual(M.state(caps: checker, status: "recorded", recordedBy: "u-9", editors: []), .approve, "a checker may approve")
        expectEqual(M.state(caps: checker, status: "recorded", recordedBy: "u-2", editors: []), .recordedByMe, "the recorder may not")
        expectEqual(M.state(caps: checker, status: "recorded", recordedBy: "u-9", editors: ["u-2"]), .editedByMe, "an editor may not")
        let superAdmin = FinanceCaps(view: true, export: true, manage: true, approve: true, userId: "u-1", isSuperAdmin: true)
        expectEqual(M.state(caps: superAdmin, status: "recorded", recordedBy: "u-1", editors: ["u-1"]), .approve, "a SuperAdmin may approve their own")
        expectEqual(M.state(caps: .loading, status: "recorded", recordedBy: "u-9", editors: []), .noCapability, "no Approve while /me loads")
        expectEqual(M.state(caps: checker, status: "approved", recordedBy: "u-9", editors: []), .notRecorded, "nothing to approve once approved")
        let unknownMe = FinanceCaps(view: true, export: false, manage: false, approve: true, userId: nil)
        expectEqual(M.state(caps: unknownMe, status: "recorded", recordedBy: "u-9", editors: []), .approve, "unknown me → the server decides")
        expectEqual(M.State.recordedByMe.sentence, "You recorded this expense, so another person must approve it.", "recorder sentence")
        expectEqual(M.State.editedByMe.sentence, "You edited this expense, so another person must approve it.", "editor sentence")
        expectEqual(FinBError.message(APIError.http(status: 403, message: "Forbidden", info: APIErrorInfo(code: "SAME_PERSON", details: [:])), fallback: "x"),
                    M.sentence, "403 SAME_PERSON → the maker-checker sentence")

        // Fund impact.
        let down = FinBMath.fundImpact(fundName: "Tithe", currency: "KES", balanceMinor: 12_000_000, amountMinor: 1_500_000, approving: true)
        expectEqual(down.sentence, "Tithe balance: KES 120,000.00 → KES 105,000.00 after this.", "approve impact sentence")
        expect(down.warning == nil, "no warning above zero")
        let over = FinBMath.fundImpact(fundName: "Tithe", currency: "KES", balanceMinor: 500_000, amountMinor: 1_350_000, approving: true)
        expectEqual(over.warning, "Tithe will be KES 8,500.00 overdrawn — approve only if the money has really left.", "overdrawn warning")
        let back = FinBMath.fundImpact(fundName: "Tithe", currency: "USD", balanceMinor: -2_000, amountMinor: 500, approving: false)
        expectEqual(back.after, -1_500, "voiding puts the amount back")
        expectEqual(back.warning, "Tithe will still be USD 15.00 overdrawn after this.", "still-overdrawn warning on void")

        // Year to date.
        let sep26 = at("2026-09-26T07:00:00Z")
        expectEqual(FinBMath.ytdMonths(year: 2026, now: sep26), 9, "Jan–Sep of the current year")
        expectEqual(FinBMath.ytdMonths(year: 2025, now: sep26), 12, "a past year is whole")
        expectEqual(FinBMath.ytdMonths(year: 2027, now: sep26), 0, "a future year has not started")
        expectEqual(FinBMath.ytdMonths(year: 2027, now: at("2026-12-31T21:30:00Z")), 1, "EAT: 00:30 on 1 Jan 2027 is January of 2027")
        expectEqual(FinBMath.ytdMonths(year: 2026, now: at("2026-12-31T21:30:00Z")), 12, "…and 2026 is then a whole past year")
        expectEqual(FinBMath.sumPrefix([1, 2, 3, 4], 2), 3, "sumPrefix")
        expectEqual(FinBMath.sumPrefix([1, 2], 9), 3, "sumPrefix clamps")
        expectEqual(FinBMath.planningYears(now: sep26, extra: [2019]), [2027, 2026, 2025, 2024, 2023, 2022, 2019], "planning years")

        // Ages and EAT stamps.
        let now = at("2026-09-26T12:00:00Z")
        expectEqual(FinBTime.age(since: "2026-09-26T11:59:40Z", now: now), "just now", "age just now")
        expectEqual(FinBTime.age(since: "2026-09-26T11:59:00Z", now: now), "1 minute", "age 1 minute")
        expectEqual(FinBTime.age(since: "2026-09-26T09:00:00Z", now: now), "3 hours", "age hours")
        expectEqual(FinBTime.age(since: "2026-09-24T10:00:00Z", now: now), "2 days", "age days after 48 h")
        expectEqual(FinBTime.age(since: "2026-09-24 14:00:00.123+00", now: now), "46 hours", "age from Postgres text")
        expectEqual(FinBTime.day("2026-09-30T22:30:00Z"), "1 Oct 2026", "a late-night UTC stamp is the next EAT day")
        expectEqual(FinBTime.day("2026-09-30"), "30 Sep 2026", "a plain date stays its day")
        expectEqual(FinBTime.stamp("2026-09-26T07:05:00Z"), "26 Sep 2026, 10:05", "EAT stamp")
        expectEqual(FinBTime.days(from: "2026-09-26", to: "2026-10-01"), 5, "days between")
        expectEqual(FinBMath.percent(45, of: 100), 45, "percent")
        expectEqual(FinBMath.percent(150, of: 100), 150, "percent past 100")
        expectEqual(FinBMath.percent(5, of: 0), 0, "percent of nothing")

        // Report footing.
        if let ok = decode(FinReportMatrix.Currency.self, #"{"currency":"KES","rows":[{"key":"tithe","label":"Tithe","months":[100,0,0,0,0,0,0,0,0,0,0,50],"total_minor":150},{"key":"none","label":"none","months":["20",0,0,0,0,0,0,0,0,0,0,0],"total_minor":"20"}],"totals":{"months":[120,0,0,0,0,0,0,0,0,0,0,50],"total_minor":170}}"#) {
            expect(FinBFoot.matrixProblems(ok).isEmpty, "a matrix that foots has no problems (BIGINT as text too)")
        }
        if let bad = decode(FinReportMatrix.Currency.self, #"{"currency":"KES","rows":[{"key":"tithe","label":"Tithe","months":[100,0,0,0,0,0,0,0,0,0,0,50],"total_minor":151}],"totals":{"months":[100,0,0,0,0,0,0,0,0,0,0,50],"total_minor":150}}"#) {
            expectEqual(FinBFoot.matrixProblems(bad).count, 1, "a row whose months miss its total is flagged")
        }
        if let ie = decode(FinIncomeExpenditure.Currency.self, #"{"currency":"KES","income":[{"key":"tithe","label":"Tithe","amount_minor":1000}],"other_income":[{"key":"sales:media","label":"Media sales","amount_minor":200}],"expenses":[{"key":"rent","label":"Rent","amount_minor":1500}],"totals":{"gifts_minor":1000,"other_income_minor":200,"income_minor":1200,"expenses_minor":1500,"surplus_minor":-300}}"#) {
            expect(FinBFoot.incomeExpenditureProblems(ie).isEmpty, "an I&E that foots (a deficit) has no problems")
        }
        if let pos = decode(FinFinancialPosition.Currency.self, #"{"currency":"KES","assets":[{"account":"cash:mpesa","label":"M-Pesa","balance_minor":900}],"funds":[{"account":"fund:tithe","label":"Tithe","balance_minor":800,"code":"tithe"}],"other":[{"account":"sales:media","label":"Media sales","balance_minor":100}],"totals":{"assets_minor":900,"funds_minor":800,"other_minor":100},"balanced":true}"#) {
            expect(FinBFoot.positionProblems(pos).isEmpty, "a balanced position foots")
        }
        if let lie = decode(FinFinancialPosition.Currency.self, #"{"currency":"KES","assets":[{"account":"cash:mpesa","label":"M-Pesa","balance_minor":900}],"funds":[],"other":[],"totals":{"assets_minor":900,"funds_minor":0,"other_minor":0},"balanced":true}"#) {
            expect(!FinBFoot.positionProblems(lie).isEmpty, "a 'balanced' flag that does not add up is flagged")
        }

        // The faithfulness summary.
        func row(_ id: String, _ user: String, cur: String, shape: String, status: String, standing: String,
                 kept: Int, due: Int, overdue: String?, pledged: Int, paid: Int) -> String {
            #"{"pledge_id":"\#(id)","user_id":"\#(user)","member_name":"Jane","member_phone":null,"title":"P","shape":"\#(shape)","amount_minor":1000,"target_minor":null,"currency":"\#(cur)","status":"\#(status)","standing":"\#(standing)","year":2026,"pledged_year_minor":\#(pledged),"paid_year_minor":\#(paid),"remaining_year_minor":\#(max(pledged - paid, 0)),"paid_total_minor":\#(paid),"kept":\#(kept),"due_count":\#(due),"next_due":"2026-10-05","overdue_since":\#(overdue.map { "\"\($0)\"" } ?? "null"),"due_day":5,"due_on":null,"created_at":"2026-01-01T00:00:00Z","pays_to":{"code":"tithe","name":"Tithe"}}"#
        }
        let rowsJSON = "[" + [
            row("a", "u", cur: "KES", shape: "monthly", status: "active", standing: "behind", kept: 6, due: 8, overdue: "2026-08-05", pledged: 9000, paid: 6000),
            row("b", "u", cur: "KES", shape: "monthly", status: "active", standing: "on_track", kept: 3, due: 3, overdue: nil, pledged: 3000, paid: 3000),
            row("c", "u", cur: "USD", shape: "total", status: "active", standing: "on_track", kept: 0, due: 0, overdue: nil, pledged: 500, paid: 100),
            row("d", "u", cur: "KES", shape: "monthly", status: "cancelled", standing: "paused", kept: 1, due: 4, overdue: "2026-02-05", pledged: 0, paid: 1000),
        ].joined(separator: ",") + "]"
        if let rows = decode([FinPledgeRow].self, rowsJSON) {
            let s = FinBMath.faithfulness(rows)
            expectEqual(s.standing, "behind", "behind when any live pledge is")
            expectEqual(s.kept, 9, "kept sums the live monthly pledges")
            expectEqual(s.due, 11, "due sums the live monthly pledges")
            expectEqual(s.overdueSince, "2026-08-05", "a cancelled pledge's overdue date is ignored")
            expectEqual(s.totals.map(\.currency), ["KES", "USD"], "faithfulness totals per currency, KES first")
            expectEqual(s.totals.first?.paidMinor, 10_000, "paid counts every row of the currency")
        }

        // Words: need deadlines and campaign timing.
        if let need = decode(FinNeedRow.self, #"{"need_id":"n","title":"Chairs","why":"","department_id":"d","department_name":"Ushers","fund_code":null,"target_minor":1000,"raised_minor":400,"gifts_count":2,"currency":"KES","deadline":"2026-09-20","status":"approved","created_at":"2026-09-01T00:00:00Z","decided_at":null}"#) {
            let note = FinanceNeedsView.deadlineNote(need, today: "2026-09-26")
            expectEqual(note?.text, "passed 6 days ago", "a passed deadline")
            expectEqual(note?.late, true, "passed short of target is late")
            expectEqual(FinanceNeedsView.deadlineNote(need, today: "2026-09-19")?.text, "1 day left", "one day left")
        }
        if let camp = decode(FinCampaign.self, #"{"campaign_id":"c","title":"Roof","blurb":"A new roof for the hall","image_url":null,"goal_minor":1000,"currency":"KES","starts_on":"2026-09-01","ends_on":"2026-09-30","status":"live","match_minor":null,"match_pledger":null,"fund":"building","created_at":null,"raised_minor":"400","people_asked":"12","gave":"3","declined":"1"}"#) {
            expectEqual(FinanceCampaignsModel.timing(camp, today: "2026-09-26"), "4 days left", "campaign days left")
            expectEqual(FinanceCampaignsModel.timing(camp, today: "2026-09-30"), "ends today", "campaign ends today")
            expectEqual(camp.peopleAsked, 12, "campaign counts arrive as text")
        }
        return (checks, failures)
    }
}
#endif

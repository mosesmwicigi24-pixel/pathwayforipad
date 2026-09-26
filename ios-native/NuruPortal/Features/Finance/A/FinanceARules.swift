// Finance A pages (Overview · Transactions · Funds · Ledger · Reconciliation ·
// Audit · Settings) — the pure rules and words, no UI and no network, so each
// form says exactly what the server will accept (pathway docs/FINANCE_ERP.md
// §2, §4; the books contract's field bounds) and every page words the same
// thing the same way. Each helper has a DEBUG self-check case
// (FinanceASelfCheck, bottom of this file — FinanceSelfCheck runs it at launch).
import Foundation

// MARK: - Instants (ISO timestamps → EAT)

/// Server timestamps are ISO-8601 instants ("2026-09-26T09:00:00.000Z"). A
/// Finance page shows them as East Africa Time days and times — never the UTC
/// date prefix (22:30Z on the 25th is the 26th in Nairobi).
enum FinanceATime {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private static func formatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = FinanceDates.calendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = FinanceDates.timeZone
        f.dateFormat = pattern
        return f
    }
    private static let timeFormatter = formatter("HH:mm")
    private static let dayTimeFormatter = formatter("d MMM yyyy, HH:mm")

    /// The instant, or nil for anything that is not an ISO timestamp.
    static func instant(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        return fractional.date(from: iso) ?? plain.date(from: iso)
    }
    /// The EAT calendar day of an instant, "YYYY-MM-DD" (a bare date passes through).
    static func ymd(_ iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        if iso.count == 10, FinanceDates.date(fromYMD: iso) != nil { return iso }
        return instant(iso).map(FinanceDates.ymd)
    }
    /// "26 Sep 2026" in EAT, or "—".
    static func day(_ iso: String?) -> String { FinanceDates.display(ymd(iso)) }
    /// "10:42" in EAT, or "".
    static func time(_ iso: String?) -> String { instant(iso).map(timeFormatter.string) ?? "" }
    /// "26 Sep 2026, 10:42" in EAT, or "—".
    static func dayTime(_ iso: String?) -> String { instant(iso).map(dayTimeFormatter.string) ?? "—" }
}

// MARK: - Rules

enum FinanceARules {

    // MARK: Record a gift — channel, reference, giver, note, dates

    /// The Record-a-gift channel picker's words (spec §5; web parity).
    static func giftChannelLabel(_ c: FinOfficeChannel) -> String {
        switch c {
        case .onhand: "Cash on hand"
        case .bank: "Bank"
        case .cheque: "Cheque"
        case .mpesa: "M-Pesa (paid by M-Pesa, recorded here)"
        case .other: "Other"
        }
    }

    /// The reference field's label for a channel.
    static func referenceLabel(_ c: FinOfficeChannel) -> String {
        switch c {
        case .mpesa: "M-Pesa code"
        case .cheque: "Cheque number"
        case .bank: "Bank reference"
        case .onhand, .other: "Reference (optional)"
        }
    }

    /// The reference field's placeholder.
    static func referencePrompt(_ c: FinOfficeChannel) -> String {
        switch c {
        case .mpesa: "e.g. QJK4ABC123"
        case .cheque: "e.g. 000451"
        case .bank: "Deposit slip or statement reference"
        case .onhand, .other: "Envelope number, note…"
        }
    }

    /// `^[A-Z0-9]{8,12}$` — what an M-Pesa code looks like once trimmed and upper-cased.
    static func isMpesaCode(_ s: String) -> Bool {
        (8...12).contains(s.count) && s.allSatisfy { $0.isASCII && ($0.isUppercase || $0.isNumber) }
    }

    /// What the server stores as office_reference: trimmed, M-Pesa codes
    /// upper-cased (the server does the same); nil when blank.
    static func normalizedReference(_ raw: String, channel: FinOfficeChannel) -> String? {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        return channel == .mpesa ? t.uppercased() : t
    }

    /// Why this reference can't be sent for this channel, or nil. Required for
    /// M-Pesa (8–12 letters/digits), cheque and bank; ≤ 80 characters always.
    static func referenceProblem(_ raw: String, channel: FinOfficeChannel) -> String? {
        let ref = normalizedReference(raw, channel: channel)
        switch channel {
        case .mpesa:
            guard let ref else { return "Enter the M-Pesa code from the payment message." }
            if !isMpesaCode(ref) { return "An M-Pesa code is 8–12 letters and digits, like QJK4ABC123." }
        case .cheque:
            if ref == nil { return "Enter the cheque number." }
        case .bank:
            if ref == nil { return "Enter the bank reference from the deposit slip or statement." }
        case .onhand, .other:
            break
        }
        if let ref, ref.utf16.count > 80 { return "Keep the reference to 80 characters." }
        return nil
    }

    /// A walk-in giver's name: 2–120 characters (trimmed).
    static func walkInNameProblem(_ raw: String) -> String? {
        let n = raw.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
        if n == 0 { return "Enter the giver's name." }
        if n < 2 { return "A name has at least 2 characters." }
        if n > 120 { return "Keep the name to 120 characters." }
        return nil
    }

    /// An optional phone: blank, or 7–32 characters (trimmed).
    static func phoneProblem(_ raw: String) -> String? {
        let n = raw.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
        if n == 0 { return nil }
        if n < 7 { return "A phone number has at least 7 characters." }
        if n > 32 { return "Keep the phone number to 32 characters." }
        return nil
    }

    /// The receipt note: ≤ 60 characters (it is printed on the receipt).
    static func noteProblem(_ raw: String) -> String? {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 60 ? "Keep the note to 60 characters — it is printed on the receipt." : nil
    }

    /// A free-text bound: `min`…`max` characters once trimmed (memo, reason).
    static func lengthProblem(_ raw: String, min: Int, max: Int, what: String) -> String? {
        let n = raw.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
        if n < min { return "\(what) needs at least \(min) characters." }
        if n > max { return "Keep \(what.lowercased()) to \(max) characters." }
        return nil
    }

    /// The EAT day `days` before `ymd` ("2026-09-26", 366 → "2025-09-25").
    static func day(_ ymd: String, minus days: Int) -> String? {
        guard let d = FinanceDates.date(fromYMD: ymd),
              let back = FinanceDates.calendar.date(byAdding: .day, value: -days, to: d) else { return nil }
        return FinanceDates.ymd(back)
    }

    /// The days a dated books write accepts: [today − `daysBack`, today] (EAT).
    /// Gifts, transfers and expenses: 366; opening balances: 3660.
    static func allowedDays(today: String, daysBack: Int) -> ClosedRange<String>? {
        guard let first = day(today, minus: daysBack) else { return nil }
        return first...today
    }

    /// "The received date must be between 25 Sep 2025 and today (East Africa Time)."
    static func dateRangeSentence(_ what: String, today: String, daysBack: Int) -> String {
        let first = day(today, minus: daysBack).map(FinanceDates.display) ?? "a year ago"
        return "\(what) must be between \(first) and today (East Africa Time)."
    }

    /// A payment that may still land: processing or requires_action, started
    /// within the last 48 hours (Record a gift warns before counting it twice).
    static func isRecentInFlight(status: String, createdAt: String, now: Date = Date()) -> Bool {
        guard status == "processing" || status == "requires_action",
              let at = FinanceATime.instant(createdAt) else { return false }
        let age = now.timeIntervalSince(at)
        return age >= -300 && age <= 48 * 3600
    }

    // MARK: Numbers

    /// "+12.4%", "-5.0%", "0%"; "new" when there was nothing before; "—" when
    /// both are zero. Exact integer math, rounded half away from zero.
    static func percentChange(current: Int, previous: Int) -> String {
        if previous == 0 { return current > 0 ? "new" : "—" }
        let num = (current - previous) * 1000
        let den = previous.magnitude
        var q = num / Int(den)
        let r = num % Int(den)
        if r.magnitude * 2 >= den { q += num >= 0 ? 1 : -1 }
        if q == 0 { return "0%" }
        let m = q.magnitude
        return (q > 0 ? "+" : "-") + "\(m / 10).\(m % 10)%"
    }

    /// "12 of 46" style share, or "—" when nothing is counted.
    static func share(_ part: Int, of whole: Int) -> String { whole > 0 ? "\(part) of \(whole)" : "—" }

    // MARK: Funds

    /// Why a fund / category code is refused (`^[a-z][a-z0-9-]{1,39}$`), or nil.
    static func slugProblem(_ code: String) -> String? {
        if code.isEmpty { return "Enter a code." }
        guard let first = code.first, first.isASCII, first.isLowercase else { return "Start the code with a lowercase letter (a–z)." }
        if !code.allSatisfy({ $0.isASCII && ($0.isLowercase || $0.isNumber || $0 == "-") }) {
            return "Use only lowercase letters, digits and hyphens."
        }
        if code.count < 2 || code.count > 40 { return "A code is 2–40 characters." }
        return nil
    }

    /// A code suggested from a name: "Building Fund 2026" → "building-fund-2026".
    static func suggestedSlug(from name: String) -> String {
        let folded = name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).lowercased()
        var out = ""
        var pendingHyphen = false
        for ch in folded {
            if ch.isASCII && (ch.isLowercase || ch.isNumber) {
                if pendingHyphen && !out.isEmpty { out.append("-") }
                pendingHyphen = false
                out.append(ch)
            } else {
                pendingHyphen = true
            }
        }
        while let f = out.first, !(f.isASCII && f.isLowercase) { out.removeFirst() }
        if out.count > 40 { out = String(out.prefix(40)) }
        while out.hasSuffix("-") { out.removeLast() }
        return out
    }

    /// The FUND_IN_USE sentence: "12 active pledges, 3 recurring gifts and 1
    /// department still send money to Building fund — their payments will fail
    /// while it is inactive."
    static func fundInUseSentence(fund: String, pledges: Int, schedules: Int, departments: Int, campaigns: Int) -> String {
        func n(_ count: Int, _ one: String, _ many: String) -> String? { count > 0 ? "\(count) \(count == 1 ? one : many)" : nil }
        let parts = [n(pledges, "active pledge", "active pledges"), n(schedules, "recurring gift", "recurring gifts"),
                     n(departments, "department", "departments"), n(campaigns, "live campaign", "live campaigns")].compactMap { $0 }
        guard !parts.isEmpty else {
            return "Money still routes to \(fund) — payments to it will fail while it is inactive."
        }
        let list = parts.count == 1 ? parts[0] : parts.dropLast().joined(separator: ", ") + " and " + (parts.last ?? "")
        let single = parts.count == 1 && [pledges, schedules, departments, campaigns].filter { $0 > 0 } == [1]
        return "\(list) still \(single ? "sends" : "send") money to \(fund) — their payments will fail while it is inactive."
    }

    // MARK: Reversal wording

    /// The Reverse sheet's consequence line (spec §5): "Posts KES 1,500.00 back
    /// out of Tithe; the gift leaves Mary Wanjiku's statement and re-opens
    /// their instalment."
    static func reversalConsequence(amountMinor: Int, currency: String, fundName: String?, memberName: String?, pledged: Bool) -> String {
        var s = "Posts \(FinanceMoney.format(amountMinor, currency)) back out of \(fundName.flatMap { $0.isEmpty ? nil : $0 } ?? "its fund")"
        if let m = memberName, !m.isEmpty {
            s += "; the gift leaves \(m)'s statement"
            if pledged { s += " and re-opens their instalment" }
        } else if pledged {
            s += "; the pledge's instalment re-opens"
        }
        return s + "."
    }

    // MARK: Ledger words

    /// "cash:mpesa" → "M-Pesa" (the settlement channel is the account without
    /// its cash: prefix; stripe = card; manual = office "other" + claims).
    static func cashChannelLabel(_ channel: String) -> String {
        switch channel {
        case "onhand": "Cash on hand"
        case "bank": "Bank"
        case "cheque": "Cheque"
        case "mpesa": "M-Pesa"
        case "airtel": "Airtel"
        case "stripe", "card": "Card"
        case "paypal": "PayPal"
        case "manual": "Other & claims"
        case "": "—"
        default: channel.capitalized
        }
    }

    /// A ledger account in words: "cash:onhand" → "Cash on hand", "fund:tithe"
    /// → the fund's name when known, "sales:media" → "Media sales".
    static func accountLabel(_ account: String, fundNames: [String: String] = [:]) -> String {
        let parts = account.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return account }
        switch parts[0] {
        case "cash": return cashChannelLabel(parts[1])
        case "fund": return fundNames[parts[1]] ?? parts[1]
        case "sales": return parts[1] == "media" ? "Media sales" : "Sales · \(parts[1])"
        default: return account
        }
    }

    // MARK: Overview alerts

    /// An alert's words: "3 claims waiting", "1 expense to approve".
    static func alertTitle(kind: String, count: Int) -> String {
        func p(_ one: String, _ many: String) -> String { "\(count) \(count == 1 ? one : many)" }
        switch kind {
        case "pending_claims": return p("claim waiting", "claims waiting")
        case "expenses_awaiting_approval": return p("expense to approve", "expenses to approve")
        case "failing_schedules": return p("recurring gift needs attention", "recurring gifts need attention")
        case "stale_processing": return p("payment stuck processing", "payments stuck processing")
        case "integrity_issues": return p("integrity issue", "integrity issues")
        case "partners_behind": return p("partner behind", "partners behind")
        default: return "\(count) × " + kind.replacingOccurrences(of: "_", with: " ")
        }
    }

    /// What an alert means, in one line.
    static func alertHint(kind: String) -> String {
        switch kind {
        case "pending_claims": "Members say they paid another way — confirm or reject."
        case "expenses_awaiting_approval": "Recorded, not yet posted — a second person approves."
        case "failing_schedules": "Paused, or the last charge failed."
        case "stale_processing": "Started but never confirmed by the provider."
        case "integrity_issues": "Postings that do not balance or are missing."
        case "partners_behind": "A pledge instalment is overdue."
        default: ""
        }
    }

    static func alertIcon(kind: String) -> String {
        switch kind {
        case "pending_claims": "list.clipboard"
        case "expenses_awaiting_approval": "banknote"
        case "failing_schedules": "repeat.circle"
        case "stale_processing": "hourglass"
        case "integrity_issues": "exclamationmark.triangle"
        case "partners_behind": "person.crop.circle.badge.exclamationmark"
        default: "bell"
        }
    }

    // MARK: Reconciliation exceptions

    /// The Reconciliation exception kinds in the order the page lists them
    /// (the books-breaking ones first).
    static let exceptionKinds = ["succeeded_without_ledger", "unbalanced_transaction", "unbalanced_journal",
                                 "refunded_without_reversal", "duplicate_receipt", "stale_processing", "failed"]

    static func exceptionTitle(_ kind: String) -> String {
        switch kind {
        case "stale_processing": "Stuck processing"
        case "failed": "Failed payments"
        case "succeeded_without_ledger": "Succeeded, not in the books"
        case "unbalanced_transaction": "Unbalanced transaction"
        case "refunded_without_reversal": "Refunded, never reversed"
        case "duplicate_receipt": "Duplicate receipt"
        case "unbalanced_journal": "Unbalanced journal"
        default: kind.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    /// What the kind means, in one line.
    static func exceptionExplanation(_ kind: String) -> String {
        switch kind {
        case "stale_processing": "Started but never confirmed — M-Pesa or Airtel for more than 30 minutes, card or PayPal for more than 24 hours."
        case "failed": "Payments that failed in this period. No money moved and nothing was posted."
        case "succeeded_without_ledger": "Marked succeeded but with no ledger postings — the books are missing this money."
        case "unbalanced_transaction": "Its postings' debits and credits are not equal."
        case "refunded_without_reversal": "Marked refunded, but no reversing entry took the money back out of the books."
        case "duplicate_receipt": "One receipt code on more than one payment — usually the office recorded an M-Pesa payment that also settled online."
        case "unbalanced_journal": "A journal whose debits and credits differ, or that has no postings."
        default: "An exception the books flagged."
        }
    }

    /// What the treasurer does about it, in one line.
    static func exceptionAction(_ kind: String) -> String {
        switch kind {
        case "stale_processing": "Look the payment up on the provider's statement. If the money arrived, report it so the confirmation can be replayed; if not, nothing is owed."
        case "failed": "Nothing to correct. If the giver says they paid, check the provider's statement."
        case "succeeded_without_ledger": "Report it — its postings have to be written before the books foot."
        case "unbalanced_transaction": "Report it. It cannot be reversed here until its postings are one balanced pair."
        case "refunded_without_reversal": "Report it so the reversing entry can be posted."
        case "duplicate_receipt": "Open the office entry and reverse it (Transactions → Reverse). The online payment stays."
        case "unbalanced_journal": "Report it — a journal must post equal debits and credits."
        default: "Open it and check."
        }
    }

    // MARK: Audit words

    /// "finance.gift_recorded" → "Gift recorded". Unknown actions read their
    /// verb part in plain words ("webhook.stripe_received" → "Stripe received").
    static func humanAction(_ action: String) -> String {
        let known: [String: String] = [
            "finance.gift_recorded": "Gift recorded",
            "finance.gift_reversed": "Gift reversed",
            "finance.category_created": "Expense category added",
            "finance.category_updated": "Expense category changed",
            "fund.created": "Fund created",
            "fund.updated": "Fund updated",
            "journal.transfer_posted": "Transfer posted",
            "journal.opening_posted": "Opening balance posted",
            "journal.reversed": "Journal reversed",
            "expense.recorded": "Expense recorded",
            "expense.updated": "Expense edited",
            "expense.approved": "Expense approved",
            "expense.voided": "Expense voided",
            "budget.created": "Budget started",
            "budget.updated": "Budget renamed",
            "budget.lines_replaced": "Budget lines saved",
            "budget.approved": "Budget approved",
            "giving.intent_created": "Gift started in the app",
            "giving.website_intent_created": "Gift started on the website",
            "giving.schedule_created": "Recurring gift set up",
            "giving.schedule_cancelled": "Recurring gift cancelled",
            "giving.schedule_resumed": "Recurring gift resumed",
            "purchase.intent_created": "Purchase started",
            "pledge.created": "Pledge made",
            "pledge.updated": "Pledge changed",
            "pledge.fulfilled": "Pledge fulfilled",
            "pledge.reminded": "Pledge reminder sent",
            "pledge.claim_created": "Payment claim submitted",
            "pledge.claim_confirmed": "Payment claim confirmed",
            "pledge.claim_rejected": "Payment claim rejected",
            "department.need_submitted": "Department need submitted",
            "department.need_approved": "Department need approved",
            "department.need_rejected": "Department need rejected",
            "department.need_closed": "Department need closed",
        ]
        if let k = known[action] { return k }
        let verb = action.split(separator: ".", maxSplits: 1).dropFirst().first.map(String.init) ?? action
        let words = verb.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " ")
        guard let f = words.first else { return action }
        return f.uppercased() + words.dropFirst()
    }

    /// The audit filter's action prefixes (the finance slice, spec §4).
    static let auditPrefixes: [(value: String, label: String)] = [
        ("", "All finance"), ("giving.", "Giving"), ("finance.", "Office gifts & categories"),
        ("pledge.", "Pledges & claims"), ("department.need", "Department needs"), ("expense.", "Expenses"),
        ("budget.", "Budgets"), ("journal.", "Journals"), ("fund.", "Funds"),
        ("webhook.", "Webhooks"), ("purchase.", "Purchases"),
    ]

    /// The key details of an audit row's metadata, one line: amount, receipt,
    /// fund (or from → to), channel + reference, payee, reason… in that order.
    static func auditDetails(_ metadata: [String: FinJSON]?) -> String {
        guard let m = metadata, !m.isEmpty else { return "" }
        func str(_ key: String) -> String? {
            guard let v = m[key] else { return nil }
            switch v {
            case .null: return nil
            case .string(let s): return s.isEmpty ? nil : s
            default: return v.text
            }
        }
        func int(_ key: String) -> Int? {
            switch m[key] {
            case .number(let n)?: return n.isFinite ? Int(n.rounded()) : nil
            case .string(let s)?: return Int(s)
            default: return nil
            }
        }
        var parts: [String] = []
        if let amount = int("amount_minor") { parts.append(FinanceMoney.format(amount, str("currency") ?? "")) }
        if let r = str("receipt_code") { parts.append(r) }
        if let from = str("from"), let to = str("to") { parts.append("\(from) → \(to)") }
        else if let fund = str("fund") { parts.append(fund) }
        if let ch = str("channel") {
            parts.append([FinWords.channel(ch), str("reference")].compactMap { $0 }.joined(separator: " "))
        }
        if let payee = str("payee") { parts.append(payee) }
        if let code = str("code"), str("fund") == nil { parts.append(code) }
        if let name = str("name"), str("payee") == nil { parts.append(name) }
        if let kind = str("kind") { parts.append(FinWords.journalKind(kind)) }
        if let was = str("was") { parts.append("was \(was)") }
        if let reason = str("reason") {
            parts.append("“" + (reason.count > 60 ? String(reason.prefix(59)) + "…" : reason) + "”")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: Who can do what (spec §6)

    static let capabilityHelp: [(key: String, label: String, detail: String)] = [
        ("view", "finance:view", "Open every Finance page and read its figures."),
        ("export", "finance:export", "Download the CSV exports."),
        ("manage", "finance:manage", "Record and reverse office gifts; create and edit funds and expense categories; record and void expenses; draft budgets; campaigns, claims and reminders."),
        ("approve", "finance:approve", "Approve expenses and budgets; post fund transfers and opening balances; reverse journals."),
    ]
}

// MARK: - DEBUG self-check

#if DEBUG
/// The A pages' pure helpers, asserted at launch in Debug builds through
/// FinanceSelfCheck.run() (FinanceKit.swift) — fixed dates only, so nothing
/// depends on the device's zone or today's date.
enum FinanceASelfCheck {
    static func run() -> (checks: Int, failures: [String]) {
        var checks = 0
        var failures: [String] = []
        func expect(_ ok: Bool, _ what: @autoclosure () -> String) {
            checks += 1
            if !ok { failures.append("A: " + what()) }
        }
        func expectEqual<T: Equatable>(_ got: T, _ want: T, _ what: String) {
            expect(got == want, "\(what): got \(got), want \(want)")
        }

        // Instants → EAT.
        expectEqual(FinanceATime.day("2026-09-25T22:30:00Z"), "26 Sep 2026", "22:30Z is the next day in EAT")
        expectEqual(FinanceATime.day("2026-09-26T09:00:00.000Z"), "26 Sep 2026", "fractional-second ISO")
        expectEqual(FinanceATime.time("2026-09-26T09:05:00Z"), "12:05", "EAT time")
        expectEqual(FinanceATime.dayTime("2026-09-26T09:05:00Z"), "26 Sep 2026, 12:05", "EAT day + time")
        expectEqual(FinanceATime.ymd("2026-09-26"), "2026-09-26", "a bare date passes through")
        expectEqual(FinanceATime.day("not a date"), "—", "garbage reads —")

        // Record a gift — channel words, references, giver fields.
        expectEqual(FinanceARules.giftChannelLabel(.mpesa), "M-Pesa (paid by M-Pesa, recorded here)", "M-Pesa channel label")
        expectEqual(FinanceARules.giftChannelLabel(.onhand), "Cash on hand", "cash channel label")
        expectEqual(FinanceARules.referenceLabel(.cheque), "Cheque number", "cheque reference label")
        expectEqual(FinanceARules.normalizedReference("  qjk4abc123 ", channel: .mpesa), "QJK4ABC123", "M-Pesa code upper-cased")
        expectEqual(FinanceARules.normalizedReference(" 000451 ", channel: .cheque), "000451", "cheque trimmed, case kept")
        expectEqual(FinanceARules.normalizedReference("   ", channel: .onhand), nil, "blank reference is absent")
        expect(FinanceARules.referenceProblem("qjk4abc123", channel: .mpesa) == nil, "lower-case M-Pesa code is accepted")
        expect(FinanceARules.referenceProblem("QJK4", channel: .mpesa) != nil, "short M-Pesa code refused")
        expect(FinanceARules.referenceProblem("QJK4-ABC123", channel: .mpesa) != nil, "M-Pesa code with a hyphen refused")
        expect(FinanceARules.referenceProblem("QJK4ABC123XYZ", channel: .mpesa) != nil, "13-character M-Pesa code refused")
        expect(FinanceARules.referenceProblem("", channel: .mpesa) != nil, "M-Pesa needs a code")
        expect(FinanceARules.referenceProblem("", channel: .bank) != nil, "bank needs a reference")
        expect(FinanceARules.referenceProblem("", channel: .cheque) != nil, "cheque needs a number")
        expect(FinanceARules.referenceProblem("", channel: .onhand) == nil, "cash needs no reference")
        expect(FinanceARules.referenceProblem(String(repeating: "x", count: 81), channel: .other) != nil, "81-character reference refused")
        expect(FinanceARules.walkInNameProblem(" A ") != nil, "one-letter walk-in name refused")
        expect(FinanceARules.walkInNameProblem("Jo") == nil, "two-letter walk-in name accepted")
        expect(FinanceARules.walkInNameProblem(String(repeating: "n", count: 121)) != nil, "121-character name refused")
        expect(FinanceARules.phoneProblem("") == nil, "phone is optional")
        expect(FinanceARules.phoneProblem("07123") != nil, "5-digit phone refused")
        expect(FinanceARules.phoneProblem("+254712345678") == nil, "E.164 phone accepted")
        expect(FinanceARules.noteProblem(String(repeating: "n", count: 60)) == nil, "60-character note accepted")
        expect(FinanceARules.noteProblem(String(repeating: "n", count: 61)) != nil, "61-character note refused")
        expect(FinanceARules.lengthProblem("ab", min: 3, max: 300, what: "The memo") != nil, "memo under 3 refused")
        expect(FinanceARules.lengthProblem("abc", min: 3, max: 300, what: "The memo") == nil, "3-character memo accepted")

        // Dates — the books' window.
        expectEqual(FinanceARules.day("2026-09-26", minus: 366), "2025-09-25", "today − 366")
        expectEqual(FinanceARules.day("2028-03-01", minus: 366), "2027-03-01", "today − 366 across a leap day")
        expectEqual(FinanceARules.day("2026-09-26", minus: 3660), "2016-09-18", "today − 3660 (opening balances)")
        if let r = FinanceARules.allowedDays(today: "2026-09-26", daysBack: 366) {
            expect(r.contains("2025-09-25") && r.contains("2026-09-26") && !r.contains("2025-09-24") && !r.contains("2026-09-27"),
                   "allowed days are inclusive at both ends")
        } else { expect(false, "allowedDays returned nil") }
        let at = ISO8601DateFormatter().date(from: "2026-09-26T09:00:00Z") ?? Date(timeIntervalSince1970: 0)
        expect(FinanceARules.isRecentInFlight(status: "processing", createdAt: "2026-09-25T10:00:00Z", now: at), "processing 23 h ago is in flight")
        expect(FinanceARules.isRecentInFlight(status: "requires_action", createdAt: "2026-09-24T09:30:00Z", now: at), "requires_action 47.5 h ago is in flight")
        expect(!FinanceARules.isRecentInFlight(status: "processing", createdAt: "2026-09-24T08:00:00Z", now: at), "49 h ago is not recent")
        expect(!FinanceARules.isRecentInFlight(status: "succeeded", createdAt: "2026-09-26T08:00:00Z", now: at), "succeeded is not in flight")

        // Numbers.
        expectEqual(FinanceARules.percentChange(current: 1124, previous: 1000), "+12.4%", "+12.4%")
        expectEqual(FinanceARules.percentChange(current: 950, previous: 1000), "-5.0%", "-5.0%")
        expectEqual(FinanceARules.percentChange(current: 1000, previous: 1000), "0%", "no change")
        expectEqual(FinanceARules.percentChange(current: 500, previous: 0), "new", "nothing last year")
        expectEqual(FinanceARules.percentChange(current: 0, previous: 0), "—", "nothing either year")
        expectEqual(FinanceARules.percentChange(current: 0, previous: 1000), "-100.0%", "fell to zero")
        expectEqual(FinanceARules.percentChange(current: 1, previous: 3), "-66.7%", "rounds half away from zero")
        expectEqual(FinanceARules.percentChange(current: 10_005, previous: 10_000), "+0.1%", "0.05% rounds up")
        expectEqual(FinanceARules.percentChange(current: 250_000_000_000, previous: 100_000_000_000), "+150.0%", "large amounts, no overflow")
        expectEqual(FinanceARules.share(12, of: 46), "12 of 46", "share")

        // Funds — codes and the FUND_IN_USE sentence.
        expect(FinanceARules.slugProblem("building-fund") == nil, "valid slug")
        expect(FinanceARules.slugProblem("Building") != nil, "upper-case slug refused")
        expect(FinanceARules.slugProblem("2026-harvest") != nil, "slug starting with a digit refused")
        expect(FinanceARules.slugProblem("b") != nil, "1-character slug refused")
        expect(FinanceARules.slugProblem(String(repeating: "a", count: 41)) != nil, "41-character slug refused")
        expect(FinanceARules.slugProblem("tithe_2026") != nil, "underscore refused")
        expectEqual(FinanceARules.suggestedSlug(from: "Building Fund 2026"), "building-fund-2026", "slug from name")
        expectEqual(FinanceARules.suggestedSlug(from: "  Missions & Outreach "), "missions-outreach", "slug collapses symbols")
        expectEqual(FinanceARules.suggestedSlug(from: "Église Fund"), "eglise-fund", "slug folds accents")
        expectEqual(FinanceARules.suggestedSlug(from: "2026 Harvest"), "harvest", "slug drops a leading number")
        expectEqual(FinanceARules.fundInUseSentence(fund: "Building fund", pledges: 12, schedules: 3, departments: 1, campaigns: 0),
                    "12 active pledges, 3 recurring gifts and 1 department still send money to Building fund — their payments will fail while it is inactive.",
                    "fund in use — three kinds")
        expectEqual(FinanceARules.fundInUseSentence(fund: "Tithe", pledges: 1, schedules: 0, departments: 0, campaigns: 0),
                    "1 active pledge still sends money to Tithe — their payments will fail while it is inactive.", "fund in use — one")
        expectEqual(FinanceARules.fundInUseSentence(fund: "Tithe", pledges: 0, schedules: 2, departments: 0, campaigns: 1),
                    "2 recurring gifts and 1 live campaign still send money to Tithe — their payments will fail while it is inactive.",
                    "fund in use — two kinds")

        // Reversal consequence.
        expectEqual(FinanceARules.reversalConsequence(amountMinor: 150_000, currency: "KES", fundName: "Tithe", memberName: "Mary Wanjiku", pledged: true),
                    "Posts KES 1,500.00 back out of Tithe; the gift leaves Mary Wanjiku's statement and re-opens their instalment.",
                    "reversal consequence — member + pledge")
        expectEqual(FinanceARules.reversalConsequence(amountMinor: 5_000, currency: "USD", fundName: "Missions", memberName: nil, pledged: false),
                    "Posts USD 50.00 back out of Missions.", "reversal consequence — walk-in")

        // Ledger + alert + exception words.
        expectEqual(FinanceARules.accountLabel("cash:onhand"), "Cash on hand", "cash:onhand")
        expectEqual(FinanceARules.accountLabel("fund:tithe", fundNames: ["tithe": "Tithe"]), "Tithe", "fund account → name")
        expectEqual(FinanceARules.accountLabel("sales:media"), "Media sales", "sales:media")
        expectEqual(FinanceARules.cashChannelLabel("stripe"), "Card", "stripe settles as card")
        expectEqual(FinanceARules.alertTitle(kind: "expenses_awaiting_approval", count: 1), "1 expense to approve", "alert singular")
        expectEqual(FinanceARules.alertTitle(kind: "pending_claims", count: 3), "3 claims waiting", "alert plural")
        expectEqual(Set(FinanceARules.exceptionKinds).count, 7, "seven exception kinds, no repeats")
        for k in FinanceARules.exceptionKinds {
            expect(FinanceARules.exceptionTitle(k) != k && !FinanceARules.exceptionAction(k).isEmpty, "exception \(k) has words")
        }

        // Audit words.
        expectEqual(FinanceARules.humanAction("finance.gift_recorded"), "Gift recorded", "known action")
        expectEqual(FinanceARules.humanAction("webhook.stripe_received"), "Stripe received", "unknown action reads its verb")
        expectEqual(FinanceARules.humanAction("department.need_approved"), "Department need approved", "department need action")
        let meta: [String: FinJSON] = ["amount_minor": .number(150_050), "currency": .string("KES"), "receipt_code": .string("OR-2026-00012"),
                                       "fund": .string("tithe"), "channel": .string("mpesa"), "reference": .string("QJK4ABC123")]
        expectEqual(FinanceARules.auditDetails(meta), "KES 1,500.50 · OR-2026-00012 · tithe · M-Pesa QJK4ABC123", "audit details — gift")
        expectEqual(FinanceARules.auditDetails(["from": .string("building"), "to": .string("missions"), "amount_minor": .string("100000"), "currency": .string("KES")]),
                    "KES 1,000.00 · building → missions", "audit details — transfer, BIGINT as text")
        expectEqual(FinanceARules.auditDetails(nil), "", "no metadata")

        // The fund patch override encodes `force` only when set.
        let enc = JSONEncoder()
        enc.keyEncodingStrategy = .convertToSnakeCase
        enc.outputFormatting = .sortedKeys
        func json<T: Encodable>(_ v: T) -> String { (try? enc.encode(v)).flatMap { String(data: $0, encoding: .utf8) } ?? "?" }
        expectEqual(json(FinFundPatchForced(patch: FinFundPatch(isActive: false), force: true)), #"{"force":true,"is_active":false}"#, "forced deactivate body")
        expectEqual(json(FinFundPatchForced(patch: FinFundPatch(isActive: false), force: false)), #"{"is_active":false}"#, "plain deactivate body")

        // The givers envelope decodes (BIGINT text, null pays_to).
        let dec = JSONDecoder()
        dec.keyDecodingStrategy = .convertFromSnakeCase
        let giverJSON = #"{"user_id":"u1","full_name":"Mary Wanjiku","phone":"+254712000001","email":null,"congregation_name":"Nuru Central","open_pledges":[{"pledge_id":"p1","title":"Building","currency":"KES","shape":"monthly","amount_minor":"500000","target_minor":null,"pays_to":{"code":"building","name":"Building fund"}},{"pledge_id":"p2","title":"Missions","currency":"USD","shape":"total","amount_minor":null,"target_minor":120000,"pays_to":null}]}"#
        if let g = try? dec.decode(FinGiver.self, from: Data(giverJSON.utf8)) {
            expect(g.openPledges.count == 2 && g.openPledges[0].amountMinor == 500_000 && g.openPledges[1].paysTo == nil,
                   "giver with open pledges decodes")
        } else { expect(false, "decode FinGiver") }

        // Large amounts (opening balances go to 1,000,000,000,000 minor).
        expectEqual(FinanceARules.parseMajor("12,000,000.50", maxMinor: 1_000_000_000_000), .success(1_200_000_050), "opening balance above the gift cap")
        expectEqual(FinanceARules.parseMajor("10000000000.01", maxMinor: 1_000_000_000_000), .failure(.tooLarge), "above the opening-balance cap")
        expectEqual(FinanceARules.parseMajor("1,500", maxMinor: 1_000_000_000_000), .success(150_000), "ordinary amount, big ceiling")
        expectEqual(FinanceARules.parseMajor("abc", maxMinor: 1_000_000_000_000), .failure(.invalid), "grammar still checked")
        expectEqual(FinanceARules.parseMajor("12,000,000", maxMinor: FinanceMoney.maxMinor), .failure(.tooLarge), "the gift cap stands")
        expectEqual(FinanceARules.parseMajor("5", maxMinor: 100), .failure(.tooLarge), "a lower ceiling is honoured")

        // Legs foot per currency, never across.
        struct Leg: FinLeg, Identifiable {
            let entryId: String, account: String, side: String, amountMinor: Int, currency: String, createdAt: String
            var id: String { entryId }
        }
        let legs = [Leg(entryId: "1", account: "cash:onhand", side: "debit", amountMinor: 1_000, currency: "KES", createdAt: ""),
                    Leg(entryId: "2", account: "fund:tithe", side: "credit", amountMinor: 1_000, currency: "KES", createdAt: ""),
                    Leg(entryId: "3", account: "cash:stripe", side: "debit", amountMinor: 500, currency: "USD", createdAt: "")]
        let foot = FinALegCheck.of(legs)
        expect(foot.count == 2 && foot[0].currency == "KES" && foot[0].balanced && !foot[1].balanced && foot[1].debit == 500,
               "legs foot per currency (KES balanced, USD not)")

        // Journal reversal words (the reason sheet's consequence).
        let journalJSON = #"{"journal_id":"j1","kind":"transfer","memo":"Seed","occurred_on":"2026-09-20","created_at":"2026-09-21T06:00:00Z","created_by":null,"created_by_name":null,"ref_id":null,"reversal_of":null,"reversed_by_journal_id":null,"legs":[{"entry_id":"e1","account":"fund:general","side":"debit","amount_minor":"1000000","currency":"KES","created_at":"2026-09-20T09:00:00Z"},{"entry_id":"e2","account":"fund:building","side":"credit","amount_minor":1000000,"currency":"KES","created_at":"2026-09-20T09:00:00Z"}],"totals":[{"currency":"KES","amount_minor":1000000}]}"#
        if let j = try? dec.decode(FinJournal.self, from: Data(journalJSON.utf8)) {
            expectEqual(FinanceARules.journalReversalConsequence(j, fundNames: ["general": "General", "building": "Building fund"]),
                        "Posts the mirror of this transfer, dated 20 Sep 2026: KES 10,000.00 goes back from Building fund to General. The transfer stays on the record, marked reversed; a journal is reversed once.",
                        "transfer reversal consequence")
            expect(j.looksReversible, "an unreversed transfer looks reversible")
        } else { expect(false, "decode FinJournal") }

        // Chart month labels.
        expectEqual(FinAIncomeExpenseChart.label("2026-09"), "Sep", "month label")
        expectEqual(FinAIncomeExpenseChart.label("2027-01"), "Jan ’27", "January carries its year")
        expectEqual(FinAIncomeExpenseChart.label("bad"), "bad", "unparseable month passes through")

        // Roles matrix (System → Roles): rendered from the catalog; a save keeps
        // every grant the matrix did not render.
        let mods = ["finance", "members"].map(RolePerm.module)
        let six = ["view", "create", "edit", "delete", "approve", "export"].map(RolePerm.capability)
        let original = [LocalPerm(moduleId: "finance", capability: "manage"), LocalPerm(moduleId: "live", capability: "go"),
                        LocalPerm(moduleId: "finance", capability: "view"), LocalPerm(moduleId: "members", capability: "edit")]
        let kept = RolePerm.grantsToSave(working: ["finance|view", "members|view"], modules: mods, capabilities: six, original: original)
            .map { "\($0.moduleId):\($0.capability)" }
        expectEqual(Set(kept), ["finance:view", "members:view", "finance:manage", "live:go"], "roles save keeps unrendered grants, drops unchecked ones")
        expectEqual(kept.count, 4, "roles save sends no duplicates")
        let all = RolePerm.grantsToSave(working: ["finance|manage"], modules: mods, capabilities: six + [RolePerm.capability("manage")], original: original)
            .map { "\($0.moduleId):\($0.capability)" }
        expectEqual(Set(all), ["finance:manage", "live:go"], "a rendered capability follows the checkboxes")
        expectEqual(RolePerm.module("brandNew").label, "brandNew", "unknown module: label = id")
        expectEqual(RolePerm.module("brandNew").group, "Other", "unknown module: group Other")
        expectEqual(RolePerm.module("finance").label, "Finance", "known module keeps its label")
        expectEqual(RolePerm.capability("manage").label, "Manage", "manage capability label")
        expectEqual(RolePerm.capability("zap").label, "zap", "unknown capability: label = key")
        expectEqual(RolePerm.groups(of: ["users", "zzz", "finance"].map(RolePerm.module)), ["Operations", "System", "Other"], "group order, Other last")

        return (checks, failures)
    }
}
#endif

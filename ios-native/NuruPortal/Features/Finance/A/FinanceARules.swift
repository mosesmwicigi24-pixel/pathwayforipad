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
//
// Every sentence here matches the web's Finance A helpers
// (admin-web src/components/finance/a/helpers.ts) — web and iPad say the same
// thing the same way.

enum FinanceARules {

    /// "1 gift" / "3 gifts".
    static func plural(_ n: Int, _ one: String, _ many: String? = nil) -> String {
        "\(n) \(n == 1 ? one : (many ?? one + "s"))"
    }

    // MARK: Record a gift — channels, references, giver, note, dates

    /// How the office received a gift (onhand = physical cash; mpesa = a
    /// payment made to the till/paybill and recorded here by hand).
    static func giftChannelLabel(_ c: FinOfficeChannel) -> String {
        switch c {
        case .onhand: "Cash on hand"
        case .bank: "Bank"
        case .cheque: "Cheque"
        case .mpesa: "M-Pesa (paid by M-Pesa, recorded here)"
        case .other: "Other"
        }
    }

    /// Where money sits (opening balances).
    static func holdingChannelLabel(_ c: FinOfficeChannel) -> String {
        switch c {
        case .onhand: "Cash on hand (cash box / safe)"
        case .bank: "Bank account"
        case .cheque: "Cheques not yet banked"
        case .mpesa: "M-Pesa till / paybill"
        case .other: "Other"
        }
    }

    /// The cash account an office channel posts to (other → cash:manual).
    static func cashAccount(for c: FinOfficeChannel) -> String { c == .other ? "cash:manual" : "cash:\(c.rawValue)" }

    struct ReferenceRule: Equatable {
        let label: String
        let required: Bool
        let placeholder: String
        let hint: String
    }

    /// What the reference field is called and whether the books require it.
    static func referenceRule(_ c: FinOfficeChannel) -> ReferenceRule {
        switch c {
        case .mpesa: ReferenceRule(label: "M-Pesa code", required: true, placeholder: "SJK4H7T2QX", hint: "The 10-character code from the M-Pesa message.")
        case .cheque: ReferenceRule(label: "Cheque number", required: true, placeholder: "e.g. 004512", hint: "As printed on the cheque.")
        case .bank: ReferenceRule(label: "Bank reference", required: true, placeholder: "e.g. FT26269ABCD", hint: "The reference on the bank statement or deposit slip.")
        case .onhand: ReferenceRule(label: "Reference", required: false, placeholder: "Optional — envelope or register number", hint: "Optional.")
        case .other: ReferenceRule(label: "Reference", required: false, placeholder: "Optional", hint: "Optional — anything that helps find it later.")
        }
    }

    /// The field's text as it is typed: an M-Pesa code is upper-cased and
    /// loses its spaces on the way in (the books store it that way).
    static func normalizeReferenceInput(_ raw: String, channel: FinOfficeChannel) -> String {
        channel == .mpesa ? raw.uppercased().filter { !$0.isWhitespace } : raw
    }

    /// `^[A-Z0-9]{8,12}$` — what an M-Pesa code looks like once trimmed and upper-cased.
    static func isMpesaCode(_ s: String) -> Bool {
        (8...12).contains(s.count) && s.allSatisfy { $0.isASCII && ($0.isUppercase || $0.isNumber) }
    }

    /// What the server stores as office_reference: trimmed, M-Pesa codes
    /// upper-cased; nil when blank.
    static func normalizedReference(_ raw: String, channel: FinOfficeChannel) -> String? {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        return channel == .mpesa ? t.uppercased() : t
    }

    /// Why this reference can't be sent for this channel, or nil.
    static func referenceProblem(_ raw: String, channel: FinOfficeChannel) -> String? {
        let v = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let rule = referenceRule(channel)
        if v.isEmpty {
            guard rule.required else { return nil }
            let what = channel == .mpesa ? "an M-Pesa payment" : channel == .cheque ? "a cheque" : "a bank payment"
            let label = channel == .mpesa ? rule.label : rule.label.lowercased()
            return "Enter the \(label) — it is required for \(what)."
        }
        if v.utf16.count > 80 { return "At most 80 characters." }
        if channel == .mpesa && !isMpesaCode(v.uppercased()) { return "An M-Pesa code is 8–12 letters and digits, like SJK4H7T2QX." }
        return nil
    }

    /// A walk-in giver's name: 2–120 characters (trimmed).
    static func walkInNameProblem(_ raw: String) -> String? {
        let n = raw.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
        if n < 2 { return "Enter the giver's name (at least 2 characters)." }
        if n > 120 { return "At most 120 characters." }
        return nil
    }

    /// An optional phone: blank, or 7–32 characters (trimmed).
    static func phoneProblem(_ raw: String) -> String? {
        let n = raw.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
        return n == 0 || (7...32).contains(n) ? nil : "A phone number is 7–32 characters."
    }

    /// The receipt note: ≤ 60 characters.
    static func noteProblem(_ raw: String) -> String? {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 60 ? "At most 60 characters." : nil
    }

    /// Trimmed length within min…max, or why not. `what` names it with its
    /// article ("a reason", "the name").
    static func lengthProblem(_ raw: String, min: Int, max: Int, what: String) -> String? {
        let n = raw.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
        if n < min {
            if n == 0 { return "Enter \(what)." }
            var bare = what
            for a in ["a ", "an ", "the "] where bare.lowercased().hasPrefix(a) { bare = String(bare.dropFirst(a.count)) }
            return (bare.prefix(1).uppercased() + bare.dropFirst()) + " needs at least \(min) characters."
        }
        if n > max { return "At most \(max) characters." }
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

    /// Why a picked day can't be used, or nil. `what` names it in the sentence.
    static func dayProblem(_ ymd: String, today: String, daysBack: Int, what: String) -> String? {
        if ymd.isEmpty { return "Pick the \(what)." }
        guard FinanceDates.date(fromYMD: ymd) != nil, let first = day(today, minus: daysBack) else {
            return "That is not a date — pick the \(what) from the calendar."
        }
        if ymd > today { return "The \(what) can't be in the future." }
        if ymd < first { return "The books take dates from \(FinanceDates.display(first)) onwards — this one is older." }
        return nil
    }

    /// A payment that may still land: processing or requires_action, started
    /// within the last 48 hours.
    static func isRecentInFlight(status: String, createdAt: String, now: Date = Date()) -> Bool {
        guard status == "processing" || status == "requires_action",
              let at = FinanceATime.instant(createdAt) else { return false }
        let age = now.timeIntervalSince(at)
        return age >= -300 && age <= 48 * 3600
    }

    /// "a" / "an" by sound: an Airtel…, an M-Pesa… (a letter said "em"), a Card….
    static func article(_ word: String) -> String {
        guard let first = word.first else { return "a" }
        if "aeiouAEIOU".contains(first) { return "an" }
        let chars = Array(word)
        if "FHLMNRSX".contains(first), chars.count > 1, chars[1] == "-" || (chars[1].isUppercase && chars[1].isLetter) { return "an" }
        return "a"
    }

    /// "10:42" when it was today (EAT), else "25 Sep 2026, 10:42".
    static func sinceEAT(_ iso: String, now: Date = Date()) -> String {
        guard let at = FinanceATime.instant(iso) else { return "—" }
        return FinanceDates.ymd(at) == FinanceDates.ymd(now) ? FinanceATime.time(iso) : FinanceATime.dayTime(iso)
    }

    /// "An M-Pesa payment of KES 1,000.00 from Grace is still processing since 10:42 — it may be this same payment."
    static func pendingNotice(_ r: FinTransactionRow, now: Date = Date()) -> String {
        let name = (r.fullName ?? r.displayName).trimmingCharacters(in: .whitespaces)
        let who = name.split(separator: " ").first.map(String.init) ?? "this member"
        let label = FinWords.channel(r.channel)
        let art = article(label)
        let state = r.status == "requires_action" ? "is waiting for them to confirm" : "is still processing"
        return "\(art == "an" ? "An" : "A") \(label) payment of \(FinanceMoney.format(r.amountMinor, r.currency)) from \(who) \(state) since \(sinceEAT(r.createdAt, now: now)) — it may be this same payment."
    }

    /// Who decides the fund — the server's order: pledge → need's department fund → the picker.
    static func fundDecisionText(byPledge: Bool, name: String?) -> String {
        byPledge ? "Booked to \(name ?? "the pledge's fund") (the pledge's fund)."
                 : "Booked to \(name ?? "the department's fund") (the department's fund)."
    }

    // MARK: Numbers

    /// Whole-percent change, or nil when there is nothing to compare with
    /// (previous ≤ 0 — the figure is new). A display ratio, never money.
    static func pctChange(current: Int, previous: Int) -> Int? {
        guard previous > 0 else { return nil }
        return Int((Double(current - previous) / Double(previous) * 100).rounded())
    }

    /// "+12%" / "−8%" / "0%" / "—" (a true minus sign).
    static func fmtPct(_ p: Int?) -> String {
        guard let p else { return "—" }
        if p == 0 { return "0%" }
        return p > 0 ? "+\(p)%" : "−\(abs(p))%"
    }

    /// The income tile's comparison line for one currency.
    static func incomeComparison(current: Int, previous: Int, currency: String) -> String {
        if let p = pctChange(current: current, previous: previous) {
            return "\(fmtPct(p)) vs \(FinanceMoney.format(previous, currency)) last year"
        }
        return previous == 0 && current > 0 ? "new — nothing this time last year" : "nothing to compare"
    }

    // MARK: Funds

    /// Why a fund / category code is refused (`^[a-z][a-z0-9-]{1,39}$`), or nil.
    static func slugProblem(_ code: String) -> String? {
        if code.isEmpty { return "Enter a code." }
        let ok = (2...40).contains(code.count)
            && (code.first.map { $0.isASCII && $0.isLowercase } ?? false)
            && code.allSatisfy { $0.isASCII && ($0.isLowercase || $0.isNumber || $0 == "-") }
        return ok ? nil : "Lowercase letters, digits and hyphens, starting with a letter — 2 to 40 characters."
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

    /// "a, b and c".
    static func joinAnd(_ parts: [String]) -> String {
        parts.count <= 1 ? (parts.first ?? "") : parts.dropLast().joined(separator: ", ") + " and " + (parts.last ?? "")
    }

    /// The FUND_IN_USE sentence: "12 active pledges, 3 recurring gifts and 1
    /// department still send money to Building fund — their payments will fail
    /// while it is inactive." (`serverMessage` when no count came back.)
    static func fundInUseSentence(fund: String, pledges: Int, schedules: Int, departments: Int, campaigns: Int, serverMessage: String = "") -> String {
        var parts: [String] = []
        if pledges > 0 { parts.append(plural(pledges, "active pledge")) }
        if schedules > 0 { parts.append(plural(schedules, "recurring gift")) }
        if departments > 0 { parts.append(plural(departments, "department")) }
        if campaigns > 0 { parts.append(plural(campaigns, "live campaign")) }
        if parts.isEmpty {
            return serverMessage.isEmpty ? "Money still routes to \(fund) — payments to it will fail while it is inactive." : serverMessage
        }
        let single = parts.count == 1 && pledges + schedules + departments + campaigns == 1
        return "\(joinAnd(parts)) still \(single ? "sends" : "send") money to \(fund) — \(single ? "its" : "their") payments will fail while it is inactive."
    }

    /// Funds below zero: "2 funds are below zero — more has left them than came in (A, B). Usually an opening balance is missing — post one, or transfer money in."
    static func negativeFundsSentence(_ names: [String], canApprove: Bool) -> String? {
        guard !names.isEmpty else { return nil }
        let one = names.count == 1
        let listed = names.prefix(3).joined(separator: ", ") + (names.count > 3 ? "…" : "")
        return "\(plural(names.count, "fund")) \(one ? "is" : "are") below zero — more has left \(one ? "it" : "them") than came in (\(listed)). Usually an opening balance is missing\(canApprove ? " — post one, or transfer money in" : "")."
    }

    // MARK: Reversal wording

    /// The Reverse sheet's consequence for a gift.
    static func reversalConsequence(amountMinor: Int, currency: String, fundName: String?, memberName: String?,
                                    pledgeTitle: String?, receiptCode: String?) -> String {
        var s = "Posts \(FinanceMoney.format(amountMinor, currency)) back out of \(fundName.flatMap { $0.isEmpty ? nil : $0 } ?? "its fund")"
        if let m = memberName, !m.isEmpty {
            s += "; the gift leaves \(m)'s statement"
            s += pledgeTitle.map { " and re-opens their instalment on “\($0)”." } ?? "."
        } else {
            s += ". It was not on any member's statement."
        }
        if let r = receiptCode, !r.isEmpty { s += " The receipt number \(r) stays on the reversed entry and is never reused." }
        return s + " Nothing is deleted: the gift and its reversal both stay in the ledger."
    }

    // MARK: Ledger words

    /// A ledger account in words: cash:mpesa → "M-Pesa", fund:tithe → the fund's name.
    static func accountLabel(_ account: String, fundNames: [String: String] = [:]) -> String {
        switch account {
        case "cash:": return "All cash accounts"
        case "fund:": return "All funds"
        case "cash:onhand": return "Cash on hand"
        case "cash:bank": return "Bank"
        case "cash:cheque": return "Cheques"
        case "cash:mpesa": return "M-Pesa"
        case "cash:manual": return "Manual / other"
        case "cash:stripe": return "Card (Stripe)"
        case "cash:airtel": return "Airtel Money"
        case "cash:paypal": return "PayPal"
        case "sales:media": return "Media sales"
        default:
            if account.hasPrefix("fund:") { let code = String(account.dropFirst(5)); return fundNames[code] ?? code }
            if account.hasPrefix("cash:") { return FinWords.channel(String(account.dropFirst(5))) }
            return account
        }
    }

    /// A settlement / channel-total row's channel ("stripe" settles as card).
    static func cashChannelLabel(_ channel: String) -> String {
        channel.isEmpty ? "—" : accountLabel("cash:\(channel)")
    }

    // MARK: Overview alerts

    enum Tone { case warn, error, info }

    struct AlertCopy {
        let title: (Int) -> String
        let hint: String
        let fallbackLink: String
        let tone: Tone
    }

    static func alertCopy(_ kind: String) -> AlertCopy {
        switch kind {
        case "pending_claims":
            AlertCopy(title: { "\(plural($0, "claim")) waiting" }, hint: "Members who say they paid another way — confirm or reject each one.",
                      fallbackLink: "/finance/claims", tone: .warn)
        case "expenses_awaiting_approval":
            AlertCopy(title: { "\(plural($0, "expense")) to approve" }, hint: "Recorded but not posted — someone other than the recorder approves them.",
                      fallbackLink: "/finance/expenses?status=recorded", tone: .warn)
        case "failing_schedules":
            AlertCopy(title: { "\(plural($0, "recurring gift")) \($0 == 1 ? "needs" : "need") attention" }, hint: "Paused, or the last collection failed.",
                      fallbackLink: "/finance/recurring?attention=true", tone: .warn)
        case "stale_processing":
            AlertCopy(title: { "\(plural($0, "payment")) stuck processing" }, hint: "An M-Pesa prompt older than 30 minutes, or a card payment older than a day.",
                      fallbackLink: "/finance/reconciliation?tab=exceptions", tone: .warn)
        case "integrity_issues":
            AlertCopy(title: { "\(plural($0, "issue")) in the books" }, hint: "Postings that are missing or don't balance — tell the developer; don't re-record.",
                      fallbackLink: "/finance/reconciliation?tab=exceptions", tone: .error)
        case "partners_behind":
            AlertCopy(title: { "\(plural($0, "partner")) behind" }, hint: "A pledge instalment is overdue.",
                      fallbackLink: "/finance/partners?status=behind", tone: .info)
        default:
            AlertCopy(title: { "\($0) × " + kind.replacingOccurrences(of: "_", with: " ") }, hint: "", fallbackLink: "/finance", tone: .info)
        }
    }

    /// Only an in-app path is followed; anything else falls back to the kind's
    /// own route. Integrity always opens the exceptions.
    static func alertLink(kind: String, link: String?) -> String {
        if kind == "integrity_issues" { return "/finance/reconciliation?tab=exceptions" }
        if let l = link, l.hasPrefix("/"), !l.hasPrefix("//") { return l }
        return alertCopy(kind).fallbackLink
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

    /// Most serious first: money counted twice, then books that don't foot,
    /// then work in flight.
    static let exceptionKinds = ["duplicate_receipt", "succeeded_without_ledger", "unbalanced_transaction", "unbalanced_journal",
                                 "refunded_without_reversal", "stale_processing", "failed"]

    struct ExceptionCopy {
        let title: String
        let explain: String
        let todo: String
        let tone: Tone
    }

    static func exceptionCopy(_ kind: String) -> ExceptionCopy {
        switch kind {
        case "duplicate_receipt":
            ExceptionCopy(title: "Recorded twice",
                          explain: "The same receipt is on two entries — usually the office recorded an M-Pesa payment that also arrived online.",
                          todo: "Open the office entry and reverse it (reason: “Also received online”). The online payment stays.", tone: .error)
        case "succeeded_without_ledger":
            ExceptionCopy(title: "Succeeded, but not in the books",
                          explain: "The payment is marked succeeded but has no ledger postings, so no fund shows the money.",
                          todo: "Tell the developer. Do not record the gift again by hand — it would be counted twice once fixed.", tone: .error)
        case "unbalanced_transaction":
            ExceptionCopy(title: "Gift postings don't balance", explain: "The gift's debits and credits differ, so the ledger no longer foots.",
                          todo: "Tell the developer. Don't reverse or re-record it yourself.", tone: .error)
        case "unbalanced_journal":
            ExceptionCopy(title: "Journal doesn't balance", explain: "A journal whose debits and credits differ, or that has no postings at all.",
                          todo: "Tell the developer. Don't post a correcting journal by hand.", tone: .error)
        case "refunded_without_reversal":
            ExceptionCopy(title: "Refunded without a reversal",
                          explain: "Marked refunded, but nothing was taken back out of the books — the fund still counts the money.",
                          todo: "Tell the developer so the reversing entry is posted. Don't record anything by hand.", tone: .error)
        case "stale_processing":
            ExceptionCopy(title: "Stuck processing",
                          explain: "An M-Pesa or Airtel prompt older than 30 minutes, or a card / PayPal payment older than 24 hours, that never settled.",
                          todo: "Check the M-Pesa statement (or the card dashboard). If the money arrived, wait — the confirmation usually lands. Don't record it by hand while it is processing.",
                          tone: .warn)
        case "failed":
            ExceptionCopy(title: "Failed in the period",
                          explain: "The payer cancelled, had too little balance, or the provider refused. Nothing was posted.",
                          todo: "Nothing to fix in the books. If the member says they paid, look for the code on the statement.", tone: .info)
        default:
            ExceptionCopy(title: kind.replacingOccurrences(of: "_", with: " ").capitalized, explain: "An exception the books flagged.",
                          todo: "Tell the developer.", tone: .warn)
        }
    }

    // MARK: Audit words

    /// "expense.approved" → "Approved an expense"; unknown actions read as
    /// "Pledge · claim confirmed" (module · what happened).
    static func humanAction(_ action: String) -> String {
        let known: [String: String] = [
            "finance.gift_recorded": "Recorded a gift",
            "finance.gift_reversed": "Reversed a gift",
            "finance.category_created": "Added an expense category",
            "finance.category_updated": "Changed an expense category",
            "fund.created": "Created a fund",
            "fund.updated": "Changed a fund",
            "journal.transfer_posted": "Moved money between funds",
            "journal.opening_posted": "Posted an opening balance",
            "journal.reversed": "Reversed a journal",
            "expense.recorded": "Recorded an expense",
            "expense.updated": "Corrected an expense",
            "expense.approved": "Approved an expense",
            "expense.voided": "Voided an expense",
            "budget.created": "Started a budget",
            "budget.updated": "Changed a budget",
            "budget.lines_replaced": "Replaced the budget lines",
            "budget.approved": "Approved a budget",
        ]
        if let k = known[action] { return k }
        guard let dot = action.firstIndex(of: "."), dot != action.startIndex else { return action.replacingOccurrences(of: "_", with: " ") }
        let head = String(action[..<dot])
        let rest = action[action.index(after: dot)...]
            .replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " ")
            .split(separator: " ").joined(separator: " ")
        return (head.prefix(1).uppercased() + head.dropFirst()) + " · " + (rest.isEmpty ? head : rest)
    }

    /// The audit filter's action prefixes (the finance slice, spec §4).
    static let auditPrefixes: [(value: String, label: String)] = [
        ("", "All finance"), ("giving.", "Giving"), ("finance.", "Office (gifts, categories)"),
        ("pledge.", "Pledges & claims"), ("department.need", "Department needs"), ("expense.", "Expenses"),
        ("budget.", "Budgets"), ("journal.", "Journals"), ("fund.", "Funds"),
        ("webhook.", "Webhooks"), ("purchase.", "Purchases"),
    ]

    /// The few facts from an audit row's metadata worth a column (at most
    /// `max`): money first, then receipt / reference / funds / reason, then any
    /// other plain values. Money keys (…_minor) read as money in the row's
    /// currency (metadata.currency, else KES), labelled without the suffix.
    static func auditDetails(_ metadata: [String: FinJSON]?, max: Int = 4) -> [String] {
        guard let m = metadata, !m.isEmpty else { return [] }
        var currency = FinanceMoney.homeCurrency
        if case .string(let c)? = m["currency"], !c.trimmingCharacters(in: .whitespaces).isEmpty { currency = c }
        func scalar(_ key: String) -> String? {
            switch m[key] {
            case .string(let s)?: let t = s.trimmingCharacters(in: .whitespaces); return t.isEmpty ? nil : t
            case .number(let n)?: return n.isFinite ? FinJSON.number(n).text : nil
            case .bool(let b)?: return b ? "yes" : "no"
            default: return nil
            }
        }
        func clip(_ s: String, _ n: Int) -> String { s.count > n ? String(s.prefix(n - 1)) + "…" : s }
        var out: [String] = []
        var used: Set<String> = []
        func take(_ key: String, _ render: (String) -> String) {
            guard out.count < max, !used.contains(key) else { return }
            used.insert(key)
            if let v = scalar(key) { out.append(render(v)) }
        }
        if let raw = scalar("amount_minor"), let minor = Int(raw) {
            out.append(FinanceMoney.format(minor, currency))
            used.insert("amount_minor")
        }
        // A money line carries the currency — no bare "currency: USD" beside it.
        if m.keys.contains(where: { $0.hasSuffix("_minor") }) { used.insert("currency") }
        take("receipt_code") { "Receipt \($0)" }
        take("reference") { "Ref \($0)" }
        for (fromKey, toKey) in [("from_fund", "to_fund"), ("from", "to")] {
            if let from = scalar(fromKey), let to = scalar(toKey), out.count < max {
                out.append("\(from) → \(to)")
                used.formUnion([fromKey, toKey])
            }
        }
        take("fund") { "Fund \($0)" }
        take("reason") { "“\(clip($0, 80))”" }
        for k in m.keys.sorted() {
            if out.count >= max { break }
            if used.contains(k) || k.hasSuffix("_id") || k == "idempotency_key" { continue }
            used.insert(k)
            if k.hasSuffix("_minor"), let raw = scalar(k), let minor = Int(raw) {
                out.append("\(auditLabel(k)): \(FinanceMoney.format(minor, currency))")
            } else if let v = scalar(k) {
                out.append("\(auditLabel(k)): \(clip(v, 40))")
            }
        }
        return out
    }

    /// The audit detail's lines — every metadata key as recorded, except that a
    /// money key (…_minor, at any depth) reads as money in the row's currency
    /// (metadata.currency, else KES) and is labelled without the suffix
    /// ("income total: KES 1,200,000.00"); the bare currency key is left out
    /// when a money line already carries it (web parity).
    static func auditMetadataFacts(_ metadata: [String: FinJSON]?) -> [FinAFact] {
        guard let m = metadata, !m.isEmpty else { return [] }
        var currency = FinanceMoney.homeCurrency
        if case .string(let c)? = m["currency"], !c.isEmpty { currency = c }
        let hasMoney = m.keys.contains { $0.hasSuffix("_minor") }
        return m.keys.sorted().compactMap { k in
            if k == "currency" && hasMoney { return nil }
            let v = m[k] ?? .null
            return FinAFact(auditLabel(k), auditValue(k, v, currency: currency),
                            mono: k.hasSuffix("_id") || k == "reference" || k == "receipt_code")
        }
    }

    /// "income_total_minor" → "income total"; "user_id" → "user id".
    static func auditLabel(_ key: String) -> String {
        let bare = key.hasSuffix("_minor") ? String(key.dropLast("_minor".count)) : key
        return bare.replacingOccurrences(of: "_", with: " ")
    }

    /// One metadata value in words; money keys as money, nested objects as
    /// "label: value · label: value" by the same rules.
    static func auditValue(_ key: String, _ v: FinJSON, currency: String) -> String {
        if key.hasSuffix("_minor") {
            switch v {
            case .number(let n) where n.isFinite: return FinanceMoney.format(Int(n.rounded()), currency)
            case .string(let t): if let i = Int(t.trimmingCharacters(in: .whitespaces)) { return FinanceMoney.format(i, currency) }
            default: break
            }
        }
        switch v {
        case .object(let o):
            var cur = currency
            if case .string(let c)? = o["currency"], !c.isEmpty { cur = c }
            let money = o.keys.contains { $0.hasSuffix("_minor") }
            return o.keys.sorted().compactMap { k in
                if k == "currency" && money { return nil }
                return "\(auditLabel(k)): \(auditValue(k, o[k] ?? .null, currency: cur))"
            }.joined(separator: " · ")
        case .array(let a):
            return a.map { auditValue(key, $0, currency: currency) }.joined(separator: ", ")
        default:
            return v.text
        }
    }

    // MARK: Period deep links

    /// A web period param ("this_month" …) → the preset.
    static func periodPreset(fromParam p: String) -> FinancePeriodPreset? {
        switch p {
        case "this_month": .thisMonth
        case "last_month": .lastMonth
        case "this_quarter": .thisQuarter
        case "this_year": .thisYear
        case "last_12_months": .last12Months
        default: nil
        }
    }

    /// A deep link's period: from/to (valid EAT days) or period=<preset>, else nil.
    static func period(fromParams p: [String: String]) -> FinancePeriod? {
        if let from = p["from"], let to = p["to"], FinanceDates.date(fromYMD: from) != nil, FinanceDates.date(fromYMD: to) != nil {
            return .custom(from: from, to: to)
        }
        return p["period"].flatMap(periodPreset(fromParam:)).map { FinancePeriod.preset($0) }
    }

    // MARK: Who can do what (spec §6)

    static let capabilityHelp: [(key: String, label: String, detail: String)] = [
        ("view", "finance:view", "See every Finance page — registers, the ledger, reconciliation, reports, statements and this page."),
        ("export", "finance:export", "Download the CSV exports of registers and reports."),
        ("manage", "finance:manage", "Record and reverse office gifts; create and edit funds and expense categories; record and void expenses; draft budgets; run campaigns; confirm or reject claims; send reminders."),
        ("approve", "finance:approve", "Approve expenses (never one they recorded or edited — maker-checker) and budgets; post fund transfers and opening balances; reverse journals."),
    ]
}

// MARK: - DEBUG self-check

#if DEBUG
/// The A pages' pure helpers, asserted at launch in Debug builds through
/// FinanceSelfCheck.run() (FinanceKit.swift) — fixed dates only, so nothing
/// depends on the device's zone or today's date. The sentences are the web's
/// (financeAHelpers.test.ts checks the same ones on that side).
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
        let dec = JSONDecoder()
        dec.keyDecodingStrategy = .convertFromSnakeCase
        let iso = ISO8601DateFormatter()
        func at(_ s: String) -> Date { iso.date(from: s) ?? Date(timeIntervalSince1970: 0) }

        // Instants → EAT.
        expectEqual(FinanceATime.day("2026-09-25T22:30:00Z"), "26 Sep 2026", "22:30Z is the next day in EAT")
        expectEqual(FinanceATime.day("2026-09-26T09:00:00.000Z"), "26 Sep 2026", "fractional-second ISO")
        expectEqual(FinanceATime.time("2026-09-26T09:05:00Z"), "12:05", "EAT time")
        expectEqual(FinanceATime.dayTime("2026-09-26T09:05:00Z"), "26 Sep 2026, 12:05", "EAT day + time")
        expectEqual(FinanceATime.ymd("2026-09-26"), "2026-09-26", "a bare date passes through")
        expectEqual(FinanceATime.day("not a date"), "—", "garbage reads —")

        // Record a gift — channels, references, giver fields.
        expectEqual(FinanceARules.giftChannelLabel(.mpesa), "M-Pesa (paid by M-Pesa, recorded here)", "M-Pesa channel label")
        expectEqual(FinanceARules.holdingChannelLabel(.cheque), "Cheques not yet banked", "holding channel label")
        expectEqual(FinanceARules.cashAccount(for: .other), "cash:manual", "other posts to cash:manual")
        expectEqual(FinanceARules.referenceRule(.cheque).label, "Cheque number", "cheque reference label")
        expect(FinanceARules.referenceRule(.bank).required && !FinanceARules.referenceRule(.onhand).required, "bank needs a reference, cash doesn't")
        expectEqual(FinanceARules.normalizeReferenceInput("sjk4 h7t2qx", channel: .mpesa), "SJK4H7T2QX", "M-Pesa typed: upper-cased, no spaces")
        expectEqual(FinanceARules.normalizeReferenceInput("ab 12", channel: .cheque), "ab 12", "cheque typed as is")
        expectEqual(FinanceARules.normalizedReference("  qjk4abc123 ", channel: .mpesa), "QJK4ABC123", "M-Pesa code upper-cased")
        expectEqual(FinanceARules.normalizedReference("   ", channel: .onhand), nil, "blank reference is absent")
        expectEqual(FinanceARules.referenceProblem("", channel: .mpesa), "Enter the M-Pesa code — it is required for an M-Pesa payment.", "M-Pesa needs a code")
        expectEqual(FinanceARules.referenceProblem("", channel: .cheque), "Enter the cheque number — it is required for a cheque.", "cheque needs a number")
        expectEqual(FinanceARules.referenceProblem("", channel: .bank), "Enter the bank reference — it is required for a bank payment.", "bank needs a reference")
        expectEqual(FinanceARules.referenceProblem("QJK4", channel: .mpesa), "An M-Pesa code is 8–12 letters and digits, like SJK4H7T2QX.", "short M-Pesa code refused")
        expect(FinanceARules.referenceProblem("qjk4abc123", channel: .mpesa) == nil, "lower-case M-Pesa code accepted")
        expect(FinanceARules.referenceProblem("QJK4-ABC123", channel: .mpesa) != nil, "M-Pesa code with a hyphen refused")
        expect(FinanceARules.referenceProblem("", channel: .onhand) == nil, "cash needs no reference")
        expectEqual(FinanceARules.referenceProblem(String(repeating: "x", count: 81), channel: .other), "At most 80 characters.", "81-character reference refused")
        expectEqual(FinanceARules.walkInNameProblem(" A "), "Enter the giver's name (at least 2 characters).", "one-letter walk-in name refused")
        expect(FinanceARules.walkInNameProblem("Jo") == nil, "two-letter walk-in name accepted")
        expectEqual(FinanceARules.walkInNameProblem(String(repeating: "n", count: 121)), "At most 120 characters.", "121-character name refused")
        expect(FinanceARules.phoneProblem("") == nil, "phone is optional")
        expectEqual(FinanceARules.phoneProblem("07123"), "A phone number is 7–32 characters.", "5-digit phone refused")
        expect(FinanceARules.phoneProblem("+254712345678") == nil, "E.164 phone accepted")
        expect(FinanceARules.noteProblem(String(repeating: "n", count: 60)) == nil, "60-character note accepted")
        expectEqual(FinanceARules.noteProblem(String(repeating: "n", count: 61)), "At most 60 characters.", "61-character note refused")
        expectEqual(FinanceARules.lengthProblem("", min: 3, max: 300, what: "a reason"), "Enter a reason.", "empty text")
        expectEqual(FinanceARules.lengthProblem("ab", min: 3, max: 300, what: "a reason"), "Reason needs at least 3 characters.", "short text")
        expect(FinanceARules.lengthProblem("abc", min: 3, max: 300, what: "a reason") == nil, "3-character reason accepted")
        expectEqual(FinanceARules.article("M-Pesa"), "an", "an M-Pesa")
        expectEqual(FinanceARules.article("Airtel"), "an", "an Airtel")
        expectEqual(FinanceARules.article("Card"), "a", "a Card")
        expectEqual(FinanceARules.fundDecisionText(byPledge: true, name: "Building fund"), "Booked to Building fund (the pledge's fund).", "pledge decides the fund")
        expectEqual(FinanceARules.fundDecisionText(byPledge: false, name: "Offering"), "Booked to Offering (the department's fund).", "need decides the fund")

        // Dates — the books' window.
        expectEqual(FinanceARules.day("2026-09-26", minus: 366), "2025-09-25", "today − 366")
        expectEqual(FinanceARules.day("2028-03-01", minus: 366), "2027-03-01", "today − 366 across a leap day")
        expectEqual(FinanceARules.day("2026-09-26", minus: 3660), "2016-09-18", "today − 3660 (opening balances)")
        if let r = FinanceARules.allowedDays(today: "2026-09-26", daysBack: 366) {
            expect(r.contains("2025-09-25") && r.contains("2026-09-26") && !r.contains("2025-09-24") && !r.contains("2026-09-27"),
                   "allowed days are inclusive at both ends")
        } else { expect(false, "allowedDays returned nil") }
        expectEqual(FinanceARules.dayProblem("2026-09-27", today: "2026-09-26", daysBack: 366, what: "day the money was received"),
                    "The day the money was received can't be in the future.", "future day refused")
        expectEqual(FinanceARules.dayProblem("2025-09-24", today: "2026-09-26", daysBack: 366, what: "day the money was received"),
                    "The books take dates from 25 Sep 2025 onwards — this one is older.", "too-old day refused")
        expect(FinanceARules.dayProblem("2025-09-25", today: "2026-09-26", daysBack: 366, what: "x") == nil, "first allowed day accepted")
        let now = at("2026-09-26T09:00:00Z")
        expect(FinanceARules.isRecentInFlight(status: "processing", createdAt: "2026-09-25T10:00:00Z", now: now), "processing 23 h ago is in flight")
        expect(FinanceARules.isRecentInFlight(status: "requires_action", createdAt: "2026-09-24T09:30:00Z", now: now), "requires_action 47.5 h ago is in flight")
        expect(!FinanceARules.isRecentInFlight(status: "processing", createdAt: "2026-09-24T08:00:00Z", now: now), "49 h ago is not recent")
        expect(!FinanceARules.isRecentInFlight(status: "succeeded", createdAt: "2026-09-26T08:00:00Z", now: now), "succeeded is not in flight")
        expectEqual(FinanceARules.sinceEAT("2026-09-26T07:42:00Z", now: now), "10:42", "since: today shows the time")
        expectEqual(FinanceARules.sinceEAT("2026-09-25T07:42:00Z", now: now), "25 Sep 2026, 10:42", "since: earlier shows the day")

        // Numbers.
        expectEqual(FinanceARules.pctChange(current: 1124, previous: 1000), 12, "12%")
        expectEqual(FinanceARules.fmtPct(FinanceARules.pctChange(current: 950, previous: 1000)), "−5%", "true minus")
        expectEqual(FinanceARules.fmtPct(FinanceARules.pctChange(current: 1000, previous: 1000)), "0%", "no change")
        expectEqual(FinanceARules.pctChange(current: 500, previous: 0), nil, "nothing last year")
        expectEqual(FinanceARules.fmtPct(nil), "—", "no comparison")
        expectEqual(FinanceARules.pctChange(current: 250_000_000_000, previous: 100_000_000_000), 150, "large amounts")
        expectEqual(FinanceARules.incomeComparison(current: 184_250_000, previous: 163_900_000, currency: "KES"),
                    "+12% vs KES 1,639,000.00 last year", "income comparison")
        expectEqual(FinanceARules.incomeComparison(current: 124_000, previous: 0, currency: "USD"), "new — nothing this time last year", "new income")
        expectEqual(FinanceARules.incomeComparison(current: 0, previous: 0, currency: "USD"), "nothing to compare", "no income either year")

        // Funds — codes and the in-use / below-zero sentences.
        expect(FinanceARules.slugProblem("building-fund") == nil, "valid slug")
        for bad in ["Building", "2026-harvest", "b", String(repeating: "a", count: 41), "tithe_2026"] {
            expectEqual(FinanceARules.slugProblem(bad), "Lowercase letters, digits and hyphens, starting with a letter — 2 to 40 characters.", "slug \(bad) refused")
        }
        expectEqual(FinanceARules.slugProblem(""), "Enter a code.", "empty slug")
        expectEqual(FinanceARules.suggestedSlug(from: "Building Fund 2026"), "building-fund-2026", "slug from name")
        expectEqual(FinanceARules.suggestedSlug(from: "  Missions & Outreach "), "missions-outreach", "slug collapses symbols")
        expectEqual(FinanceARules.suggestedSlug(from: "Église Fund"), "eglise-fund", "slug folds accents")
        expectEqual(FinanceARules.suggestedSlug(from: "2026 Harvest"), "harvest", "slug drops a leading number")
        expectEqual(FinanceARules.fundInUseSentence(fund: "Building fund", pledges: 12, schedules: 3, departments: 1, campaigns: 0),
                    "12 active pledges, 3 recurring gifts and 1 department still send money to Building fund — their payments will fail while it is inactive.",
                    "fund in use — three kinds")
        expectEqual(FinanceARules.fundInUseSentence(fund: "Tithe", pledges: 1, schedules: 0, departments: 0, campaigns: 0),
                    "1 active pledge still sends money to Tithe — its payments will fail while it is inactive.", "fund in use — one")
        expectEqual(FinanceARules.fundInUseSentence(fund: "Tithe", pledges: 0, schedules: 0, departments: 0, campaigns: 0, serverMessage: "In use."),
                    "In use.", "fund in use — the server's sentence when no counts")
        expectEqual(FinanceARules.negativeFundsSentence(["Youth ministry"], canApprove: true),
                    "1 fund is below zero — more has left it than came in (Youth ministry). Usually an opening balance is missing — post one, or transfer money in.",
                    "one fund below zero")
        expectEqual(FinanceARules.negativeFundsSentence([], canApprove: true), nil, "no fund below zero")

        // Reversal consequences.
        expectEqual(FinanceARules.reversalConsequence(amountMinor: 150_000, currency: "KES", fundName: "Tithe", memberName: "Mary Wanjiku",
                                                      pledgeTitle: "Building 2026", receiptCode: "OR-2026-00040"),
                    "Posts KES 1,500.00 back out of Tithe; the gift leaves Mary Wanjiku's statement and re-opens their instalment on “Building 2026”. The receipt number OR-2026-00040 stays on the reversed entry and is never reused. Nothing is deleted: the gift and its reversal both stay in the ledger.",
                    "gift reversal — member + pledge")
        expectEqual(FinanceARules.reversalConsequence(amountMinor: 5_000, currency: "USD", fundName: "Missions", memberName: nil, pledgeTitle: nil, receiptCode: nil),
                    "Posts USD 50.00 back out of Missions. It was not on any member's statement. Nothing is deleted: the gift and its reversal both stay in the ledger.",
                    "gift reversal — walk-in")

        // Ledger, alert and exception words.
        expectEqual(FinanceARules.accountLabel("cash:onhand"), "Cash on hand", "cash:onhand")
        expectEqual(FinanceARules.accountLabel("cash:cheque"), "Cheques", "cash:cheque")
        expectEqual(FinanceARules.accountLabel("fund:tithe", fundNames: ["tithe": "Tithe"]), "Tithe", "fund account → name")
        expectEqual(FinanceARules.accountLabel("fund:"), "All funds", "fund prefix")
        expectEqual(FinanceARules.cashChannelLabel("stripe"), "Card (Stripe)", "stripe settles as card")
        expectEqual(FinanceARules.alertCopy("expenses_awaiting_approval").title(1), "1 expense to approve", "alert singular")
        expectEqual(FinanceARules.alertCopy("failing_schedules").title(2), "2 recurring gifts need attention", "alert plural verb")
        expectEqual(FinanceARules.alertCopy("integrity_issues").title(3), "3 issues in the books", "integrity alert")
        expectEqual(FinanceARules.alertLink(kind: "integrity_issues", link: "/finance/elsewhere"), "/finance/reconciliation?tab=exceptions", "integrity always opens exceptions")
        expectEqual(FinanceARules.alertLink(kind: "pending_claims", link: "https://evil.example"), "/finance/claims", "off-app links fall back")
        expectEqual(FinanceARules.alertLink(kind: "pending_claims", link: "//evil.example"), "/finance/claims", "protocol-relative links fall back")
        expectEqual(FinanceARules.alertLink(kind: "partners_behind", link: "/finance/partners?status=behind"), "/finance/partners?status=behind", "in-app link followed")
        expectEqual(Set(FinanceARules.exceptionKinds).count, 7, "seven exception kinds, no repeats")
        expectEqual(FinanceARules.exceptionKinds.first, "duplicate_receipt", "money counted twice comes first")
        expectEqual(FinanceARules.exceptionCopy("duplicate_receipt").title, "Recorded twice", "duplicate title")
        for k in FinanceARules.exceptionKinds {
            let c = FinanceARules.exceptionCopy(k)
            expect(!c.explain.isEmpty && !c.todo.isEmpty && c.title != k, "exception \(k) has words")
        }
        expectEqual(FinanceARules.periodPreset(fromParam: "last_12_months"), .last12Months, "period param")
        expectEqual(FinanceARules.period(fromParams: ["from": "2026-09-01", "to": "2026-09-10"])?.to, "2026-09-10", "from/to period")
        expectEqual(FinanceARules.period(fromParams: ["from": "2026-02-30", "to": "2026-09-10"]), nil, "invalid from/to ignored")

        // Audit words.
        expectEqual(FinanceARules.humanAction("finance.gift_recorded"), "Recorded a gift", "known action")
        expectEqual(FinanceARules.humanAction("pledge.claim_confirmed"), "Pledge · claim confirmed", "unknown action: module · what")
        expectEqual(FinanceARules.humanAction("webhook.mpesa_callback"), "Webhook · mpesa callback", "webhook action")
        let gift: [String: FinJSON] = ["amount_minor": .number(150_050), "currency": .string("KES"), "receipt_code": .string("OR-2026-00012"),
                                       "fund": .string("tithe"), "channel": .string("mpesa"), "reference": .string("QJK4ABC123"),
                                       "user_id": .string("u1")]
        expectEqual(FinanceARules.auditDetails(gift), ["KES 1,500.50", "Receipt OR-2026-00012", "Ref QJK4ABC123", "Fund tithe"], "audit details — gift (4 at most)")
        expectEqual(FinanceARules.auditDetails(["from": .string("building"), "to": .string("missions"), "amount_minor": .string("100000"), "currency": .string("KES")]),
                    ["KES 1,000.00", "building → missions"], "audit details — transfer (from/to), BIGINT as text")
        expectEqual(FinanceARules.auditDetails(["amount_minor": .number(5_000)]), ["KES 50.00"], "details: currency falls back to KES")
        expectEqual(FinanceARules.auditDetails(["from_balance_after_minor": .number(-300_000), "currency": .string("USD")]),
                    ["from balance after: -USD 3,000.00"], "details: other money keys as money, no suffix, no bare currency")
        expectEqual(FinanceARules.auditDetails(["reason": .string(String(repeating: "r", count: 90))]).first?.count, 82, "reason clipped to 80 (+ quotes)")
        expectEqual(FinanceARules.auditDetails(nil), [], "no metadata")
        func facts(_ m: [String: FinJSON]) -> [String] { FinanceARules.auditMetadataFacts(m).map { "\($0.label): \($0.value)" } }
        expectEqual(facts(["income_total_minor": .number(120_000_000), "currency": .string("KES")]),
                    ["income total: KES 1,200,000.00"], "money key: no suffix, no bare currency line")
        expectEqual(facts(["amount_minor": .string("5000")]), ["amount: KES 50.00"], "money key as text, KES fallback")
        expectEqual(facts(["currency": .string("USD"), "reason": .string("Duplicate")]),
                    ["currency: USD", "reason: Duplicate"], "currency kept when no money line carries it")
        expectEqual(facts(["currency": .string("USD"), "changes": .object(["amount_minor": .number(5_000), "payee": .string("KPLC")])]),
                    ["changes: amount: USD 50.00 · payee: KPLC", "currency: USD"], "nested money key in the row's currency")

        // The fund patch override encodes `force` only when set.
        let enc = JSONEncoder()
        enc.keyEncodingStrategy = .convertToSnakeCase
        enc.outputFormatting = .sortedKeys
        func json<T: Encodable>(_ v: T) -> String { (try? enc.encode(v)).flatMap { String(data: $0, encoding: .utf8) } ?? "?" }
        expectEqual(json(FinFundPatchForced(patch: FinFundPatch(isActive: false), force: true)), #"{"force":true,"is_active":false}"#, "forced deactivate body")
        expectEqual(json(FinFundPatchForced(patch: FinFundPatch(isActive: false), force: false)), #"{"is_active":false}"#, "plain deactivate body")

        // Decoding: the givers envelope, a journal, the in-flight notice.
        let giverJSON = #"{"user_id":"u1","full_name":"Mary Wanjiku","phone":"+254712000001","email":null,"congregation_name":"Nuru Central","open_pledges":[{"pledge_id":"p1","title":"Building","currency":"KES","shape":"monthly","amount_minor":"500000","target_minor":null,"pays_to":{"code":"building","name":"Building fund"}},{"pledge_id":"p2","title":"Missions","currency":"USD","shape":"total","amount_minor":null,"target_minor":120000,"pays_to":null}]}"#
        if let g = try? dec.decode(FinGiver.self, from: Data(giverJSON.utf8)) {
            expect(g.openPledges.count == 2 && g.openPledges[0].amountMinor == 500_000 && g.openPledges[1].paysTo == nil, "giver with open pledges decodes")
        } else { expect(false, "decode FinGiver") }
        let journalJSON = #"{"journal_id":"j1","kind":"transfer","memo":"Seed","occurred_on":"2026-09-20","created_at":"2026-09-21T06:00:00Z","created_by":null,"created_by_name":null,"ref_id":null,"reversal_of":null,"reversed_by_journal_id":null,"legs":[{"entry_id":"e1","account":"fund:general","side":"debit","amount_minor":"1000000","currency":"KES","created_at":"2026-09-20T09:00:00Z"},{"entry_id":"e2","account":"fund:building","side":"credit","amount_minor":1000000,"currency":"KES","created_at":"2026-09-20T09:00:00Z"}],"totals":[{"currency":"KES","amount_minor":1000000}]}"#
        if let j = try? dec.decode(FinJournal.self, from: Data(journalJSON.utf8)) {
            expectEqual(FinanceARules.journalReversalConsequence(j, fundNames: ["general": "General", "building": "Building fund"]),
                        "Moves KES 10,000.00 back from Building fund to General, dated 20 Sep 2026 like the original. The transfer stays in the ledger, marked reversed; a reversal can't itself be undone.",
                        "transfer reversal consequence")
            expect(j.looksReversible, "an unreversed transfer looks reversible")
        } else { expect(false, "decode FinJournal") }
        let rowJSON = #"{"transaction_id":"t4","user_id":"u4","full_name":"David Mwangi","member_phone":null,"display_name":"David Mwangi","amount_minor":300000,"currency":"KES","status":"processing","fund":"tithe","fund_name":"Tithe","account_name":null,"method":"mpesa","channel":"mpesa","source":"app","provider":"mpesa","provider_ref":null,"receipt_code":null,"giver_name":null,"giver_phone":null,"pledge_id":null,"pledge_title":null,"need_id":null,"need_title":null,"office_channel":null,"office_reference":null,"recorded_by":null,"recorded_by_name":null,"reversed_at":null,"reversed_by":null,"reversed_by_name":null,"reversal_reason":null,"created_at":"2026-09-26T07:42:00Z","settled_at":null}"#
        if let r = try? dec.decode(FinTransactionRow.self, from: Data(rowJSON.utf8)) {
            expectEqual(FinanceARules.pendingNotice(r, now: now),
                        "An M-Pesa payment of KES 3,000.00 from David is still processing since 10:42 — it may be this same payment.", "in-flight notice")
        } else { expect(false, "decode FinTransactionRow") }

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

        // Chart month labels.
        expectEqual(FinAIncomeExpenseChart.label("2026-09"), "Sep", "month label")
        expectEqual(FinAIncomeExpenseChart.label("2027-01"), "Jan", "month label — short name only, as the web")
        expectEqual(FinAIncomeExpenseChart.monthYear("2026-09"), "Sep 2026", "month and year (the tooltip)")
        expectEqual(FinanceARules.fmtRange(from: "2026-09-01", to: "2026-09-26"), "1 Sep – 26 Sep 2026", "range, same year (web fmtRange)")
        expectEqual(FinanceARules.fmtRange(from: "2026-09-26", to: "2026-09-26"), "26 Sep 2026", "range, one day")
        expectEqual(FinanceARules.fmtRange(from: "2025-12-15", to: "2026-01-03"), "15 Dec 2025 – 3 Jan 2026", "range across years")
        expectEqual(FinanceARules.postingSource(kind: "journal", receiptCode: nil, memberName: nil, journalKind: "transfer", memo: "Seed"), "Transfer — Seed", "posting source — journal")
        expectEqual(FinanceARules.postingSource(kind: "transaction", receiptCode: "OR-2026-00012", memberName: "Grace", journalKind: nil, memo: nil), "OR-2026-00012 · Grace", "posting source — gift")
        expectEqual(FinanceARules.postingSource(kind: "transaction", receiptCode: nil, memberName: nil, journalKind: nil, memo: nil), "Gift", "posting source — bare gift")
        expectEqual(FinanceARules.auditShortId("5b0c1e2f-aaaa-bbbb"), "5b0c1e2f…", "audit short id")
        expectEqual(FinanceARules.auditShortId("t-001"), "t-001", "audit short id — short ids whole")
        expect(FinanceARules.auditLineIsMoney("KES 1,500.00") && FinanceARules.auditLineIsMoney("-USD 5.00") && !FinanceARules.auditLineIsMoney("Receipt OR-1"), "audit money lines set in mono")
        expectEqual(FinanceARules.message(APIError.http(status: 403, message: HTTPURLResponse.localizedString(forStatusCode: 403))), "You don't have permission to do that.", "403 without a server sentence")
        expectEqual(FinanceARules.message(APIError.http(status: 409, message: "That M-Pesa code is already in the books."), fallback: "x"), "That M-Pesa code is already in the books.", "the server's sentence wins")
        expectEqual(FinanceARules.message(APIError.http(status: 502, message: ""), fallback: "x"), "The server had a problem (502) — try again in a minute.", "5xx")
        expectEqual(FinanceARules.message(APIError.transport("The request timed out.")), "The server took too long to answer — try again.", "timeout")
        expectEqual(FinanceARules.message(APIError.http(status: 422, message: ""), fallback: "The transfer was not posted."), "The transfer was not posted.", "fallback")
        // The category move plan (the web's reorderPlan): renumber 10, 20, 30…, send only changes.
        let plan = FinanceARules.reorderPlan([("a", 0), ("b", 0), ("c", 0)], index: 1, dir: -1)
        expectEqual(plan.map(\.id), ["b", "a", "c"], "reorder — ties all renumbered")
        expectEqual(plan.map(\.sort), [10, 20, 30], "reorder — 10, 20, 30")
        let plan2 = FinanceARules.reorderPlan([("a", 10), ("b", 20), ("c", 30)], index: 2, dir: -1)
        expectEqual(plan2.map(\.id), ["c", "b"], "reorder — only the two that change")
        expect(FinanceARules.reorderPlan([("a", 10)], index: 0, dir: -1).isEmpty, "reorder — out of range is nothing")
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

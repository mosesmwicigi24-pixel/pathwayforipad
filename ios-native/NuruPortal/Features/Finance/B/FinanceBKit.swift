// Finance ERP — what the B pages share (Pledges, Partners, Claims, Recurring
// gifts, Campaigns, Department needs, Expenses, Budgets, Reports, Statements;
// pathway docs/FINANCE_ERP.md §5). Built ON FinanceKit + FinanceERPAPI — the
// kit itself is not changed by anything here.
//
// Index (one line each):
//   FinBTime                  EAT day / stamp for dates AND timestamps (ISO or Postgres text)
//   FinBMath                  run-rate, budget spread, month cells, 12 values, YTD, overlaps — pure
//   FinBMakerChecker          who may approve an expense, and the one sentence when not
//   FinBError                 an error → the sentence a page shows
//   finbRelay(_:)             a page model re-publishes its FinancePager
//   FinBLookups               funds (/config) + expense categories, loaded once per page
//   FinBDownloadButton        PDF / CSV → share sheet, with a 404 sentence of its own
//   FinBPeriodMenu · FinBMultiMenu · FinBChoiceChips      filters the kit's bar lacks
//   FinBCard · FinBProgress · FinBAmount · FinBPersonCell · FinBKeyValue · FinBCurrencyFigures
//   FinBConfirmSheet · FinBFormSheet · FinBField · .finbInput()          writes
import SwiftUI
import Combine

// MARK: - Dates and timestamps in EAT

enum FinBTime {
    private static func eat(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = FinanceDates.calendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = FinanceDates.timeZone
        f.dateFormat = format
        return f
    }
    private static let dayF = eat("d MMM yyyy")
    private static let stampF = eat("d MMM yyyy, HH:mm")

    /// A wire date or timestamp → an instant. "YYYY-MM-DD" is that EAT day
    /// (noon); anything longer is ISO 8601 or Postgres `timestamptz::text`.
    static func parse(_ raw: String?) -> Date? {
        guard let s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        if s.count == 10 { return FinanceDates.date(fromYMD: s) }
        return PgDate.parse(s)
    }

    /// "26 Sep 2026" — the EAT calendar day of a date or a timestamp; "—" if none.
    static func day(_ raw: String?) -> String { parse(raw).map { dayF.string(from: $0) } ?? "—" }

    /// "26 Sep 2026, 10:11" in EAT; a plain date reads as its day (it has no time).
    static func stamp(_ raw: String?) -> String {
        guard let s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return "—" }
        if s.count == 10 { return day(s) }
        return parse(s).map { stampF.string(from: $0) } ?? "—"
    }

    /// The EAT calendar day ("YYYY-MM-DD") of a date or timestamp.
    static func ymd(_ raw: String?) -> String? { parse(raw).map { FinanceDates.ymd($0) } }

    /// Whole EAT days from one "YYYY-MM-DD" to another (negative when backwards).
    static func days(from: String, to: String) -> Int? {
        guard let a = FinanceDates.date(fromYMD: from), let b = FinanceDates.date(fromYMD: to) else { return nil }
        return FinanceDates.calendar.dateComponents([.day], from: a, to: b).day
    }

    /// How long ago an instant was, for a queue's age (web `ageSince`):
    /// "just now", "12 minutes", "5 hours" (under 48 hours), then "3 days".
    static func age(since raw: String?, now: Date = Date()) -> String {
        guard let start = parse(raw) else { return "—" }
        let minutes = max(0, Int(now.timeIntervalSince(start) / 60))
        if minutes < 1 { return "just now" }
        if minutes < 60 { return "\(minutes) \(minutes == 1 ? "minute" : "minutes")" }
        let hours = minutes / 60
        if hours < 48 { return "\(hours) \(hours == 1 ? "hour" : "hours")" }
        return "\(hours / 24) days"
    }
}

// MARK: - Pure helpers (asserted by FinanceBSelfCheck at every Debug launch)

/// Why a budget month cell was refused.
enum FinBCellError: Error, Equatable {
    case invalid, tooManyDecimals, negative, tooLarge
    var message: String {
        switch self {
        case .invalid: "Enter a number such as 25000 or 25,000.50."
        case .tooManyDecimals: "Use at most two decimal places."
        case .negative: "Budget amounts are 0 or more."
        case .tooLarge: "At most KES 1,000,000,000.00 a month."
        }
    }
}

enum FinBMath {
    static let monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static func monthName(_ index: Int) -> String { monthNames.indices.contains(index) ? monthNames[index] : "Month \(index + 1)" }

    // Recurring gifts — the monthly run-rate.

    /// What one schedule contributes to the run-rate.
    struct Schedule: Equatable {
        let frequency: String
        let amountMinor: Int
        let currency: String
        let status: String
    }

    /// One currency's run-rate. APPROXIMATE by design: a weekly gift is
    /// counted as 52 ÷ 12 charges a month.
    struct RunRate: Equatable {
        let currency: String
        /// ≈ per month: (Σ weekly × 52 + Σ monthly × 12) ÷ 12, rounded half up
        /// to the cent — integer math, divided once per currency (web parity:
        /// logic.ts recurringTotals).
        let monthlyMinor: Int
        /// Active schedules — the only ones that collect.
        let active: Int
        /// Every schedule listed in that currency (paused ones included).
        let listed: Int
        /// Active schedules with a frequency other than weekly/monthly — left
        /// OUT of the run-rate and said so, never guessed.
        let unrated: Int
    }

    static func runRates(_ items: [Schedule]) -> [RunRate] {
        var monthly: [String: Int] = [:], weekly: [String: Int] = [:]
        var active: [String: Int] = [:], listed: [String: Int] = [:], unrated: [String: Int] = [:]
        for s in items {
            let c = s.currency.trimmingCharacters(in: .whitespaces).uppercased()
            listed[c, default: 0] += 1
            guard s.status == "active" else { continue }
            active[c, default: 0] += 1
            switch s.frequency {
            case "monthly": monthly[c, default: 0] += s.amountMinor
            case "weekly": weekly[c, default: 0] += s.amountMinor
            default: unrated[c, default: 0] += 1
            }
        }
        return listed.keys.sorted(by: FinanceMoney.currencyPrecedes).map { c in
            let annual = (weekly[c] ?? 0) * 52 + (monthly[c] ?? 0) * 12
            return RunRate(currency: c, monthlyMinor: perMonth(fromAnnual: annual),
                           active: active[c] ?? 0, listed: listed[c] ?? 0, unrated: unrated[c] ?? 0)
        }
    }

    /// A yearly amount ÷ 12, rounded half up (symmetric for negatives).
    static func perMonth(fromAnnual annual: Int) -> Int {
        annual >= 0 ? (annual + 6) / 12 : -((-annual + 6) / 12)
    }

    // Partners — the faithfulness summary of one member's register rows.

    struct Faithfulness: Equatable {
        struct Total: Equatable {
            let currency: String
            let pledgedMinor: Int
            let paidMinor: Int
            let remainingMinor: Int
            /// Σ min(paid, pledged) per row — pledged = toward + remaining.
            let towardMinor: Int
            /// Σ max(paid − pledged, 0) per row — paid = toward + beyond.
            let beyondMinor: Int
            let count: Int
        }
        /// behind · on_track · fulfilled · paused · none — behind when any pledge is.
        let standing: String
        /// Σ kept / Σ due over the monthly pledges (not cancelled).
        let kept: Int
        let due: Int
        let monthly: Int
        /// The earliest date any pledge (not cancelled) has been overdue since.
        let overdueSince: String?
        /// Per currency, KES first: pledged / paid / remaining in the year and how many pledges.
        let totals: [Total]
    }

    /// One member's pledge-register rows summed for the partner's
    /// faithfulness strip — counts and same-currency sums only; standing,
    /// kept, due and overdue dates are the server's, per pledge (web
    /// logic.ts faithfulnessSummary).
    static func faithfulness(_ rows: [FinPledgeRow]) -> Faithfulness {
        let live = rows.filter { $0.status != "cancelled" }
        let monthly = live.filter { $0.shape == "monthly" }
        let standing: String
        if live.contains(where: { $0.standing == "behind" }) { standing = "behind" }
        else if live.contains(where: { $0.standing == "on_track" }) { standing = "on_track" }
        else if !live.isEmpty && live.allSatisfy({ $0.standing == "fulfilled" }) { standing = "fulfilled" }
        else if !live.isEmpty { standing = "paused" }
        else { standing = "none" }
        let overdue = live.compactMap(\.overdueSince).filter { FinanceDates.date(fromYMD: $0) != nil }.sorted().first
        var by: [String: (pledged: Int, paid: Int, remaining: Int, toward: Int, beyond: Int, count: Int)] = [:]
        for r in rows {
            let c = r.currency.trimmingCharacters(in: .whitespaces).uppercased()
            var t = by[c] ?? (0, 0, 0, 0, 0, 0)
            t.pledged += r.pledgedYearMinor; t.paid += r.paidYearMinor; t.remaining += r.remainingYearMinor
            t.toward += min(r.paidYearMinor, r.pledgedYearMinor); t.beyond += max(r.paidYearMinor - r.pledgedYearMinor, 0)
            t.count += 1
            by[c] = t
        }
        return Faithfulness(standing: standing,
                            kept: monthly.reduce(0) { $0 + $1.kept },
                            due: monthly.reduce(0) { $0 + $1.dueCount },
                            monthly: monthly.count,
                            overdueSince: overdue,
                            totals: by.keys.sorted(by: FinanceMoney.currencyPrecedes).map { c in
                                let t = by[c] ?? (0, 0, 0, 0, 0, 0)
                                return .init(currency: c, pledgedMinor: t.pledged, paidMinor: t.paid, remainingMinor: t.remaining,
                                             towardMinor: t.toward, beyondMinor: t.beyond, count: t.count)
                            })
    }

    // Years.

    /// A year menu that also plans ahead: next year, this year and `back`
    /// years before, plus any years that already have data — newest first.
    static func planningYears(now: Date = Date(), back: Int = 4, extra: [Int] = []) -> [Int] {
        let y = FinanceDates.currentYear(now: now)
        return Array(Set([y + 1, y] + (0..<max(back, 0)).map { y - 1 - $0 } + extra)).sorted(by: >)
    }

    // Expenses — what a posting does to its fund.

    /// A fund's balance before and after an expense posting, in the expense's
    /// currency: approving takes the amount out, voiding an approved expense
    /// puts it back. Below zero is a warning, never a block (the money really
    /// left). Web parity: logic.ts fundImpact.
    struct FundImpact: Equatable {
        let before: Int
        let after: Int
        /// "General Fund balance: KES 120,000.00 → KES 105,000.00 after this."
        let sentence: String
        let warning: String?
    }

    static func fundImpact(fundName: String, currency: String, balanceMinor: Int, amountMinor: Int, approving: Bool) -> FundImpact {
        let after = approving ? balanceMinor - amountMinor : balanceMinor + amountMinor
        let sentence = "\(fundName) balance: \(FinanceMoney.format(balanceMinor, currency)) → \(FinanceMoney.format(after, currency)) after this."
        var warning: String? = nil
        if after < 0 {
            warning = approving
                ? "\(fundName) will be \(FinanceMoney.format(-after, currency)) overdrawn — approve only if the money has really left."
                : "\(fundName) will still be \(FinanceMoney.format(-after, currency)) overdrawn after this."
        }
        return FundImpact(before: balanceMinor, after: after, sentence: sentence, warning: warning)
    }

    // Budgets.

    /// The largest monthly amount a budget line takes (BooksBudgetLinesInput:
    /// 100,000,000,000 minor = KES 1,000,000,000.00).
    static let budgetMonthMaxMinor = 100_000_000_000

    /// An annual amount spread over the 12 months in whole minor units: equal
    /// shares, and the integer remainder of the division on December — so the
    /// months always add up to exactly the annual amount.
    static func spreadEvenly(_ annualMinor: Int) -> [Int] {
        guard annualMinor > 0 else { return Array(repeating: 0, count: 12) }
        let share = annualMinor / 12
        var months = Array(repeating: share, count: 12)
        months[11] += annualMinor % 12
        return months
    }

    /// One month cell of the budget editor, typed in MAJOR units (KES): blank
    /// is 0; digits with at most two decimals; 0 … 1,000,000,000.00.
    static func parseMonthCell(_ raw: String) -> Result<Int, FinBCellError> {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        s.removeAll { $0 == "," || $0 == " " || $0 == "\u{00A0}" || $0 == "_" }
        if s.isEmpty { return .success(0) }
        if s.hasPrefix("-") { return .failure(.negative) }
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2 else { return .failure(.invalid) }
        let whole = String(parts[0]), frac = parts.count == 2 ? String(parts[1]) : ""
        let digits: (String) -> Bool = { $0.allSatisfy { $0.isASCII && $0.isWholeNumber } }
        guard digits(whole), digits(frac), !(whole.isEmpty && frac.isEmpty) else { return .failure(.invalid) }
        guard frac.count <= 2 else { return .failure(.tooManyDecimals) }
        let significant = whole.drop { $0 == "0" }
        guard significant.count <= 13 else { return .failure(.tooLarge) }
        let minor = (Int(significant.isEmpty ? "0" : String(significant)) ?? 0) * 100
            + (Int(frac.padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0)
        return minor > budgetMonthMaxMinor ? .failure(.tooLarge) : .success(minor)
    }

    /// A line's months before they are sent: exactly 12, each 0 … the max.
    /// Nil when fine, else the sentence.
    static func twelveProblem(_ values: [Int]) -> String? {
        guard values.count == 12 else { return "A budget line needs exactly 12 monthly amounts (this one has \(values.count))." }
        if let i = values.firstIndex(where: { $0 < 0 }) { return "\(monthName(i)) is below zero — budget amounts are 0 or more." }
        if let i = values.firstIndex(where: { $0 > budgetMonthMaxMinor }) { return "\(monthName(i)) is more than KES 1,000,000,000.00." }
        return nil
    }

    /// What a budget line is keyed by, for the overlap rule.
    struct LineKey: Equatable {
        let kind: String            // income | expense
        let fund: String?
        let category: String?
    }

    /// The server's no-overlap rule (PUT /budgets/{id}/lines), checked before
    /// saving so the office reads a sentence instead of a 400: one income line
    /// per fund; per expense category either ONE church-wide line (no fund) or
    /// lines for distinct funds — never both, never the same fund twice.
    static func overlapProblem(_ lines: [LineKey], fundName: (String) -> String, categoryName: (String) -> String) -> String? {
        var incomeFunds = Set<String>()
        var churchWide = Set<String>()                 // expense categories with a no-fund line
        var perFund: [String: Set<String>] = [:]       // category → funds with their own line
        for l in lines {
            if l.kind == "income" {
                guard let f = l.fund, !f.isEmpty else { continue }
                if !incomeFunds.insert(f).inserted { return "\(fundName(f)) has two income lines — keep one income line per fund." }
            } else {
                guard let c = l.category, !c.isEmpty else { continue }
                if let f = l.fund, !f.isEmpty {
                    if churchWide.contains(c) { return "\(categoryName(c)) has a church-wide line AND a line for \(fundName(f)) — use one or the other." }
                    if !perFund[c, default: []].insert(f).inserted { return "\(categoryName(c)) has two lines for \(fundName(f))." }
                } else {
                    if !churchWide.insert(c).inserted { return "\(categoryName(c)) has two church-wide lines." }
                    if !(perFund[c]?.isEmpty ?? true) { return "\(categoryName(c)) has a church-wide line AND per-fund lines — use one or the other." }
                }
            }
        }
        return nil
    }

    /// How many months of `year` are "year to date" on `now` (EAT): all 12 for
    /// a past year, none for a future one, else January through this month.
    static func ytdMonths(year: Int, now: Date = Date()) -> Int {
        let current = FinanceDates.currentYear(now: now)
        if year < current { return 12 }
        if year > current { return 0 }
        return FinanceDates.calendar.component(.month, from: now)
    }

    /// Σ of the first `n` values (clamped to the array).
    static func sumPrefix(_ values: [Int], _ n: Int) -> Int {
        values.prefix(max(0, min(n, values.count))).reduce(0, +)
    }

    /// Net actual over the first `months` months: ALL KES money in less ALL KES
    /// money out — the budgeted lines' actuals PLUS the unbudgeted money of each
    /// kind (web cycle 1: counting budgeted lines only understated the surplus).
    static func netActual(incomeActual: [Int], incomeUnbudgeted: [Int],
                          expenseActual: [Int], expenseUnbudgeted: [Int], months: Int) -> Int {
        (sumPrefix(incomeActual, months) + sumPrefix(incomeUnbudgeted, months))
            - (sumPrefix(expenseActual, months) + sumPrefix(expenseUnbudgeted, months))
    }

    /// floor(part × 100 ÷ whole), 0 when there is no whole — may exceed 100.
    static func percent(_ part: Int, of whole: Int) -> Int {
        whole > 0 ? max(part, 0) * 100 / whole : 0
    }
}

// MARK: - Maker-checker (spec §2): who may approve an expense

enum FinBMakerChecker {
    enum State: Equatable {
        /// Show Approve.
        case approve
        /// This person recorded it (not a SuperAdmin) — no Approve, the sentence instead.
        case recordedByMe
        /// This person edited it while recorded (not a SuperAdmin) — likewise.
        case editedByMe
        /// No finance:approve (or /me still loading) — no Approve at all.
        case noCapability
        /// Approved or void — nothing left to approve.
        case notRecorded

        /// The sentence shown in place of Approve, if any.
        var sentence: String? {
            switch self {
            case .recordedByMe: "You recorded this expense, so another person must approve it."
            case .editedByMe: "You edited this expense, so another person must approve it."
            default: nil
            }
        }
    }

    /// What a 403 SAME_PERSON from the server becomes (web SAME_PERSON_SENTENCE).
    static let sentence = "Another person must approve this expense — whoever recorded or edited it cannot approve it."

    /// `editors`: everyone who edited it while it was recorded (the audit's
    /// expense.updated rows, plus this person after a save here) — the server
    /// counts each as a maker. Unknown "me" → Approve shows and the server's
    /// SAME_PERSON answer maps to `sentence` (web approveGate).
    static func state(caps: FinanceCaps, status: String, recordedBy: String?, editors: Set<String>) -> State {
        guard status == "recorded" else { return .notRecorded }
        guard caps.approve else { return .noCapability }
        guard !caps.isSuperAdmin, let me = caps.userId else { return .approve }
        if recordedBy == me { return .recordedByMe }
        if editors.contains(me) { return .editedByMe }
        return .approve
    }
}

// MARK: - Errors → sentences

enum FinBError {
    /// The sentence for a failed call: SAME_PERSON reads as the maker-checker
    /// sentence; otherwise the server's own message (else `fallback`).
    static func message(_ error: Error, fallback: String) -> String {
        if error.apiCode == "SAME_PERSON" { return FinBMakerChecker.sentence }
        if let api = error as? APIError, let text = api.errorDescription, !text.isEmpty { return text }
        return fallback
    }
}

// MARK: - Page models that own a FinancePager

extension ObservableObject where ObjectWillChangePublisher == ObservableObjectPublisher {
    /// Re-publish a child object's changes as this one's, so a page that reads
    /// `vm.pager.totals` redraws when the pager lands (SwiftUI observes only
    /// the object it holds). Keep the returned token for the model's lifetime.
    func finbRelay<Child: ObservableObject>(_ child: Child) -> AnyCancellable
        where Child.ObjectWillChangePublisher == ObservableObjectPublisher {
        child.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }
}

// MARK: - Funds + expense categories (loaded once per page)

@MainActor
final class FinBLookups: ObservableObject {
    @Published private(set) var funds: [FundOption] = []
    @Published private(set) var categories: [FinExpenseCategory] = []
    @Published private(set) var fundsError: String?
    @Published private(set) var categoriesError: String?
    private var fundsLoaded = false
    private var categoriesLoaded = false

    /// GET /admin/finance/config → every fund, active or not (finance:view).
    func loadFunds(force: Bool = false) async {
        guard force || !fundsLoaded else { return }
        do {
            funds = try await FinanceERPAPI.config().funds
            fundsLoaded = true
            fundsError = nil
        } catch {
            fundsError = FinBError.message(error, fallback: "Could not load the funds.")
        }
    }

    /// GET /admin/finance/expense-categories (finance:view).
    func loadCategories(force: Bool = false) async {
        guard force || !categoriesLoaded else { return }
        do {
            categories = try await FinanceERPAPI.expenseCategories()
            categoriesLoaded = true
            categoriesError = nil
        } catch {
            categoriesError = FinBError.message(error, fallback: "Could not load the expense categories.")
        }
    }

    var activeFunds: [FundOption] { funds.filter(\.isActive).sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending } }
    var activeCategories: [FinExpenseCategory] {
        categories.filter(\.isActive).sorted { ($0.sort, $0.name) < ($1.sort, $1.name) }
    }

    func fundName(_ code: String?) -> String {
        guard let code, !code.isEmpty else { return "—" }
        return funds.first { $0.code == code }?.name ?? code
    }
    func categoryName(_ code: String?) -> String {
        guard let code, !code.isEmpty else { return "—" }
        return categories.first { $0.code == code }?.name ?? code
    }

    /// Filter options: "All funds" then every fund by name (inactive ones marked).
    func fundFilterOptions() -> [FinanceFilterOption] {
        [.all("All funds")] + funds.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            .map { FinanceFilterOption($0.code, $0.isActive ? $0.name : "\($0.name) (inactive)") }
    }
    func categoryFilterOptions() -> [FinanceFilterOption] {
        [.all("All categories")] + categories.sorted { ($0.sort, $0.name) < ($1.sort, $1.name) }
            .map { FinanceFilterOption($0.code, $0.isActive ? $0.name : "\($0.name) (inactive)") }
    }
}

// MARK: - Download (PDF / CSV) → share sheet, with a 404 sentence

/// A download chip like FinanceExportButton, with one difference: a 404 reads
/// as `notFound` ("No partner statement for 2026") instead of the server's
/// generic message. Hidden unless `caps[keyPath: gate]` — the statement PDFs
/// are reads (finance:view), CSVs need finance:export.
struct FinBDownloadButton: View {
    let caps: FinanceCaps
    let path: String
    var query: [String: String] = [:]
    let title: String
    var icon: String = "doc.richtext"
    var gate: KeyPath<FinanceCaps, Bool> = \.view
    var notFound: String? = nil
    /// A smaller chip for table rows.
    var compact = false

    @State private var busy = false
    @State private var error: String?
    @State private var anchor = FinanceShareAnchor()

    var body: some View {
        if caps[keyPath: gate] {
            VStack(alignment: .leading, spacing: 4) {
                Button(action: run) { face }
                    .buttonStyle(PressableButtonStyle())
                    .hoverEffect(.lift)
                    .disabled(busy)
                    .background(FinanceShareAnchorView(anchor: anchor))
                    .accessibilityLabel(title)
                    .accessibilityHint("Downloads the file and opens the share sheet")
                if let error {
                    Button { self.error = nil } label: {
                        Text(error).font(.nMicro).foregroundStyle(FinanceStatus.rose.fg)
                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Dismiss")
                }
            }
        }
    }

    private var face: some View {
        HStack(spacing: 5) {
            if busy { ProgressView().controlSize(.small).tint(Nuru.navy) }
            else { Image(systemName: icon).font(.system(size: compact ? 10 : 11, weight: .semibold)) }
            Text(busy ? "Preparing…" : title).font(.inter(compact ? 11.5 : 12.5, .semibold)).lineLimit(1)
        }
        .foregroundStyle(Nuru.navy)
        .padding(.horizontal, compact ? 9 : 12).frame(height: compact ? 28 : 34)
        .background(Nuru.white)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
    }

    private func run() {
        guard !busy else { return }
        busy = true
        error = nil
        Task { @MainActor in
            defer { busy = false }
            do {
                let url = try await FinanceERPAPI.download(path: path, query: query)
                if !FinanceShare.present(url, from: anchor) {
                    error = "Downloaded, but the share sheet could not open — try again."
                }
            } catch {
                if error.apiStatus == 404, let notFound { self.error = notFound }
                else { self.error = FinBError.message(error, fallback: "Could not download the file.") }
            }
        }
    }
}

// MARK: - Filters the kit's bar does not have

/// A period chip that can also be "All dates" (nil) — for registers where a
/// deep link must show everything (Expenses awaiting approval).
struct FinBPeriodMenu: View {
    @Binding var period: FinancePeriod?
    var allLabel = "All dates"
    @State private var showCustom = false

    var body: some View {
        Menu {
            Button { period = nil } label: { check(allLabel, period == nil) }
            ForEach(FinancePeriodPreset.allCases) { p in
                Button {
                    if p == .custom { showCustom = true } else { period = .preset(p) }
                } label: { check(p.label, period?.preset == p) }
            }
        } label: {
            FinanceChipLabel(icon: "calendar", title: "Period", value: period?.label ?? allLabel, active: period != nil)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("Period")
        .accessibilityValue(period?.label ?? allLabel)
        .sheet(isPresented: $showCustom) {
            FinanceCustomRangeSheet(initial: period ?? .thisMonth) { period = $0 }
        }
    }

    @ViewBuilder private func check(_ text: String, _ on: Bool) -> some View {
        if on { Label(text, systemImage: "checkmark") } else { Text(text) }
    }
}

/// A multi-select filter chip; `selection` is the comma list the API takes, in
/// `options` order ("" = all).
struct FinBMultiMenu: View {
    let title: String
    let options: [FinanceFilterOption]
    @Binding var selection: String
    var icon: String? = nil

    private var chosen: Set<String> { Set(selection.split(separator: ",").map(String.init)) }

    var body: some View {
        Menu {
            Button { selection = "" } label: { check("All", chosen.isEmpty) }
            ForEach(options) { o in
                Button { toggle(o.value) } label: { check(o.label, chosen.contains(o.value)) }
            }
        } label: {
            FinanceChipLabel(icon: icon, title: title, value: summary, active: !chosen.isEmpty)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("\(title) filter")
        .accessibilityValue(summary)
    }

    private var summary: String {
        let labels = options.filter { chosen.contains($0.value) }.map(\.label)
        return labels.isEmpty ? "All" : labels.joined(separator: " + ")
    }

    private func toggle(_ value: String) {
        var set = chosen
        if set.contains(value) { set.remove(value) } else { set.insert(value) }
        let ordered = options.map(\.value).filter(set.contains)
        selection = ordered.count == options.count ? "" : ordered.joined(separator: ",")
    }

    @ViewBuilder private func check(_ text: String, _ on: Bool) -> some View {
        if on { Label(text, systemImage: "checkmark") } else { Text(text) }
    }
}

/// Small segmented chips ("By fund · channel · source"): navy when chosen.
struct FinBChoiceChips: View {
    let options: [FinanceFilterOption]
    @Binding var selection: String
    var body: some View {
        HStack(spacing: 6) {
            ForEach(options) { o in
                let on = selection == o.value
                Button { selection = o.value } label: {
                    Text(o.label).font(.inter(12.5, .semibold))
                        .padding(.horizontal, 12).frame(height: 32)
                        .foregroundStyle(on ? .white : Nuru.navy)
                        .background(on ? Nuru.navy : Nuru.white)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(on ? Nuru.navy : Nuru.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

// MARK: - Display

/// A white card with a small header (overline title, caption, trailing slot).
struct FinBCard<Trailing: View, Content: View>: View {
    let title: String
    var caption: String? = nil
    var icon: String? = nil
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let icon {
                    Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.goldLo)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(title.uppercased()).font(.nOverline).tracking(1.1).foregroundStyle(Nuru.ink600)
                    if let caption {
                        Text(caption).font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                trailing
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}
extension FinBCard where Trailing == EmptyView {
    init(title: String, caption: String? = nil, icon: String? = nil, @ViewBuilder content: () -> Content) {
        self.init(title: title, caption: caption, icon: icon, trailing: { EmptyView() }, content: content)
    }
}

/// "KES 45,000.00 of KES 100,000.00 · 45%" over a bar. The percent is
/// floor(raised × 100 ÷ target) and may pass 100; the bar stops at full.
struct FinBProgress: View {
    let raised: Int
    let target: Int
    let currency: String
    var fill: Color = Nuru.lumGreen
    var compact = false

    var body: some View {
        let pct = FinBMath.percent(raised, of: target)
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(FinanceMoney.format(raised, currency)).font(.inter(compact ? 12 : 12.5, .semibold)).foregroundStyle(Nuru.navy)
                    .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                Text("of \(FinanceMoney.format(target, currency))").font(.inter(compact ? 11 : 11.5)).foregroundStyle(Nuru.ink600)
                    .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                Text(target > 0 ? "\(pct)%" : "—").font(.nMono(11)).foregroundStyle(pct >= 100 ? Nuru.success : Nuru.ink600)
            }
            ProgressBar(pct: Double(min(pct, 100)), fill: pct >= 100 ? Nuru.success : fill, height: compact ? 5 : 7)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(FinanceMoney.format(raised, currency)) of \(FinanceMoney.format(target, currency)), \(pct) percent")
    }
}

/// An amount in the Finance style: exact, with its currency, tabular digits.
struct FinBAmount: View {
    let minor: Int
    let currency: String
    var size: CGFloat = 13
    var weight: Font.Weight = .semibold
    var color: Color = Nuru.navy
    var body: some View {
        Text(FinanceMoney.format(minor, currency))
            .font(.inter(size, weight)).monospacedDigit()
            .foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.75)
    }
}

/// A two-line table cell: a bold first line and a quiet second line.
struct FinBPersonCell: View {
    let title: String
    var subtitle: String? = nil
    var subtitleColor: Color = Nuru.ink600
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.isEmpty ? "—" : title).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle).font(.nMicro).foregroundStyle(subtitleColor).lineLimit(1)
            }
        }
    }
}

/// A label over a value, on an inset tile (detail sheets).
struct FinBKeyValue<Value: View>: View {
    let label: String
    @ViewBuilder var value: Value
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased()).font(.inter(10.5, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                .lineLimit(1).minimumScaleFactor(0.8)
            value
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
    }
}
extension FinBKeyValue where Value == Text {
    init(_ label: String, _ text: String, mono: Bool = false) {
        self.label = label
        self.value = Text(text.isEmpty ? "—" : text)
            .font(mono ? .nMono(12.5) : .inter(13, .medium))
            .foregroundColor(Nuru.navy)
    }
}

/// Per-currency totals with several named figures ("Pledged · Paid ·
/// Remaining"), one row per currency, KES first — never added across currencies.
struct FinBCurrencyFigures: View {
    struct Figure: Hashable { let label: String; let minor: Int; var tint: Color? = nil }
    struct Row: Identifiable, Hashable {
        let currency: String
        let figures: [Figure]
        var count: Int? = nil
        /// A quiet trailing remark for this currency ("of 14 listed").
        var note: String? = nil
        var id: String { currency }
    }
    let title: String
    let rows: [Row]
    var noun: (one: String, many: String) = ("record", "records")
    var caption: String? = nil
    var loading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title.uppercased()).font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                Spacer(minLength: 8)
                if let caption { Text(caption).font(.nMicro).foregroundStyle(Nuru.ink400).multilineTextAlignment(.trailing) }
            }
            if loading && rows.isEmpty {
                Skeleton(height: 14, width: 260)
            } else if rows.isEmpty {
                Text("No matching \(noun.many)").font(.nCaption).foregroundStyle(Nuru.ink400)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(rows.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }) { r in
                        FinanceFlowLayout(spacing: 18, rowSpacing: 4) {
                            HStack(spacing: 7) {
                                Text(r.currency).font(.inter(11, .bold)).foregroundStyle(Nuru.goldLo)
                                    .padding(.horizontal, 7).padding(.vertical, 2)
                                    .background(Nuru.goldChipBg).clipShape(Capsule())
                                if let n = r.count {
                                    Text("\(n) \(n == 1 ? noun.one : noun.many)").font(.nCaption).foregroundStyle(Nuru.ink600)
                                }
                                if let note = r.note {
                                    Text(note).font(.nCaption).foregroundStyle(Nuru.ink400)
                                }
                            }
                            .fixedSize()
                            ForEach(r.figures, id: \.self) { f in
                                HStack(alignment: .firstTextBaseline, spacing: 5) {
                                    Text(f.label).font(.nCaption).foregroundStyle(Nuru.ink600)
                                    Text(FinanceMoney.format(f.minor, "")).font(.inter(14.5, .semibold))
                                        .foregroundStyle(f.tint ?? Nuru.navy).monospacedDigit()
                                }
                                .fixedSize()
                            }
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .opacity(loading && !rows.isEmpty ? 0.55 : 1)
        .accessibilityElement(children: .combine)
    }
}

/// A quiet explanatory line under a heading ("How these numbers are made").
struct FinBExplain: View {
    let text: String
    var icon = "info.circle"
    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.ink400).padding(.top, 2)
            Text(text).font(.nMicro).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Writes

/// Confirm a money write: the consequence in plain words first (plus any
/// `extra` view — e.g. a fund's balance before → after), then the button.
/// Stays open with the error inline on failure; dismisses on success.
struct FinBConfirmSheet<Extra: View>: View {
    let title: String
    /// The first line is the headline ("Posts KES 12,000.00 out of Tithe via Bank on 3 Sep 2026.").
    let consequence: [String]
    let confirmLabel: String
    let destructive: Bool
    let onConfirm: () async throws -> Void
    let errorText: (Error) -> String
    let extra: Extra

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?

    init(title: String, consequence: [String], confirmLabel: String, destructive: Bool = false,
         onConfirm: @escaping () async throws -> Void,
         errorText: @escaping (Error) -> String = { FinBError.message($0, fallback: "That did not go through — try again.") },
         @ViewBuilder extra: () -> Extra) {
        self.title = title
        self.consequence = consequence
        self.confirmLabel = confirmLabel
        self.destructive = destructive
        self.onConfirm = onConfirm
        self.errorText = errorText
        self.extra = extra()
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(consequence.enumerated()), id: \.offset) { i, line in
                    Text(line)
                        .font(i == 0 ? .inter(15.5, .semibold) : .nBody)
                        .foregroundStyle(i == 0 ? Nuru.navy : Nuru.ink600)
                        .fixedSize(horizontal: false, vertical: true)
                }
                extra
                if let error { FinanceNoticeBar(notice: .error(error)) }
                Spacer(minLength: 0)
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    FinanceButton(title: "Cancel") { dismiss() }
                        .disabled(busy)
                    FinanceButton(title: confirmLabel, icon: destructive ? "exclamationmark.triangle" : "checkmark",
                                  style: destructive ? .danger : .primary, busy: busy) { submit() }
                }
            }
            .padding(24)
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Nuru.paper)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy)
    }

    private func submit() {
        guard !busy else { return }
        busy = true
        error = nil
        Task { @MainActor in
            do {
                try await onConfirm()
                busy = false
                dismiss()
            } catch {
                busy = false
                self.error = errorText(error)
            }
        }
    }
}

extension FinBConfirmSheet where Extra == EmptyView {
    init(title: String, consequence: [String], confirmLabel: String, destructive: Bool = false,
         onConfirm: @escaping () async throws -> Void,
         errorText: @escaping (Error) -> String = { FinBError.message($0, fallback: "That did not go through — try again.") }) {
        self.init(title: title, consequence: consequence, confirmLabel: confirmLabel, destructive: destructive,
                  onConfirm: onConfirm, errorText: errorText, extra: { EmptyView() })
    }
}

/// The frame of every add/edit sheet (UI_DENSITY_SPEC v6): warm paper, a
/// centred column ≤ 780 pt, Cancel + a gold Save in the bar, the error inline.
struct FinBFormSheet<Content: View>: View {
    let title: String
    let confirmLabel: String
    let canConfirm: Bool
    let busy: Bool
    var error: String? = nil
    let onConfirm: () -> Void
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let error { FinanceNoticeBar(notice: .error(error)) }
                    content
                }
                .frame(maxWidth: 780)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24).padding(.vertical, 20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Nuru.paper)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.tint(Nuru.ink600).disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: onConfirm) {
                        if busy { ProgressView() } else { Text(confirmLabel).font(.inter(14.5, .bold)) }
                    }
                    .tint(Nuru.goldLo)
                    .disabled(!canConfirm || busy)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(busy)
    }
}

/// A form field: overline label, the control, then a hint or the error.
struct FinBField<Content: View>: View {
    let label: String
    var hint: String? = nil
    var error: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.inter(12, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
            content
            if let error, !error.isEmpty {
                Text(error).font(.nCaption).foregroundStyle(Nuru.danger).fixedSize(horizontal: false, vertical: true)
            } else if let hint, !hint.isEmpty {
                Text(hint).font(.nCaption).foregroundStyle(Nuru.ink400).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FinBInputStyle: ViewModifier {
    var invalid = false
    func body(content: Content) -> some View {
        content
            .font(.nBody).foregroundStyle(Nuru.ink)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(minHeight: 44)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous)
                .stroke(invalid ? Nuru.danger : Nuru.border, lineWidth: 1))
    }
}

extension View {
    /// The white, bordered input look of the Finance forms.
    func finbInput(invalid: Bool = false) -> some View { modifier(FinBInputStyle(invalid: invalid)) }
}

/// A menu picker styled as a form input ("Fund ▾").
struct FinBPickerField: View {
    let placeholder: String
    @Binding var selection: String
    let options: [FinanceFilterOption]
    var invalid = false
    var body: some View {
        Menu {
            Picker(placeholder, selection: $selection) {
                ForEach(options) { o in Text(o.label).tag(o.value) }
            }
        } label: {
            HStack {
                Text(options.first { $0.value == selection }?.label ?? placeholder)
                    .foregroundStyle(selection.isEmpty ? Nuru.ink400 : Nuru.ink)
                    .lineLimit(1)
                Spacer(minLength: 6)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.ink400)
            }
            .finbInput(invalid: invalid)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .accessibilityLabel(placeholder)
        .accessibilityValue(options.first { $0.value == selection }?.label ?? "Not chosen")
    }
}

/// An EAT calendar-day picker bound to a "YYYY-MM-DD" string, within bounds.
struct FinBDayPicker: View {
    let label: String
    @Binding var ymd: String
    var earliest: String? = nil
    var latest: String? = nil

    var body: some View {
        let binding = Binding<Date>(
            get: { FinanceDates.date(fromYMD: ymd) ?? FinanceDates.date(fromYMD: FinanceDates.today()) ?? Date() },
            set: { ymd = FinanceDates.ymd($0) })
        let lo = earliest.flatMap(FinanceDates.date(fromYMD:)) ?? Date.distantPast
        let hi = latest.flatMap(FinanceDates.date(fromYMD:)) ?? Date.distantFuture
        DatePicker(label, selection: binding, in: lo...max(lo, hi), displayedComponents: .date)
            .labelsHidden()
            .environment(\.timeZone, FinanceDates.timeZone)
            .environment(\.calendar, FinanceDates.calendar)
            .accessibilityLabel(label)
    }
}

extension FinanceDates {
    /// "YYYY-MM-DD" `days` before (negative) or after today, in EAT.
    static func todayOffset(_ days: Int, now: Date = Date()) -> String {
        let noon = date(fromYMD: today(now: now)) ?? now
        return ymd(calendar.date(byAdding: .day, value: days, to: noon) ?? noon)
    }
}

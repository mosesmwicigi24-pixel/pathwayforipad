// Finance ERP — the shared kit every Finance page is built from (pathway
// docs/FINANCE_ERP.md §1, §4–§6; the iPad twin of admin-web's Finance pages).
//
// House rules the kit enforces so no page has to remember them:
//   • Money is integer minor units + an ISO currency. It is formatted with exact
//     integer math ("KES 1,234.50") and NEVER summed across currencies — every
//     per-currency figure is shown per currency (KES first, then A–Z).
//   • Dates are calendar days in East Africa Time (Africa/Nairobi), sent to the
//     server as inclusive "YYYY-MM-DD" from/to pairs.
//   • Write actions hide behind FinanceCaps, which fails CLOSED while /me loads
//     (reads stay open — the sidebar already shows the page; the server
//     enforces every permission regardless).
//
// Index (one line each):
//   FinanceMoney · FinanceMoneyError        exact formatting · major→minor parsing
//   FinanceDates · FinancePeriod(Preset)     EAT days · This month … Custom presets
//   FinanceCaps                              finance:{view,export,manage,approve}
//   FinanceStatus · FinanceStatusChip        the shared status vocabulary + colors
//   FinanceLink · .onFinanceLink(_:perform:) NavRouter deep links into a page
//   FinancePageScaffold · FinancePageHeader  page chrome (navy hero, "Finance ›" crumb)
//   FinanceKpiTile · FinanceKpiGrid          compact per-currency KPI tiles
//   FinanceTotalsStrip                       per-currency totals of a filtered set
//   FinanceFilterBar · FinanceFilterMenu · FinanceYearMenu · FinanceFilterOption
//   FinancePager · FinancePagedTable · FinanceTable · FinanceColumn · .financeCell
//   FinanceTabs                              gold-underline segmented tabs
//   FinanceReasonSheet                       confirm-with-reason (min/max + counter)
//   FinanceExportButton                      CSV/PDF download → share sheet
//   FinanceMoneyField                        validated amount input
//   FinanceButton · FinanceNoticeBar · FinanceFlowLayout · FinanceStubNote
import SwiftUI
import UIKit

// MARK: - Money

/// Why an amount the office typed was refused (FinanceMoney.parseMajor).
enum FinanceMoneyError: Error, Equatable {
    case empty, invalid, tooManyDecimals, notPositive, tooLarge

    var message: String {
        switch self {
        case .empty: "Enter an amount."
        case .invalid: "Enter a number such as 1500 or 1,500.50."
        case .tooManyDecimals: "Use at most two decimal places."
        case .notPositive: "The amount must be more than zero."
        case .tooLarge: "That is more than \(FinanceMoney.format(FinanceMoney.maxMinor, "")) — check the amount."
        }
    }
}

enum FinanceMoney {
    /// The largest single amount the books accept (spec §4: amount_minor ≤
    /// 1,000,000,000 minor = 10,000,000.00). Every currency here has two
    /// minor digits — the server's CSV (`minorToMajor`) assumes the same.
    static let maxMinor = 1_000_000_000
    /// The church's home currency: listed first wherever currencies are listed.
    static let homeCurrency = "KES"

    /// "KES 1,234.50", "-KES 12.00", "USD 0.05" — exact integer math, a comma
    /// every three digits, always two decimals. An empty currency drops the code.
    static func format(_ minor: Int, _ currency: String) -> String {
        let code = currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let magnitude = minor.magnitude                  // UInt — safe even for Int.min
        let body = grouped(magnitude / 100) + "." + twoDigits(magnitude % 100)
        return (minor < 0 ? "-" : "") + (code.isEmpty ? body : "\(code) \(body)")
    }

    /// Major units without code or grouping, for pre-filling an input:
    /// 123450 → "1234.50" (and back through `parseMajor`).
    static func majorString(_ minor: Int) -> String {
        let m = minor.magnitude
        return (minor < 0 ? "-" : "") + "\(m / 100).\(twoDigits(m % 100))"
    }

    /// Chart-axis shorthand in major units: 1,234,500 minor → "12.3K". NOT exact —
    /// for axes and sparklines only; every figure a person reads uses `format`.
    static func compact(_ minor: Int) -> String {
        let major = minor / 100
        let sign = major < 0 ? "-" : ""
        let m = major.magnitude
        func scaled(_ unit: UInt, _ suffix: String) -> String {
            let tenths = m * 10 / unit
            let whole = tenths / 10, frac = tenths % 10
            return sign + (frac == 0 || whole >= 100 ? "\(whole)" : "\(whole).\(frac)") + suffix
        }
        if m >= 1_000_000_000 { return scaled(1_000_000_000, "B") }
        if m >= 1_000_000 { return scaled(1_000_000, "M") }
        if m >= 1_000 { return scaled(1_000, "K") }
        return sign + "\(m)"
    }

    /// Currency display order: KES first, then A–Z.
    static func currencyPrecedes(_ a: String, _ b: String) -> Bool {
        if a == b { return false }
        if a == homeCurrency { return true }
        if b == homeCurrency { return false }
        return a < b
    }

    /// One formatted line per currency, KES first — for KPI tiles and strips.
    /// Never adds currencies together; pass each currency's own figure.
    static func lines(_ amounts: [(currency: String, minor: Int)]) -> [String] {
        amounts.sorted { currencyPrecedes($0.currency, $1.currency) }.map { format($0.minor, $0.currency) }
    }

    /// Parse what a person typed in MAJOR units into minor units: "1,500.50" →
    /// 150050. Grouping commas and spaces are ignored; at most two decimals;
    /// must be > 0 and ≤ `maxMinor`. ASCII digits only.
    static func parseMajor(_ raw: String) -> Result<Int, FinanceMoneyError> {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        s.removeAll { $0 == "," || $0 == " " || $0 == "\u{00A0}" || $0 == "_" }
        guard !s.isEmpty else { return .failure(.empty) }
        if s.hasPrefix("-") {
            // A negative number is still a number — say what is wrong with it.
            if case .success = parseMajor(String(s.dropFirst())) { return .failure(.notPositive) }
            return .failure(.invalid)
        }
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2 else { return .failure(.invalid) }
        let whole = String(parts[0])
        let frac = parts.count == 2 ? String(parts[1]) : ""
        guard whole.allSatisfy(isDigit), frac.allSatisfy(isDigit), !(whole.isEmpty && frac.isEmpty) else {
            return .failure(.invalid)
        }
        guard frac.count <= 2 else { return .failure(.tooManyDecimals) }
        let significant = whole.drop { $0 == "0" }
        guard significant.count <= 12 else { return .failure(.tooLarge) }   // far from Int overflow
        let wholeValue = Int(significant.isEmpty ? "0" : String(significant)) ?? 0
        let fracValue = Int(frac.padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0
        let minor = wholeValue * 100 + fracValue
        if minor <= 0 { return .failure(.notPositive) }
        if minor > maxMinor { return .failure(.tooLarge) }
        return .success(minor)
    }

    private static func isDigit(_ c: Character) -> Bool { c.isASCII && c.isWholeNumber }

    private static func grouped(_ n: UInt) -> String {
        let digits = String(n)
        var out = ""
        out.reserveCapacity(digits.count + digits.count / 3)
        for (i, ch) in digits.enumerated() {
            if i > 0 && (digits.count - i) % 3 == 0 { out.append(",") }
            out.append(ch)
        }
        return out
    }

    private static func twoDigits(_ n: UInt) -> String { n < 10 ? "0\(n)" : "\(n)" }
}

// MARK: - Dates (EAT calendar days)

enum FinanceDates {
    /// The church's calendar: every Finance date is a day in Africa/Nairobi.
    static let timeZone: TimeZone = TimeZone(identifier: "Africa/Nairobi") ?? TimeZone(secondsFromGMT: 3 * 3600) ?? .current

    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        c.locale = Locale(identifier: "en_US_POSIX")
        return c
    }()

    private static let ymdFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = calendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "yyyy-MM-dd"
        f.isLenient = false
        return f
    }()

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = calendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "d MMM yyyy"
        return f
    }()

    /// The EAT calendar day of an instant, "YYYY-MM-DD".
    static func ymd(_ date: Date) -> String { ymdFormatter.string(from: date) }

    /// "YYYY-MM-DD" → 12:00 EAT that day (noon keeps the day stable in any zone);
    /// nil for anything that is not a real calendar date ("2026-02-30").
    static func date(fromYMD s: String) -> Date? {
        guard s.count == 10, let midnight = ymdFormatter.date(from: s), ymd(midnight) == s else { return nil }
        return calendar.date(byAdding: .hour, value: 12, to: midnight)
    }

    /// Today in EAT, "YYYY-MM-DD".
    static func today(now: Date = Date()) -> String { ymd(now) }

    /// The EAT year of `now`.
    static func currentYear(now: Date = Date()) -> Int { calendar.component(.year, from: now) }

    /// "26 Sep 2026" for a "YYYY-MM-DD" (or the date part of an ISO stamp), or "—".
    static func display(_ ymd: String?) -> String {
        guard let ymd, ymd.count >= 10, let d = date(fromYMD: String(ymd.prefix(10))) else { return "—" }
        return dayFormatter.string(from: d)
    }

    /// "26 Sep 2026", "1 Sep – 26 Sep 2026", "30 Aug – 5 Sep 2026", "15 Dec 2025 – 3 Jan 2026" (web fmtRange).
    static func displayRange(from: String, to: String) -> String {
        guard let a = date(fromYMD: from), let b = date(fromYMD: to) else { return "\(from) – \(to)" }
        let ca = calendar.dateComponents([.year, .month, .day], from: a)
        let cb = calendar.dateComponents([.year, .month, .day], from: b)
        let right = dayFormatter.string(from: b)
        // Web fmtRange parity: one day reads "26 Sep 2026"; a range inside one
        // year reads "1 Sep – 26 Sep 2026" (never "1 – 26 Sep 2026").
        if from == to { return right }
        if ca.year == cb.year {
            let f = DateFormatter()
            f.calendar = calendar; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = timeZone
            f.dateFormat = "d MMM"
            return "\(f.string(from: a)) – \(right)"
        }
        return "\(dayFormatter.string(from: a)) – \(right)"
    }
}

/// The period presets every date filter offers (web parity). Period-to-date
/// presets end TODAY, so "same period last year" comparisons stay fair.
enum FinancePeriodPreset: String, CaseIterable, Identifiable {
    case thisMonth, lastMonth, thisQuarter, thisYear, last12Months, custom
    var id: String { rawValue }
    var label: String {
        switch self {
        case .thisMonth: "This month"
        case .lastMonth: "Last month"
        case .thisQuarter: "This quarter"
        case .thisYear: "This year"
        case .last12Months: "Last 12 months"
        case .custom: "Custom…"
        }
    }
}

/// An inclusive EAT date range: `from`/`to` are "YYYY-MM-DD" — exactly the
/// `from`/`to` query parameters of every Finance read (spec §4).
struct FinancePeriod: Equatable, Hashable {
    let preset: FinancePeriodPreset
    let from: String
    let to: String

    /// A preset's range as of `now` (EAT). `.custom` falls back to this month.
    ///   This month:    1st of this month → today
    ///   Last month:    1st → last day of last month
    ///   This quarter:  1st of the quarter → today
    ///   This year:     1 January → today
    ///   Last 12 months: today − 12 months + 1 day → today
    static func preset(_ p: FinancePeriodPreset, now: Date = Date()) -> FinancePeriod {
        let cal = FinanceDates.calendar
        let today = cal.startOfDay(for: now)
        let ym = cal.dateComponents([.year, .month], from: today)
        let year = ym.year ?? 2000, month = ym.month ?? 1
        let monthStart = cal.date(from: DateComponents(year: year, month: month, day: 1)) ?? today
        var start = monthStart, end = today
        switch p {
        case .thisMonth, .custom:
            break
        case .lastMonth:
            start = cal.date(byAdding: .month, value: -1, to: monthStart) ?? monthStart
            end = cal.date(byAdding: .day, value: -1, to: monthStart) ?? monthStart
        case .thisQuarter:
            let quarterMonth = ((month - 1) / 3) * 3 + 1
            start = cal.date(from: DateComponents(year: year, month: quarterMonth, day: 1)) ?? monthStart
        case .thisYear:
            start = cal.date(from: DateComponents(year: year, month: 1, day: 1)) ?? monthStart
        case .last12Months:
            let yearAgo = cal.date(byAdding: .year, value: -1, to: today) ?? today
            start = cal.date(byAdding: .day, value: 1, to: yearAgo) ?? yearAgo
        }
        return FinancePeriod(preset: p, from: FinanceDates.ymd(start), to: FinanceDates.ymd(end))
    }

    /// A custom range; the ends are swapped if given backwards.
    static func custom(from: String, to: String) -> FinancePeriod {
        from <= to ? FinancePeriod(preset: .custom, from: from, to: to)
                   : FinancePeriod(preset: .custom, from: to, to: from)
    }

    static var thisMonth: FinancePeriod { .preset(.thisMonth) }

    var label: String { preset == .custom ? FinanceDates.displayRange(from: from, to: to) : preset.label }
    /// `["from": …, "to": …]` — merge into a request's query.
    var query: [String: String] { ["from": from, "to": to] }
    /// The same preset recomputed for `now` (a page left open past midnight).
    func refreshed(now: Date = Date()) -> FinancePeriod { preset == .custom ? self : .preset(preset, now: now) }
}

// MARK: - Capabilities

/// What this person may do in Finance (spec §6), from /me's effective
/// permissions. SuperAdmin/Admin hold everything (the server bridges them past
/// every check). While /me is loading (`profile == nil`) reads stay open and
/// EVERY gated action — export, manage, approve — is hidden (web parity).
struct FinanceCaps: Equatable {
    var view: Bool
    var export: Bool
    var manage: Bool
    var approve: Bool
    /// The signed-in user (nil while loading) — for maker-checker hints.
    var userId: String?
    var isSuperAdmin: Bool

    init(view: Bool, export: Bool, manage: Bool, approve: Bool, userId: String? = nil, isSuperAdmin: Bool = false) {
        self.view = view; self.export = export; self.manage = manage; self.approve = approve
        self.userId = userId; self.isSuperAdmin = isSuperAdmin
    }

    init(profile: MeProfile?) {
        guard let p = profile else { self = .loading; return }
        let bridged = p.role == "SuperAdmin" || p.role == "Admin"
        let granted = Set(p.permissions)
        func has(_ capability: String) -> Bool { bridged || granted.contains("finance:\(capability)") }
        self.init(view: has("view"), export: has("export"), manage: has("manage"), approve: has("approve"),
                  userId: p.userId.isEmpty ? nil : p.userId, isSuperAdmin: p.role == "SuperAdmin")
    }

    /// /me not back yet: reads open, every gated action closed.
    static let loading = FinanceCaps(view: true, export: false, manage: false, approve: false)

    /// Maker-checker hint (spec §2): the recorder/editor of an expense cannot
    /// approve it — a SuperAdmin may. The server decides (403 SAME_PERSON);
    /// this only keeps the button honest.
    func canApprove(recordedBy: String?) -> Bool {
        guard approve else { return false }
        if isSuperAdmin { return true }
        guard let me = userId, let maker = recordedBy else { return true }
        return me != maker
    }
}

extension AuthStore {
    /// `FinanceCaps(profile: profile)` — `@EnvironmentObject auth` → `auth.financeCaps`.
    var financeCaps: FinanceCaps { FinanceCaps(profile: profile) }
}

// MARK: - Status vocabulary

/// One status's label and colors — the web portal's chip palette.
struct FinanceStatusTone: Equatable {
    let label: String
    let fg: Color
    let bg: Color
}

enum FinanceStatus {
    // The web's chip colors (Finance.tsx statusChip, Partners.tsx CHIP_*).
    static let green = (fg: Color(hex: 0x0F6B33), bg: Color(hex: 0xE8F6EC))
    static let amber = (fg: Color(hex: 0xA87616), bg: Color(hex: 0xFFFBEB))
    static let amberStrong = (fg: Color(hex: 0xA87616), bg: Color(hex: 0xFFF4DA))
    static let red = (fg: Color(hex: 0xDC2626), bg: Color(hex: 0xFDECEC))
    static let rose = (fg: Color(hex: 0xB42318), bg: Color(hex: 0xFDECEC))
    static let violet = (fg: Color(hex: 0x7C3AED), bg: Color(hex: 0xF3EAFE))
    static let grey = (fg: Color(hex: 0x6B7280), bg: Color(hex: 0xEEF0F3))
    static let navy = (fg: Color(hex: 0x1E4068), bg: Color(hex: 0xE6EDF5))

    /// Every status word the Finance pages show, one vocabulary for all of them:
    /// payments (succeeded · processing · requires_action · failed · refunded),
    /// expenses (recorded · approved · void), budgets/campaigns (draft · live ·
    /// ended), claims & needs (pending · confirmed · rejected · closed), pledge
    /// standing (on_track · behind · fulfilled · paused) and schedules (active ·
    /// paused · cancelled). Anything else reads title-cased in grey.
    static func tone(_ raw: String) -> FinanceStatusTone {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        func t(_ label: String, _ c: (fg: Color, bg: Color)) -> FinanceStatusTone { FinanceStatusTone(label: label, fg: c.fg, bg: c.bg) }
        switch s {
        case "succeeded", "settled": return t("Succeeded", green)
        case "processing": return t("Processing", amber)
        case "requires_action": return t("Action needed", amber)
        case "failed": return t("Failed", red)
        case "refunded", "reversed": return t(s == "reversed" ? "Reversed" : "Refunded", violet)
        case "recorded": return t("Recorded", amber)          // awaiting a second person's approval
        case "approved": return t("Approved", green)
        case "void": return t("Void", grey)
        case "draft": return t("Draft", grey)
        case "pending": return t("Pending", amber)
        case "confirmed": return t("Confirmed", green)
        case "rejected": return t("Rejected", rose)
        case "on_track", "on track": return t("On track", green)
        case "behind": return t("Behind", amberStrong)
        case "fulfilled": return t("Fulfilled", violet)
        case "paused": return t("Paused", grey)
        case "active": return t("Active", green)
        case "cancelled", "canceled": return t("Cancelled", grey)
        case "live": return t("Live", green)
        case "ended": return t("Ended", navy)
        case "closed": return t("Closed", grey)
        default:
            let label = s.isEmpty ? "—" : s.prefix(1).uppercased() + s.dropFirst().replacingOccurrences(of: "_", with: " ")
            return t(label, grey)
        }
    }
}

/// A status pill: `FinanceStatusChip(status: row.status)`. `label` overrides the
/// vocabulary's word (keeps its colors).
struct FinanceStatusChip: View {
    let status: String
    var label: String? = nil
    var body: some View {
        let tone = FinanceStatus.tone(status)
        Text(label ?? tone.label)
            .font(.inter(11, .bold)).tracking(0.2)
            .foregroundStyle(tone.fg)
            .padding(.horizontal, 9).padding(.vertical, 3)
            .background(tone.bg)
            .clipShape(Capsule())
            .lineLimit(1).fixedSize()
            .accessibilityLabel("Status: \(label ?? tone.label)")
    }
}

// MARK: - Deep links (NavRouter)

/// A jump INTO a Finance page with a filter preset. Send with
/// `router.openFinance(.financeExpenses, ["status": "recorded"])`; receive with
/// `.onFinanceLink(.financeExpenses) { params in … }`. `token` makes two
/// identical links distinct, so a repeated tap still lands.
struct FinanceLink: Equatable {
    let section: Section
    var params: [String: String] = [:]
    let token = UUID()

    /// A web route ("/finance/expenses?status=recorded", the Overview alerts'
    /// `link`) → the iPad section + its query as params. Nil for a non-Finance route.
    static func fromWebRoute(_ href: String) -> FinanceLink? {
        guard let comps = URLComponents(string: href) else { return nil }
        let segments = comps.path.split(separator: "/").map(String.init)
        let section: Section
        switch segments.first {
        case "finance": section = Section.finance(route: segments.count > 1 ? segments[1] : "")
        case "partners": section = .partners
        default: return nil
        }
        var params: [String: String] = [:]
        for item in comps.queryItems ?? [] { if let v = item.value { params[item.name] = v } }
        return FinanceLink(section: section, params: params)
    }
}

private struct FinanceLinkConsumer: ViewModifier {
    @EnvironmentObject private var router: NavRouter
    let section: Section
    let perform: ([String: String]) -> Void
    // Explicit: a private stored property makes the memberwise init private.
    init(section: Section, perform: @escaping ([String: String]) -> Void) {
        self.section = section
        self.perform = perform
    }
    func body(content: Content) -> some View {
        content
            .onAppear { consume() }
            .onChange(of: router.financeLink) { _, _ in consume() }
    }
    /// Read-and-clear: a consumed link never replays on a later mount.
    private func consume() {
        guard let link = router.financeLink, link.section == section else { return }
        router.financeLink = nil
        perform(link.params)
    }
}

extension View {
    /// Apply a NavRouter Finance deep link aimed at `section` (on mount, and
    /// whenever a new one arrives while the page is kept alive).
    func onFinanceLink(_ section: Section, perform: @escaping ([String: String]) -> Void) -> some View {
        modifier(FinanceLinkConsumer(section: section, perform: perform))
    }
}

// MARK: - Page chrome

/// The Finance page header: the app's navy PortalHero with the "Finance ›
/// <Title>" breadcrumb, a subtitle, an optional stat strip and trailing
/// actions (HeroChip / FinanceExportButton(placement: .hero)).
struct FinancePageHeader<Actions: View>: View {
    let title: String
    var subtitle: String? = nil
    var stats: [HeroStat] = []
    @ViewBuilder var actions: Actions
    var body: some View {
        PortalHero(breadcrumb: ["Finance", title], title: title, subtitle: subtitle, stats: stats) { actions }
    }
}
extension FinancePageHeader where Actions == EmptyView {
    init(title: String, subtitle: String? = nil, stats: [HeroStat] = []) {
        self.init(title: title, subtitle: subtitle, stats: stats) { EmptyView() }
    }
}

/// A whole Finance page: scroll view on warm paper, the header, an optional
/// full-bleed subheader (FinanceTabs), then the content column with the
/// house padding (Mac: the workspace width). Pull-to-refresh when `onRefresh`.
///
///     FinancePageScaffold(title: "Ledger", subtitle: "…", onRefresh: { await vm.reload() }) {
///         FinanceExportButton(caps: caps, path: "/admin/finance/ledger.csv", query: vm.query, placement: .hero)
///     } subheader: {
///         FinanceTabs(tabs: LedgerTab.allCases, selection: $tab, label: \.title)
///     } content: {
///         FinanceFilterBar(…) { … }
///         FinancePagedTable(pager: vm.pager, columns: cols) { row in … }
///     }
struct FinancePageScaffold<Actions: View, Subheader: View, Content: View>: View {
    let title: String
    var subtitle: String? = nil
    var stats: [HeroStat] = []
    var onRefresh: (() async -> Void)? = nil
    @ViewBuilder var actions: Actions
    @ViewBuilder var subheader: Subheader
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                FinancePageHeader(title: title, subtitle: subtitle, stats: stats) { actions }
                subheader
                VStack(alignment: .leading, spacing: Nuru.S.base) { content }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Nuru.S.lg)
                    .padding(.top, Nuru.S.lg)
                    .padding(.bottom, 48)
                    .macContentColumn(MacDesign.workspaceMaxWidth)
            }
        }
        .background(Nuru.paper)
        .navigationBarTitleDisplayMode(.inline)
        .modifier(FinanceRefreshable(action: onRefresh))
    }
}
extension FinancePageScaffold where Subheader == EmptyView {
    init(title: String, subtitle: String? = nil, stats: [HeroStat] = [], onRefresh: (() async -> Void)? = nil,
         @ViewBuilder actions: () -> Actions, @ViewBuilder content: () -> Content) {
        self.init(title: title, subtitle: subtitle, stats: stats, onRefresh: onRefresh,
                  actions: actions, subheader: { EmptyView() }, content: content)
    }
}
extension FinancePageScaffold where Actions == EmptyView, Subheader == EmptyView {
    init(title: String, subtitle: String? = nil, stats: [HeroStat] = [], onRefresh: (() async -> Void)? = nil,
         @ViewBuilder content: () -> Content) {
        self.init(title: title, subtitle: subtitle, stats: stats, onRefresh: onRefresh,
                  actions: { EmptyView() }, subheader: { EmptyView() }, content: content)
    }
}

private struct FinanceRefreshable: ViewModifier {
    let action: (() async -> Void)?
    @ViewBuilder func body(content: Content) -> some View {
        if let action { content.refreshable { await action() } } else { content }
    }
}

/// Placeholder body for a page that is not built yet — what it will show
/// (spec §5). Delete with the last stub.
struct FinanceStubNote: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            TintedIcon(systemName: "hammer", color: Nuru.goldLo, size: 34)
            VStack(alignment: .leading, spacing: 4) {
                Text("Being built").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                Text(text).font(.nBody).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(Nuru.S.base)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous)
            .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1, dash: [6, 4])))
    }
}

// MARK: - Wrapping layout

/// Left-to-right flow that wraps onto new rows — filter chips, totals.
struct FinanceFlowLayout: Layout {
    var spacing: CGFloat = 8
    var rowSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            let w = min(s.width, maxWidth)
            if x > 0, x + w > maxWidth { y += rowHeight + rowSpacing; x = 0; rowHeight = 0 }
            x += w + spacing
            rowHeight = max(rowHeight, s.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: maxWidth.isFinite ? maxWidth : widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            let w = min(s.width, bounds.width)
            if x > bounds.minX, x + w > bounds.maxX { y += rowHeight + rowSpacing; x = bounds.minX; rowHeight = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: w, height: s.height))
            x += w + spacing
            rowHeight = max(rowHeight, s.height)
        }
    }
}

// MARK: - KPI tiles

/// A compact KPI tile: icon, overline label, one line PER CURRENCY (never a
/// sum), optional hint; tappable (deep link) when `action` is set.
///
///     FinanceKpiTile(label: "Income", icon: "arrow.down.circle",
///                    values: FinanceMoney.lines(o.income.map { ($0.currency, $0.periodMinor) }),
///                    hint: "this period") { router.openFinance(.financeTransactions) }
struct FinanceKpiTile: View {
    let label: String
    let icon: String
    var tint: Nuru.Tint = Nuru.brandTint(2)
    var values: [String] = []
    var hint: String? = nil
    var loading = false
    var action: (() -> Void)? = nil

    var body: some View {
        Group {
            if let action {
                Button(action: action) { tile }.buttonStyle(PressableButtonStyle()).hoverEffect(.lift)
            } else {
                tile
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
        .accessibilityValue(values.isEmpty ? (loading ? "Loading" : "None") : values.joined(separator: ", "))
    }

    private var tile: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(tint.fg)
                    .frame(width: 26, height: 26)
                    .background(tint.fg.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text(label.uppercased())
                    .font(.inter(10.5, .semibold)).tracking(0.8).foregroundStyle(Nuru.ink600)
                    .lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 0)
                if action != nil {
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.ink300)
                }
            }
            if loading && values.isEmpty {
                Skeleton(height: 18, width: 110)
            } else if values.isEmpty {
                Text("—").font(.inter(17, .semibold)).foregroundStyle(Nuru.ink400)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                        Text(v).font(.inter(16, .semibold)).foregroundStyle(Nuru.navy)
                            .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                            .contentTransition(.numericText())
                    }
                }
            }
            if let hint {
                Text(hint).font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
    }
}

/// Adaptive grid for FinanceKpiTiles (4 across in portrait, 6–8 in landscape).
struct FinanceKpiGrid<Content: View>: View {
    var minimum: CGFloat = 168
    @ViewBuilder var content: Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: 12, alignment: .top)],
                  alignment: .leading, spacing: 12) { content }
    }
}

// MARK: - Totals strip

/// "TOTAL  KES 1,234,500.00 · 42 gifts | USD 310.00 · 3 gifts" — the per-currency
/// totals of the WHOLE filtered set (the list envelope's `totals`), never added
/// across currencies.
struct FinanceTotalsStrip<Total: FinCurrencyTotaled>: View {
    let totals: [Total]
    var title: String = "Total"
    var noun: (one: String, many: String) = ("record", "records")
    var loading = false

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Text(title.uppercased())
                .font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                .fixedSize()
            Rectangle().fill(Nuru.border).frame(width: 1, height: 22)
            if loading && totals.isEmpty {
                Skeleton(height: 14, width: 180)
            } else if totals.isEmpty {
                Text("No matching \(noun.many)").font(.nCaption).foregroundStyle(Nuru.ink400)
            } else {
                FinanceFlowLayout(spacing: 18, rowSpacing: 6) {
                    ForEach(sorted, id: \.currency) { t in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(FinanceMoney.format(t.amountMinor, t.currency))
                                .font(.inter(15, .semibold)).foregroundStyle(Nuru.navy).monospacedDigit()
                            Text("· \(t.count) \(t.count == 1 ? noun.one : noun.many)")
                                .font(.nCaption).foregroundStyle(Nuru.ink600)
                        }
                        .fixedSize()
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .opacity(loading && !totals.isEmpty ? 0.55 : 1)
        .accessibilityElement(children: .combine)
    }

    private var sorted: [Total] { totals.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) } }
}

// MARK: - Filters

/// One choice in a FinanceFilterMenu. `value` is what the API gets; "" means
/// "no filter" (the All / Any option).
struct FinanceFilterOption: Identifiable, Hashable {
    let value: String
    let label: String
    var id: String { value }
    init(_ value: String, _ label: String) { self.value = value; self.label = label }
    /// The no-filter option (value "").
    static func all(_ label: String = "All") -> FinanceFilterOption { FinanceFilterOption("", label) }
}

/// A filter chip that opens a menu: "Fund · Tithe ▾". Highlighted while set.
struct FinanceFilterMenu: View {
    let title: String
    @Binding var selection: String
    let options: [FinanceFilterOption]
    var icon: String? = nil

    var body: some View {
        Menu {
            Picker(title, selection: $selection) {
                ForEach(options) { o in Text(o.label).tag(o.value) }
            }
        } label: {
            FinanceChipLabel(icon: icon, title: title,
                             value: options.first { $0.value == selection }?.label ?? selection,
                             active: !selection.isEmpty)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("\(title) filter")
    }
}

/// A year chip (Reports, Statements, Pledges, Budgets): "Year · 2026 ▾".
struct FinanceYearMenu: View {
    @Binding var year: Int
    var years: [Int] = Array(((FinanceDates.currentYear() - 6)...FinanceDates.currentYear()).reversed())
    var body: some View {
        Menu {
            Picker("Year", selection: $year) {
                ForEach(years, id: \.self) { y in Text(String(y)).tag(y) }
            }
        } label: {
            FinanceChipLabel(icon: "calendar", title: "Year", value: String(year), active: true)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("Year")
        .accessibilityValue(String(year))
    }
}

/// The chip face shared by the filter menus.
struct FinanceChipLabel: View {
    var icon: String? = nil
    let title: String
    let value: String
    var active = false
    var body: some View {
        HStack(spacing: 6) {
            if let icon { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
            Text(title).font(.inter(12.5, .medium)).foregroundStyle(active ? Nuru.navy.opacity(0.7) : Nuru.ink600)
            Text(value).font(.inter(12.5, .semibold)).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(Nuru.ink400)
        }
        .foregroundStyle(Nuru.navy)
        .padding(.horizontal, 12).frame(height: 34)
        .background(active ? FinanceStatus.navy.bg : Nuru.white)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(active ? Nuru.navy.opacity(0.25) : Nuru.border, lineWidth: 1))
        .contentShape(Capsule())
    }
}

/// The filters card: an optional debounced search row (+ Clear), then a
/// wrapping row with the period menu and the page's own pickers.
///
///     FinanceFilterBar(period: $vm.period, search: $vm.q, searchPrompt: "Receipt, member, phone…",
///                      isFiltered: vm.isFiltered, onClear: vm.clearFilters) {
///         FinanceFilterMenu(title: "Fund", selection: $vm.fund, options: vm.fundOptions)
///         FinanceFilterMenu(title: "Status", selection: $vm.status, options: statusOptions)
///     }
///
/// The search binding is written 300 ms after typing stops (or at once on
/// Return / clear), so a page can reload on every change of it.
struct FinanceFilterBar<Pickers: View>: View {
    let period: Binding<FinancePeriod>?
    let search: Binding<String>?
    let searchPrompt: String
    let isFiltered: Bool
    let onClear: (() -> Void)?
    let pickers: Pickers

    @State private var text = ""
    @State private var showCustomRange = false

    init(period: Binding<FinancePeriod>? = nil, search: Binding<String>? = nil, searchPrompt: String = "Search",
         isFiltered: Bool = false, onClear: (() -> Void)? = nil, @ViewBuilder pickers: () -> Pickers) {
        self.period = period
        self.search = search
        self.searchPrompt = searchPrompt
        self.isFiltered = isFiltered
        self.onClear = onClear
        self.pickers = pickers()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if search != nil {
                HStack(spacing: 10) {
                    searchField
                    if isFiltered, onClear != nil { clearButton }
                }
            }
            FinanceFlowLayout(spacing: 8, rowSpacing: 8) {
                if let period { periodMenu(period) }
                pickers
                if search == nil, isFiltered, onClear != nil { clearButton }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .onAppear { if let search { text = search.wrappedValue } }
        .onChange(of: search?.wrappedValue ?? "") { _, v in if v != text { text = v } }
        .task(id: text) {
            guard let search, text != search.wrappedValue else { return }
            try? await Task.sleep(nanoseconds: 300_000_000)
            if !Task.isCancelled { search.wrappedValue = text }
        }
        .sheet(isPresented: $showCustomRange) {
            if let period {
                FinanceCustomRangeSheet(initial: period.wrappedValue) { period.wrappedValue = $0 }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Nuru.ink400)
            TextField(searchPrompt, text: $text)
                .font(.nBody).foregroundStyle(Nuru.ink)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { search?.wrappedValue = text }
            if !text.isEmpty {
                Button { text = ""; search?.wrappedValue = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 14)).foregroundStyle(Nuru.ink300)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12).frame(height: 38)
        .frame(maxWidth: .infinity)
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private var clearButton: some View {
        Button {
            text = ""
            search?.wrappedValue = ""
            onClear?()
        } label: {
            Label("Clear", systemImage: "xmark")
                .font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink600)
                .padding(.horizontal, 12).frame(height: 34)
                .background(Nuru.white)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("Clear filters")
    }

    private func periodMenu(_ period: Binding<FinancePeriod>) -> some View {
        Menu {
            ForEach(FinancePeriodPreset.allCases) { p in
                Button {
                    if p == .custom { showCustomRange = true } else { period.wrappedValue = .preset(p) }
                } label: {
                    if period.wrappedValue.preset == p { Label(p.label, systemImage: "checkmark") } else { Text(p.label) }
                }
            }
        } label: {
            FinanceChipLabel(icon: "calendar", title: "Period", value: period.wrappedValue.label, active: true)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("Period")
        .accessibilityValue(period.wrappedValue.label)
    }
}

extension FinanceFilterBar where Pickers == EmptyView {
    init(period: Binding<FinancePeriod>? = nil, search: Binding<String>? = nil, searchPrompt: String = "Search",
         isFiltered: Bool = false, onClear: (() -> Void)? = nil) {
        self.init(period: period, search: search, searchPrompt: searchPrompt, isFiltered: isFiltered, onClear: onClear) { EmptyView() }
    }
}

/// The custom range picker: two EAT calendar days, `from` ≤ `to`.
struct FinanceCustomRangeSheet: View {
    let initial: FinancePeriod
    let onApply: (FinancePeriod) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var from: Date
    @State private var to: Date

    init(initial: FinancePeriod, onApply: @escaping (FinancePeriod) -> Void) {
        self.initial = initial
        self.onApply = onApply
        let today = FinanceDates.date(fromYMD: FinanceDates.today()) ?? Date()
        _from = State(initialValue: FinanceDates.date(fromYMD: initial.from) ?? today)
        _to = State(initialValue: FinanceDates.date(fromYMD: initial.to) ?? today)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Inclusive calendar days, East Africa Time.").font(.nCaption).foregroundStyle(Nuru.ink600)
                DatePicker("From", selection: $from, displayedComponents: .date)
                    .font(.nBody)
                DatePicker("To", selection: $to, in: from..., displayedComponents: .date)
                    .font(.nBody)
                Spacer(minLength: 0)
            }
            .padding(24)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Nuru.paper)
            // Days are chosen in the church's calendar, so a device in another
            // zone never shifts the range by a day.
            .environment(\.timeZone, FinanceDates.timeZone)
            .environment(\.calendar, FinanceDates.calendar)
            .navigationTitle("Custom period")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        onApply(.custom(from: FinanceDates.ymd(from), to: FinanceDates.ymd(max(from, to))))
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Tables (keyset-paged registers)

/// One table column. Fixed `width`, or flexible (shares the leftover space,
/// never narrower than `minWidth`). Apply the SAME column to the header and to
/// each row's cell with `.financeCell(column)` so the columns line up.
struct FinanceColumn {
    enum Align { case leading, center, trailing }
    let title: String
    var width: CGFloat? = nil
    var minWidth: CGFloat = 90
    var align: Align = .leading

    init(_ title: String, width: CGFloat? = nil, minWidth: CGFloat = 90, align: Align = .leading) {
        self.title = title; self.width = width; self.minWidth = minWidth; self.align = align
    }

    var alignment: Alignment {
        switch align { case .leading: .leading; case .center: .center; case .trailing: .trailing }
    }
    fileprivate var floor: CGFloat { width ?? minWidth }
}

extension View {
    /// Size a table cell to its column (fixed width, or flexible with a floor).
    @ViewBuilder func financeCell(_ column: FinanceColumn) -> some View {
        if let w = column.width {
            frame(width: w, alignment: column.alignment)
        } else {
            frame(minWidth: column.minWidth, maxWidth: .infinity, alignment: column.alignment)
        }
    }
}

/// Loads a keyset-paged Finance list (spec §4 envelope `{data, next_cursor,
/// totals}`) and keeps the rows, the whole-set totals and the paging state.
/// Owned by the page's view model; shown by FinancePagedTable.
///
///     let pager = FinancePager<FinTransactionsPage>()
///     // filters changed (e.g. from .task(id: filterKey)):
///     await pager.load { cursor in try await FinanceERPAPI.transactions(filter, cursor: cursor) }
///     // pull-to-refresh / after a write:
///     await pager.reload()
///
/// Only the latest request may land (a generation counter), so a slow
/// response for old filters never overwrites newer rows.
@MainActor
final class FinancePager<Page: FinPaged>: ObservableObject {
    enum Phase: Equatable { case idle, loading, loaded, failed(String) }
    typealias Fetch = (_ cursor: String?) async throws -> Page

    @Published private(set) var rows: [Page.Row] = []
    /// Per-currency totals of the WHOLE filtered set (not just the rows shown).
    @Published private(set) var totals: [Page.Total] = []
    /// The latest response — for the envelope's extra fields (year, period, totals_by_status…).
    @Published private(set) var envelope: Page?
    @Published private(set) var nextCursor: String?
    @Published private(set) var phase: Phase = .idle
    /// A reload is running while the previous rows stay on screen (dimmed).
    @Published private(set) var refreshing = false
    @Published private(set) var loadingMore = false
    /// A failed "Load more" or background refresh (the rows stay; Retry offered).
    @Published private(set) var footerError: String?

    private var fetch: Fetch?
    private var generation = 0

    init() {}

    var hasMore: Bool { nextCursor != nil }
    var isLoadingFirstPage: Bool { phase == .loading || phase == .idle }

    /// Run a NEW query (the filters changed). The old rows stay, dimmed, until
    /// the first page lands; if it fails they are cleared — they belonged to
    /// other filters.
    func load(_ fetch: @escaping Fetch) async {
        self.fetch = fetch
        await run(replacing: true)
    }

    /// Re-run the current query (pull-to-refresh, after a write). A failure
    /// keeps the rows on screen and reports in the footer.
    func reload() async {
        guard fetch != nil else { return }
        await run(replacing: false)
    }

    /// The table's Retry: re-run whatever failed.
    func retry() async {
        if case .failed = phase { await reload() }
        else if footerError != nil, hasMore, !refreshing { await loadMore() }
        else { await reload() }
    }

    func loadMore() async {
        guard let fetch, let cursor = nextCursor, !loadingMore, !refreshing, phase == .loaded else { return }
        let gen = generation
        loadingMore = true
        footerError = nil
        do {
            let page = try await fetch(cursor)
            guard gen == generation else { return }
            rows = Self.unique(rows + page.data)
            totals = page.totals
            nextCursor = page.nextCursor
            envelope = page
        } catch {
            guard gen == generation else { return }
            if !Task.isCancelled { footerError = Self.message(error) }
        }
        if gen == generation { loadingMore = false }
    }

    /// Patch rows in place after a write (a reversal, an approval) without a refetch.
    func update(_ transform: (inout [Page.Row]) -> Void) { transform(&rows) }

    private func run(replacing: Bool) async {
        guard let fetch else { return }
        generation += 1
        let gen = generation
        if rows.isEmpty { phase = .loading } else { refreshing = true }
        loadingMore = false                       // an in-flight "Load more" is now stale
        footerError = nil
        do {
            let page = try await fetch(nil)
            guard gen == generation else { return }
            rows = Self.unique(page.data)
            totals = page.totals
            nextCursor = page.nextCursor
            envelope = page
            phase = .loaded
        } catch {
            guard gen == generation else { return }
            if Task.isCancelled {
                // The caller went away (a .task restarted); a newer load follows.
                refreshing = false
                return
            }
            let message = Self.message(error)
            if replacing || rows.isEmpty {
                rows = []; totals = []; nextCursor = nil; envelope = nil
                phase = .failed(message)
            } else {
                footerError = "Couldn't refresh — \(message)"
            }
        }
        if gen == generation { refreshing = false }
    }

    private static func unique(_ list: [Page.Row]) -> [Page.Row] {
        var seen = Set<Page.Row.ID>()
        return list.filter { seen.insert($0.id).inserted }
    }

    private static func message(_ error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}

/// A register: white card, overline header row, compact rows with hairlines,
/// skeleton while the first page loads, an honest empty state, the error with
/// Retry, and a "Load more" footer (keyset cursor). Narrower than its columns'
/// floors (portrait), it scrolls sideways instead of crushing them.
///
///     FinancePagedTable(pager: vm.pager, columns: cols, onSelect: { vm.open($0) }) { t in
///         Text(FinanceDates.display(t.createdAt)).financeCell(cols[0])
///         Text(t.displayName).lineLimit(1).financeCell(cols[1])
///         FinanceStatusChip(status: t.status).financeCell(cols[2])
///         Text(FinanceMoney.format(t.amountMinor, t.currency)).financeCell(cols[3])
///     }
struct FinancePagedTable<Page: FinPaged, RowContent: View>: View {
    @ObservedObject var pager: FinancePager<Page>
    let columns: [FinanceColumn]
    var emptyIcon: String = "tray"
    var emptyMessage: String = "Nothing matches these filters."
    /// Records in the whole filtered set, when the page knows it ("Showing 50 of 312").
    var totalCount: Int? = nil
    var onSelect: ((Page.Row) -> Void)? = nil
    @ViewBuilder let row: (Page.Row) -> RowContent

    var body: some View {
        FinanceTableFrame(columns: columns, busy: pager.refreshing) {
            if pager.phase == .loaded, !pager.rows.isEmpty {
                LazyVStack(spacing: 0) {
                    ForEach(pager.rows) { r in
                        FinanceTableRow(onTap: tap(r)) { row(r) }
                    }
                }
                .opacity(pager.refreshing ? 0.55 : 1)
            }
        } status: {
            switch pager.phase {
            case .idle, .loading:
                SkeletonTable(rows: 6).padding(12)
            case .failed(let message):
                ErrorBanner(message: message) { Task { await pager.retry() } }
            case .loaded:
                if pager.rows.isEmpty { EmptyState.compact(icon: emptyIcon, message: emptyMessage) }
            }
        } footer: {
            if pager.phase == .loaded, !pager.rows.isEmpty { footer }
        }
    }

    private func tap(_ r: Page.Row) -> (() -> Void)? {
        guard let onSelect else { return nil }
        return { onSelect(r) }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Text(totalCount.map { "Showing \(pager.rows.count) of \($0)" } ?? "Showing \(pager.rows.count)")
                .font(.nCaption).foregroundStyle(Nuru.ink600)
            Spacer(minLength: 0)
            if let error = pager.footerError {
                Text(error).font(.nCaption).foregroundStyle(Nuru.danger).lineLimit(2)
                FinanceButton(title: "Retry", icon: "arrow.clockwise") { Task { await pager.retry() } }
            } else if pager.hasMore {
                FinanceButton(title: pager.loadingMore ? "Loading…" : "Load more", icon: "arrow.down",
                              busy: pager.loadingMore) { Task { await pager.loadMore() } }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
    }
}

/// The same register for rows the page already holds (funds, trial balance,
/// schedules): header, rows, hairlines, empty state. Loading and errors are the
/// page's (show SkeletonTable / ErrorBanner instead of this while they apply).
struct FinanceTable<Row: Identifiable, RowContent: View>: View {
    let rows: [Row]
    let columns: [FinanceColumn]
    var emptyIcon: String = "tray"
    var emptyMessage: String = "Nothing here yet."
    var onSelect: ((Row) -> Void)? = nil
    @ViewBuilder let row: (Row) -> RowContent

    var body: some View {
        FinanceTableFrame(columns: columns, busy: false) {
            LazyVStack(spacing: 0) {
                ForEach(rows) { r in
                    FinanceTableRow(onTap: tap(r)) { row(r) }
                }
            }
        } status: {
            if rows.isEmpty { EmptyState.compact(icon: emptyIcon, message: emptyMessage) }
        } footer: {
            EmptyView()
        }
    }

    private func tap(_ r: Row) -> (() -> Void)? {
        guard let onSelect else { return nil }
        return { onSelect(r) }
    }
}

/// Card + header + horizontal-overflow handling shared by both tables. The
/// header and rows scroll sideways together when narrower than the columns'
/// floors; `status` (skeleton, error, empty) always spans the visible width.
private struct FinanceTableFrame<Rows: View, Status: View, Footer: View>: View {
    let columns: [FinanceColumn]
    let busy: Bool
    let rows: Rows
    let status: Status
    let footer: Footer
    @State private var width: CGFloat = 0

    init(columns: [FinanceColumn], busy: Bool, @ViewBuilder rows: () -> Rows,
         @ViewBuilder status: () -> Status, @ViewBuilder footer: () -> Footer) {
        self.columns = columns
        self.busy = busy
        self.rows = rows()
        self.status = status()
        self.footer = footer()
    }

    private var minWidth: CGFloat {
        columns.reduce(0) { $0 + $1.floor } + CGFloat(max(columns.count - 1, 0)) * 12 + 32
    }

    var body: some View {
        VStack(spacing: 0) {
            Group {
                // Until the available width is known (0) — and whenever it is
                // narrower than the columns' floors — the grid scrolls sideways
                // at its floor width, so it can never widen the page.
                if width < minWidth {
                    ScrollView(.horizontal, showsIndicators: true) { grid.frame(width: max(minWidth, width)) }
                } else {
                    grid
                }
            }
            // Measure the width OFFERED to the table (the flexible frame takes
            // the proposal), never the grid's own, possibly overflowing, width.
            .frame(maxWidth: .infinity, alignment: .leading)
            .measureWidth($width)
            status
            footer
        }
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .nuruShadow()
    }

    private var grid: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ForEach(Array(columns.enumerated()), id: \.offset) { _, c in
                    Text(c.title.uppercased())
                        .font(.inter(10.5, .bold)).tracking(0.7).foregroundStyle(Nuru.ink600)
                        .lineLimit(1).minimumScaleFactor(0.85)
                        .financeCell(c)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.surface)
            .overlay(alignment: .trailing) {
                if busy { ProgressView().controlSize(.small).padding(.trailing, 10) }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            rows
        }
    }
}

/// One row: the page's cells in the house HStack, a top hairline, and — when
/// tappable — a hover/press highlight (the detail drawer opens on tap).
private struct FinanceTableRow<Cells: View>: View {
    let onTap: (() -> Void)?
    @ViewBuilder var cells: Cells

    var body: some View {
        let line = HStack(spacing: 12) { cells }
            .font(.inter(13.5)).foregroundStyle(Nuru.ink)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .contentShape(Rectangle())
            .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
        if let onTap {
            Button(action: onTap) { line }
                .buttonStyle(FinanceRowButtonStyle())
                .hoverEffect(.highlight)
        } else {
            line
        }
    }
}

private struct FinanceRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Nuru.surface : Color.clear)
    }
}

// MARK: - Tabs

/// In-page segmented tabs in the house style (gold underline, as Partners and
/// the old Finance page): Ledger → Journal · Trial balance · Journals, etc.
/// Put it in FinancePageScaffold's `subheader` so it runs full-bleed.
///
///     FinanceTabs(tabs: LedgerTab.allCases, selection: $tab, label: \.title)
struct FinanceTabs<Tab: Hashable>: View {
    let tabs: [Tab]
    @Binding var selection: Tab
    let label: (Tab) -> String
    var badge: (Tab) -> Int? = { _ in nil }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(tabs, id: \.self) { t in
                    let active = selection == t
                    Button { selection = t } label: {
                        HStack(spacing: 7) {
                            Text(label(t)).font(.inter(14, active ? .bold : .medium))
                            if let n = badge(t), n > 0 {
                                Text("\(n)").font(.nMono(11))
                                    .foregroundStyle(Color(hex: 0xA87616))
                                    .padding(.horizontal, 6).frame(minWidth: 18, minHeight: 18)
                                    .background(Color(hex: 0xFFF4DA))
                                    .clipShape(Capsule())
                            }
                        }
                        .foregroundStyle(active ? Nuru.navy : Nuru.ink600)
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(active ? Nuru.gold : .clear).frame(height: 2)
                        }
                    }
                    .pressable()
                    .hoverEffect(.highlight)
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
            .padding(.horizontal, Nuru.S.lg)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }
        .background(Nuru.paper)
    }
}

// MARK: - Buttons & notices

/// A compact action button: navy (primary), gold, rose (danger) or white
/// (plain). `busy` swaps the icon for a spinner and disables it.
struct FinanceButton: View {
    enum Style { case primary, gold, danger, plain }
    let title: String
    var icon: String? = nil
    var style: Style = .plain
    var busy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy { ProgressView().tint(fg).controlSize(.small) }
                else if let icon { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
                Text(title).font(.inter(12.5, .bold)).lineLimit(1)
            }
            .foregroundStyle(fg)
            .padding(.horizontal, 12).frame(height: 34)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(border, lineWidth: 1))
        }
        .pressable()
        .hoverEffect(.lift)
        .disabled(busy)
        .opacity(busy ? 0.7 : 1)
    }

    private var fg: Color {
        switch style { case .primary: .white; case .gold: .white; case .danger: FinanceStatus.rose.fg; case .plain: Nuru.navy }
    }
    private var bg: Color {
        switch style { case .primary: Nuru.navy; case .gold: Nuru.gold; case .danger: FinanceStatus.rose.bg; case .plain: Nuru.white }
    }
    private var border: Color {
        switch style { case .primary: Nuru.navy; case .gold: Nuru.gold; case .danger: Color(hex: 0xF5C2C0); case .plain: Nuru.border }
    }
}

/// An inline notice in one of three tones (web Notice).
struct FinanceNotice: Equatable {
    enum Kind { case ok, warn, error }
    let kind: Kind
    let text: String
    static func ok(_ text: String) -> FinanceNotice { FinanceNotice(kind: .ok, text: text) }
    static func warn(_ text: String) -> FinanceNotice { FinanceNotice(kind: .warn, text: text) }
    static func error(_ text: String) -> FinanceNotice { FinanceNotice(kind: .error, text: text) }
}

struct FinanceNoticeBar: View {
    let notice: FinanceNotice
    var onDismiss: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: notice.kind == .ok ? "checkmark" : "exclamationmark.triangle")
                .font(.system(size: 12, weight: .bold))
            Text(notice.text).font(.inter(12.5, .semibold)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let onDismiss {
                Button(action: onDismiss) { Image(systemName: "xmark").font(.system(size: 11, weight: .bold)) }
                    .buttonStyle(.plain).accessibilityLabel("Dismiss")
            }
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private var fg: Color {
        switch notice.kind { case .ok: Color(hex: 0x0F6B33); case .warn: Color(hex: 0xA87616); case .error: Color(hex: 0xB42318) }
    }
    private var bg: Color {
        switch notice.kind { case .ok: Color(hex: 0xE8F6EC); case .warn: Color(hex: 0xFFF4DA); case .error: Color(hex: 0xFDECEC) }
    }
    private var border: Color {
        switch notice.kind { case .ok: Color(hex: 0xBFE3CB); case .warn: Color(hex: 0xF3DFA6); case .error: Color(hex: 0xF5C2C0) }
    }
}

// MARK: - Confirm with a reason

/// "Why?" before an irreversible-in-spirit action (reverse a gift, void an
/// expense, reverse a journal): a reason of `minLength`…`maxLength` characters
/// (trimmed — the server's rule, spec §4: 5–300) with a live counter. Runs
/// `onConfirm`; shows its error inline and stays open on failure; dismisses on
/// success.
///
///     .sheet(item: $vm.reversing) { t in
///         FinanceReasonSheet(title: "Reverse this gift",
///                            message: "Posts the mirror entries and marks it refunded. The receipt number stays on the record.",
///                            confirmLabel: "Reverse") { reason in try await vm.reverse(t, reason: reason) }
///     }
struct FinanceReasonSheet: View {
    let title: String
    let message: String?
    let confirmLabel: String
    let destructive: Bool
    let minLength: Int
    let maxLength: Int
    let placeholder: String
    let onConfirm: (String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var busy = false
    @State private var error: String?

    init(title: String, message: String? = nil, confirmLabel: String = "Confirm", destructive: Bool = true,
         minLength: Int = 5, maxLength: Int = 300,
         placeholder: String = "Reason — kept on the record and in the audit trail",
         onConfirm: @escaping (String) async throws -> Void) {
        self.title = title
        self.message = message
        self.confirmLabel = confirmLabel
        self.destructive = destructive
        self.minLength = minLength
        self.maxLength = maxLength
        self.placeholder = placeholder
        self.onConfirm = onConfirm
    }

    private var trimmed: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// What the server counts (zod `.length` = UTF-16 code units, after trim).
    private var length: Int { trimmed.utf16.count }
    private var valid: Bool { length >= minLength && length <= maxLength }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                if let message {
                    Text(message).font(.nBody).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("REASON").font(.inter(12, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
                    TextField(placeholder, text: $reason, axis: .vertical)
                        .lineLimit(3...6)
                        .font(.nBody).foregroundStyle(Nuru.ink)
                        .padding(12)
                        .background(Nuru.white)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous)
                            .stroke(length > maxLength ? Nuru.danger : Nuru.border, lineWidth: 1))
                        .disabled(busy)
                    HStack {
                        Text(length < minLength ? "At least \(minLength) characters." : " ")
                            .font(.nCaption).foregroundStyle(Nuru.ink400)
                        Spacer()
                        Text("\(length)/\(maxLength)")
                            .font(.nMono(11.5))
                            .foregroundStyle(length > maxLength ? Nuru.danger : Nuru.ink400)
                    }
                }
                if let error { FinanceNoticeBar(notice: .error(error)) }
                Spacer(minLength: 0)
            }
            .padding(24)
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Nuru.paper)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: submit) {
                        if busy { ProgressView() } else { Text(confirmLabel).fontWeight(.semibold) }
                    }
                    .tint(destructive ? Nuru.danger : Nuru.navy)
                    .disabled(!valid || busy)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy)
    }

    private func submit() {
        guard valid, !busy else { return }
        busy = true
        error = nil
        let text = trimmed
        Task { @MainActor in
            do {
                try await onConfirm(text)
                busy = false
                dismiss()
            } catch {
                busy = false
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

// MARK: - Money input

/// An amount field in MAJOR units with the currency beside it (a menu when
/// there is a choice), the parse error once the person has typed, and an echo
/// of the exact amount that will be recorded. Read the value with
/// `FinanceMoney.parseMajor(text)` on submit.
struct FinanceMoneyField: View {
    let label: String
    @Binding var text: String
    @Binding var currency: String
    let currencies: [String]
    let prompt: String

    @State private var edited = false

    /// `currencies` with one entry locks the currency (budgets are KES only).
    init(label: String, text: Binding<String>, currency: Binding<String>,
         currencies: [String] = ["KES", "USD"], prompt: String = "0.00") {
        self.label = label
        _text = text
        _currency = currency
        self.currencies = currencies
        self.prompt = prompt
    }
    private var parsed: Result<Int, FinanceMoneyError> { FinanceMoney.parseMajor(text) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.inter(12, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
            HStack(spacing: 0) {
                currencyControl
                    .padding(.horizontal, 12)
                    .frame(maxHeight: .infinity)
                    .background(Nuru.surface)
                Rectangle().fill(Nuru.border).frame(width: 1)
                TextField(prompt, text: $text)
                    .keyboardType(.decimalPad)
                    .font(.nMono(16)).foregroundStyle(Nuru.ink)
                    .padding(.horizontal, 12)
                    .onChange(of: text) { _, _ in edited = true }
            }
            .frame(height: 44)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous)
                .stroke(showError ? Nuru.danger : Nuru.border, lineWidth: 1))
            switch parsed {
            case .failure(let e) where showError:
                Text(e.message).font(.nCaption).foregroundStyle(Nuru.danger)
            case .success(let minor):
                Text("Records \(FinanceMoney.format(minor, currency))").font(.nCaption).foregroundStyle(Nuru.ink400)
            default:
                EmptyView()
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var showError: Bool {
        guard edited, case .failure(let e) = parsed else { return false }
        return e != .empty || !text.isEmpty
    }

    @ViewBuilder private var currencyControl: some View {
        if currencies.count > 1 {
            Menu {
                Picker("Currency", selection: $currency) {
                    ForEach(currencies, id: \.self) { Text($0).tag($0) }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(currency).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(Nuru.ink400)
                }
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .accessibilityLabel("Currency")
            .accessibilityValue(currency)
        } else {
            Text(currency).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
        }
    }
}

// MARK: - Export (CSV / PDF → share sheet)

/// Where an export button sits: on the navy header (a gold chip) or on the
/// paper (a white chip, like the filter chips).
enum FinanceActionPlacement { case hero, toolbar }

/// Downloads a server export (a `.csv` twin, a statement PDF) with the
/// session's auth, keeps the server's filename, and opens the share sheet
/// (Save to Files, AirDrop, Mail…) anchored to the button. Hidden unless
/// `caps[keyPath: gate]` — finance:export for CSVs (the default); pass
/// `gate: \.view` for the statement PDFs (spec §4 lists them as reads).
///
///     FinanceExportButton(caps: caps, path: "/admin/finance/transactions.csv", query: vm.filter.query)
///     FinanceExportButton(caps: caps, path: FinanceERPAPI.givingStatementPath(userId), query: ["year": "2026"],
///                         title: "Giving statement", icon: "doc.richtext", gate: \.view)
struct FinanceExportButton: View {
    let caps: FinanceCaps
    let path: String
    let query: [String: String]
    let title: String
    let icon: String
    let gate: KeyPath<FinanceCaps, Bool>
    let placement: FinanceActionPlacement

    @State private var busy = false
    @State private var error: String?
    @State private var anchor = FinanceShareAnchor()

    init(caps: FinanceCaps, path: String, query: [String: String] = [:], title: String = "Export CSV",
         icon: String = "square.and.arrow.up", gate: KeyPath<FinanceCaps, Bool> = \.export,
         placement: FinanceActionPlacement = .toolbar) {
        self.caps = caps
        self.path = path
        self.query = query
        self.title = title
        self.icon = icon
        self.gate = gate
        self.placement = placement
    }

    var body: some View {
        if caps[keyPath: gate] {
            VStack(alignment: .trailing, spacing: 6) {
                Button(action: run) { face }
                    .buttonStyle(PressableButtonStyle())
                    .hoverEffect(.lift)
                    .disabled(busy)
                    .background(FinanceShareAnchorView(anchor: anchor))
                    .accessibilityLabel(title)
                    .accessibilityHint("Downloads the file and opens the share sheet")
                if let error {
                    FinanceNoticeBar(notice: .error(error)) { self.error = nil }
                        .frame(maxWidth: 360)
                }
            }
        }
    }

    @ViewBuilder private var face: some View {
        let label = HStack(spacing: 6) {
            if busy { ProgressView().controlSize(.small).tint(placement == .hero ? .white : Nuru.navy) }
            else { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
            Text(busy ? "Preparing…" : title).font(.inter(placement == .hero ? 11.5 : 12.5, .semibold)).lineLimit(1)
        }
        switch placement {
        case .hero:
            label
                .foregroundStyle(.white)
                .padding(.horizontal, 12).frame(height: 32)
                .background(Nuru.gold)
                .clipShape(Capsule())
        case .toolbar:
            label
                .foregroundStyle(Nuru.navy)
                .padding(.horizontal, 12).frame(height: 34)
                .background(Nuru.white)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
        }
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
                    self.error = "Downloaded, but the share sheet could not open — try again."
                }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Could not download the file."
            }
        }
    }
}

/// Holds the UIView the share popover points at (iPad requires an anchor).
final class FinanceShareAnchor {
    weak var view: UIView?
}

/// Invisible UIView behind a button — its frame is the popover's source rect.
struct FinanceShareAnchorView: UIViewRepresentable {
    let anchor: FinanceShareAnchor
    func makeUIView(context: Context) -> UIView {
        let v = UIView(frame: .zero)
        v.isUserInteractionEnabled = false
        v.backgroundColor = .clear
        anchor.view = v
        return v
    }
    func updateUIView(_ uiView: UIView, context: Context) { anchor.view = uiView }
}

/// Presents the system share sheet for a downloaded file, then deletes the
/// temporary copy once the sheet is done with it (exports carry member names
/// and money — nothing lingers in tmp).
@MainActor
enum FinanceShare {
    /// False when there is no window to present from (the caller says so);
    /// the temporary copy is removed in that case too.
    @discardableResult
    static func present(_ url: URL, from anchor: FinanceShareAnchor?) -> Bool {
        let folder = url.deletingLastPathComponent()
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: folder)
        }
        let window = anchor?.view?.window ?? keyWindow()
        guard var top = window?.rootViewController else {
            try? FileManager.default.removeItem(at: folder)
            return false
        }
        while let presented = top.presentedViewController, !presented.isBeingDismissed { top = presented }
        if let pop = sheet.popoverPresentationController {
            if let source = anchor?.view, source.window != nil {
                pop.sourceView = source
                pop.sourceRect = source.bounds
            } else {
                pop.sourceView = top.view
                pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
        }
        top.present(sheet, animated: true)
        return true
    }

    private static func keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }
    }
}

// MARK: - DEBUG self-check

#if DEBUG
/// DEBUG-only self-check. This project has no unit-test target, so the kit's
/// pure helpers are asserted once at launch in Debug builds
/// (NuruPortalApp.init): money formatting and parsing, the EAT period presets
/// (at fixed instants, so nothing depends on the device's zone or today's
/// date), date validation, the /me → FinanceCaps rules, the status words,
/// deep-link parsing, download filenames and the sidebar
/// (`financeNavSelfCheckFailures`, RootView.swift). Release builds carry none of it.
enum FinanceSelfCheck {
    static func run() -> (checks: Int, failures: [String]) {
        var checks = 0
        var failures: [String] = []
        func expect(_ ok: Bool, _ what: @autoclosure () -> String) {
            checks += 1
            if !ok { failures.append(what()) }
        }
        func expectEqual<T: Equatable>(_ got: T, _ want: T, _ what: String) {
            expect(got == want, "\(what): got \(got), want \(want)")
        }

        // Money — exact formatting.
        expectEqual(FinanceMoney.format(123_450, "KES"), "KES 1,234.50", "format 1234.50")
        expectEqual(FinanceMoney.format(5, "usd"), "USD 0.05", "format cents + upper-case code")
        expectEqual(FinanceMoney.format(-100_000, "KES"), "-KES 1,000.00", "format negative")
        expectEqual(FinanceMoney.format(0, "KES"), "KES 0.00", "format zero")
        expectEqual(FinanceMoney.format(100_000_000_000, "KES"), "KES 1,000,000,000.00", "format large")
        expectEqual(FinanceMoney.format(99, ""), "0.99", "format without code")
        expectEqual(FinanceMoney.format(Int.min, "KES"), "-KES 92,233,720,368,547,758.08", "format Int.min")
        expectEqual(FinanceMoney.majorString(123_450), "1234.50", "majorString")
        expectEqual(FinanceMoney.majorString(7), "0.07", "majorString cents")
        expectEqual(FinanceMoney.compact(123_450_000), "1.2M", "compact M")
        expectEqual(FinanceMoney.compact(1_000_000), "10K", "compact K")
        expectEqual(FinanceMoney.compact(99_900), "999", "compact small")
        expectEqual(FinanceMoney.compact(-250_000), "-2.5K", "compact negative")
        expectEqual(FinanceMoney.lines([("USD", 100), ("KES", 200)]), ["KES 2.00", "USD 1.00"], "lines KES first")

        // Money — parsing what the office types.
        let parses: [(String, Result<Int, FinanceMoneyError>)] = [
            ("1,500.50", .success(150_050)), (" 12 ", .success(1_200)), ("0.5", .success(50)),
            (".5", .success(50)), ("5.", .success(500)), ("1 000", .success(100_000)),
            ("10000000", .success(1_000_000_000)), ("10000000.01", .failure(.tooLarge)),
            ("", .failure(.empty)), ("   ", .failure(.empty)), ("abc", .failure(.invalid)),
            ("1.2.3", .failure(.invalid)), ("1.234", .failure(.tooManyDecimals)), ("0", .failure(.notPositive)),
            ("0.00", .failure(.notPositive)), ("-5", .failure(.notPositive)), ("-x", .failure(.invalid)),
            ("99999999999999999999", .failure(.tooLarge)), ("１２", .failure(.invalid)),
            ("1e5", .failure(.invalid)), ("+5", .failure(.invalid)), (".", .failure(.invalid)),
        ]
        for (input, want) in parses { expectEqual(FinanceMoney.parseMajor(input), want, "parseMajor(\"\(input)\")") }
        expectEqual(FinanceMoney.parseMajor(FinanceMoney.majorString(123_450)), .success(123_450), "parse ∘ majorString")

        // Dates — EAT presets at fixed instants.
        let iso = ISO8601DateFormatter()
        func at(_ s: String) -> Date { iso.date(from: s) ?? Date(timeIntervalSince1970: 0) }
        func range(_ p: FinancePeriodPreset, _ now: String) -> String {
            let r = FinancePeriod.preset(p, now: at(now))
            return "\(r.from)…\(r.to)"
        }
        let sep26 = "2026-09-26T07:00:00Z"                       // 10:00 EAT
        expectEqual(range(.thisMonth, sep26), "2026-09-01…2026-09-26", "this month")
        expectEqual(range(.lastMonth, sep26), "2026-08-01…2026-08-31", "last month")
        expectEqual(range(.thisQuarter, sep26), "2026-07-01…2026-09-26", "this quarter")
        expectEqual(range(.thisYear, sep26), "2026-01-01…2026-09-26", "this year")
        expectEqual(range(.last12Months, sep26), "2025-09-27…2026-09-26", "last 12 months")
        expectEqual(range(.thisMonth, "2026-09-30T22:30:00Z"), "2026-10-01…2026-10-01", "EAT midnight boundary")
        expectEqual(FinanceDates.today(now: at("2026-09-30T22:30:00Z")), "2026-10-01", "today in EAT")
        expectEqual(range(.lastMonth, "2026-01-15T09:00:00Z"), "2025-12-01…2025-12-31", "last month across the year")
        expectEqual(range(.thisQuarter, "2026-01-15T09:00:00Z"), "2026-01-01…2026-01-15", "Q1")
        expectEqual(range(.last12Months, "2028-02-29T09:00:00Z"), "2027-03-01…2028-02-29", "last 12 months from a leap day")
        expectEqual(range(.lastMonth, "2028-03-10T09:00:00Z"), "2028-02-01…2028-02-29", "last month = leap February")
        let swapped = FinancePeriod.custom(from: "2026-09-10", to: "2026-09-01")
        expectEqual("\(swapped.from)…\(swapped.to)", "2026-09-01…2026-09-10", "custom range swaps backwards ends")
        expect(FinanceDates.date(fromYMD: "2026-02-30") == nil, "2026-02-30 is not a date")
        expect(FinanceDates.date(fromYMD: "2026-9-1") == nil, "2026-9-1 is not YYYY-MM-DD")
        expect(FinanceDates.date(fromYMD: "2026-02-28") != nil, "2026-02-28 is a date")
        expectEqual(FinanceDates.display("2026-09-26"), "26 Sep 2026", "display day")
        expectEqual(FinanceDates.display("2026-09-26T10:00:00Z"), "26 Sep 2026", "display ISO prefix")
        expectEqual(FinanceDates.display(nil), "—", "display nil")
        expectEqual(FinanceDates.displayRange(from: "2026-09-01", to: "2026-09-26"), "1 Sep – 26 Sep 2026", "range same month (web fmtRange)")
        expectEqual(FinanceDates.displayRange(from: "2026-09-26", to: "2026-09-26"), "26 Sep 2026", "one day reads as one day")
        expectEqual(FinanceDates.displayRange(from: "2026-08-30", to: "2026-09-05"), "30 Aug – 5 Sep 2026", "range same year")
        expectEqual(FinanceDates.displayRange(from: "2025-12-15", to: "2026-01-03"), "15 Dec 2025 – 3 Jan 2026", "range across years")

        // Caps — fail closed while /me loads; permissions; the admin bridge; maker-checker.
        expectEqual(FinanceCaps(profile: nil), .loading, "nil profile → loading caps")
        expect(FinanceCaps.loading.view && !FinanceCaps.loading.export && !FinanceCaps.loading.manage && !FinanceCaps.loading.approve,
               "loading caps: reads open, every gated action closed")
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        func profile(_ json: String) -> MeProfile? { try? decoder.decode(MeProfile.self, from: Data(json.utf8)) }
        if let clerk = profile(#"{"user_id":"u-2","role":"Staff","role_keys":[],"permissions":["finance:view","finance:export"]}"#) {
            let c = FinanceCaps(profile: clerk)
            expect(c.view && c.export && !c.manage && !c.approve, "view+export grants only those")
        } else { expect(false, "decode a staff MeProfile") }
        if let admin = profile(#"{"user_id":"u-1","role":"SuperAdmin","role_keys":[],"permissions":[]}"#) {
            let c = FinanceCaps(profile: admin)
            expect(c.view && c.export && c.manage && c.approve, "SuperAdmin holds every capability")
            expect(c.canApprove(recordedBy: "u-1"), "SuperAdmin may approve their own expense")
        } else { expect(false, "decode a SuperAdmin MeProfile") }
        let approver = FinanceCaps(view: true, export: false, manage: true, approve: true, userId: "u-2")
        expect(!approver.canApprove(recordedBy: "u-2"), "maker cannot approve their own expense")
        expect(approver.canApprove(recordedBy: "u-9"), "checker may approve someone else's expense")
        expect(!FinanceCaps.loading.canApprove(recordedBy: "u-9"), "no approve while loading")

        // Status words.
        expectEqual(FinanceStatus.tone("succeeded").label, "Succeeded", "status succeeded")
        expectEqual(FinanceStatus.tone("on_track").label, "On track", "status on_track")
        expectEqual(FinanceStatus.tone("recorded").label, "Recorded", "status recorded")
        expectEqual(FinanceStatus.tone("weird_state").label, "Weird state", "unknown status title-cased")

        // Deep links from web routes (the Overview's alert links).
        let link = FinanceLink.fromWebRoute("/finance/expenses?status=recorded")
        expect(link?.section == .financeExpenses && link?.params["status"] == "recorded", "alert link → Expenses, status=recorded")
        expect(FinanceLink.fromWebRoute("/finance")?.section == .financeOverview, "/finance → Overview")
        expect(FinanceLink.fromWebRoute("/partners")?.section == .partners, "/partners → Partners")
        expect(FinanceLink.fromWebRoute("/members") == nil, "a non-Finance route is not a Finance link")

        // Download filenames.
        expectEqual(FinanceERPAPI.filename(fromContentDisposition: #"attachment; filename="transactions-2026-09.csv""#),
                    "transactions-2026-09.csv", "quoted filename")
        expectEqual(FinanceERPAPI.filename(fromContentDisposition: "attachment; filename*=UTF-8''Giving%20statement%202026.pdf"),
                    "Giving statement 2026.pdf", "RFC 5987 filename*")
        expectEqual(FinanceERPAPI.filename(fromContentDisposition: "attachment; filename=plain.csv"), "plain.csv", "bare filename")
        expectEqual(FinanceERPAPI.filename(fromContentDisposition: nil), nil, "no header")
        expectEqual(FinanceERPAPI.safeFilename("../../etc/passwd", fallbackPath: "/x.csv"), "-..-etc-passwd", "no path traversal")
        expectEqual(FinanceERPAPI.safeFilename(nil, fallbackPath: "/admin/finance/statements/u/giving.pdf"), "giving.pdf", "fallback to the path")

        // Request filters and search terms (the list and its CSV twin share `query`).
        var tf = FinTransactionFilter(period: FinancePeriod.custom(from: "2026-09-01", to: "2026-09-26"))
        tf.q = " +254712 "
        expectEqual(tf.query, ["from": "2026-09-01", "to": "2026-09-26", "q": "254712"], "transactions filter query")
        tf.pledged = "yes"; tf.status = "succeeded"
        expect(tf.query["pledged"] == "yes" && tf.query["status"] == "succeeded", "filter carries set values")
        expectEqual(FinanceERPAPI.searchTerm("   "), nil, "blank search term")

        // Decoding the wire: nulls where nullable, BIGINT as text, composed
        // results, audit metadata keys kept exactly as sent.
        func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
            do { return try decoder.decode(T.self, from: Data(json.utf8)) }
            catch { expect(false, "decode \(T.self): \(error)"); return nil }
        }
        if let page = decode(FinTransactionsPage.self, #"""
            {"data":[{"transaction_id":"t1","user_id":null,"full_name":null,"member_phone":null,"display_name":"Walk-in",
            "amount_minor":"150050","currency":"KES","status":"succeeded","fund":"tithe","fund_name":"Tithe","account_name":null,
            "method":"manual","channel":"onhand","source":"admin","provider":"manual","provider_ref":null,"receipt_code":"OR-2026-00001",
            "giver_name":"Walk-in","giver_phone":null,"pledge_id":null,"pledge_title":null,"need_id":null,"need_title":null,
            "office_channel":"onhand","office_reference":null,"recorded_by":"u1","recorded_by_name":"Clerk","reversed_at":null,
            "reversed_by":null,"reversed_by_name":null,"reversal_reason":null,"created_at":"2026-09-26T09:00:00.000Z","settled_at":null}],
            "next_cursor":null,"totals":[{"currency":"KES","amount_minor":150050,"count":1}]}
            """#) {
            expect(page.data.first?.amountMinor == 150_050 && page.data.first?.userId == nil, "transactions row: BIGINT text + null member")
            expect(page.data.first?.looksReversible == true && page.data.first?.isOffice == true, "an office gift looks reversible")
        }
        if let gift = decode(FinGiftResult.self, #"""
            {"transaction_id":"t1","status":"succeeded","provider":"manual","source":"admin","receipt_code":"OR-2026-00001",
            "amount_minor":150050,"currency":"KES","fund":{"code":"tithe","name":"Tithe"},"channel":"mpesa","reference":"QWE123RTY9",
            "received_on":"2026-09-26","created_at":"2026-09-26T09:00:00Z","settled_at":"2026-09-26T09:00:00Z","user_id":null,
            "member_name":null,"giver_name":null,"giver_phone":null,"anonymous":true,"pledge":null,"need":null,"note":null,
            "recorded_by":"u1","recorded_by_name":"Clerk","reversed_at":null,"reversed_by":null,"reversed_by_name":null,
            "reversal_reason":null,"ledger":[],"idempotency_key":"k-12345678","reused":true}
            """#) {
            expect(gift.reused && gift.receiptCode == "OR-2026-00001" && gift.fund?.code == "tithe", "gift result (composed)")
        }
        if let audit = decode(FinAuditPage.self, #"""
            {"data":[{"audit_id":"42","actor_id":null,"actor_name":null,"action":"finance.gift_recorded","entity":"transaction",
            "entity_id":"t1","metadata":{"amount_minor":150050,"office_channel":"mpesa"},"occurred_at":"2026-09-26T09:00:00Z",
            "actor_type":"System"}],"next_cursor":"41"}
            """#) {
            expect(audit.data.first?.auditId == 42 && audit.data.first?.metadata?["office_channel"] == .string("mpesa"),
                   "audit row: BIGINT id + metadata keys as sent")
        }

        // The A pages' helpers (Finance/A/FinanceARules.swift).
        let pagesA = FinanceASelfCheck.run()
        checks += pagesA.checks
        failures += pagesA.failures

        // The sidebar.
        for f in financeNavSelfCheckFailures() { expect(false, f) }
        // The Pledges … Statements pages' helpers (Features/Finance/B/FinanceBSelfCheck.swift).
        let pagesB = pagesB()
        checks += pagesB.checks
        failures += pagesB.failures
        return (checks, failures)
    }

    /// Runs the checks; prints one line when they pass, the list and an
    /// assertion when they don't (Debug only).
    static func runAtLaunch() {
        FinanceAFixtures.installIfRequested()   // no-op unless NURU_FINANCE_FIXTURES is set (A/FinanceAFixtures.swift)
        let result = run()
        if result.failures.isEmpty {
            print("FinanceSelfCheck: all \(result.checks) checks passed")
        } else {
            print("FinanceSelfCheck FAILED \(result.failures.count) of \(result.checks):\n  - "
                  + result.failures.joined(separator: "\n  - "))
            assertionFailure("FinanceSelfCheck failed — see the console")
        }
    }
}
#endif

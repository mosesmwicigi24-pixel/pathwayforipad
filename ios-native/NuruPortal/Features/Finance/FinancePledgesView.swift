// Finance → Pledges (pathway docs/FINANCE_ERP.md §5) — the pledge register.
// Every pledge is read from the SAME instalment ledger the member's statement
// and pledge card read (GET /admin/finance/pledges): the year's pledged / paid
// / remaining, instalments kept of those due, next due or "overdue since", and
// the standing the member's own card shows. Totals are per currency over the
// WHOLE filtered set. A row opens that member in Partners (member=<user_id>).
// Deep link: standing=behind (and status / shape / q / year).
import SwiftUI
import Combine

@MainActor
final class FinancePledgesModel: ObservableObject {
    @Published var filter = FinPledgeFilter(year: FinanceDates.currentYear())
    let pager = FinancePager<FinPledgesPage>()
    private var relay: AnyCancellable?

    init() { relay = finbRelay(pager) }

    var year: Int { filter.year ?? FinanceDates.currentYear() }

    var isFiltered: Bool {
        !filter.status.isEmpty || !filter.standing.isEmpty || !filter.shape.isEmpty
            || FinanceERPAPI.searchTerm(filter.q) != nil || year != FinanceDates.currentYear()
    }

    func clear() { filter = FinPledgeFilter(year: FinanceDates.currentYear()) }

    func load() async {
        let f = filter
        await pager.load { cursor in try await FinanceERPAPI.pledges(f, cursor: cursor) }
    }

    /// A deep link replaces the filters with exactly what it asks for
    /// (unknown values are ignored, never sent).
    func apply(link params: [String: String]) {
        var f = FinPledgeFilter(year: FinanceDates.currentYear())
        if let s = params["standing"], ["on_track", "behind"].contains(s) { f.standing = s }
        if let s = params["status"], ["active", "paused", "fulfilled", "cancelled"].contains(s) { f.status = s }
        if let s = params["shape"], ["monthly", "total"].contains(s) { f.shape = s }
        if let q = params["q"] { f.q = q }
        if let y = params["year"].flatMap(Int.init), (2000...2999).contains(y) { f.year = y }
        filter = f
    }

    /// The totals strip: pledged, paid and remaining per currency.
    var totalsRows: [FinBCurrencyFigures.Row] {
        pager.totals.map { t in
            FinBCurrencyFigures.Row(currency: t.currency, figures: [
                .init(label: "Pledged", minor: t.pledgedMinor),
                .init(label: "Paid", minor: t.paidMinor, tint: Nuru.success),
                .init(label: "Remaining", minor: t.remainingMinor, tint: t.remainingMinor > 0 ? FinanceStatus.amber.fg : nil),
            ], count: t.count)
        }
    }

    /// Pledges in the whole filtered set (each pledge has one currency, so the
    /// per-currency counts add up to pledges — never money).
    var totalCount: Int? { pager.phase == .loaded ? pager.totals.reduce(0) { $0 + $1.count } : nil }
}

struct FinancePledgesView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinancePledgesModel()

    static let standingOptions: [FinanceFilterOption] = [.all("Any"), .init("on_track", "On track"), .init("behind", "Behind")]
    static let statusOptions: [FinanceFilterOption] = [
        .all("All"), .init("active", "Active"), .init("paused", "Paused"), .init("fulfilled", "Fulfilled"), .init("cancelled", "Cancelled"),
    ]
    static let shapeOptions: [FinanceFilterOption] = [.all("Both"), .init("monthly", "Monthly"), .init("total", "Total by a date")]

    // Floors ≈ 720 pt: fits portrait on the 13-inch; scrolls sideways narrower.
    private static let columns: [FinanceColumn] = [
        FinanceColumn("Member", minWidth: 130),
        FinanceColumn("Pledge · pays to", minWidth: 160),
        FinanceColumn("Paid · remaining", width: 128, align: .trailing),
        FinanceColumn("Kept / due · next", width: 100),
        FinanceColumn("Standing", width: 124),
    ]

    private var yearWord: String { vm.year == FinanceDates.currentYear() ? "this year" : "in \(String(vm.year))" }

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financePledges.title,
                            subtitle: "Every pledge, read from the same instalment ledger as the member's statement: what was promised \(yearWord), what has been paid, instalments kept of those due, and who is behind — with the date they fell behind.",
                            stats: vm.totalCount.map { [HeroStat(label: "Pledges", value: String($0), hint: "in this selection")] } ?? [],
                            onRefresh: { await vm.pager.reload() }) {
            FinanceExportButton(caps: caps, path: FinanceERPAPI.pledgesCSV, query: vm.filter.query, placement: .hero)
        } content: {
            FinanceFilterBar(search: $vm.filter.q, searchPrompt: "Member name or phone, or pledge title",
                             isFiltered: vm.isFiltered, onClear: vm.clear) {
                FinanceYearMenu(year: Binding(get: { vm.year }, set: { vm.filter.year = $0 }))
                FinanceFilterMenu(title: "Standing", selection: $vm.filter.standing, options: Self.standingOptions, icon: "flag")
                FinanceFilterMenu(title: "Status", selection: $vm.filter.status, options: Self.statusOptions)
                FinanceFilterMenu(title: "Shape", selection: $vm.filter.shape, options: Self.shapeOptions)
            }
            FinBCurrencyFigures(title: "Totals \(yearWord)", rows: vm.totalsRows,
                                noun: ("pledge", "pledges"),
                                caption: "Over every pledge that matches — not just the rows loaded. KES and USD are never added.",
                                loading: vm.pager.isLoadingFirstPage || vm.pager.refreshing)
            FinBExplain(text: "Pledged: monthly instalments due in the year + total pledges' targets due in the year. Paid: succeeded payments toward the pledge \(yearWord) (the member statement's rule). Remaining: pledged minus paid, never below zero. Kept / due: monthly pledges' instalments paid in full (on time or late) of those due so far. Standing is as of today — the pledge card's own label. Newest pledge first; a row opens the member's partner record.")
            FinancePagedTable(pager: vm.pager, columns: Self.columns, emptyIcon: "signature",
                              emptyMessage: vm.isFiltered ? "No pledges match these filters." : "No pledges yet — members pledge from Give → Partners in the app.",
                              totalCount: vm.totalCount,
                              onSelect: { router.openFinance(.partners, ["member": $0.userId]) }) { p in
                row(p)
            }
        }
        .task(id: vm.filter) { await vm.load() }
        .onFinanceLink(.financePledges) { vm.apply(link: $0) }
    }

    @ViewBuilder private func row(_ p: FinPledgeRow) -> some View {
        let cols = Self.columns
        FinBPersonCell(title: p.memberName, subtitle: p.memberPhone ?? "No phone")
            .financeCell(cols[0])
        FinBPersonCell(title: p.title, subtitle: terms(p))
            .financeCell(cols[1])
        VStack(alignment: .trailing, spacing: 2) {
            FinBAmount(minor: p.paidYearMinor, currency: p.currency)
            Text("\(FinanceMoney.format(p.remainingYearMinor, "")) remaining")
                .font(.nMicro).foregroundStyle(p.remainingYearMinor > 0 ? FinanceStatus.amber.fg : Nuru.ink400)
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
        }
        .financeCell(cols[2])
        VStack(alignment: .leading, spacing: 2) {
            Text(Self.keptOfDue(p)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy).lineLimit(1)
            Text("next \(FinanceDates.display(p.nextDue))").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .financeCell(cols[3])
        VStack(alignment: .leading, spacing: 3) {
            if p.status == "cancelled" { FinanceStatusChip(status: "cancelled") }
            else { FinanceStatusChip(status: p.standing) }
            if let since = p.overdueSince, p.status != "cancelled" {
                Text("Overdue since \(FinanceDates.display(since))").font(.inter(11, .semibold))
                    .foregroundStyle(FinanceStatus.amber.fg).lineLimit(1).minimumScaleFactor(0.8)
            }
        }
        .financeCell(cols[4])
    }

    /// Kept of due as the register counts it ("7 of 9"); a total pledge has no instalments: "—".
    static func keptOfDue(_ p: FinPledgeRow) -> String { p.shape == "monthly" ? "\(p.kept) of \(p.dueCount)" : "—" }

    /// "KES 5,000.00 a month · pays to Tithe" / "KES 120,000.00 by 31 Dec 2026 · pays to Building".
    private func terms(_ p: FinPledgeRow) -> String {
        let money: String
        if p.shape == "monthly" {
            money = "\(p.amountMinor.map { FinanceMoney.format($0, p.currency) } ?? "—") a month"
        } else {
            money = (p.targetMinor.map { FinanceMoney.format($0, p.currency) } ?? "—") + (p.dueOn.map { " by \(FinanceDates.display($0))" } ?? "")
        }
        let paysTo = p.paysTo.map { " · pays to \($0.name.isEmpty ? $0.code : $0.name)" } ?? ""
        return money + paysTo
    }
}

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
        .all("Any"), .init("active", "Active"), .init("paused", "Paused"), .init("fulfilled", "Fulfilled"), .init("cancelled", "Cancelled"),
    ]
    static let shapeOptions: [FinanceFilterOption] = [.all("Any"), .init("monthly", "Monthly"), .init("total", "Total by a date")]

    // Floors ≈ 700 pt: fits portrait on the 13-inch; scrolls sideways narrower.
    private static let columns: [FinanceColumn] = [
        FinanceColumn("Member", minWidth: 130),
        FinanceColumn("Pledge · pays to", minWidth: 160),
        FinanceColumn("This year", width: 128, align: .trailing),
        FinanceColumn("Kept · next", width: 112),
        FinanceColumn("Standing", width: 84),
    ]

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financePledges.title,
                            subtitle: "Every commitment, read from the instalment ledger — the same figures the member's own statement shows.",
                            onRefresh: { await vm.pager.reload() }) {
            FinanceExportButton(caps: caps, path: FinanceERPAPI.pledgesCSV, query: vm.filter.query, placement: .hero)
        } content: {
            FinanceFilterBar(search: $vm.filter.q, searchPrompt: "Member name or phone, or the pledge title",
                             isFiltered: vm.isFiltered, onClear: vm.clear) {
                FinanceYearMenu(year: Binding(get: { vm.year }, set: { vm.filter.year = $0 }))
                FinanceFilterMenu(title: "Standing", selection: $vm.filter.standing, options: Self.standingOptions, icon: "flag")
                FinanceFilterMenu(title: "Status", selection: $vm.filter.status, options: Self.statusOptions)
                FinanceFilterMenu(title: "Shape", selection: $vm.filter.shape, options: Self.shapeOptions)
            }
            FinBCurrencyFigures(title: "\(String(vm.year)) · all matching pledges", rows: vm.totalsRows,
                                noun: ("pledge", "pledges"),
                                caption: "per currency — never added together",
                                loading: vm.pager.isLoadingFirstPage || vm.pager.refreshing)
            FinBExplain(text: "Pledged is what falls due in \(String(vm.year)): each monthly instalment dated in the year, or a total pledge's target when its date is in the year. Paid is what arrived toward the pledge in \(String(vm.year)). Remaining is pledged − paid, never below zero. Kept counts the instalments paid in full (on time or late) of those due so far.")
            FinancePagedTable(pager: vm.pager, columns: Self.columns, emptyIcon: "signature",
                              emptyMessage: vm.isFiltered ? "No pledges match these filters." : "No pledges yet — members make them in the app (Give → Partners).",
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
            Text(p.remainingYearMinor > 0
                 ? "\(FinanceMoney.format(p.remainingYearMinor, "")) left of \(FinanceMoney.format(p.pledgedYearMinor, ""))"
                 : "nothing left of \(FinanceMoney.format(p.pledgedYearMinor, ""))")
                .font(.nMicro).foregroundStyle(p.remainingYearMinor > 0 ? FinanceStatus.amber.fg : Nuru.ink600)
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
        }
        .financeCell(cols[2])
        VStack(alignment: .leading, spacing: 2) {
            Text(p.shape == "monthly" ? (p.dueCount > 0 ? "\(p.kept) of \(p.dueCount) kept" : "none due yet") : "—")
                .font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
            if let since = p.overdueSince {
                Text("overdue since \(FinanceDates.display(since))").font(.nMicro).foregroundStyle(FinanceStatus.amber.fg).lineLimit(1)
                    .minimumScaleFactor(0.8)
            } else if let next = p.nextDue {
                Text("next \(FinanceDates.display(next))").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
            } else {
                Text("nothing due").font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1)
            }
        }
        .financeCell(cols[3])
        Group {
            if p.status == "cancelled" { FinanceStatusChip(status: "cancelled") }
            else { FinanceStatusChip(status: p.standing) }
        }
        .financeCell(cols[4])
    }

    /// "Monthly KES 2,000.00 · pays to Tithe" / "Total KES 50,000.00 by 31 Dec 2026 · pays to Building".
    private func terms(_ p: FinPledgeRow) -> String {
        let money: String
        if p.shape == "monthly" {
            money = "Monthly \(p.amountMinor.map { FinanceMoney.format($0, p.currency) } ?? "—")"
        } else {
            let target = p.targetMinor.map { FinanceMoney.format($0, p.currency) } ?? "—"
            money = "Total \(target)" + (p.dueOn.map { " by \(FinanceDates.display($0))" } ?? "")
        }
        let paysTo = p.paysTo.map { " · pays to \($0.name.isEmpty ? $0.code : $0.name)" } ?? " · no active fund"
        return money + paysTo
    }
}

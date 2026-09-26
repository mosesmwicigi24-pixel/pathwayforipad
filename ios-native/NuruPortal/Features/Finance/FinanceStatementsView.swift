// Finance → Statements (pathway docs/FINANCE_ERP.md §4, §5) — the year's givers
// (GET /admin/finance/statements, finance:view): every member who gave in the
// year — succeeded gifts dated in East Africa Time, the member statement's own
// year rule, so a row foots with that member's PDF — with their gifts, totals
// per currency, giving by fund and the part toward pledges. Each member's
// Giving statement and Partner statement PDFs download to the share sheet
// (finance:view; a 404 reads "No … statement for <year>"); the list is CSV
// (finance:export). Walk-in and anonymous gifts have no member, so no statement.
import SwiftUI
import Combine

@MainActor
final class FinanceStatementsModel: ObservableObject {
    struct Filter: Equatable {
        var year = FinanceDates.currentYear()
        var q = ""
    }
    @Published var filter = Filter()
    let pager = FinancePager<FinStatementsPage>()
    private var relay: AnyCancellable?

    init() { relay = finbRelay(pager) }

    var isFiltered: Bool { filter.year != FinanceDates.currentYear() || FinanceERPAPI.searchTerm(filter.q) != nil }

    /// The list and its CSV twin take the same query.
    var query: [String: String] {
        var q = FinanceERPAPI.yearQuery(filter.year, by: nil)
        if let term = FinanceERPAPI.searchTerm(filter.q) { q["q"] = term }
        return q
    }

    func load() async {
        let f = filter
        await pager.load { cursor in try await FinanceERPAPI.statements(year: f.year, q: f.q, cursor: cursor) }
    }

    func apply(link p: [String: String]) {
        var f = Filter()
        if let y = p["year"].flatMap(Int.init), (2000...2999).contains(y) { f.year = y }
        if let q = p["q"] { f.q = q }
        filter = f
    }

    /// Gifts in the whole filtered set (each gift has one currency, so the
    /// per-currency counts add up to gifts — never money).
    var giftCount: Int { pager.totals.reduce(0) { $0 + $1.count } }
}

struct FinanceStatementsView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var vm = FinanceStatementsModel()

    private static let columns: [FinanceColumn] = [
        FinanceColumn("Member", minWidth: 160),
        FinanceColumn("Gifts", width: 52, align: .trailing),
        FinanceColumn("Given · to pledges", width: 150, align: .trailing),
        FinanceColumn("By fund", minWidth: 130),
        FinanceColumn("Statements", width: 176),
    ]

    var body: some View {
        let caps = auth.financeCaps
        let y = String(vm.filter.year)
        FinancePageScaffold(title: Section.financeStatements.title,
                            subtitle: "Every member who gave in the year, with what each gave — and each one's giving and partner statements as PDFs.",
                            onRefresh: { await vm.pager.reload() }) {
            FinanceExportButton(caps: caps, path: FinanceERPAPI.statementsCSV, query: vm.query, placement: .hero)
        } content: {
            FinanceFilterBar(search: $vm.filter.q, searchPrompt: "Member name, phone or email",
                             isFiltered: vm.isFiltered, onClear: { vm.filter = .init() }) {
                FinanceYearMenu(year: $vm.filter.year)
            }
            FinBCurrencyFigures(title: "Given in \(y) · every matching member",
                                rows: vm.pager.totals.map { .init(currency: $0.currency, figures: [.init(label: "Given", minor: $0.amountMinor, tint: Nuru.success)], count: $0.count) },
                                noun: ("gift", "gifts"), caption: "per currency — never added together",
                                loading: vm.pager.isLoadingFirstPage || vm.pager.refreshing)
            FinBExplain(text: "Gifts are dated in East Africa Time — the member statement's own year rule — so each row adds up to that member's PDF. Walk-in and anonymous gifts have no member and no statement. The Partner statement exists only for someone who has been a partner.")
            FinancePagedTable(pager: vm.pager, columns: Self.columns, emptyIcon: "doc.text",
                              emptyMessage: vm.isFiltered ? "Nobody matches — try another name or year." : "Nobody with an account gave in \(y) yet.") { r in
                // No row tap: the row carries its own PDF buttons.
                row(r, caps: caps, year: y)
            }
        }
        .task(id: vm.filter) { await vm.load() }
        .onFinanceLink(.financeStatements) { vm.apply(link: $0) }
    }

    @ViewBuilder private func row(_ r: FinStatementRow, caps: FinanceCaps, year: String) -> some View {
        let cols = Self.columns
        FinBPersonCell(title: r.fullName,
                       subtitle: [r.phone, r.email].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                           + " · last gift \(FinBTime.day(r.lastGiftAt))")
            .financeCell(cols[0])
        Text(String(r.gifts)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).monospacedDigit()
            .financeCell(cols[1])
        VStack(alignment: .trailing, spacing: 2) {
            ForEach(r.totals.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }, id: \.currency) { t in
                FinBAmount(minor: t.amountMinor, currency: t.currency)
            }
            let pledged = r.pledgePaid.filter { $0.amountMinor != 0 }.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
            if !pledged.isEmpty {
                Text(pledged.map { FinanceMoney.format($0.amountMinor, $0.currency) }.joined(separator: " · ") + " to pledges")
                    .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.8)
            }
        }
        .financeCell(cols[2])
        VStack(alignment: .leading, spacing: 2) {
            let funds = r.byFund.sorted { $0.amountMinor > $1.amountMinor }
            ForEach(Array(funds.prefix(2).enumerated()), id: \.offset) { _, f in
                Text("\(f.name.isEmpty ? f.code : f.name) \(FinanceMoney.format(f.amountMinor, f.currency))")
                    .font(.nMicro).foregroundStyle(Nuru.ink).lineLimit(1).minimumScaleFactor(0.8)
            }
            if funds.count > 2 { Text("+ \(funds.count - 2) more").font(.nMicro).foregroundStyle(Nuru.ink400) }
        }
        .financeCell(cols[3])
        HStack(spacing: 6) {
            FinBDownloadButton(caps: caps, path: FinanceERPAPI.givingStatementPath(r.userId), query: ["year": year],
                               title: "Giving", icon: "doc.text", notFound: "No giving statement for \(year)", compact: true)
            FinBDownloadButton(caps: caps, path: FinanceERPAPI.partnersStatementPath(r.userId), query: ["year": year],
                               title: "Partner", icon: "doc.richtext", notFound: "No partner statement for \(year)", compact: true)
        }
        .financeCell(cols[4])
    }
}

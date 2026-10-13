// Finance → Transactions (pathway docs/FINANCE_ERP.md §5): the register — every
// gift and purchase, online and office — filtered by period, fund, status,
// channel, source, pledge and need, with a search over receipt, name, phone and
// M-Pesa code; the per-currency totals of the WHOLE filtered set; the CSV twin;
// a detail sheet per transaction (Reverse for office gifts) and Record a gift.
// Deep links: tx=<id> opens a transaction; record=gift opens the form; the
// filter keys (from, to, fund, status, channel, source, q, pledged, need) apply.
// Two reports (owner ask, 2026-10-13), the web's tabs: Succeeded (money
// received), Failed (what did not arrive, why, who gave again within 7 days)
// and All transactions (the status filter). report= picks one; a bare
// status= link lands on the matching report.
import SwiftUI
import Combine

/// The sheet the register shows.
enum FinATxSheet: Identifiable, Equatable {
    case detail(String)
    case gift
    var id: String {
        switch self { case .detail(let id): "tx:\(id)"; case .gift: "gift" }
    }
}

@MainActor
final class FinanceTransactionsModel: ObservableObject {
    @Published var filter = FinTransactionFilter()
    @Published var report: FinTransactionsReport = .succeeded
    let pager = FinancePager<FinTransactionsPage>()
    @Published private(set) var funds: [FundOption] = []
    @Published var sheet: FinATxSheet?
    private var forward: AnyCancellable?

    init() {
        forward = pager.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    func loadFunds() async {
        guard funds.isEmpty else { return }
        funds = (try? await FinanceERPAPI.config().funds) ?? []
    }

    var fundNames: [String: String] { Dictionary(funds.map { ($0.code, $0.name) }, uniquingKeysWith: { a, _ in a }) }
    /// What is asked for: on Succeeded / Failed the report is the status.
    var effectiveFilter: FinTransactionFilter {
        var f = filter
        if report != .all { f.status = report.rawValue }
        return f
    }
    var isFiltered: Bool {
        var f = filter
        if report != .all { f.status = "" }
        return f != FinTransactionFilter()
    }
    /// Clear resets the filters, never the report.
    func clearFilters() { filter = FinTransactionFilter() }

    private static let filterKeys: Set<String> = ["from", "to", "period", "fund", "status", "channel", "source", "q", "pledged", "need", "report"]

    /// A deep link: filter keys replace the filters; tx=<id> opens that
    /// transaction; record=gift opens the form (only with finance:manage).
    func apply(_ p: [String: String], caps: FinanceCaps) {
        if !Self.filterKeys.isDisjoint(with: p.keys) {
            var f = FinTransactionFilter()
            if let period = FinanceARules.period(fromParams: p) { f.period = period }
            f.fund = p["fund"] ?? ""
            f.status = p["status"] ?? ""
            f.channel = p["channel"] ?? ""
            f.source = p["source"] ?? ""
            f.q = p["q"] ?? ""
            f.pledged = p["pledged"] ?? "any"
            f.need = p["need"] ?? "any"
            report = FinTransactionsReport.from(report: p["report"], status: p["status"])
            if report != .all { f.status = "" }
            filter = f
        }
        if let tx = p["tx"], !tx.isEmpty { sheet = .detail(tx) }
        else if p["record"] != nil, caps.manage { sheet = .gift }
    }
}

struct FinanceTransactionsView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceTransactionsModel()
    @State private var width: CGFloat = 0

    private static let statusOptions = [
        FinanceFilterOption.all("Any"), FinanceFilterOption("succeeded", "Succeeded"),
        FinanceFilterOption("processing", "Processing"), FinanceFilterOption("requires_action", "Action needed"),
        FinanceFilterOption("failed", "Failed"), FinanceFilterOption("refunded", "Refunded / reversed"),
    ]
    private static let channelOptions = [
        FinanceFilterOption.all("Any"), FinanceFilterOption("mpesa", "M-Pesa"), FinanceFilterOption("card", "Card"),
        FinanceFilterOption("airtel", "Airtel"), FinanceFilterOption("paypal", "PayPal"),
        FinanceFilterOption("onhand", "Cash on hand"), FinanceFilterOption("bank", "Bank"),
        FinanceFilterOption("cheque", "Cheque"), FinanceFilterOption("other", "Other (office)"),
        FinanceFilterOption("manual", "Confirmed claims"),
    ]
    private static let sourceOptions = [
        FinanceFilterOption.all("Any"), FinanceFilterOption("app", "Member app"),
        FinanceFilterOption("website", "Website"), FinanceFilterOption("paybill", "Paybill (direct)"),
        FinanceFilterOption("admin", "Office"),
    ]

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeTransactions.title,
                            subtitle: "Every gift and payment — online and recorded by the office. Dates are East Africa Time; an office gift is dated the day the money was received. Tap a row for its ledger postings.",
                            onRefresh: { await vm.pager.reload() }) {
            HStack(spacing: 8) {
                FinanceExportButton(caps: caps, path: FinanceERPAPI.transactionsCSV, query: vm.effectiveFilter.query, placement: .hero)
                if caps.manage {
                    HeroChip(label: "Record a gift", icon: "plus", style: .gold) { vm.sheet = .gift }
                }
            }
        } content: {
            Picker("Report", selection: $vm.report) {
                ForEach(FinTransactionsReport.allCases) { r in Text(r.label).tag(r) }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 460)
            .accessibilityLabel("Transaction reports")
            filters
            totalsBlock
            if vm.report == .failed, let reasons = vm.pager.envelope?.failureReasons, !reasons.isEmpty {
                FailureReasonsCard(reasons: reasons)
            }
            table
        }
        .task { await vm.loadFunds() }
        .task(id: vm.effectiveFilter) {
            let filter = vm.effectiveFilter
            await vm.pager.load { cursor in try await FinanceERPAPI.transactions(filter, cursor: cursor) }
        }
        .onFinanceLink(.financeTransactions) { vm.apply($0, caps: auth.financeCaps) }
        .finADebugLaunchParams(.financeTransactions) { vm.apply($0, caps: auth.financeCaps) }
        .sheet(item: $vm.sheet) { s in
            switch s {
            case .detail(let id):
                FinATransactionSheet(transactionId: id, caps: caps, fundNames: vm.fundNames,
                                     onChanged: { Task { await vm.pager.reload() } },
                                     onOpenMember: { userId, name in
                                         DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { router.member(userId, name) }
                                     },
                                     onOpenPartner: { userId in
                                         DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { router.openFinance(.partners, ["member": userId]) }
                                     },
                                     onOpenNeed: { needId in
                                         DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { router.openFinance(.financeNeeds, ["need": needId]) }
                                     })
            case .gift:
                FinARecordGiftSheet(onOpenTransaction: { id in vm.sheet = .detail(id) },
                                    onRecorded: { Task { await vm.pager.reload() } })
            }
        }
    }

    // MARK: Filters

    private var filters: some View {
        FinanceFilterBar(period: Binding(get: { vm.filter.period ?? .thisMonth }, set: { vm.filter.period = $0 }),
                         search: $vm.filter.q,
                         searchPrompt: "Receipt, name, phone, M-Pesa code",
                         isFiltered: vm.isFiltered,
                         onClear: vm.clearFilters) {
            FinanceFilterMenu(title: "Fund", selection: $vm.filter.fund,
                              options: [.all("Any")] + vm.funds.map { FinanceFilterOption($0.code, $0.isActive ? $0.name : "\($0.name) (inactive)") },
                              icon: "square.stack.3d.up")
            if vm.report == .all {
                FinanceFilterMenu(title: "Status", selection: $vm.filter.status, options: Self.statusOptions)
            }
            FinanceFilterMenu(title: "Channel", selection: $vm.filter.channel, options: Self.channelOptions)
            FinanceFilterMenu(title: "Source", selection: $vm.filter.source, options: Self.sourceOptions)
            FinanceFilterMenu(title: "Pledge", selection: anyBinding(\.pledged),
                              options: [.all("Any"), FinanceFilterOption("yes", "Yes"), FinanceFilterOption("no", "No")])
            FinanceFilterMenu(title: "Need", selection: anyBinding(\.need),
                              options: [.all("Any"), FinanceFilterOption("yes", "Yes"), FinanceFilterOption("no", "No")])
        }
    }

    // MARK: Totals

    @ViewBuilder private var totalsBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            switch vm.report {
            case .succeeded:
                FinanceTotalsStrip(totals: vm.pager.totals, title: "Received", noun: ("gift", "gifts"),
                                   loading: vm.pager.isLoadingFirstPage)
                FinAExplain("Succeeded gifts only: money that reached the church")
            case .failed:
                // What the givers tried to give — nothing was received (amount_minor is 0 here).
                FinanceTotalsStrip(totals: vm.pager.totals.map { FinCurrencyTotal(currency: $0.currency, amountMinor: $0.attemptedMinor ?? $0.amountMinor, count: $0.count) },
                                   title: "Did not arrive", noun: ("failed gift", "failed gifts"),
                                   loading: vm.pager.isLoadingFirstPage)
                FinAExplain("What these givers tried to give. Nothing was taken from them.")
            case .all:
                FinanceTotalsStrip(totals: vm.pager.totals, title: "Total", noun: ("transaction", "transactions"),
                                   loading: vm.pager.isLoadingFirstPage)
                FinAExplain("Amount = succeeded gifts only · count = every row in this filter, any status")
            }
        }
    }

    /// pledged / need carry "any" on the wire; the menu's "no filter" value is "".
    private func anyBinding(_ key: WritableKeyPath<FinTransactionFilter, String>) -> Binding<String> {
        Binding(get: { vm.filter[keyPath: key] == "any" ? "" : vm.filter[keyPath: key] },
                set: { vm.filter[keyPath: key] = $0.isEmpty ? "any" : $0 })
    }

    // MARK: Table

    /// Three layouts by the width the register gets: wide (landscape) gives
    /// channel and source their own columns; medium (13" portrait) folds them
    /// under the giver; narrow (11" portrait, split view) also stacks the
    /// receipt under the date and the fund under the giver, so the amount and
    /// status never scroll out of sight.
    private enum Layout { case wide, medium, narrow }
    private var layout: Layout { width >= 980 ? .wide : (width >= 700 ? .medium : .narrow) }

    private func columns(_ layout: Layout) -> [FinanceColumn] {
        switch layout {
        case .wide:
            return [
                FinanceColumn("Date (EAT)", width: 92), FinanceColumn("Receipt", width: 120),
                FinanceColumn("Giver", minWidth: 150), FinanceColumn("Fund", width: 110),
                FinanceColumn("Channel", width: 96), FinanceColumn("Source", width: 70),
                FinanceColumn("Amount", width: 120, align: .trailing), FinanceColumn("Status", width: 100),
            ]
        case .medium:
            return [
                FinanceColumn("Date (EAT)", width: 78), FinanceColumn("Receipt", width: 104),
                FinanceColumn("Giver", minWidth: 150), FinanceColumn("Fund", width: 92),
                FinanceColumn("Amount", width: 108, align: .trailing), FinanceColumn("Status", width: 92),
            ]
        case .narrow:
            return [
                FinanceColumn("Date · receipt", width: 108), FinanceColumn("Giver · fund", minWidth: 140),
                FinanceColumn("Amount", width: 104, align: .trailing), FinanceColumn("Status", width: 88),
            ]
        }
    }

    private var table: some View {
        let layout = self.layout
        let report = vm.report
        let cols = columns(layout).enumerated().map { i, c in
            i == columns(layout).count - 1 && report == .failed
                ? FinanceColumn("Gave again?", width: c.width, minWidth: c.minWidth, align: c.align) : c
        }
        return FinancePagedTable(pager: vm.pager, columns: cols,
                                 emptyIcon: "arrow.left.arrow.right",
                                 emptyMessage: vm.isFiltered ? "No transactions match these filters."
                                     : report == .failed ? "No failed gifts in this period."
                                     : report == .succeeded ? "No gifts received in this period yet." : "No transactions in this period yet.",
                                 totalCount: vm.pager.totals.isEmpty ? nil : vm.pager.totals.reduce(0) { $0 + $1.count },
                                 onSelect: { vm.sheet = .detail($0.transactionId) }) { t in
            let reversed = t.reversedAt != nil
            let fund = t.fundName ?? t.fund ?? "—"
            let via = "\(FinWords.channel(t.channel)) · \(FinWords.source(t.source))"
            // Date (+ receipt when narrow).
            VStack(alignment: .leading, spacing: 1) {
                Text(FinanceATime.day(t.createdAt)).font(.inter(12.5)).lineLimit(1).minimumScaleFactor(0.8)
                if layout == .narrow {
                    Text(t.receiptCode ?? FinanceATime.time(t.createdAt)).font(.nMono(10.5)).foregroundStyle(Nuru.ink600)
                        .lineLimit(1).minimumScaleFactor(0.75)
                } else if t.source != "admin" {
                    // An office gift is dated 12:00 EAT on the day it was received (a
                    // date, not a time) — only online payments have a real clock time.
                    Text(FinanceATime.time(t.createdAt)).font(.nMicro).foregroundStyle(Nuru.ink400)
                }
            }
            .financeCell(cols[0])
            if layout != .narrow {
                VStack(alignment: .leading, spacing: 1) {
                    Text(t.receiptCode ?? "—").font(.nMono(12)).foregroundStyle(t.receiptCode == nil ? Nuru.ink400 : Nuru.ink)
                        .lineLimit(1).minimumScaleFactor(0.75)
                    if let ref = t.officeReference, !ref.isEmpty, ref != t.receiptCode {
                        Text(ref).font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1)
                    }
                }
                .financeCell(cols[1])
            }
            // Giver (+ how it came, the fund when narrow, and its pledge / need).
            VStack(alignment: .leading, spacing: 2) {
                Text(t.giverLabel).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                switch layout {
                case .wide: EmptyView()
                case .medium: Text(via).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                case .narrow: Text("\(fund) · \(via)").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                }
                if t.status == "failed", let why = t.failure?.reason, !why.isEmpty {
                    Text(why).font(.nMicro).foregroundStyle(FinanceStatus.amberStrong.fg).lineLimit(2)
                }
                if t.pledgeTitle != nil || t.needTitle != nil {
                    HStack(spacing: 5) {
                        if let p = t.pledgeTitle { FinATag(text: "Pledge · \(p)", tone: FinanceStatus.navy) }
                        if let n = t.needTitle { FinATag(text: "Need · \(n)", tone: FinanceStatus.amberStrong) }
                    }
                }
            }
            .financeCell(cols[layout == .narrow ? 1 : 2])
            if layout != .narrow {
                Text(fund).font(.inter(12.5)).foregroundStyle(Nuru.ink).lineLimit(2).financeCell(cols[3])
            }
            if layout == .wide {
                Text(FinWords.channel(t.channel)).font(.inter(12.5)).lineLimit(1).financeCell(cols[4])
                Text(FinWords.source(t.source)).font(.inter(12.5)).foregroundStyle(Nuru.ink600).lineLimit(1).financeCell(cols[5])
            }
            let amountCol = cols.count - 2
            let statusCol = cols.count - 1
            Text(FinanceMoney.format(t.amountMinor, t.currency))
                .font(.nMono(13, .medium)).foregroundStyle(reversed || t.status == "failed" ? Nuru.ink400 : Nuru.navy)
                .strikethrough(reversed, color: Nuru.ink400)
                .lineLimit(1).minimumScaleFactor(0.7)
                .financeCell(cols[amountCol])
            if report == .failed {
                GaveAgainLabel(value: t.gaveAfter).financeCell(cols[statusCol])
            } else {
                FinanceStatusChip(status: reversed ? "reversed" : t.status).financeCell(cols[statusCol])
            }
        }
        .measureWidth($width)
    }
}

/// "Gave again?" on a failed row: yes (sorted out) or not yet (worth a call).
private struct GaveAgainLabel: View {
    let value: Bool?
    var body: some View {
        switch value {
        case .some(true):
            Label("Gave again", systemImage: "checkmark.circle.fill")
                .font(.inter(12, .semibold)).foregroundStyle(FinanceStatus.green.fg).lineLimit(1)
        case .some(false):
            Label("Not yet", systemImage: "phone.fill")
                .font(.inter(12, .semibold)).foregroundStyle(FinanceStatus.amberStrong.fg).lineLimit(1)
        case .none:
            Text("—").foregroundStyle(Nuru.ink400)
        }
    }
}

/// The Failed report's "why": one line per reason, most frequent first.
private struct FailureReasonsCard: View {
    let reasons: [FinFailureReason]
    var body: some View {
        let total = reasons.reduce(0) { $0 + $1.count }
        let gave = reasons.reduce(0) { $0 + $1.gaveAfter }
        FinACard(icon: "exclamationmark.triangle", title: "Why they failed",
                 caption: "\(gave) of \(total) gave again within 7 days") {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(reasons) { r in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.reason).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy)
                            Text(r.hint).font(.nMicro).foregroundStyle(Nuru.ink600)
                        }
                        Spacer(minLength: 8)
                        Text("\(r.count) \(r.count == 1 ? "gift" : "gifts")").font(.nMono(12))
                        VStack(alignment: .trailing, spacing: 1) {
                            ForEach(r.byCurrency, id: \.currency) { c in
                                Text(FinanceMoney.format(c.amountMinor, c.currency)).font(.nMono(12)).foregroundStyle(Nuru.ink600)
                            }
                        }
                        Text("\(r.gaveAfter) gave again").font(.nMicro)
                            .foregroundStyle(r.gaveAfter > 0 ? FinanceStatus.green.fg : Nuru.ink400)
                    }
                    if r.id != reasons.last?.id { Divider() }
                }
            }
        }
    }
}

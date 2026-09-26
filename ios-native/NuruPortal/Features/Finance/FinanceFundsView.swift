// Finance → Funds (pathway docs/FINANCE_ERP.md §5): every fund with its balance
// per currency (all time), income for the period and year to date, approved
// expenses and transfers in / out year to date, and its last activity. A fund
// opens its detail (recent postings); New / Edit (finance:manage), Transfer and
// Opening balance (finance:approve) are the books' fund writes.
// Deep link: fund=<code> opens that fund.
import SwiftUI
import Combine

enum FinAFundSheet: Identifiable {
    case detail(String)
    case edit(String?)
    case transfer(from: String?)
    case opening(fund: String?)
    var id: String {
        switch self {
        case .detail(let c): "detail:\(c)"
        case .edit(let c): "edit:\(c ?? "new")"
        case .transfer(let c): "transfer:\(c ?? "")"
        case .opening(let c): "opening:\(c ?? "")"
        }
    }
}

@MainActor
final class FinanceFundsModel: ObservableObject {
    @Published var period: FinancePeriod = .thisMonth
    let pager = FinancePager<FinFundsPage>()
    @Published var sheet: FinAFundSheet?
    /// A deep link's fund, opened once the rows are in.
    var pendingFund: String?
    private var forward: AnyCancellable?

    init() {
        forward = pager.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    var fundNames: [String: String] { Dictionary(pager.rows.map { ($0.code, $0.name) }, uniquingKeysWith: { a, _ in a }) }
    func row(_ code: String) -> FinFundRow? { pager.rows.first { $0.code == code } }

    func apply(_ params: [String: String]) {
        if let from = params["from"], let to = params["to"],
           FinanceDates.date(fromYMD: from) != nil, FinanceDates.date(fromYMD: to) != nil {
            period = .custom(from: from, to: to)
        }
        if let code = params["fund"], !code.isEmpty {
            pendingFund = code
            openPending()
        }
    }

    func openPending() {
        guard let code = pendingFund, row(code) != nil else { return }
        pendingFund = nil
        sheet = .detail(code)
    }
}

struct FinanceFundsView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceFundsModel()

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeFunds.title,
                            subtitle: "Where the money is held — each fund's balance, movement and history.",
                            onRefresh: { await vm.pager.reload() }) {
            HStack(spacing: 8) {
                if caps.approve {
                    HeroChip(label: "Opening balance", icon: "tray.and.arrow.down") { vm.sheet = .opening(fund: nil) }
                    HeroChip(label: "Transfer", icon: "arrow.left.arrow.right") { vm.sheet = .transfer(from: nil) }
                }
                if caps.manage {
                    HeroChip(label: "New fund", icon: "plus", style: .gold) { vm.sheet = .edit(nil) }
                }
            }
        } content: {
            FinanceFilterBar(period: $vm.period)
            VStack(alignment: .leading, spacing: 6) {
                FinanceTotalsStrip(totals: vm.pager.totals, title: "Balances", noun: ("fund", "funds"), loading: vm.pager.isLoadingFirstPage)
                FinAExplain("Every fund's balance added up per currency (all time); the count is the funds holding that currency. Income is for \(vm.period.label.lowercased()) and the year to date of its last day; expenses and transfers are year to date.")
            }
            table
        }
        .task(id: vm.period) {
            let period = vm.period
            await vm.pager.load { _ in try await FinanceERPAPI.funds(period: period) }
            vm.openPending()
        }
        .onFinanceLink(.financeFunds) { vm.apply($0) }
        .finADebugLaunchParams(.financeFunds) { vm.apply($0) }
        .sheet(item: $vm.sheet) { s in sheet(s, caps: caps) }
    }

    @ViewBuilder private func sheet(_ s: FinAFundSheet, caps: FinanceCaps) -> some View {
        switch s {
        case .detail(let code):
            if let f = vm.row(code) {
                FinAFundDetailSheet(fund: f, caps: caps, fundNames: vm.fundNames,
                                    onEdit: { vm.sheet = .edit(code) },
                                    onTransfer: { vm.sheet = .transfer(from: code) },
                                    onOpening: { vm.sheet = .opening(fund: code) },
                                    onOpenLedger: {
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                                            router.openFinance(.financeLedger, ["tab": "postings", "account": "fund:\(code)"])
                                        }
                                    })
            }
        case .edit(let code):
            FinAFundEditorSheet(fund: code.flatMap { vm.row($0) }, onSaved: { Task { await vm.pager.reload() } })
        case .transfer(let from):
            FinATransferSheet(funds: vm.pager.rows, from: from, onPosted: { Task { await vm.pager.reload() } })
        case .opening(let fund):
            FinAOpeningBalanceSheet(funds: vm.pager.rows, fund: fund, onPosted: { Task { await vm.pager.reload() } })
        }
    }

    private var columns: [FinanceColumn] { [
        FinanceColumn("Fund", minWidth: 150),
        FinanceColumn("Balance", width: 120, align: .trailing),
        FinanceColumn("Income · YTD", width: 124, align: .trailing),
        FinanceColumn("Spent YTD", width: 104, align: .trailing),
        FinanceColumn("Transfers YTD", width: 112, align: .trailing),
    ] }

    private var table: some View {
        let cols = columns
        return FinancePagedTable(pager: vm.pager, columns: cols, emptyIcon: "square.stack.3d.up",
                                 emptyMessage: "No funds yet.", onSelect: { vm.sheet = .detail($0.code) }) { f in
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(f.name).font(.inter(13.5, .semibold)).foregroundStyle(f.isActive ? Nuru.navy : Nuru.ink600).lineLimit(1)
                    if !f.isActive { FinATag(text: "Inactive", tone: FinanceStatus.grey) }
                }
                Text(f.code + (f.lastActivityAt.map { " · last \(FinanceATime.day($0))" } ?? " · no activity"))
                    .font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1)
            }
            .financeCell(cols[0])
            moneyLines(f.balances.map { ($0.currency, $0.balanceMinor) }, bold: true).financeCell(cols[1])
            VStack(alignment: .trailing, spacing: 1) {
                ForEach(f.income.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }, id: \.currency) { i in
                    Text(FinanceMoney.format(i.periodMinor, i.currency)).font(.nMono(12)).lineLimit(1).minimumScaleFactor(0.7)
                    Text("YTD " + FinanceMoney.format(i.ytdMinor, i.currency)).font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1).minimumScaleFactor(0.7)
                }
                if f.income.isEmpty { Text("—").font(.nMono(12)).foregroundStyle(Nuru.ink400) }
            }
            .financeCell(cols[2])
            moneyLines(f.expensesYtd.map { ($0.currency, $0.amountMinor) }).financeCell(cols[3])
            VStack(alignment: .trailing, spacing: 1) {
                ForEach(f.transfersInYtd.filter { $0.amountMinor != 0 }, id: \.currency) { t in
                    Text("in " + FinanceMoney.format(t.amountMinor, t.currency)).font(.nMono(11.5)).foregroundStyle(FinanceStatus.green.fg).lineLimit(1).minimumScaleFactor(0.7)
                }
                ForEach(f.transfersOutYtd.filter { $0.amountMinor != 0 }, id: \.currency) { t in
                    Text("out " + FinanceMoney.format(t.amountMinor, t.currency)).font(.nMono(11.5)).foregroundStyle(FinanceStatus.rose.fg).lineLimit(1).minimumScaleFactor(0.7)
                }
                if f.transfersInYtd.allSatisfy({ $0.amountMinor == 0 }) && f.transfersOutYtd.allSatisfy({ $0.amountMinor == 0 }) {
                    Text("—").font(.nMono(12)).foregroundStyle(Nuru.ink400)
                }
            }
            .financeCell(cols[4])
        }
    }

    private func moneyLines(_ amounts: [(String, Int)], bold: Bool = false) -> some View {
        let sorted = amounts.sorted { FinanceMoney.currencyPrecedes($0.0, $1.0) }
        return VStack(alignment: .trailing, spacing: 1) {
            if sorted.isEmpty { Text("—").font(.nMono(12)).foregroundStyle(Nuru.ink400) }
            ForEach(sorted.indices, id: \.self) { i in
                let minor = sorted[i].1
                Text(FinanceMoney.format(minor, sorted[i].0)).font(.nMono(12.5, bold ? .medium : .regular))
                    .foregroundStyle(minor < 0 ? FinanceStatus.red.fg : (bold ? Nuru.navy : Nuru.ink))
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
        }
    }
}

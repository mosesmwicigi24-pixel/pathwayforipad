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
    /// A deep link's fund / action, opened once the rows are in.
    var pendingFund: String?
    var pendingAction: String?
    private var forward: AnyCancellable?

    init() {
        forward = pager.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    var fundNames: [String: String] { Dictionary(pager.rows.map { ($0.code, $0.name) }, uniquingKeysWith: { a, _ in a }) }
    func row(_ code: String) -> FinFundRow? { pager.rows.first { $0.code == code } }

    /// fund=<code> opens that fund; action=new|edit|transfer|opening opens the
    /// write (only with its capability — manage for new/edit, approve for
    /// transfer/opening), for fund=<code> when given.
    func apply(_ params: [String: String], caps: FinanceCaps) {
        if let from = params["from"], let to = params["to"],
           FinanceDates.date(fromYMD: from) != nil, FinanceDates.date(fromYMD: to) != nil {
            period = .custom(from: from, to: to)
        }
        let code = params["fund"].flatMap { $0.isEmpty ? nil : $0 }
        switch params["action"] {
        case "new" where caps.manage: sheet = .edit(nil)
        case "edit" where caps.manage, "transfer" where caps.approve, "opening" where caps.approve:
            pendingAction = params["action"]
            pendingFund = code
            openPending()
        default:
            if let code { pendingFund = code; pendingAction = nil; openPending() }
        }
    }

    func openPending() {
        guard pendingFund != nil || pendingAction != nil, !pager.rows.isEmpty else { return }
        let code = pendingFund.flatMap { row($0) != nil ? $0 : nil }
        defer { pendingFund = nil; pendingAction = nil }
        switch pendingAction {
        case "edit": if let code { sheet = .edit(code) }
        case "transfer": sheet = .transfer(from: code)
        case "opening": sheet = .opening(fund: code)
        default: if let code { sheet = .detail(code) }
        }
    }
}

struct FinanceFundsView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceFundsModel()
    @State private var width: CGFloat = 0

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
        .onFinanceLink(.financeFunds) { vm.apply($0, caps: auth.financeCaps) }
        .finADebugLaunchParams(.financeFunds) { vm.apply($0, caps: auth.financeCaps) }
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

    /// Medium and wide give each movement its own column; narrow (11" portrait,
    /// split view) stacks them, labelled, in one — the balance never scrolls away.
    private var narrow: Bool { width > 0 && width < 700 }

    private var columns: [FinanceColumn] {
        if narrow {
            return [
                FinanceColumn("Fund", minWidth: 130),
                FinanceColumn("Balance", width: 118, align: .trailing),
                FinanceColumn("Movement", width: 170, align: .trailing),
            ]
        }
        return [
            FinanceColumn("Fund", minWidth: 150),
            FinanceColumn("Balance", width: 120, align: .trailing),
            FinanceColumn("Income · YTD", width: 124, align: .trailing),
            FinanceColumn("Spent YTD", width: 104, align: .trailing),
            FinanceColumn("Transfers YTD", width: 112, align: .trailing),
        ]
    }

    private var table: some View {
        let cols = columns
        let narrow = self.narrow
        return FinancePagedTable(pager: vm.pager, columns: cols, emptyIcon: "square.stack.3d.up",
                                 emptyMessage: "No funds yet.", onSelect: { vm.sheet = .detail($0.code) }) { f in
            VStack(alignment: .leading, spacing: 2) {
                Text(f.name).font(.inter(13.5, .semibold)).foregroundStyle(f.isActive ? Nuru.navy : Nuru.ink600).lineLimit(2)
                HStack(spacing: 6) {
                    Text(f.code).font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1)
                    if !f.isActive { FinATag(text: "Inactive", tone: FinanceStatus.grey) }
                }
                Text(f.lastActivityAt.map { "Last activity \(FinanceATime.day($0))" } ?? "No activity yet")
                    .font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1)
            }
            .financeCell(cols[0])
            moneyLines(f.balances.map { ($0.currency, $0.balanceMinor) }, bold: true).financeCell(cols[1])
            if narrow {
                VStack(alignment: .trailing, spacing: 1) {
                    ForEach(movement(f), id: \.self) { line in
                        Text(line).font(.nMono(11)).foregroundStyle(Nuru.ink).lineLimit(1).minimumScaleFactor(0.7)
                    }
                }
                .financeCell(cols[2])
            } else {
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
        .measureWidth($width)
    }

    /// The narrow layout's movement lines: "in KES 984,000.00" (period),
    /// "YTD in …", "spent …", "moved in …", "moved out …" — per currency.
    private func movement(_ f: FinFundRow) -> [String] {
        var out: [String] = []
        for i in f.income.sorted(by: { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }) {
            out.append("in " + FinanceMoney.format(i.periodMinor, i.currency))
            out.append("YTD in " + FinanceMoney.format(i.ytdMinor, i.currency))
        }
        for e in f.expensesYtd where e.amountMinor != 0 { out.append("spent " + FinanceMoney.format(e.amountMinor, e.currency)) }
        for t in f.transfersInYtd where t.amountMinor != 0 { out.append("moved in " + FinanceMoney.format(t.amountMinor, t.currency)) }
        for t in f.transfersOutYtd where t.amountMinor != 0 { out.append("moved out " + FinanceMoney.format(t.amountMinor, t.currency)) }
        return out.isEmpty ? ["—"] : out
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

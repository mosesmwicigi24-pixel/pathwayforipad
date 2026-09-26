// Finance → Funds (pathway docs/FINANCE_ERP.md §5): every fund with its balance
// per currency (credits − debits on fund:<code>, all time, gifts AND journals),
// the period's and year's income, the year's expenses and transfers, and its
// last activity (GET /admin/finance/funds). A row opens the fund (fund=<code>,
// also the Overview's link) with its latest postings. Writes: New fund / Edit
// (finance:manage), Transfer between funds and Opening balance
// (finance:approve). Funds are never deleted — deactivate instead. Same
// content and words as the web's Finance → Funds.
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
    @Published var toast: ToastData?
    /// A deep link's fund / action, opened once the rows are in.
    var pendingFund: String?
    var pendingAction: String?
    private var forward: AnyCancellable?

    init() {
        forward = pager.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    var rows: [FinFundRow] { pager.rows }
    var active: [FinFundRow] { pager.rows.filter(\.isActive) }
    func row(_ code: String) -> FinFundRow? { pager.rows.first { $0.code == code } }

    /// Σ per currency over every fund (the web's totalsByCurrency — zeros kept).
    func sum(_ pick: (FinFundRow) -> [(currency: String, minor: Int)]) -> [(currency: String, minor: Int)] {
        var by: [String: Int] = [:]
        for f in pager.rows { for a in pick(f) { by[a.currency.uppercased(), default: 0] += a.minor } }
        return by.keys.sorted(by: FinanceMoney.currencyPrecedes).map { ($0, by[$0] ?? 0) }
    }

    /// fund=<code> opens that fund; action=new|edit|transfer|opening opens the
    /// write (only with its capability — manage for new/edit, approve for
    /// transfer/opening), for fund=<code> when given; period=<preset> or from/to.
    func apply(_ params: [String: String], caps: FinanceCaps) {
        if let p = FinanceARules.period(fromParams: params) { period = p }
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

    // MARK: After a write — reload and say what happened (the web's toasts)

    func saved(_ f: FinFund, created: Bool) {
        toast = .success(created ? "Fund created — fund:\(f.code)." : (f.isActive ? "\(f.name) saved." : "\(f.name) saved — inactive now."))
        Task {
            await pager.reload()
            if created {
                // Open the new fund once the editor has gone (the web selects it).
                try? await Task.sleep(for: .milliseconds(350))
                if row(f.code) != nil { sheet = .detail(f.code) }
            }
        }
    }

    func posted(_ t: FinTransfer) {
        toast = .success("\(t.reused ? "Already posted — nothing new" : "Transfer posted"): \(FinanceMoney.format(t.amountMinor, t.currency)) from \(t.fromFund.name) to \(t.toFund.name).")
        Task { await pager.reload() }
    }

    func posted(_ j: FinJournalResult) {
        let money = j.totals.map { FinanceMoney.format($0.amountMinor, $0.currency) }.joined(separator: " + ")
        toast = .success(j.reused ? "Already posted — nothing new (\(money))." : "Opening balance posted: \(money).")
        Task { await pager.reload() }
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
                            subtitle: "Where money is given to and spent from. A balance is everything credited to the fund less everything taken out, all time; the other figures are for the period or the year. Funds are never deleted — an unused one is deactivated.",
                            onRefresh: { await vm.pager.reload() }) {
            HStack(spacing: 8) {
                if caps.manage {
                    HeroChip(label: "New fund", icon: "plus", style: .gold) { vm.sheet = .edit(nil) }
                }
                if caps.approve {
                    HeroChip(label: "Transfer between funds", icon: "arrow.left.arrow.right") { vm.sheet = .transfer(from: nil) }
                    HeroChip(label: "Opening balance", icon: "tray.and.arrow.down") { vm.sheet = .opening(fund: nil) }
                }
            }
        } content: {
            FinanceFilterBar(period: $vm.period)
            kpis
            if let warn = FinanceARules.negativeFundsSentence(vm.rows.filter { $0.balances.contains { $0.balanceMinor < 0 } }.map(\.name),
                                                             canApprove: caps.approve) {
                FinanceNoticeBar(notice: .warn(warn))
            }
            VStack(alignment: .leading, spacing: 8) {
                FinASectionTitle(icon: "square.stack.3d.up", title: "Funds")
                FinAExplain("Ordered as the pickers show them (sort order, then name). Tap a fund for its postings.")
                table(caps: caps)
            }
        }
        .task(id: vm.period) {
            let period = vm.period
            await vm.pager.load { _ in try await FinanceERPAPI.funds(period: period) }
            vm.openPending()
        }
        .onFinanceLink(.financeFunds) { vm.apply($0, caps: auth.financeCaps) }
        .finADebugLaunchParams(.financeFunds) { vm.apply($0, caps: auth.financeCaps) }
        .sheet(item: $vm.sheet) { s in sheet(s, caps: caps) }
        .toast($vm.toast)
    }

    // MARK: KPI tiles

    private var kpis: some View {
        let loading = vm.pager.isLoadingFirstPage
        let loaded = !vm.rows.isEmpty || !vm.pager.totals.isEmpty
        let inactive = vm.rows.count - vm.active.count
        return FinanceKpiGrid(minimum: 170) {
            FinanceKpiTile(label: "Held across funds", icon: "banknote", tint: Nuru.brandTint(0),
                           values: FinanceMoney.lines(vm.pager.totals.map { ($0.currency, $0.amountMinor) }),
                           hint: "Every fund's balance added up, per currency", loading: loading)
            FinanceKpiTile(label: "Income in the period", icon: "arrow.up.right", tint: Nuru.brandTint(2),
                           values: FinanceMoney.lines(vm.sum { f in f.income.map { ($0.currency, $0.periodMinor) } }),
                           hint: FinanceARules.fmtRange(from: vm.period.from, to: vm.period.to), loading: loading)
            FinanceKpiTile(label: "Expenses this year", icon: "arrow.down.right", tint: Nuru.brandTint(3),
                           values: FinanceMoney.lines(vm.sum { f in f.expensesYtd.map { ($0.currency, $0.amountMinor) } }),
                           hint: "Approved, by the day spent", loading: loading)
            FinanceKpiTile(label: "Funds", icon: "square.stack.3d.up", tint: Nuru.brandTint(1),
                           values: loaded ? ["\(vm.active.count) active"] : [],
                           hint: loaded ? FinanceARules.plural(inactive, "inactive fund") : nil, loading: loading)
        }
    }

    // MARK: Sheets

    @ViewBuilder private func sheet(_ s: FinAFundSheet, caps: FinanceCaps) -> some View {
        switch s {
        case .detail(let code):
            if let f = vm.row(code) {
                FinAFundDetailSheet(fund: f, period: vm.period, caps: caps,
                                    onEdit: { vm.sheet = .edit(code) },
                                    onTransfer: { vm.sheet = .transfer(from: code) },
                                    onOpening: { vm.sheet = .opening(fund: code) },
                                    onOpenLedger: {
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                                            router.openFinance(.financeLedger, ["account": "fund:\(code)"])
                                        }
                                    })
            }
        case .edit(let code):
            FinAFundEditorSheet(fund: code.flatMap { vm.row($0) }) { f, created in vm.saved(f, created: created) }
        case .transfer(let from):
            FinATransferSheet(funds: vm.rows, from: from) { vm.posted($0) }
        case .opening(let fund):
            FinAOpeningBalanceSheet(funds: vm.active, fund: fund) { vm.posted($0) }
        }
    }

    // MARK: Table

    /// Wide: the web's seven columns. Medium: the year's figures stack under the
    /// period's. Narrow (11" portrait, split view): every movement, labelled, in
    /// one column — the balance never scrolls away.
    private enum Layout { case wide, medium, narrow }
    private var layout: Layout { width == 0 || width >= 1000 ? .wide : width >= 700 ? .medium : .narrow }

    private var columns: [FinanceColumn] {
        switch layout {
        case .wide: return [
            FinanceColumn("Fund", minWidth: 170),
            FinanceColumn("Balance", width: 124, align: .trailing),
            FinanceColumn("Income (period)", width: 120, align: .trailing),
            FinanceColumn("Income (year)", width: 120, align: .trailing),
            FinanceColumn("Expenses (year)", width: 116, align: .trailing),
            FinanceColumn("Transfers in / out (year)", width: 132, align: .trailing),
            FinanceColumn("Last activity", width: 100),
        ]
        case .medium: return [
            FinanceColumn("Fund", minWidth: 150),
            FinanceColumn("Balance", width: 120, align: .trailing),
            FinanceColumn("Income (period · year)", width: 132, align: .trailing),
            FinanceColumn("Expenses (year)", width: 112, align: .trailing),
            FinanceColumn("Transfers in / out", width: 118, align: .trailing),
        ]
        case .narrow: return [
            FinanceColumn("Fund", minWidth: 130),
            FinanceColumn("Balance", width: 118, align: .trailing),
            FinanceColumn("Movement", width: 170, align: .trailing),
        ]
        }
    }

    private func table(caps: FinanceCaps) -> some View {
        let cols = columns
        let layout = self.layout
        return FinancePagedTable(pager: vm.pager, columns: cols, emptyIcon: "square.stack.3d.up",
                                 emptyMessage: caps.manage ? "No funds yet — create the first with New fund." : "No funds yet.",
                                 onSelect: { vm.sheet = .detail($0.code) }) { f in
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(f.name).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(2)
                    if !f.isActive { FinanceStatusChip(status: "inactive", label: "Inactive") }
                }
                Text("fund:\(f.code)" + ((f.nameSw ?? "").isEmpty ? "" : " · \(f.nameSw ?? "")"))
                    .font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1)
                if layout != .wide {
                    Text(f.lastActivityAt.map { "Last activity \(FinanceATime.day($0))" } ?? "No postings yet")
                        .font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1)
                }
            }
            .financeCell(cols[0])
            moneyLines(f.balances.map { ($0.currency, $0.balanceMinor) }, bold: true).financeCell(cols[1])
            switch layout {
            case .wide:
                moneyLines(f.income.filter { $0.periodMinor != 0 }.map { ($0.currency, $0.periodMinor) }).financeCell(cols[2])
                moneyLines(f.income.filter { $0.ytdMinor != 0 }.map { ($0.currency, $0.ytdMinor) }).financeCell(cols[3])
                moneyLines(f.expensesYtd.map { ($0.currency, $0.amountMinor) }).financeCell(cols[4])
                transfers(f).financeCell(cols[5])
                Text(f.lastActivityAt.map { FinanceATime.day($0) } ?? "—").font(.nMono(12))
                    .foregroundStyle(f.lastActivityAt == nil ? Nuru.ink400 : Nuru.ink600)
                    .lineLimit(1).minimumScaleFactor(0.8).financeCell(cols[6])
            case .medium:
                VStack(alignment: .trailing, spacing: 1) {
                    moneyLines(f.income.filter { $0.periodMinor != 0 }.map { ($0.currency, $0.periodMinor) })
                    let ytd = f.income.filter { $0.ytdMinor != 0 }.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
                    ForEach(ytd, id: \.currency) { i in
                        Text("year " + FinanceMoney.format(i.ytdMinor, i.currency)).font(.nMono(10.5)).foregroundStyle(Nuru.ink400)
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                }
                .financeCell(cols[2])
                moneyLines(f.expensesYtd.map { ($0.currency, $0.amountMinor) }).financeCell(cols[3])
                transfers(f).financeCell(cols[4])
            case .narrow:
                VStack(alignment: .trailing, spacing: 1) {
                    ForEach(movement(f), id: \.self) { line in
                        Text(line).font(.nMono(11)).foregroundStyle(Nuru.ink).lineLimit(1).minimumScaleFactor(0.7)
                    }
                }
                .financeCell(cols[2])
            }
        }
        .measureWidth($width)
    }

    /// The web's transfers cell: the year's transfers in, then out (negative); "—" when none.
    private func transfers(_ f: FinFundRow) -> some View {
        VStack(alignment: .trailing, spacing: 1) {
            if f.transfersInYtd.isEmpty && f.transfersOutYtd.isEmpty {
                Text("—").font(.nMono(12)).foregroundStyle(Nuru.ink400)
            } else {
                ForEach(f.transfersInYtd.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }, id: \.currency) { t in
                    Text(FinanceMoney.format(t.amountMinor, t.currency)).font(.nMono(12)).lineLimit(1).minimumScaleFactor(0.7)
                }
                ForEach(f.transfersOutYtd.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }, id: \.currency) { t in
                    Text(FinanceMoney.format(-t.amountMinor, t.currency)).font(.nMono(12)).foregroundStyle(FinanceStatus.red.fg)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
            }
        }
    }

    /// The narrow layout's movement lines, labelled, per currency.
    private func movement(_ f: FinFundRow) -> [String] {
        var out: [String] = []
        for i in f.income.sorted(by: { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }) {
            if i.periodMinor != 0 { out.append("period " + FinanceMoney.format(i.periodMinor, i.currency)) }
            if i.ytdMinor != 0 { out.append("year " + FinanceMoney.format(i.ytdMinor, i.currency)) }
        }
        for e in f.expensesYtd { out.append("spent " + FinanceMoney.format(e.amountMinor, e.currency)) }
        for t in f.transfersInYtd { out.append("moved in " + FinanceMoney.format(t.amountMinor, t.currency)) }
        for t in f.transfersOutYtd { out.append("moved out " + FinanceMoney.format(-t.amountMinor, t.currency)) }
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

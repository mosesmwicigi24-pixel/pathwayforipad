// Finance → Overview (pathway docs/FINANCE_ERP.md §5): where the money stands
// for a period — income against the same period last year, approved expenses,
// net, pledges still due, partners behind, the 12-month picture, money in by
// channel, the top fund balances and the work waiting — every figure PER
// CURRENCY (KES first), never added across currencies.
import SwiftUI
import Charts

@MainActor
final class FinanceOverviewModel: ObservableObject {
    @Published var period: FinancePeriod = .thisMonth
    @Published private(set) var overview: FinOverview?
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    /// The currency the 12-month chart shows (KES first).
    @Published var chartCurrency = FinanceMoney.homeCurrency
    private var generation = 0

    func load() async {
        generation += 1
        let gen = generation
        loading = true
        error = nil
        do {
            let o = try await FinanceERPAPI.overview(period: period)
            guard gen == generation else { return }
            overview = o
            if !o.series.contains(where: { $0.currency == chartCurrency }) {
                chartCurrency = o.series.first?.currency ?? FinanceMoney.homeCurrency
            }
        } catch {
            guard gen == generation else { return }
            if !Task.isCancelled { self.error = FinanceARules.message(error) }
        }
        if gen == generation { loading = false }
    }

    /// A deep link's `from`/`to` (EAT days) set a custom period.
    func apply(_ params: [String: String]) {
        if let from = params["from"], let to = params["to"],
           FinanceDates.date(fromYMD: from) != nil, FinanceDates.date(fromYMD: to) != nil {
            period = .custom(from: from, to: to)
        }
    }
}

struct FinanceOverviewView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceOverviewModel()

    var body: some View {
        FinancePageScaffold(title: Section.financeOverview.title,
                            subtitle: "Where the money stands — per currency, never added together.",
                            onRefresh: { await vm.load() }) {
            if auth.financeCaps.manage {
                HeroChip(label: "Record a gift", icon: "plus", style: .gold) {
                    router.openFinance(.financeTransactions, ["record": "gift"])
                }
            }
        } content: {
            FinanceFilterBar(period: $vm.period)
            if let o = vm.overview { periodLine(o) }
            if let o = vm.overview {
                loaded(o)
                    .opacity(vm.loading ? 0.55 : 1)
                    .animation(.easeInOut(duration: 0.2), value: vm.loading)
                if let error = vm.error {
                    FinanceNoticeBar(notice: .error("Couldn't refresh — \(error)"))
                }
            } else if let error = vm.error {
                ErrorBanner(message: error) { Task { await vm.load() } }
            } else {
                SkeletonGrid(tiles: 5, columns: 5)
                SkeletonTable(rows: 5)
            }
        }
        .task(id: vm.period) { await vm.load() }
        .onFinanceLink(.financeOverview) { vm.apply($0) }
    }

    // MARK: Period

    private func periodLine(_ o: FinOverview) -> some View {
        let p = o.period
        var text = "\(FinanceDates.displayRange(from: p.from, to: p.to)) · compared with \(FinanceDates.displayRange(from: p.lastYearFrom, to: p.lastYearTo))"
        text += " · month to date from \(FinanceDates.display(p.mtdFrom)) · year to date from \(FinanceDates.display(p.ytdFrom))"
        return FinAExplain(text + ". Income is succeeded gifts by the day they were given; expenses are approved expenses by the day they were spent (EAT).")
    }

    // MARK: Loaded

    @ViewBuilder private func loaded(_ o: FinOverview) -> some View {
        if !o.alerts.isEmpty { alerts(o.alerts) }
        kpis(o)
        chartCard(o)
        channels(o)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 16, alignment: .top)], alignment: .leading, spacing: 16) {
            fundsCard(o)
            queueCard(o)
        }
    }

    // MARK: Alerts

    private func alerts(_ list: [FinOverview.Alert]) -> some View {
        FinanceFlowLayout(spacing: 10, rowSpacing: 10) {
            ForEach(list.filter { $0.count > 0 }) { a in
                Button { open(alert: a) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: FinanceARules.alertIcon(kind: a.kind))
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(FinanceStatus.amber.fg)
                            .frame(width: 30, height: 30)
                            .background(FinanceStatus.amberStrong.bg)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(FinanceARules.alertTitle(kind: a.kind, count: a.count))
                                .font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                            let hint = FinanceARules.alertHint(kind: a.kind)
                            if !hint.isEmpty { Text(hint).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1) }
                        }
                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.ink300)
                    }
                    .padding(.leading, 8).padding(.trailing, 12).padding(.vertical, 8)
                    .background(Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Color(hex: 0xF3DFA6), lineWidth: 1))
                }
                .buttonStyle(PressableButtonStyle())
                .hoverEffect(.lift)
                .accessibilityHint("Opens the list")
            }
        }
    }

    private func open(alert a: FinOverview.Alert) {
        if let link = FinanceLink.fromWebRoute(a.link) {
            router.openFinance(link.section, link.params)
        } else {
            // A route the app does not know — fall back to the page the kind belongs to.
            switch a.kind {
            case "pending_claims": router.go(.financeClaims)
            case "expenses_awaiting_approval": router.openFinance(.financeExpenses, ["status": "recorded"])
            case "failing_schedules": router.go(.financeRecurring)
            case "partners_behind": router.go(.partners)
            default: router.openFinance(.financeReconciliation, ["tab": "exceptions"])
            }
        }
    }

    // MARK: KPI tiles

    private func kpis(_ o: FinOverview) -> some View {
        let periodQuery = ["from": o.period.from, "to": o.period.to]
        return FinanceKpiGrid(minimum: 132) {
            FinanceKpiTile(label: "Income", icon: "arrow.down.circle", tint: Nuru.brandTint(0),
                           values: FinanceMoney.lines(o.income.map { ($0.currency, $0.periodMinor) }),
                           hint: incomeHint(o)) {
                router.openFinance(.financeTransactions, periodQuery.merging(["status": "succeeded"]) { a, _ in a })
            }
            FinanceKpiTile(label: "Expenses", icon: "arrow.up.circle", tint: Nuru.brandTint(3),
                           values: FinanceMoney.lines(o.expenses.map { ($0.currency, $0.periodMinor) }),
                           hint: "Approved · " + count(o.expenses.reduce(0) { $0 + $1.periodCount }, "expense", "expenses")) {
                router.openFinance(.financeExpenses, periodQuery.merging(["status": "approved"]) { a, _ in a })
            }
            FinanceKpiTile(label: "Net", icon: "plusminus.circle", tint: Nuru.brandTint(2),
                           values: FinanceMoney.lines(o.net.map { ($0.currency, $0.periodMinor) }),
                           hint: "Year to date " + FinanceMoney.lines(o.net.map { ($0.currency, $0.ytdMinor) }).joined(separator: " · "))
            FinanceKpiTile(label: "Pledges due", icon: "signature", tint: Nuru.brandTint(1),
                           values: FinanceMoney.lines(o.outstandingPledges.map { ($0.currency, $0.remainingYearMinor) }),
                           hint: "Still due this year · " + count(o.outstandingPledges.reduce(0) { $0 + $1.pledges }, "active pledge", "active pledges")) {
                router.go(.financePledges)
            }
            FinanceKpiTile(label: "Partners behind", icon: "person.2", tint: Nuru.brandTint(3),
                           values: ["\(o.partners.behind)"],
                           hint: "of \(count(o.partners.count, "partner", "partners")) — a pledge behind today") {
                if let a = o.alerts.first(where: { $0.kind == "partners_behind" }), let link = FinanceLink.fromWebRoute(a.link) {
                    router.openFinance(link.section, link.params)
                } else {
                    router.go(.partners)
                }
            }
        }
    }

    /// "KES +12.4% · USD new vs the same period last year".
    private func incomeHint(_ o: FinOverview) -> String {
        let parts = o.income.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }.map {
            "\($0.currency) \(FinanceARules.percentChange(current: $0.periodMinor, previous: $0.samePeriodLastYearMinor))"
        }
        let gifts = o.income.reduce(0) { $0 + $1.periodCount }
        return count(gifts, "gift", "gifts") + " · " + (parts.isEmpty ? "—" : parts.joined(separator: " · ")) + " vs last year"
    }

    private func count(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n == 1 ? one : many)" }

    // MARK: 12 months

    private func chartCard(_ o: FinOverview) -> some View {
        let series = o.series.first { $0.currency == vm.chartCurrency } ?? o.series.first
        return FinACard(icon: "chart.bar.xaxis", title: "Income vs expenses", caption: "12 months to \(FinanceDates.display(o.period.to))") {
            if o.series.count > 1 {
                Picker("Currency", selection: $vm.chartCurrency) {
                    ForEach(o.series.map(\.currency).sorted(by: FinanceMoney.currencyPrecedes), id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: CGFloat(70 * o.series.count))
            }
        } content: {
            if let s = series, s.months.contains(where: { $0.incomeMinor != 0 || $0.expensesMinor != 0 }) {
                FinAIncomeExpenseChart(series: s)
                let income = s.months.reduce(0) { $0 + $1.incomeMinor }
                let spent = s.months.reduce(0) { $0 + $1.expensesMinor }
                FinAExplain("\(s.currency) over these 12 months: income \(FinanceMoney.format(income, s.currency)) · approved expenses \(FinanceMoney.format(spent, s.currency)) · net \(FinanceMoney.format(income - spent, s.currency)). The last month runs to \(FinanceDates.display(o.period.to)).")
            } else {
                EmptyState.compact(icon: "chart.bar", message: "No income or expenses in the last 12 months.")
            }
        }
    }

    // MARK: Channels

    private func channels(_ o: FinOverview) -> some View {
        let rows = o.channels.sorted {
            $0.currency != $1.currency ? FinanceMoney.currencyPrecedes($0.currency, $1.currency) : $0.netMinor > $1.netMinor
        }
        let cols = [
            FinanceColumn("Channel", minWidth: 150),
            FinanceColumn("Gifts", width: 56, align: .trailing),
            FinanceColumn("Received", width: 118, align: .trailing),
            FinanceColumn("Reversed", width: 108, align: .trailing),
            FinanceColumn("Net", width: 118, align: .trailing),
        ]
        return VStack(alignment: .leading, spacing: 8) {
            FinASectionTitle(icon: "arrow.down.to.line", title: "Money in by channel", caption: vm.period.label)
            FinanceTable(rows: rows, columns: cols, emptyIcon: "tray", emptyMessage: "No money came in during this period.") { c in
                VStack(alignment: .leading, spacing: 1) {
                    Text(FinanceARules.cashChannelLabel(c.channel)).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    Text(c.account).font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1)
                }
                .financeCell(cols[0])
                Text("\(c.count)").font(.nMono(12.5)).financeCell(cols[1])
                Text(FinanceMoney.format(c.receivedMinor, c.currency)).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
                Text(c.reversedMinor == 0 ? "—" : FinanceMoney.format(-c.reversedMinor, c.currency))
                    .font(.nMono(12.5)).foregroundStyle(c.reversedMinor == 0 ? Nuru.ink400 : FinanceStatus.violet.fg)
                    .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[3])
                Text(FinanceMoney.format(c.netMinor, c.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy)
                    .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[4])
            }
            FinAExplain("Money each cash account received in the period by the posting's date (EAT), less reversals — a reversal is dated on the gift it corrects, so net is what stayed. Daily detail: Reconciliation → Settlement.")
        }
    }

    // MARK: Funds + work

    private func fundsCard(_ o: FinOverview) -> some View {
        FinACard(icon: "square.stack.3d.up", title: "Fund balances", caption: "top \(o.fundBalances.count), all time") {
            Button { router.go(.financeFunds) } label: {
                Text("All funds").font(.inter(12, .semibold)).foregroundStyle(Nuru.goldLo)
            }
            .buttonStyle(.plain)
        } content: {
            if o.fundBalances.isEmpty {
                EmptyState.compact(icon: "square.stack.3d.up", message: "No fund holds money yet.")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(o.fundBalances.enumerated()), id: \.element.id) { i, f in
                        Button { router.openFinance(.financeFunds, ["fund": f.code]) } label: {
                            HStack(alignment: .top, spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) {
                                        Text(f.name).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                                        if !f.isActive { FinATag(text: "Inactive", tone: FinanceStatus.grey) }
                                    }
                                    Text(f.code).font(.nMono(10.5)).foregroundStyle(Nuru.ink400)
                                }
                                Spacer(minLength: 8)
                                VStack(alignment: .trailing, spacing: 2) {
                                    let lines = f.balances.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
                                    if lines.isEmpty { Text("—").font(.nMono(13)).foregroundStyle(Nuru.ink400) }
                                    ForEach(lines, id: \.currency) { b in
                                        Text(FinanceMoney.format(b.balanceMinor, b.currency)).font(.nMono(13, .medium))
                                            .foregroundStyle(b.balanceMinor < 0 ? FinanceStatus.red.fg : Nuru.navy)
                                            .lineLimit(1).minimumScaleFactor(0.7)
                                    }
                                }
                            }
                            .padding(.vertical, 9)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                    }
                }
                FinAExplain("Credits minus debits on each fund's account — gifts in, approved expenses and transfers out. Negative means more left the fund than came in.")
            }
        }
    }

    private func queueCard(_ o: FinOverview) -> some View {
        let c = o.counts
        let periodQuery = ["from": o.period.from, "to": o.period.to]
        let items: [(icon: String, label: String, value: Int, hint: String, open: () -> Void)] = [
            ("clock", "Processing now", c.processing, "Payments in flight or awaiting action",
             { router.openFinance(.financeTransactions, ["status": "processing"]) }),
            ("hourglass", "Stuck processing", c.staleProcessing, "Older than the provider's window",
             { router.openFinance(.financeReconciliation, ["tab": "exceptions"]) }),
            ("xmark.octagon", "Failed in period", c.failedInPeriod, "No money moved",
             { router.openFinance(.financeTransactions, periodQuery.merging(["status": "failed"]) { a, _ in a }) }),
            ("list.clipboard", "Claims waiting", c.pendingClaims, "Paid another way — to confirm",
             { router.go(.financeClaims) }),
            ("banknote", "Expenses to approve", c.expensesAwaitingApproval, "Recorded, not yet posted",
             { router.openFinance(.financeExpenses, ["status": "recorded"]) }),
            ("repeat.circle", "Recurring gifts to check", c.failingSchedules, "Paused or failing",
             { router.go(.financeRecurring) }),
            ("exclamationmark.triangle", "Integrity issues", c.integrityIssues, "Postings that don't balance",
             { router.openFinance(.financeReconciliation, ["tab": "exceptions"]) }),
        ]
        return FinACard(icon: "tray.full", title: "Work waiting", caption: "now") {
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, it in
                    Button(action: it.open) {
                        HStack(spacing: 10) {
                            Image(systemName: it.icon).font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(it.value > 0 ? FinanceStatus.amber.fg : Nuru.ink400)
                                .frame(width: 26, height: 26)
                                .background((it.value > 0 ? FinanceStatus.amberStrong.bg : Nuru.surface))
                                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(it.label).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                                Text(it.hint).font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1)
                            }
                            Spacer(minLength: 6)
                            Text("\(it.value)").font(.nMono(15, .medium))
                                .foregroundStyle(it.value > 0 ? Nuru.navy : Nuru.ink400)
                            Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Nuru.ink300)
                        }
                        .padding(.vertical, 7)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                }
            }
        }
    }
}

// MARK: - Chart

/// Income (green) against approved expenses (gold), month by month, one currency.
struct FinAIncomeExpenseChart: View {
    let series: FinOverview.Series

    var body: some View {
        Chart {
            ForEach(series.months) { m in
                BarMark(x: .value("Month", Self.label(m.month)), y: .value("Amount", Double(m.incomeMinor) / 100))
                    .foregroundStyle(by: .value("Kind", "Income"))
                    .position(by: .value("Kind", "Income"))
                    .cornerRadius(3)
                BarMark(x: .value("Month", Self.label(m.month)), y: .value("Amount", Double(m.expensesMinor) / 100))
                    .foregroundStyle(by: .value("Kind", "Expenses"))
                    .position(by: .value("Kind", "Expenses"))
                    .cornerRadius(3)
            }
        }
        .chartForegroundStyleScale(["Income": Nuru.lumGreen, "Expenses": Nuru.gold])
        .chartLegend(position: .top, alignment: .leading, spacing: 10)
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel().font(.inter(10.5)).foregroundStyle(Nuru.ink600)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Nuru.border)
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(FinanceMoney.compact(Int((v * 100).rounded()))).font(.inter(10.5)).foregroundStyle(Nuru.ink600)
                    }
                }
            }
        }
        .frame(height: 220)
        .accessibilityLabel("Income and expenses per month in \(series.currency)")
    }

    /// "2026-09" → "Sep"; January carries its year ("Jan ’26").
    static func label(_ ym: String) -> String {
        let names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        let parts = ym.split(separator: "-")
        guard parts.count == 2, let m = Int(parts[1]), (1...12).contains(m) else { return ym }
        return m == 1 ? "Jan ’\(parts[0].suffix(2))" : names[m - 1]
    }
}

/// A section title above a table (the tables are their own cards).
struct FinASectionTitle<Trailing: View>: View {
    var icon: String? = nil
    let title: String
    var caption: String? = nil
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            if let icon { Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.goldLo) }
            Text(title).font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
            if let caption { Text(caption).font(.nCaption).foregroundStyle(Nuru.ink600).lineLimit(1) }
            Spacer(minLength: 8)
            trailing
        }
        .padding(.top, 4)
    }
}
extension FinASectionTitle where Trailing == EmptyView {
    init(icon: String? = nil, title: String, caption: String? = nil) {
        self.init(icon: icon, title: title, caption: caption) { EmptyView() }
    }
}

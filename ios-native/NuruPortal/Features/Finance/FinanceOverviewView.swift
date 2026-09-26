// Finance → Overview (pathway docs/FINANCE_ERP.md §5): where the money stands
// for a period — income against the same period last year, approved expenses,
// net, pledges still due, partners behind; what needs attention; the 12-month
// picture; money in by channel; the largest fund balances. Every figure PER
// CURRENCY (KES first), never added across currencies. Same content and words
// as the web's Finance → Overview.
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
            if !Task.isCancelled { self.error = FinanceARules.message(error, fallback: "Could not load the overview.") }
        }
        if gen == generation { loading = false }
    }

    /// A deep link's from/to or period=<preset>.
    func apply(_ params: [String: String]) {
        if let p = FinanceARules.period(fromParams: params) { period = p }
    }
}

struct FinanceOverviewView: View {
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceOverviewModel()

    var body: some View {
        FinancePageScaffold(title: Section.financeOverview.title,
                            subtitle: "\(FinanceARules.fmtRange(from: vm.period.from, to: vm.period.to)), East Africa Time. Income is succeeded gifts dated in the period; expenses are approved expenses by the day they were spent. Each currency stands alone — KES and USD are never added.",
                            onRefresh: { await vm.load() }) {
            EmptyView()
        } content: {
            FinanceFilterBar(period: $vm.period)
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
        .finADebugLaunchParams(.financeOverview) { vm.apply($0) }
    }

    @ViewBuilder private func loaded(_ o: FinOverview) -> some View {
        kpis(o)
        attention(o)
        chartCard(o)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 560), spacing: 16, alignment: .top)], alignment: .leading, spacing: 16) {
            channels(o)
            fundsCard(o)
        }
    }

    private func open(_ route: String) {
        if let link = FinanceLink.fromWebRoute(route) { router.openFinance(link.section, link.params) }
    }

    // MARK: KPI tiles

    private func kpis(_ o: FinOverview) -> some View {
        let year = String(o.period.to.prefix(4))
        let pledges = o.outstandingPledges.reduce(0) { $0 + $1.pledges }
        let income = o.income.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
        return FinanceKpiGrid(minimum: 190) {
            FinAValueTile(label: "Income", icon: "arrow.up.right", tint: Nuru.brandTint(0),
                          lines: income.map { i in
                              let p = FinanceARules.pctChange(current: i.periodMinor, previous: i.samePeriodLastYearMinor)
                              return FinAValueTile.Line(text: FinanceMoney.format(i.periodMinor, i.currency),
                                                        sub: FinanceARules.incomeComparison(current: i.periodMinor, previous: i.samePeriodLastYearMinor, currency: i.currency),
                                                        subColor: p == nil ? Nuru.ink400 : (p ?? 0) >= 0 ? FinanceStatus.green.fg : FinanceStatus.red.fg)
                          },
                          hint: "Succeeded gifts in the period")
            FinAValueTile(label: "Expenses", icon: "arrow.down.right", tint: Nuru.brandTint(3),
                          lines: o.expenses.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
                            .map { FinAValueTile.Line(text: FinanceMoney.format($0.periodMinor, $0.currency)) },
                          hint: "Approved expenses in the period") {
                open("/finance/expenses")
            }
            FinAValueTile(label: "Net", icon: "plusminus", tint: Nuru.brandTint(2),
                          lines: o.net.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
                            .map { FinAValueTile.Line(text: FinanceMoney.format($0.periodMinor, $0.currency), color: $0.periodMinor < 0 ? FinanceStatus.red.fg : nil) },
                          hint: "Income − expenses")
            FinAValueTile(label: "Outstanding pledges", icon: "signature", tint: Nuru.brandTint(1),
                          lines: o.outstandingPledges.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
                            .map { FinAValueTile.Line(text: FinanceMoney.format($0.remainingYearMinor, $0.currency)) },
                          hint: "Still to come in \(year) on \(FinanceARules.plural(pledges, "active pledge"))") {
                open("/finance/pledges")
            }
            FinAValueTile(label: "Partners behind", icon: "person.2", tint: Nuru.brandTint(3),
                          lines: [FinAValueTile.Line(text: "\(o.partners.behind) of \(o.partners.count)",
                                                     color: o.partners.behind > 0 ? FinanceStatus.amber.fg : nil)],
                          hint: "A pledge instalment is overdue, as of today") {
                open("/finance/partners?status=behind")
            }
        }
    }

    // MARK: Needs attention

    private func attention(_ o: FinOverview) -> some View {
        let alerts = o.alerts.filter { $0.count > 0 }
        let c = o.counts
        let periodQuery = "from=\(o.period.from)&to=\(o.period.to)"
        return FinACard(icon: "bell", title: "Needs attention", caption: "Each line opens the queue behind the number.") {
            if alerts.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(FinanceStatus.green.fg)
                    Text("Nothing waiting — no claims, expenses to approve, failing recurring gifts, stuck payments or books issues.")
                        .font(.inter(13, .semibold)).foregroundStyle(FinanceStatus.green.fg).fixedSize(horizontal: false, vertical: true)
                }
            } else {
                VStack(spacing: 8) {
                    ForEach(alerts) { a in
                        let copy = FinanceARules.alertCopy(a.kind)
                        let t = FinanceARules.colors(copy.tone)
                        Button { open(FinanceARules.alertLink(kind: a.kind, link: a.link)) } label: {
                            HStack(spacing: 12) {
                                Text("\(a.count)").font(.nMono(13, .medium)).foregroundStyle(t.fg)
                                    .padding(.horizontal, 8).frame(minWidth: 30, minHeight: 26)
                                    .background(Color.white.opacity(0.7)).clipShape(Capsule())
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(copy.title(a.count)).font(.inter(13, .bold)).foregroundStyle(t.fg)
                                    Text(copy.hint).font(.nCaption).foregroundStyle(Nuru.navy.opacity(0.8)).fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 6)
                                Image(systemName: "arrow.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(t.fg)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(t.bg)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(t.border, lineWidth: 1))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressableButtonStyle())
                        .hoverEffect(.lift)
                    }
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8, alignment: .top)], alignment: .leading, spacing: 8) {
                countLink(icon: "clock", label: "Processing now", count: c.processing, hint: "Payments started and not yet settled, any age.", tone: .warn) {
                    open("/finance/transactions?status=processing&period=last_12_months")
                }
                countLink(icon: "xmark.circle", label: "Failed in the period", count: c.failedInPeriod, hint: "Cancelled or refused — nothing was posted.", tone: .info) {
                    open("/finance/transactions?status=failed&\(periodQuery)")
                }
                countLink(icon: "exclamationmark.triangle", label: "Stuck processing", count: c.staleProcessing, hint: "M-Pesa over 30 minutes, card over a day.", tone: .warn) {
                    open("/finance/reconciliation?tab=exceptions")
                }
            }
            .padding(.top, 6)
        }
    }

    private func countLink(icon: String, label: String, count: Int, hint: String, tone: FinanceARules.Tone, action: @escaping () -> Void) -> some View {
        let t = FinanceARules.colors(count > 0 ? tone : .info)
        return Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(count > 0 ? t.fg : Nuru.ink400)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 5) {
                        Text(label).font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy)
                        Text("\(count)").font(.nMono(12.5, .medium)).foregroundStyle(count > 0 ? t.fg : Nuru.ink400)
                    }
                    Text(hint).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(2)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.ink400)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(count > 0 ? t.bg : Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(count > 0 ? t.border : Nuru.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .hoverEffect(.lift)
    }

    // MARK: 12 months

    private func chartCard(_ o: FinOverview) -> some View {
        let ordered = o.series.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
        let series = ordered.first { $0.currency == vm.chartCurrency } ?? ordered.first
        let to = vm.period.to
        return FinACard(icon: "chart.bar.xaxis", title: "Income and expenses, twelve months") {
            if ordered.count > 1 {
                Picker("Currency", selection: $vm.chartCurrency) {
                    ForEach(ordered.map(\.currency), id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: CGFloat(70 * ordered.count))
            }
        } content: {
            FinAExplain("Twelve calendar months ending with \(FinAIncomeExpenseChart.monthYear(String(to.prefix(7)))) (its last day counted: \(FinanceDates.display(to))). Tap a month for the exact figures and the net.")
            if let s = series {
                FinAIncomeExpenseChart(series: s)
            } else {
                Text("No months to show.").font(.nCaption).foregroundStyle(Nuru.ink400).padding(.vertical, 24)
            }
        }
    }

    // MARK: Channels

    @State private var channelsWidth: CGFloat = 0

    private func channels(_ o: FinOverview) -> some View {
        let rows = o.channels.sorted {
            $0.currency != $1.currency ? FinanceMoney.currencyPrecedes($0.currency, $1.currency) : $0.netMinor > $1.netMinor
        }
        let currencies = Array(Set(rows.map(\.currency))).sorted(by: FinanceMoney.currencyPrecedes)
        let totals = currencies.map { c -> FinChannelTotal in
            let mine = rows.filter { $0.currency == c }
            return FinChannelTotal(channel: "Total \(c)", account: "", currency: c, count: mine.reduce(0) { $0 + $1.count },
                                   receivedMinor: mine.reduce(0) { $0 + $1.receivedMinor }, reversedMinor: mine.reduce(0) { $0 + $1.reversedMinor },
                                   netMinor: mine.reduce(0) { $0 + $1.netMinor })
        }
        let narrow = channelsWidth > 0 && channelsWidth < 600
        let cols = narrow ? [
            FinanceColumn("Channel", minWidth: 130),
            FinanceColumn("Received", width: 120, align: .trailing),
            FinanceColumn("Net", width: 120, align: .trailing),
        ] : [
            FinanceColumn("Channel", minWidth: 150),
            FinanceColumn("Gifts", width: 52, align: .trailing),
            FinanceColumn("Received", width: 116, align: .trailing),
            FinanceColumn("Reversed", width: 106, align: .trailing),
            FinanceColumn("Net", width: 116, align: .trailing),
        ]
        return VStack(alignment: .leading, spacing: 8) {
            FinASectionTitle(icon: "dollarsign.circle", title: "Money in by channel")
            FinAExplain("Received into each cash account in the period, net of reversals (a reversal is dated at the gift it corrects).")
            if rows.isEmpty {
                EmptyState.compact(icon: "tray", message: "No money received in this period. Gifts show here per channel — M-Pesa, card, cash, bank — once they settle.")
            } else {
                FinanceTable(rows: rows + totals, columns: cols, emptyIcon: "tray", emptyMessage: "") { c in
                    let total = c.account.isEmpty
                    VStack(alignment: .leading, spacing: 1) {
                        Text(total ? c.channel : FinanceARules.cashChannelLabel(c.channel))
                            .font(.inter(13.5, total ? .bold : .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        if !total { Text(c.account).font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1) }
                        if narrow && !total { Text(FinanceARules.plural(c.count, "gift")).font(.nMicro).foregroundStyle(Nuru.ink400) }
                    }
                    .financeCell(cols[0])
                    if narrow {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(FinanceMoney.format(c.receivedMinor, c.currency)).font(.nMono(12.5, total ? .medium : .regular)).lineLimit(1).minimumScaleFactor(0.7)
                            if c.reversedMinor > 0 {
                                Text(FinanceMoney.format(-c.reversedMinor, c.currency)).font(.nMono(10.5)).foregroundStyle(FinanceStatus.red.fg).lineLimit(1).minimumScaleFactor(0.7)
                            }
                        }
                        .financeCell(cols[1])
                        Text(FinanceMoney.format(c.netMinor, c.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy)
                            .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
                    } else {
                        Text("\(c.count)").font(.nMono(12.5, total ? .medium : .regular)).financeCell(cols[1])
                        Text(FinanceMoney.format(c.receivedMinor, c.currency)).font(.nMono(12.5, total ? .medium : .regular)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
                        Text(c.reversedMinor > 0 ? FinanceMoney.format(-c.reversedMinor, c.currency) : "—").font(.nMono(12.5))
                            .foregroundStyle(c.reversedMinor > 0 ? FinanceStatus.red.fg : Nuru.ink400)
                            .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[3])
                        Text(FinanceMoney.format(c.netMinor, c.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy)
                            .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[4])
                    }
                }
                .measureWidth($channelsWidth)
            }
        }
    }

    // MARK: Fund balances

    private func fundsCard(_ o: FinOverview) -> some View {
        FinACard(icon: "square.stack.3d.up", title: "Fund balances") {
            Button { router.go(.financeFunds) } label: {
                HStack(spacing: 4) {
                    Text("All funds").font(.inter(12, .semibold))
                    Image(systemName: "arrow.right").font(.system(size: 10, weight: .semibold))
                }
                .foregroundStyle(Nuru.goldLo)
            }
            .buttonStyle(.plain)
        } content: {
            FinAExplain("All time: everything credited to the fund, less what left it (expenses, transfers out). The six largest by KES.")
            if o.fundBalances.isEmpty {
                EmptyState.compact(icon: "square.stack.3d.up", message: "No fund holds money yet. Balances appear as gifts settle, expenses are approved and transfers are posted.")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(o.fundBalances.enumerated()), id: \.element.id) { i, f in
                        Button { router.openFinance(.financeFunds, ["fund": f.code]) } label: {
                            HStack(alignment: .center, spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.name).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                                    HStack(spacing: 6) {
                                        Text("fund:\(f.code)").font(.nMono(10.5)).foregroundStyle(Nuru.ink400)
                                        if !f.isActive { FinanceStatusChip(status: "inactive", label: "Inactive") }
                                    }
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
                                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.ink400)
                            }
                            .padding(.vertical, 9)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                    }
                }
            }
        }
    }
}

// MARK: - A KPI tile with per-currency lines (and a sub-line each)

/// FinanceKpiTile's look, with a colour and an optional sub-line per currency
/// line ("+12% vs KES 1,639,000.00 last year").
struct FinAValueTile: View {
    struct Line: Hashable {
        let text: String
        var color: Color? = nil
        var sub: String? = nil
        var subColor: Color = Nuru.ink400
    }
    let label: String
    let icon: String
    var tint: Nuru.Tint = Nuru.brandTint(2)
    var lines: [Line] = []
    var hint: String? = nil
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
                    .lineLimit(1).minimumScaleFactor(0.75)
                Spacer(minLength: 0)
                if action != nil {
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.ink300)
                }
            }
            if lines.isEmpty {
                Text("—").font(.inter(17, .semibold)).foregroundStyle(Nuru.ink400)
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(lines, id: \.self) { l in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(l.text).font(.inter(16, .semibold)).foregroundStyle(l.color ?? Nuru.navy)
                                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                            if let sub = l.sub {
                                Text(sub).font(.nMono(10.5)).foregroundStyle(l.subColor).fixedSize(horizontal: false, vertical: true)
                            }
                        }
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

// MARK: - Chart

/// Income (gold) against approved expenses (navy), month by month, one
/// currency — never two currencies on one axis. Tap (or drag across) a month
/// for its exact income, expenses and net (the web's tooltip).
struct FinAIncomeExpenseChart: View {
    let series: FinOverview.Series
    @State private var selected: String?

    static let incomeColor = Color(hex: 0xC89B3C)
    static let expensesColor = Color(hex: 0x1E4068)

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                legend(Self.incomeColor, "Income (succeeded gifts)")
                legend(Self.expensesColor, "Expenses (approved)")
            }
            if series.months.allSatisfy({ $0.incomeMinor == 0 && $0.expensesMinor == 0 }) {
                Text("No \(series.currency) income or expenses in these twelve months.")
                    .font(.nCaption).foregroundStyle(Nuru.ink400)
                    .frame(maxWidth: .infinity, minHeight: 200)
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Nuru.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            } else {
                chart
            }
        }
    }

    private func legend(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3, style: .continuous).fill(color).frame(width: 10, height: 10)
            Text(label).font(.inter(12)).foregroundStyle(Nuru.ink400)
        }
    }

    private var chart: some View {
        Chart {
            ForEach(series.months) { m in
                BarMark(x: .value("Month", Self.label(m.month)), y: .value("Amount", Double(m.incomeMinor) / 100))
                    .foregroundStyle(by: .value("Kind", "Income"))
                    .position(by: .value("Kind", "Income"))
                    .cornerRadius(4)
                BarMark(x: .value("Month", Self.label(m.month)), y: .value("Amount", Double(m.expensesMinor) / 100))
                    .foregroundStyle(by: .value("Kind", "Expenses"))
                    .position(by: .value("Kind", "Expenses"))
                    .cornerRadius(4)
            }
            if let sel = selected, let m = series.months.first(where: { Self.label($0.month) == sel }) {
                RuleMark(x: .value("Month", sel))
                    .foregroundStyle(Nuru.navy.opacity(0.05))
                    .lineStyle(StrokeStyle(lineWidth: 34))
                    .zIndex(-1)
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tip(m)
                    }
            }
        }
        .chartForegroundStyleScale(["Income": Self.incomeColor, "Expenses": Self.expensesColor])
        .chartLegend(.hidden)
        .chartXSelection(value: $selected)
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel().font(.inter(11)).foregroundStyle(Nuru.ink600)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Nuru.border)
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(FinanceMoney.compact(Int((v * 100).rounded()))).font(.nMono(11)).foregroundStyle(Nuru.ink600)
                    }
                }
            }
        }
        .frame(height: 240)
        .accessibilityLabel("Income and expenses per month in \(series.currency)")
    }

    private func tip(_ m: FinOverview.SeriesMonth) -> some View {
        let net = m.incomeMinor - m.expensesMinor
        return VStack(alignment: .leading, spacing: 4) {
            Text(Self.monthYear(m.month)).font(.inter(12, .bold)).foregroundStyle(Nuru.navy)
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 2) {
                GridRow {
                    Text("Income").foregroundStyle(Self.incomeColor)
                    Text(FinanceMoney.format(m.incomeMinor, series.currency)).gridColumnAlignment(.trailing).foregroundStyle(Nuru.navy)
                }
                GridRow {
                    Text("Expenses").foregroundStyle(Self.expensesColor)
                    Text(FinanceMoney.format(m.expensesMinor, series.currency)).foregroundStyle(Nuru.navy)
                }
                GridRow {
                    Text("Net").foregroundStyle(Nuru.ink400)
                    Text(FinanceMoney.format(net, series.currency)).foregroundStyle(net < 0 ? FinanceStatus.red.fg : Nuru.navy)
                }
            }
            .font(.nMono(11.5))
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .shadow(color: Color(hex: 0x071629).opacity(0.12), radius: 9, y: 6)
    }

    private static let names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    /// "2026-09" → "Sep" (twelve consecutive months never repeat a name).
    static func label(_ ym: String) -> String {
        let parts = ym.split(separator: "-")
        guard parts.count >= 2, let m = Int(parts[1]), (1...12).contains(m) else { return ym }
        return names[m - 1]
    }

    /// "2026-09" → "Sep 2026".
    static func monthYear(_ ym: String) -> String {
        let parts = ym.split(separator: "-")
        guard parts.count >= 2, let m = Int(parts[1]), (1...12).contains(m) else { return ym }
        return "\(names[m - 1]) \(parts[0])"
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

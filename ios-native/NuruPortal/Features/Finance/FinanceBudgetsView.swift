// Finance → Budgets (pathway docs/FINANCE_ERP.md §3, §5) — the year's budget in
// KES. One budget per year: started as a DRAFT (finance:manage), its lines
// edited (income lines name a fund; expense lines name a category and
// optionally a fund; twelve monthly KES amounts each), then APPROVED
// (finance:approve), which locks the lines. An approved budget shows budget
// against actual per line and month — year to date, with the variance
// (actual − budget; income below budget and expense above budget are the
// warnings) and the money no line covers. USD money is reported beside, never
// against, a budget. Editor: B/FinanceBudgetEditor.swift.
import SwiftUI
import Combine

@MainActor
final class FinanceBudgetsModel: ObservableObject {
    enum Phase: Equatable { case loading, none, draft, approved, failed(String) }

    @Published var year = FinanceDates.currentYear()
    @Published private(set) var budgets: [FinBudget] = []
    @Published private(set) var detail: FinBudgetDetail?
    @Published private(set) var actuals: FinBudgetActuals?
    @Published private(set) var actualsError: String?
    @Published private(set) var phase: Phase = .loading
    /// Bumped whenever the saved lines change, so the editor restarts from them.
    @Published private(set) var revision = 0
    @Published var notice: FinanceNotice?
    let lookups = FinBLookups()
    private var relays: [AnyCancellable] = []
    private var seq = 0

    init() { relays = [finbRelay(lookups)] }

    /// The year menu: every year with a budget, plus last, this and next year.
    var years: [Int] {
        let now = FinanceDates.currentYear()
        return Array(Set(budgets.map(\.year) + [now - 1, now, now + 1])).sorted(by: >)
    }

    func load() async {
        seq += 1
        let mine = seq
        let y = year
        if detail?.year != y { phase = .loading }
        async let funds: Void = lookups.loadFunds()
        async let categories: Void = lookups.loadCategories()
        do {
            let all = try await FinanceERPAPI.budgets()
            guard mine == seq else { _ = await (funds, categories); return }
            budgets = all
            if let b = all.first(where: { $0.year == y }) {
                let d = try await FinanceERPAPI.budget(b.budgetId)
                guard mine == seq else { _ = await (funds, categories); return }
                detail = d
                revision += 1
                if d.status == "approved" {
                    phase = .approved
                    await loadActuals(d.budgetId, seq: mine)
                } else {
                    actuals = nil
                    phase = .draft
                }
            } else {
                detail = nil
                actuals = nil
                phase = .none
            }
        } catch {
            guard mine == seq else { _ = await (funds, categories); return }
            phase = .failed(FinBError.message(error, fallback: "Could not load the budget."))
        }
        _ = await (funds, categories)
    }

    private func loadActuals(_ id: String, seq mine: Int) async {
        do {
            let a = try await FinanceERPAPI.budgetActuals(id)
            guard mine == seq else { return }
            actuals = a
            actualsError = nil
        } catch {
            guard mine == seq else { return }
            actuals = nil
            actualsError = FinBError.message(error, fallback: "Could not load budget against actual.")
        }
    }

    // MARK: writes (throw for their sheets)

    func start(name: String) async throws {
        let d = try await FinanceERPAPI.createBudget(year: year, name: name)
        detail = d
        revision += 1
        phase = .draft
        notice = .ok("The \(String(d.year)) budget is started as a draft — add its lines, save, then ask for approval.")
        budgets = (try? await FinanceERPAPI.budgets()) ?? budgets
    }

    func saveLines(_ lines: [FinBudgetLineInput]) async throws {
        guard let id = detail?.budgetId else { return }
        let d = try await FinanceERPAPI.replaceBudgetLines(id, lines)
        detail = d
        revision += 1
        notice = .ok("Saved \(d.lines.count) line\(d.lines.count == 1 ? "" : "s") — income \(FinanceMoney.format(d.incomeTotalMinor, "KES")), expense \(FinanceMoney.format(d.expenseTotalMinor, "KES")).")
    }

    func approve() async throws {
        guard let id = detail?.budgetId else { return }
        let d = try await FinanceERPAPI.approveBudget(id)
        detail = d
        revision += 1
        phase = .approved
        notice = .ok("The \(String(d.year)) budget is approved — its lines are locked and budget against actual has started.")
        await loadActuals(d.budgetId, seq: seq)
        budgets = (try? await FinanceERPAPI.budgets()) ?? budgets
    }
}

struct FinanceBudgetsView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var vm = FinanceBudgetsModel()
    @State private var starting = false

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeBudgets.title,
                            subtitle: "The year's plan in KES, and how the year is going against it.",
                            stats: stats,
                            onRefresh: { await vm.load() }) {
            if let n = vm.notice { FinanceNoticeBar(notice: n) { vm.notice = nil } }
            HStack(spacing: 10) {
                FinanceYearMenu(year: $vm.year, years: vm.years)
                if let d = vm.detail { FinanceStatusChip(status: d.status) }
                Spacer(minLength: 0)
            }
            FinBExplain(text: "Budgets are in KES. USD gifts and expenses are reported beside the budget, never against it.")
            switch vm.phase {
            case .loading:
                SkeletonTable(rows: 5)
            case .failed(let message):
                ErrorBanner(message: message) { Task { await vm.load() } }
            case .none:
                EmptyState(icon: "chart.bar.doc.horizontal", title: "No budget for \(String(vm.year))",
                           message: caps.manage ? "Start it as a draft: add the income and expense lines, save them, then have it approved."
                                                : "Someone with finance:manage starts a year's budget.",
                           actionTitle: caps.manage ? "Start the \(String(vm.year)) budget" : nil,
                           action: caps.manage ? { starting = true } : nil)
            case .draft:
                if let d = vm.detail {
                    FinanceBudgetEditor(detail: d, lookups: vm.lookups, caps: caps,
                                        onSave: { try await vm.saveLines($0) },
                                        onApprove: { try await vm.approve() })
                        .id("\(d.budgetId)#\(vm.revision)")
                }
            case .approved:
                if let d = vm.detail {
                    approvedHeader(d)
                    if let a = vm.actuals {
                        FinanceBudgetActualsView(actuals: a)
                    } else {
                        if let e = vm.actualsError { FinanceNoticeBar(notice: .error(e)) }
                        FinanceBudgetLinesReadOnly(lines: d.lines)
                    }
                }
            }
        }
        .task(id: vm.year) { await vm.load() }
        .sheet(isPresented: $starting) {
            FinanceBudgetStartSheet(year: vm.year) { name in try await vm.start(name: name) }
        }
    }

    private var stats: [HeroStat] {
        guard let d = vm.detail else { return [] }
        let net = d.incomeTotalMinor - d.expenseTotalMinor
        return [
            HeroStat(label: "Income planned", value: FinanceMoney.format(d.incomeTotalMinor, "KES"), hint: "\(String(d.year)) · all income lines"),
            HeroStat(label: "Expense planned", value: FinanceMoney.format(d.expenseTotalMinor, "KES"), hint: "all expense lines"),
            HeroStat(label: net < 0 ? "Planned deficit" : "Planned surplus", value: FinanceMoney.format(abs(net), "KES"),
                     hint: "income − expense", tint: net < 0 ? Color(hex: 0xF5C77E) : nil),
        ]
    }

    private func approvedHeader(_ d: FinBudgetDetail) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "lock.fill").font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.success)
            Text("\(d.name) — approved by \(d.approvedByName ?? "—") on \(FinBTime.day(d.approvedAt)). Its \(d.lineCount) line\(d.lineCount == 1 ? " is" : "s are") locked.")
                .font(.nCaption).foregroundStyle(Nuru.ink)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(FinanceStatus.green.bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
    }
}

// MARK: - Approved: budget against actual

struct FinanceBudgetActualsView: View {
    let actuals: FinBudgetActuals
    @State private var monthsFor: FinBudgetActuals.Line?

    private var ytd: Int { FinBMath.ytdMonths(year: actuals.year) }
    private var ytdLabel: String {
        switch ytd {
        case 0: "not started"
        case 12: "the whole year"
        case 1: "January"
        default: "Jan – \(FinBMath.monthName(ytd - 1))"
        }
    }

    private static let columns: [FinanceColumn] = [
        FinanceColumn("Line", minWidth: 160),
        FinanceColumn("Budget YTD", width: 110, align: .trailing),
        FinanceColumn("Actual YTD", width: 110, align: .trailing),
        FinanceColumn("Variance", width: 120, align: .trailing),
        FinanceColumn("Year budget", width: 110, align: .trailing),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            FinBExplain(text: "Year to date is \(ytdLabel) \(String(actuals.year)). Actual income is succeeded KES gifts to the line's fund by the month they were given; actual expense is approved KES expenses in the line's category (and fund, when the line names one) by the day spent. Variance = actual − budget: income below budget and expense above budget are flagged. Tap a line for its twelve months.")
            ForEach(["income", "expense"], id: \.self) { kind in
                section(kind)
            }
        }
        .sheet(item: $monthsFor) { line in
            FinanceBudgetMonthsSheet(line: line, months: actuals.months)
        }
    }

    @ViewBuilder private func section(_ kind: String) -> some View {
        let lines = actuals.lines.filter { $0.kind == kind }
        let total = actuals.totals.first { $0.kind == kind }
        FinBCard(title: kind == "income" ? "Income" : "Expense",
                 caption: "KES · all \(kind) lines · \(ytdLabel)", icon: kind == "income" ? "arrow.down.circle" : "arrow.up.circle") {
            if let total {
                FinanceFlowLayout(spacing: 22, rowSpacing: 10) {
                    figure("Budget YTD", FinBMath.sumPrefix(total.budgetMinor, ytd))
                    figure("Actual YTD", FinBMath.sumPrefix(total.actualMinor, ytd))
                    varianceFigure(kind, FinBMath.sumPrefix(total.actualMinor, ytd) - FinBMath.sumPrefix(total.budgetMinor, ytd))
                    figure("Year budget", total.budgetTotalMinor)
                    figure("Year actual", total.actualTotalMinor)
                }
            } else {
                Text("No totals for \(kind).").font(.nCaption).foregroundStyle(Nuru.ink400)
            }
        }
        FinanceTable(rows: lines, columns: Self.columns, emptyIcon: "list.bullet",
                     emptyMessage: "No \(kind) lines in this budget.", onSelect: { monthsFor = $0 }) { l in
            let budget = FinBMath.sumPrefix(l.budgetMinor, ytd)
            let actual = FinBMath.sumPrefix(l.actualMinor, ytd)
            FinBPersonCell(title: l.label, subtitle: lineTarget(l))
                .financeCell(Self.columns[0])
            Text(FinanceMoney.format(budget, "")).font(.inter(12.5, .medium)).monospacedDigit().foregroundStyle(Nuru.navy)
                .financeCell(Self.columns[1])
            Text(FinanceMoney.format(actual, "")).font(.inter(12.5, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                .financeCell(Self.columns[2])
            FinanceBudgetVariance(kind: kind, minor: actual - budget)
                .financeCell(Self.columns[3])
            Text(FinanceMoney.format(l.budgetTotalMinor, "")).font(.inter(12.5)).monospacedDigit().foregroundStyle(Nuru.ink600)
                .financeCell(Self.columns[4])
        }
        if let total, FinBMath.sumPrefix(total.unbudgetedMinor, ytd) != 0 {
            FinBExplain(text: "Not in any line: \(FinanceMoney.format(FinBMath.sumPrefix(total.unbudgetedMinor, ytd), "KES")) of actual \(kind) year to date (\(FinanceMoney.format(total.unbudgetedTotalMinor, "KES")) for the year) — no \(kind) line covers it.",
                        icon: "exclamationmark.circle")
        }
    }

    private func figure(_ label: String, _ minor: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(.inter(10, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
            Text(FinanceMoney.format(minor, "KES")).font(.inter(14, .semibold)).foregroundStyle(Nuru.navy).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.8)
        }
    }

    private func varianceFigure(_ kind: String, _ minor: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("VARIANCE").font(.inter(10, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
            FinanceBudgetVariance(kind: kind, minor: minor, size: 14)
        }
    }

    private func lineTarget(_ l: FinBudgetActuals.Line) -> String {
        if l.kind == "income" { return "fund · \(l.fund?.name ?? "—")" }
        let cat = l.category?.name ?? "—"
        return l.fund.map { "\(cat) · \($0.name)" } ?? "\(cat) · church-wide"
    }
}

/// actual − budget, signed and coloured by what it means for the kind:
/// income below budget (amber) and expense above budget (red) are warnings.
struct FinanceBudgetVariance: View {
    let kind: String
    let minor: Int
    var size: CGFloat = 12.5

    var body: some View {
        let warn = kind == "income" ? minor < 0 : minor > 0
        let text = minor == 0 ? "on budget" : (minor > 0 ? "+" : "") + FinanceMoney.format(minor, "")
        VStack(alignment: .trailing, spacing: 1) {
            Text(text).font(.inter(size, .semibold)).monospacedDigit()
                .foregroundStyle(minor == 0 ? Nuru.ink600 : warn ? (kind == "income" ? FinanceStatus.amber.fg : FinanceStatus.red.fg) : Nuru.success)
                .lineLimit(1).minimumScaleFactor(0.8)
            if minor != 0 {
                Text(kind == "income" ? (minor < 0 ? "below budget" : "above budget") : (minor > 0 ? "over budget" : "under budget"))
                    .font(.nMicro).foregroundStyle(Nuru.ink400)
            }
        }
    }
}

/// One line's twelve months: budget, actual, variance.
struct FinanceBudgetMonthsSheet: View {
    let line: FinBudgetActuals.Line
    let months: [String]
    @Environment(\.dismiss) private var dismiss

    private static let columns: [FinanceColumn] = [
        FinanceColumn("Month", width: 90),
        FinanceColumn("Budget", minWidth: 120, align: .trailing),
        FinanceColumn("Actual", minWidth: 120, align: .trailing),
        FinanceColumn("Variance", minWidth: 130, align: .trailing),
    ]

    private struct Row: Identifiable { let id: Int; let budget: Int; let actual: Int; let variance: Int }

    var body: some View {
        let rows = (0..<12).map { i in
            Row(id: i, budget: line.budgetMinor.indices.contains(i) ? line.budgetMinor[i] : 0,
                actual: line.actualMinor.indices.contains(i) ? line.actualMinor[i] : 0,
                variance: line.varianceMinor.indices.contains(i) ? line.varianceMinor[i] : 0)
        }
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(line.label).font(.inter(17, .bold)).foregroundStyle(Nuru.navy)
                    FinanceTable(rows: rows, columns: Self.columns) { r in
                        Text(FinBMath.monthName(r.id)).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).financeCell(Self.columns[0])
                        Text(FinanceMoney.format(r.budget, "")).font(.inter(12.5)).monospacedDigit().financeCell(Self.columns[1])
                        Text(FinanceMoney.format(r.actual, "")).font(.inter(12.5, .semibold)).monospacedDigit().financeCell(Self.columns[2])
                        FinanceBudgetVariance(kind: line.kind, minor: r.variance).financeCell(Self.columns[3])
                    }
                    HStack(spacing: 18) {
                        Text("Year: budget \(FinanceMoney.format(line.budgetTotalMinor, "KES")) · actual \(FinanceMoney.format(line.actualTotalMinor, "KES"))")
                            .font(.nCaption).foregroundStyle(Nuru.ink600)
                        Spacer(minLength: 0)
                        FinanceBudgetVariance(kind: line.kind, minor: line.varianceTotalMinor)
                    }
                }
                .padding(24)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .navigationTitle("Budget against actual")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.large])
    }
}

/// The locked lines when budget against actual could not be read.
struct FinanceBudgetLinesReadOnly: View {
    let lines: [FinBudgetLine]
    private static let columns: [FinanceColumn] = [
        FinanceColumn("Line", minWidth: 180),
        FinanceColumn("Kind", width: 80),
        FinanceColumn("Year", width: 140, align: .trailing),
    ]
    var body: some View {
        FinanceTable(rows: lines, columns: Self.columns, emptyMessage: "No lines.") { l in
            FinBPersonCell(title: l.label, subtitle: l.kind == "income" ? (l.fund?.name ?? "—")
                           : [l.category?.name, l.fund?.name ?? "church-wide"].compactMap { $0 }.joined(separator: " · "))
                .financeCell(Self.columns[0])
            Text(l.kind == "income" ? "Income" : "Expense").font(.inter(12.5)).financeCell(Self.columns[1])
            FinBAmount(minor: l.totalMinor, currency: "KES").financeCell(Self.columns[2])
        }
    }
}

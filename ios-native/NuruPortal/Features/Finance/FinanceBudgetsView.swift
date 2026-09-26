// Finance → Budgets (pathway docs/FINANCE_ERP.md §3, §5) — one budget per year,
// in KES. No budget yet → "Start the <year> budget" (finance:manage). A draft is
// edited line by line — income per fund, expenses per category (church-wide or
// per fund), twelve months each — and saved (finance:manage), then approved
// (finance:approve), which locks the lines. An approved budget shows budget
// against actual per line and month, year to date and the year, with the
// variance coloured where it needs attention (income below budget, spending
// above it) and the money no line covers; USD is reported beside the budget,
// never against it. Mirrors admin-web Budgets.tsx + BudgetActuals.tsx.
// Editor: B/FinanceBudgetEditor.swift.
import SwiftUI
import Combine

@MainActor
final class FinanceBudgetsModel: ObservableObject {
    enum Phase: Equatable { case loading, none, draft, approved, failed(String) }

    @Published private(set) var year = FinanceDates.currentYear()
    @Published private(set) var budgets: [FinBudget] = []
    @Published private(set) var detail: FinBudgetDetail?
    @Published private(set) var actuals: FinBudgetActuals?
    @Published private(set) var actualsError: String?
    /// Non-KES income and spending in the year — outside the budget (Reports).
    @Published private(set) var outside: (income: [FinCurrencyAmount], expenses: [FinCurrencyAmount])?
    @Published private(set) var outsideError = false
    @Published private(set) var phase: Phase = .loading
    /// Bumped whenever the saved lines change, so the editor restarts from them.
    @Published private(set) var revision = 0
    /// The editor holds unsaved changes.
    @Published var dirty = false
    @Published var notice: FinanceNotice?
    let lookups = FinBLookups()
    private var relays: [AnyCancellable] = []
    private var seq = 0

    init() { relays = [finbRelay(lookups)] }

    /// Next year, this year and four back, plus every year with a budget.
    var years: [Int] { FinBMath.planningYears(extra: budgets.map(\.year)) }
    var summary: FinBudget? { budgets.first { $0.year == year } }

    func choose(year y: Int) {
        guard y != year else { return }
        year = y
        dirty = false
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
            if mine == seq {
                budgets = all
                if let b = all.first(where: { $0.year == y }) {
                    let d = try await FinanceERPAPI.budget(b.budgetId)
                    if mine == seq {
                        detail = d
                        revision += 1
                        if d.status == "approved" {
                            phase = .approved
                            await loadActuals(d, seq: mine)
                        } else {
                            actuals = nil
                            phase = .draft
                        }
                    }
                } else {
                    detail = nil
                    actuals = nil
                    phase = .none
                }
            }
        } catch {
            if mine == seq { phase = .failed(FinBError.message(error, fallback: "Could not load the budgets.")) }
        }
        _ = await (funds, categories)
    }

    private func loadActuals(_ d: FinBudgetDetail, seq mine: Int) async {
        async let usd: Void = loadOutside(d.year, seq: mine)
        do {
            let a = try await FinanceERPAPI.budgetActuals(d.budgetId)
            if mine == seq { actuals = a; actualsError = nil }
        } catch {
            if mine == seq { actuals = nil; actualsError = FinBError.message(error, fallback: "Could not load budget vs actual.") }
        }
        _ = await usd
    }

    /// Everything outside the budget: the year's non-KES income and spending.
    private func loadOutside(_ y: Int, seq mine: Int) async {
        do {
            async let inc = FinanceERPAPI.incomeReport(year: y, by: "fund")
            async let exp = FinanceERPAPI.expensesReport(year: y, by: "category")
            let (i, e) = try await (inc, exp)
            func pick(_ m: FinReportMatrix) -> [FinCurrencyAmount] {
                m.currencies.filter { $0.currency != "KES" && $0.totals.totalMinor != 0 }
                    .map { FinCurrencyAmount(currency: $0.currency, amountMinor: $0.totals.totalMinor) }
            }
            if mine == seq { outside = (pick(i), pick(e)); outsideError = false }
        } catch {
            if mine == seq { outside = nil; outsideError = true }
        }
    }

    // MARK: writes (throw for their sheets)

    func start() async throws {
        let d = try await FinanceERPAPI.createBudget(year: year, name: "\(year) budget")
        notice = .ok("Started the \(String(year)) budget as a draft — add its lines, save, then approve")
        detail = d
        revision += 1
        phase = .draft
        budgets = (try? await FinanceERPAPI.budgets()) ?? budgets
    }

    func rename(_ name: String) async throws {
        guard let id = detail?.budgetId else { return }
        let d = try await FinanceERPAPI.updateBudget(id, name: name)
        notice = .ok("Renamed to “\(d.name)”")
        detail = d
        budgets = (try? await FinanceERPAPI.budgets()) ?? budgets
    }

    func saveLines(_ lines: [FinBudgetLineInput]) async throws {
        guard let id = detail?.budgetId else { return }
        let d = try await FinanceERPAPI.replaceBudgetLines(id, lines)
        detail = d
        revision += 1
        dirty = false
        notice = .ok("Saved \(d.lines.count) \(d.lines.count == 1 ? "line" : "lines") — income \(FinanceMoney.format(d.incomeTotalMinor, "KES")), expenses \(FinanceMoney.format(d.expenseTotalMinor, "KES"))")
        budgets = (try? await FinanceERPAPI.budgets()) ?? budgets
    }

    func approve() async throws {
        guard let id = detail?.budgetId else { return }
        let d = try await FinanceERPAPI.approveBudget(id)
        notice = .ok("Approved the \(String(d.year)) budget — its lines are locked")
        detail = d
        revision += 1
        phase = .approved
        budgets = (try? await FinanceERPAPI.budgets()) ?? budgets
        await loadActuals(d, seq: seq)
    }
}

struct FinanceBudgetsView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var vm = FinanceBudgetsModel()
    @State private var ask: Ask?

    enum Ask: Identifiable {
        case start, approve, rename, leave(Int)
        var id: String {
            switch self {
            case .start: "start"
            case .approve: "approve"
            case .rename: "rename"
            case .leave(let y): "leave\(y)"
            }
        }
    }

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeBudgets.title,
                            subtitle: "The year's plan in KES — income per fund and spending per category, month by month — and, once approved, how the year is tracking against it.",
                            stats: stats,
                            onRefresh: { await vm.load() }) {
            FinanceYearMenu(year: Binding(get: { vm.year }, set: { y in
                if vm.dirty { ask = .leave(y) } else { vm.choose(year: y) }
            }), years: vm.years)
        } content: {
            if let n = vm.notice { FinanceNoticeBar(notice: n) { vm.notice = nil } }
            if vm.dirty { FinanceNoticeBar(notice: .warn("Unsaved changes to the lines — save them before approving or leaving this year.")) }
            switch vm.phase {
            case .loading:
                SkeletonTable(rows: 5)
            case .failed(let message):
                ErrorBanner(message: message) { Task { await vm.load() } }
            case .none:
                EmptyState(icon: "scalemass", title: "No budget for \(String(vm.year)) yet",
                           message: "A budget sets what the church expects to receive into each fund and to spend in each category, month by month, in KES. Once approved, this page compares it with what actually came in and went out."
                               + (caps.manage ? "" : " Starting a budget needs finance:manage."),
                           actionTitle: caps.manage ? "Start the \(String(vm.year)) budget" : nil,
                           action: caps.manage ? { ask = .start } : nil)
            case .draft:
                if let d = vm.detail { draft(d, caps: caps) }
            case .approved:
                if let d = vm.detail { approved(d) }
            }
        }
        .task(id: vm.year) { await vm.load() }
        .onFinanceLink(.financeBudgets) { p in
            if let y = p["year"].flatMap(Int.init), (2020...2100).contains(y) {
                if vm.dirty { ask = .leave(y) } else { vm.choose(year: y) }
            }
        }
        .sheet(item: $ask) { a in sheet(a) }
    }

    private var stats: [HeroStat] {
        guard vm.phase != .loading else { return [] }
        let s = vm.summary
        return [
            HeroStat(label: "\(String(vm.year)) budget", value: s.map { FinanceStatus.tone($0.status).label } ?? "None yet",
                     hint: s.map { "\($0.lineCount) \($0.lineCount == 1 ? "line" : "lines")" } ?? "one budget per year"),
            HeroStat(label: "Income budgeted", value: s.map { FinanceMoney.format($0.incomeTotalMinor, "KES") } ?? "—", hint: "saved lines, KES"),
            HeroStat(label: "Spending budgeted", value: s.map { FinanceMoney.format($0.expenseTotalMinor, "KES") } ?? "—", hint: "saved lines, KES"),
            HeroStat(label: "Budgeted surplus", value: s.map { FinanceMoney.format($0.incomeTotalMinor - $0.expenseTotalMinor, "KES") } ?? "—",
                     hint: "income − spending"),
        ]
    }

    private func draft(_ d: FinBudgetDetail, caps: FinanceCaps) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "pencil.line").font(.system(size: 14, weight: .semibold)).foregroundStyle(FinanceStatus.amber.fg)
                VStack(alignment: .leading, spacing: 3) {
                    Text(d.name).font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
                    Text("Draft · \(d.lineCount) saved \(d.lineCount == 1 ? "line" : "lines") · started by \(d.createdByName ?? "someone") \(FinBTime.stamp(d.createdAt))")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                }
                Spacer(minLength: 8)
                if caps.manage { FinanceButton(title: "Rename", icon: "character.cursor.ibeam") { ask = .rename } }
                if caps.approve {
                    FinanceButton(title: "Approve", icon: "checkmark.circle", style: .primary) { ask = .approve }
                        .disabled(vm.dirty || d.lineCount == 0)
                        .opacity(vm.dirty || d.lineCount == 0 ? 0.5 : 1)
                }
            }
            if caps.approve, vm.dirty || d.lineCount == 0 {
                Text(vm.dirty ? "Save the lines first — approval locks what is saved." : "Add and save at least one line before approving.")
                    .font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            if !caps.manage {
                FinanceNoticeBar(notice: .ok("A draft — shown read-only. Editing lines needs finance:manage."))
            }
            FinanceBudgetEditor(detail: d, lookups: vm.lookups, caps: caps,
                                onSave: { try await vm.saveLines($0) },
                                onDirtyChange: { vm.dirty = $0 })
                .id("\(d.budgetId)#\(vm.revision)")
        }
    }

    @ViewBuilder private func approved(_ d: FinBudgetDetail) -> some View {
        FinBCard(title: "\(d.name) — budget vs actual",
                 caption: "Approved by \(d.approvedByName ?? "someone") \(FinBTime.stamp(d.approvedAt)) · actuals: succeeded KES gifts to each income line's fund, approved KES expenses in each expense line's category",
                 icon: "scalemass") {
            if let a = vm.actuals {
                FinanceBudgetActualsView(actuals: a, outside: vm.outside, outsideError: vm.outsideError)
            } else if let e = vm.actualsError {
                ErrorBanner(message: e) { Task { await vm.load() } }
            } else {
                SkeletonTable(rows: 4)
            }
        }
        FinBCard(title: "Approved lines", caption: "Locked — an approved budget cannot change.", icon: "lock") {
            FinanceBudgetLinesGrid(lines: d.lines)
        }
    }

    @ViewBuilder private func sheet(_ a: Ask) -> some View {
        switch a {
        case .start:
            FinBConfirmSheet(title: "Start the \(String(vm.year)) budget?",
                             consequence: ["Creates a draft budget for \(String(vm.year)) in KES, named “\(String(vm.year)) budget”. Nothing is locked until it is approved."],
                             confirmLabel: "Start draft",
                             onConfirm: { try await vm.start() },
                             errorText: { $0.apiStatus == 409 ? "\(String(vm.year)) already has a budget — refresh the page." : FinBError.message($0, fallback: "That did not go through.") })
        case .approve:
            if let d = vm.detail {
                FinBConfirmSheet(title: "Approve the \(String(d.year)) budget?",
                                 consequence: ["Locks the lines — an approved budget cannot be edited.",
                                               "Budgeted income \(FinanceMoney.format(d.incomeTotalMinor, "KES")), spending \(FinanceMoney.format(d.expenseTotalMinor, "KES")) across \(d.lineCount) \(d.lineCount == 1 ? "line" : "lines"). From then on this page compares it with what actually came in and went out."],
                                 confirmLabel: "Approve and lock",
                                 onConfirm: { try await vm.approve() },
                                 errorText: { FinBError.message($0, fallback: "That did not go through.") })
            }
        case .rename:
            if let d = vm.detail {
                FinanceBudgetRenameSheet(current: d.name, year: d.year) { try await vm.rename($0) }
            }
        case .leave(let y):
            FinBConfirmSheet(title: "Leave without saving?",
                             consequence: ["The unsaved changes to this budget's lines will be lost."],
                             confirmLabel: "Discard changes", destructive: true,
                             onConfirm: { vm.choose(year: y) })
        }
    }
}

// MARK: - Approved: budget against actual

/// Budget vs actual (GET /budgets/{id}/actuals, KES): "Year to date" — line,
/// budget / actual / variance to date and for the year — or "Month by month",
/// with a total row per kind and the unbudgeted money of that kind. Variance =
/// actual − budget; amber is income below budget or spending above it.
struct FinanceBudgetActualsView: View {
    let actuals: FinBudgetActuals
    let outside: (income: [FinCurrencyAmount], expenses: [FinCurrencyAmount])?
    let outsideError: Bool
    @State private var view = "summary"

    private var ytd: Int { FinBMath.ytdMonths(year: actuals.year) }
    private var ytdLabel: String { ytd == 12 ? "Year" : ytd == 0 ? "YTD (not started)" : "YTD (Jan–\(FinBMath.monthName(ytd - 1)))" }

    private static let labelWidth: CGFloat = 220
    private static let cellWidth: CGFloat = 112

    /// One row of the table (a line, a kind's total, or its unbudgeted money).
    private struct Row: Identifiable {
        let id: String
        let label: String
        let sub: String?
        let kind: String
        let budget: [Int], actual: [Int], variance: [Int]
        let budgetYear: Int, actualYear: Int, varianceYear: Int
        var strong = false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                FinBChoiceChips(options: [.init("summary", "Year to date"), .init("months", "Month by month")], selection: $view)
                Text("All figures KES. Variance = actual − budget; amber is income below budget or spending above it.")
                    .font(.nMicro).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
            }
            ScrollView(.horizontal, showsIndicators: true) {
                VStack(spacing: 0) {
                    header
                    ForEach(["income", "expense"], id: \.self) { kind in
                        sectionHeader(kind)
                        ForEach(rows(kind)) { r in
                            if view == "summary" { summaryRow(r) } else { monthRows(r) }
                        }
                    }
                }
            }
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            footer
        }
    }

    private func rows(_ kind: String) -> [Row] {
        var out = actuals.lines.filter { $0.kind == kind }.map { l in
            Row(id: l.lineId, label: l.label,
                sub: kind == "income" ? l.fund?.name : "\(l.category?.name ?? "")\(l.fund.map { " · \($0.name)" } ?? " · church-wide")",
                kind: kind, budget: l.budgetMinor, actual: l.actualMinor, variance: l.varianceMinor,
                budgetYear: l.budgetTotalMinor, actualYear: l.actualTotalMinor, varianceYear: l.varianceTotalMinor)
        }
        if let t = actuals.totals.first(where: { $0.kind == kind }) {
            out.append(Row(id: "\(kind)-total", label: "Total \(kind == "income" ? "income" : "expenses")", sub: nil, kind: kind,
                           budget: t.budgetMinor, actual: t.actualMinor, variance: t.varianceMinor,
                           budgetYear: t.budgetTotalMinor, actualYear: t.actualTotalMinor, varianceYear: t.varianceTotalMinor, strong: true))
            if t.unbudgetedTotalMinor != 0 {
                out.append(Row(id: "\(kind)-unbudgeted", label: "Unbudgeted", sub: "actual money no line covers", kind: kind,
                               budget: Array(repeating: 0, count: 12), actual: t.unbudgetedMinor, variance: t.unbudgetedMinor,
                               budgetYear: 0, actualYear: t.unbudgetedTotalMinor, varianceYear: t.unbudgetedTotalMinor))
            }
        }
        return out
    }

    private var header: some View {
        HStack(spacing: 0) {
            Text("LINE").frame(width: Self.labelWidth, alignment: .leading).padding(.leading, 12)
            if view == "summary" {
                ForEach(["Budget \(ytdLabel)", "Actual \(ytdLabel)", "Variance", "Budget year", "Actual year", "Variance"], id: \.self) { h in
                    Text(h.uppercased()).frame(width: Self.cellWidth, alignment: .trailing)
                }
            } else {
                ForEach(FinBMath.monthNames, id: \.self) { m in Text(m.uppercased()).frame(width: 92, alignment: .trailing) }
                Text(ytd == 12 ? "YEAR" : "YTD").frame(width: 104, alignment: .trailing)
                Text("YEAR").frame(width: 104, alignment: .trailing).padding(.trailing, 12)
            }
        }
        .font(.inter(10, .bold)).tracking(0.5).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.7)
        .padding(.vertical, 9)
        .background(Nuru.surface)
    }

    private func sectionHeader(_ kind: String) -> some View {
        HStack {
            Text(kind == "income" ? "Income" : "Expenses").font(.inter(13, .bold))
                .foregroundStyle(kind == "income" ? Nuru.success : FinanceStatus.amber.fg)
            Spacer()
        }
        .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 4)
    }

    private func labelCell(_ r: Row, what: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            VStack(alignment: .leading, spacing: 1) {
                Text(r.label).font(.inter(12.5, r.strong ? .bold : .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                if let sub = r.sub, !sub.isEmpty { Text(sub).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1) }
            }
            Spacer(minLength: 4)
            if let what { Text(what.uppercased()).font(.inter(9.5, .semibold)).tracking(0.4).foregroundStyle(Nuru.ink400) }
        }
        .frame(width: Self.labelWidth, alignment: .leading)
        .padding(.leading, 12)
    }

    private func amount(_ v: Int, variance: Bool, kind: String, strong: Bool, width: CGFloat, dim: Bool = false) -> some View {
        let text = variance ? (v > 0 ? "+" : "") + FinanceMoney.format(v, "") : FinanceMoney.format(v, "")
        let color: Color = variance ? Self.tone(kind, v) : (dim ? Nuru.ink400 : Nuru.navy)
        return Text(text).font(.inter(12, strong ? .bold : .regular)).monospacedDigit().foregroundStyle(color)
            .lineLimit(1).minimumScaleFactor(0.7)
            .frame(width: width, alignment: .trailing)
    }

    /// Income below budget and spending above it are the warnings (amber); the opposite is good.
    static func tone(_ kind: String, _ variance: Int) -> Color {
        if variance == 0 { return Nuru.ink600 }
        let warn = kind == "income" ? variance < 0 : variance > 0
        return warn ? FinanceStatus.amber.fg : Nuru.success
    }

    private func summaryRow(_ r: Row) -> some View {
        let b = FinBMath.sumPrefix(r.budget, ytd), a = FinBMath.sumPrefix(r.actual, ytd)
        return HStack(spacing: 0) {
            labelCell(r)
            amount(b, variance: false, kind: r.kind, strong: r.strong, width: Self.cellWidth)
            amount(a, variance: false, kind: r.kind, strong: r.strong, width: Self.cellWidth)
            amount(a - b, variance: true, kind: r.kind, strong: r.strong, width: Self.cellWidth)
            amount(r.budgetYear, variance: false, kind: r.kind, strong: r.strong, width: Self.cellWidth)
            amount(r.actualYear, variance: false, kind: r.kind, strong: r.strong, width: Self.cellWidth)
            amount(r.varianceYear, variance: true, kind: r.kind, strong: r.strong, width: Self.cellWidth)
                .padding(.trailing, 12)
        }
        .padding(.vertical, 6)
        .background(r.strong ? Nuru.surface : Nuru.white)
        .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
    }

    @ViewBuilder private func monthRows(_ r: Row) -> some View {
        let yb = FinBMath.sumPrefix(r.budget, ytd), ya = FinBMath.sumPrefix(r.actual, ytd)
        VStack(spacing: 0) {
            monthLine(r, "Budget", r.budget, ytdValue: yb, year: r.budgetYear, variance: false, first: true)
            monthLine(r, "Actual", r.actual, ytdValue: ya, year: r.actualYear, variance: false)
            monthLine(r, "Variance", r.variance, ytdValue: ya - yb, year: r.varianceYear, variance: true)
        }
        .background(r.strong ? Nuru.surface : Nuru.white)
        .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
    }

    private func monthLine(_ r: Row, _ what: String, _ values: [Int], ytdValue: Int, year: Int, variance: Bool, first: Bool = false) -> some View {
        HStack(spacing: 0) {
            if first { labelCell(r, what: what) }
            else {
                HStack { Spacer(); Text(what.uppercased()).font(.inter(9.5, .semibold)).tracking(0.4).foregroundStyle(Nuru.ink400) }
                    .frame(width: Self.labelWidth, alignment: .trailing).padding(.leading, 12)
            }
            ForEach(0..<12, id: \.self) { m in
                amount(values.indices.contains(m) ? values[m] : 0, variance: variance, kind: r.kind, strong: false, width: 92, dim: m >= ytd)
            }
            amount(ytdValue, variance: variance, kind: r.kind, strong: true, width: 104)
            amount(year, variance: variance, kind: r.kind, strong: true, width: 104).padding(.trailing, 12)
        }
        .padding(.vertical, 3)
    }

    private var footer: some View {
        let inc = actuals.totals.first { $0.kind == "income" }
        let exp = actuals.totals.first { $0.kind == "expense" }
        let incA = inc.map { FinBMath.sumPrefix($0.actualMinor, ytd) } ?? 0, incB = inc.map { FinBMath.sumPrefix($0.budgetMinor, ytd) } ?? 0
        let expA = exp.map { FinBMath.sumPrefix($0.actualMinor, ytd) } ?? 0, expB = exp.map { FinBMath.sumPrefix($0.budgetMinor, ytd) } ?? 0
        let toDate = ytd == 12 ? "" : "to date "
        let net = FinBMath.netActual(incomeActual: inc?.actualMinor ?? [], incomeUnbudgeted: inc?.unbudgetedMinor ?? [],
                                     expenseActual: exp?.actualMinor ?? [], expenseUnbudgeted: exp?.unbudgetedMinor ?? [], months: ytd)
        return VStack(alignment: .leading, spacing: 8) {
            FinanceFlowLayout(spacing: 22, rowSpacing: 4) {
                (Text("Net actual \(ytd == 12 ? "for the year" : "to date"): ") + Text(FinanceMoney.format(net, "KES")).bold()
                    + Text(" (all KES in − all KES out, budgeted or not)").foregroundColor(Nuru.ink600))
                    .font(.inter(12.5)).foregroundStyle(Nuru.navy)
                if inc != nil {
                    Text("Income \(toDate)is \(FinanceMoney.format(abs(incA - incB), "KES")) \(incA >= incB ? "above" : "below") budget.")
                        .font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                }
                if exp != nil {
                    Text("Spending \(toDate)is \(FinanceMoney.format(abs(expA - expB), "KES")) \(expA > expB ? "above" : "within") budget.")
                        .font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                }
            }
            FinanceNoticeBar(notice: .ok("Budgets are in KES; USD giving is reported beside them, never against them. " + outsideText))
        }
    }

    private var outsideText: String {
        if outsideError { return "The year's non-KES figures could not be read — see Reports." }
        guard let o = outside else { return "" }
        if o.income.isEmpty && o.expenses.isEmpty { return "No non-KES income or spending in \(String(actuals.year))." }
        let parts = o.income.map { "income \(FinanceMoney.format($0.amountMinor, $0.currency))" }
            + o.expenses.map { "spending \(FinanceMoney.format($0.amountMinor, $0.currency))" }
        return "Outside the budget in \(String(actuals.year)): \(parts.joined(separator: " · ")) (see Reports)."
    }
}

/// The lines of an approved budget, read-only: label, then Jan–Dec and the year.
struct FinanceBudgetLinesGrid: View {
    let lines: [FinBudgetLine]
    var body: some View {
        if lines.isEmpty {
            Text("No lines.").font(.nCaption).foregroundStyle(Nuru.ink400)
        } else {
            ScrollView(.horizontal, showsIndicators: true) {
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        Text("LINE").frame(width: 220, alignment: .leading).padding(.leading, 12)
                        ForEach(FinBMath.monthNames, id: \.self) { Text($0.uppercased()).frame(width: 88, alignment: .trailing) }
                        Text("YEAR").frame(width: 112, alignment: .trailing).padding(.trailing, 12)
                    }
                    .font(.inter(10, .bold)).tracking(0.5).foregroundStyle(Nuru.ink600)
                    .padding(.vertical, 9).background(Nuru.surface)
                    ForEach(lines) { l in
                        HStack(spacing: 0) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(l.label).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                                Text(l.kind == "income" ? "Income · \(l.fund?.name ?? "—")"
                                     : "Expense · \(l.category?.name ?? "—")\(l.fund.map { " · \($0.name)" } ?? " · church-wide")")
                                    .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                            }
                            .frame(width: 220, alignment: .leading).padding(.leading, 12)
                            ForEach(0..<12, id: \.self) { m in
                                let v = l.monthlyMinor.indices.contains(m) ? l.monthlyMinor[m] : 0
                                Text(v == 0 ? "—" : FinanceMoney.format(v, "")).font(.inter(12)).monospacedDigit()
                                    .foregroundStyle(v == 0 ? Nuru.ink400 : Nuru.navy).lineLimit(1).minimumScaleFactor(0.7)
                                    .frame(width: 88, alignment: .trailing)
                            }
                            Text(FinanceMoney.format(l.totalMinor, "")).font(.inter(12, .bold)).monospacedDigit().foregroundStyle(Nuru.navy)
                                .frame(width: 112, alignment: .trailing).padding(.trailing, 12)
                        }
                        .padding(.vertical, 6)
                        .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
                    }
                }
            }
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
    }
}

/// Rename a draft budget (PATCH /budgets/{id}, finance:manage, 2–80 characters).
struct FinanceBudgetRenameSheet: View {
    let current: String
    let year: Int
    let onRename: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var busy = false
    @State private var error: String?

    init(current: String, year: Int, onRename: @escaping (String) async throws -> Void) {
        self.current = current
        self.year = year
        self.onRename = onRename
        _name = State(initialValue: current)
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var valid: Bool { (2...80).contains(trimmed.count) && trimmed != current }

    var body: some View {
        FinBFormSheet(title: "Rename the budget", confirmLabel: "Rename", canConfirm: valid, busy: busy, error: error, onConfirm: rename) {
            Text("Currently “\(current)”.").font(.nBody).foregroundStyle(Nuru.ink600)
            FinBField(label: "New name", hint: "2–80 characters") {
                TextField("\(String(year)) budget", text: $name).finbInput()
            }
        }
        .presentationDetents([.medium])
    }

    private func rename() {
        guard valid else { return }
        busy = true
        error = nil
        Task { @MainActor in
            do {
                try await onRename(trimmed)
                busy = false
                dismiss()
            } catch {
                busy = false
                self.error = FinBError.message(error, fallback: "That did not go through.")
            }
        }
    }
}

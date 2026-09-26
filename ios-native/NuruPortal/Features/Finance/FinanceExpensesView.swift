// Finance → Expenses (pathway docs/FINANCE_ERP.md §2, §5) — money out, with
// maker-checker. An expense is RECORDED (nothing posts), then APPROVED by a
// different person (the journal posts: debit the fund, credit the cash account
// it was paid from, dated spent_on) — a SuperAdmin may approve their own.
// Mistakes are VOIDED with a reason: a recorded one simply stops counting; an
// approved one gets the reversing journal. Nothing is ever deleted.
//
// Register: GET /admin/finance/expenses (finance:view) — period (or all
// dates), status (several), fund, category, search; totals per currency for
// the whole filtered set and the same set by status; CSV (finance:export).
// Writes: record / edit while recorded / void (finance:manage), approve
// (finance:approve). Deep link: status=recorded shows every expense awaiting
// approval, whatever its date. Sheets: B/FinanceExpenseSheets.swift.
import SwiftUI
import Combine

@MainActor
final class FinanceExpensesModel: ObservableObject {
    /// Recorded + approved, spent this year (web parity: voids are out unless asked for).
    static let defaultFilter = FinExpenseFilter(period: .preset(.thisYear), status: "recorded,approved")

    @Published var filter = FinanceExpensesModel.defaultFilter
    @Published var notice: FinanceNotice?
    /// Expenses this person edited while signed in here (the audit lists
    /// every editor; this covers the one just saved before it is read back).
    @Published private(set) var editedByMe: Set<String> = []
    /// Bumped after a write so an open detail re-reads itself and its trail.
    @Published private(set) var version = 0
    let pager = FinancePager<FinExpenseList>()
    let lookups = FinBLookups()
    private var relays: [AnyCancellable] = []

    init() {
        relays = [finbRelay(pager), finbRelay(lookups)]
    }

    var isFiltered: Bool { filter != Self.defaultFilter }

    func load() async {
        let f = filter
        async let lookupsDone: Void = loadLookups()
        await pager.load { cursor in try await FinanceERPAPI.expenses(f, cursor: cursor) }
        _ = await lookupsDone
    }

    func loadLookups() async {
        async let a: Void = lookups.loadFunds()
        async let b: Void = lookups.loadCategories()
        _ = await (a, b)
    }

    /// A deep link replaces the filters. status=recorded without dates means
    /// "everything awaiting approval" — so the period opens to all dates.
    func apply(link params: [String: String]) {
        var f = FinExpenseFilter()
        let allowed = ["recorded", "approved", "void"]
        if let s = params["status"] {
            let parts = s.split(separator: ",").map(String.init).filter(allowed.contains)
            if !parts.isEmpty { f.status = allowed.filter(parts.contains).joined(separator: ",") }
        }
        if let from = params["from"], let to = params["to"],
           FinanceDates.date(fromYMD: from) != nil, FinanceDates.date(fromYMD: to) != nil {
            f.period = .custom(from: from, to: to)
        } else if params["status"] != nil {
            f.period = nil
        }
        if let v = params["fund"] { f.fund = v }
        if let v = params["category"] { f.category = v }
        if let v = params["q"] { f.q = v }
        filter = f
    }

    var totalCount: Int? { pager.phase == .loaded ? pager.totals.reduce(0) { $0 + $1.count } : nil }

    // MARK: writes (each throws for its sheet to show; the list refreshes after)

    func record(_ input: FinExpenseInput) async throws -> FinExpense {
        let e = try await FinanceERPAPI.recordExpense(input)
        notice = .ok("Recorded \(FinanceMoney.format(e.amountMinor, e.currency)) to \(e.payee) — waiting for someone else to approve")
        await pager.reload()
        return e
    }

    func update(_ id: String, _ patch: FinExpensePatch) async throws -> FinExpense {
        let e = try await FinanceERPAPI.updateExpense(id, patch)
        editedByMe.insert(id)
        notice = .ok("Saved — you edited it, so another person must approve it")
        pager.update { rows in if let i = rows.firstIndex(where: { $0.id == id }) { rows[i] = e } }
        version += 1
        await pager.reload()
        return e
    }

    func approve(_ e: FinExpense) async throws -> FinExpense {
        do {
            let done = try await FinanceERPAPI.approveExpense(e.expenseId)
            notice = .ok("Approved — \(FinanceMoney.format(done.amountMinor, done.currency)) posted out of \(done.fund.name)")
            pager.update { rows in if let i = rows.firstIndex(where: { $0.id == done.id }) { rows[i] = done } }
            await pager.reload()
            return done
        } catch {
            if error.apiCode == "SAME_PERSON" { notice = .warn(FinBMakerChecker.sentence) }
            else { version += 1 }                 // it may have been approved or voided meanwhile
            throw error
        }
    }

    func void(_ e: FinExpense, reason: String) async throws -> FinExpense {
        do {
            let done = try await FinanceERPAPI.voidExpense(e.expenseId, reason: reason)
            notice = e.status == "approved"
                ? .ok("Voided — \(done.fund.name) gets \(FinanceMoney.format(done.amountMinor, done.currency)) back")
                : .ok("Voided — nothing had been posted")
            pager.update { rows in if let i = rows.firstIndex(where: { $0.id == done.id }) { rows[i] = done } }
            await pager.reload()
            return done
        } catch {
            version += 1
            throw error
        }
    }

    // MARK: the KPI tiles (per currency, from totals_by_status)

    func statusAmounts(_ status: String) -> [String] {
        FinanceMoney.lines((pager.envelope?.totalsByStatus ?? []).filter { $0.status == status }.map { ($0.currency, $0.amountMinor) })
    }
    func statusCount(_ status: String) -> Int {
        (pager.envelope?.totalsByStatus ?? []).filter { $0.status == status }.reduce(0) { $0 + $1.count }
    }
    var periodText: String { filter.period.map { $0.preset == .custom ? $0.label : $0.label.lowercased() } ?? "any date" }
    var statusText: String {
        let chosen = filter.status.split(separator: ",").map(String.init)
        if chosen.isEmpty || chosen.count == 3 { return "every status" }
        return chosen.map { $0 == "recorded" ? "awaiting approval" : $0 }.joined(separator: " + ")
    }

    /// The approval queue: everything awaiting approval, whenever it was spent.
    func showApprovalQueue() { filter = FinExpenseFilter(period: nil, status: "recorded") }

    func editedByMe(_ id: String) -> Bool { editedByMe.contains(id) }
}

struct FinanceExpensesView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var vm = FinanceExpensesModel()
    @State private var open: FinExpense?
    @State private var recording = false

    static let statusOptions: [FinanceFilterOption] = [
        .init("recorded", "Awaiting approval"), .init("approved", "Approved"), .init("void", "Void"),
    ]

    // Floors ≈ 690 pt: fits portrait on the 13-inch; scrolls sideways narrower.
    private static let columns: [FinanceColumn] = [
        FinanceColumn("Spent on", width: 84),
        FinanceColumn("Payee · category · fund", minWidth: 190),
        FinanceColumn("Amount · via", width: 120, align: .trailing),
        FinanceColumn("Status", width: 96),
        FinanceColumn("Recorded · approved", minWidth: 120),
    ]

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeExpenses.title,
                            subtitle: "What the church spent — recorded by one person, approved by another before it posts; a mistake is voided, never deleted.",
                            onRefresh: { await vm.pager.reload() }) {
            HStack(spacing: 8) {
                FinanceExportButton(caps: caps, path: FinanceERPAPI.expensesCSV, query: vm.filter.query, placement: .hero)
                if caps.manage {
                    HeroChip(label: "Record expense", icon: "plus", style: .gold) { recording = true }
                }
            }
        } content: {
            if let n = vm.notice { FinanceNoticeBar(notice: n) { vm.notice = nil } }
            let loadingFirst = vm.pager.isLoadingFirstPage
            FinanceKpiGrid(minimum: 190) {
                FinanceKpiTile(label: "Approved", icon: "checkmark.circle", tint: Nuru.brandTint(0),
                               values: vm.statusAmounts("approved"),
                               hint: vm.filter.status.isEmpty || vm.filter.status.contains("approved") ? "spent · \(vm.periodText)" : "not in this selection",
                               loading: loadingFirst)
                FinanceKpiTile(label: "Awaiting approval", icon: "exclamationmark.triangle", tint: Nuru.brandTint(3),
                               values: vm.statusAmounts("recorded").isEmpty && !loadingFirst ? ["None"] : vm.statusAmounts("recorded"),
                               hint: "\(vm.statusCount("recorded")) recorded · \(vm.periodText)", loading: loadingFirst,
                               action: vm.filter.status == "recorded" && vm.filter.period == nil ? nil : { vm.showApprovalQueue() })
                FinanceKpiTile(label: "Expenses", icon: "doc.text", tint: Nuru.brandTint(2),
                               values: loadingFirst ? [] : [String(vm.totalCount ?? 0)], hint: vm.statusText, loading: loadingFirst)
            }
            FinanceFilterBar(search: $vm.filter.q, searchPrompt: "Payee, description or reference",
                             isFiltered: vm.isFiltered, onClear: { vm.filter = FinanceExpensesModel.defaultFilter }) {
                FinBPeriodMenu(period: $vm.filter.period)
                FinBMultiMenu(title: "Status", options: Self.statusOptions, selection: $vm.filter.status)
                FinanceFilterMenu(title: "Fund", selection: $vm.filter.fund, options: vm.lookups.fundFilterOptions())
                FinanceFilterMenu(title: "Category", selection: $vm.filter.category, options: vm.lookups.categoryFilterOptions())
            }
            FinanceTotalsStrip(totals: vm.pager.totals, title: "Total", noun: ("expense", "expenses"),
                               loading: vm.pager.isLoadingFirstPage || vm.pager.refreshing)
            FinanceExpenseStatusTotals(totals: vm.pager.envelope?.totalsByStatus ?? [],
                                       loading: vm.pager.isLoadingFirstPage || vm.pager.refreshing)
            FinBExplain(text: "Newest spending first · \(vm.statusText) · \(vm.periodText). Only approved expenses are in the books — each posted out of its fund when a different person approved it, dated the day it was spent. Awaiting approval ones have posted nothing yet; void ones never count. The totals cover every expense that matches, not just the rows loaded.")
            FinancePagedTable(pager: vm.pager, columns: Self.columns, emptyIcon: "banknote",
                              emptyMessage: vm.isFiltered ? "No expenses match these filters."
                                  : caps.manage ? "No expenses this year yet — “Record expense” adds one; someone else approves it." : "No expenses this year yet.",
                              totalCount: vm.totalCount, onSelect: { open = $0 }) { e in
                row(e, caps: caps)
            }
        }
        .task(id: vm.filter) { await vm.load() }
        .onFinanceLink(.financeExpenses) { vm.apply(link: $0) }
        .sheet(isPresented: $recording) {
            FinanceExpenseFormSheet(existing: nil, lookups: vm.lookups) { input, _ in
                if let input { _ = try await vm.record(input) }
            }
        }
        .sheet(item: $open) { e in
            FinanceExpenseDetailSheet(expense: e, model: vm)
        }
    }

    @ViewBuilder private func row(_ e: FinExpense, caps: FinanceCaps) -> some View {
        let cols = Self.columns
        Text(FinanceDates.display(e.spentOn)).font(.inter(12.5, .medium)).foregroundStyle(Nuru.navy).lineLimit(1)
            .minimumScaleFactor(0.85)
            .financeCell(cols[0])
        FinBPersonCell(title: e.payee, subtitle: "\(e.category.name) · \(e.fund.name)" + (e.description.map { " · \($0)" } ?? ""))
            .financeCell(cols[1])
        VStack(alignment: .trailing, spacing: 2) {
            FinBAmount(minor: e.amountMinor, currency: e.currency,
                       color: e.status == "void" ? Nuru.ink400 : Nuru.navy)
                .strikethrough(e.status == "void", color: Nuru.ink400)
            Text("via \(FinWords.channel(e.channel))").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
        }
        .financeCell(cols[2])
        FinanceStatusChip(status: e.status, label: e.status == "recorded" ? "Awaiting approval" : nil)
            .financeCell(cols[3])
        FinBPersonCell(title: e.recordedByName ?? "—",
                       subtitle: e.approvedAt != nil ? "approved · \(e.approvedByName ?? "—")"
                           : e.status == "recorded" ? "waiting for approval" : "void · \(e.voidedByName ?? "—")")
            .financeCell(cols[4])
    }
}

/// The filtered set split by status, per currency: awaiting approval ·
/// approved (posted) · void.
struct FinanceExpenseStatusTotals: View {
    let totals: [FinExpenseList.StatusTotal]
    var loading = false

    private static let order: [(status: String, label: String)] = [
        ("recorded", "Awaiting approval"), ("approved", "Approved · posted"), ("void", "Void · never counts"),
    ]

    var body: some View {
        if !totals.isEmpty {
            FinanceFlowLayout(spacing: 10, rowSpacing: 8) {
                ForEach(Self.order, id: \.status) { s in
                    let rows = totals.filter { $0.status == s.status }
                        .sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
                    if !rows.isEmpty {
                        let tone = FinanceStatus.tone(s.status)
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(s.label).font(.inter(11.5, .bold)).foregroundStyle(tone.fg)
                            ForEach(rows) { t in
                                Text("\(FinanceMoney.format(t.amountMinor, t.currency)) · \(t.count)")
                                    .font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).monospacedDigit()
                            }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(tone.bg)
                        .clipShape(Capsule())
                        .fixedSize()
                    }
                }
            }
            .opacity(loading ? 0.55 : 1)
            .accessibilityElement(children: .combine)
        }
    }
}

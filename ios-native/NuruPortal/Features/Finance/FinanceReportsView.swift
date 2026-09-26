// Finance → Reports (pathway docs/FINANCE_ERP.md §4, §5) — the year in figures
// and the two financial statements, each per currency (KES and USD are never
// added) and each with its CSV twin (finance:export):
//   Income                 GET /reports/income?year&by=fund|channel|source — succeeded gifts by month
//   Expenses               GET /reports/expenses?year&by=category|fund — APPROVED expenses by spent_on month
//   Pledges                GET /reports/pledges?year — pledged / paid / kept / missed / behind by month
//   Income & expenditure   GET /reports/income-expenditure?from&to — a period (default this month)
//   Financial position     GET /reports/financial-position?as_of — as of a day (default today)
// Before a server table is shown it is checked to foot (rows → totals, months
// → year, lines → subtotals, assets = funds + other); a table that does not
// add up says so instead of being trusted silently. Tables: B/FinanceReportTables.swift.
// Deep link: tab=income|expenses|pledges|ie|position (+ year, by, from, to, as_of).
import SwiftUI

/// A read's state, per report tab.
enum FinBLoad<T>: Equatable {
    case idle, loading, loaded(T), failed(String)
    static func == (a: FinBLoad<T>, b: FinBLoad<T>) -> Bool {
        switch (a, b) {
        case (.idle, .idle), (.loading, .loading), (.loaded, .loaded): true
        case (.failed(let x), .failed(let y)): x == y
        default: false
        }
    }
    var value: T? { if case .loaded(let v) = self { v } else { nil } }
}

@MainActor
final class FinanceReportsModel: ObservableObject {
    enum Tab: String, CaseIterable, Hashable {
        case income, expenses, pledges, ie, position
        var title: String {
            switch self {
            case .income: "Income"
            case .expenses: "Expenses"
            case .pledges: "Pledges"
            case .ie: "Income & expenditure"
            case .position: "Financial position"
            }
        }
    }

    @Published var tab: Tab = .income
    @Published var year = FinanceDates.currentYear()
    @Published var incomeBy = "fund"
    @Published var expensesBy = "category"
    @Published var period: FinancePeriod = .thisMonth
    @Published var asOf = FinanceDates.today()

    @Published private(set) var income: FinBLoad<FinReportMatrix> = .idle
    @Published private(set) var expenses: FinBLoad<FinReportMatrix> = .idle
    @Published private(set) var pledges: FinBLoad<FinPledgesReport> = .idle
    @Published private(set) var ie: FinBLoad<FinIncomeExpenditure> = .idle
    @Published private(set) var position: FinBLoad<FinFinancialPosition> = .idle
    private var seq = 0

    /// What the current tab reads — `.task(id:)` reloads when it changes.
    var key: String {
        switch tab {
        case .income: "income|\(year)|\(incomeBy)"
        case .expenses: "expenses|\(year)|\(expensesBy)"
        case .pledges: "pledges|\(year)"
        case .ie: "ie|\(period.from)|\(period.to)"
        case .position: "position|\(asOf)"
        }
    }

    func load() async {
        seq += 1
        let mine = seq
        do {
            switch tab {
            case .income:
                if income.value == nil { income = .loading }
                let r = try await FinanceERPAPI.incomeReport(year: year, by: incomeBy)
                if mine == seq { income = .loaded(r) }
            case .expenses:
                if expenses.value == nil { expenses = .loading }
                let r = try await FinanceERPAPI.expensesReport(year: year, by: expensesBy)
                if mine == seq { expenses = .loaded(r) }
            case .pledges:
                if pledges.value == nil { pledges = .loading }
                let r = try await FinanceERPAPI.pledgesReport(year: year)
                if mine == seq { pledges = .loaded(r) }
            case .ie:
                if ie.value == nil { ie = .loading }
                let r = try await FinanceERPAPI.incomeExpenditure(period: period)
                if mine == seq { ie = .loaded(r) }
            case .position:
                if position.value == nil { position = .loading }
                let r = try await FinanceERPAPI.financialPosition(asOf: asOf)
                if mine == seq { position = .loaded(r) }
            }
        } catch {
            guard mine == seq, !Task.isCancelled else { return }
            let message = FinBError.message(error, fallback: "Could not load the report.")
            switch tab {
            case .income: income = .failed(message)
            case .expenses: expenses = .failed(message)
            case .pledges: pledges = .failed(message)
            case .ie: ie = .failed(message)
            case .position: position = .failed(message)
            }
        }
    }

    func apply(link p: [String: String]) {
        if let t = p["tab"].flatMap(Tab.init(rawValue:)) { tab = t }
        if let y = p["year"].flatMap(Int.init), (2000...2999).contains(y) { year = y }
        if let by = p["by"] {
            if tab == .income, ["fund", "channel", "source"].contains(by) { incomeBy = by }
            if tab == .expenses, ["category", "fund"].contains(by) { expensesBy = by }
        }
        if let f = p["from"], let t = p["to"], FinanceDates.date(fromYMD: f) != nil, FinanceDates.date(fromYMD: t) != nil {
            period = .custom(from: f, to: t)
        }
        if let a = p["as_of"], FinanceDates.date(fromYMD: a) != nil { asOf = a }
    }

    /// The current tab's CSV twin and its query (the same filters).
    var csv: (path: String, query: [String: String]) {
        switch tab {
        case .income: (FinanceERPAPI.incomeReportCSV, FinanceERPAPI.yearQuery(year, by: incomeBy))
        case .expenses: (FinanceERPAPI.expensesReportCSV, FinanceERPAPI.yearQuery(year, by: expensesBy))
        case .pledges: (FinanceERPAPI.pledgesReportCSV, FinanceERPAPI.yearQuery(year, by: nil))
        case .ie: (FinanceERPAPI.incomeExpenditureCSV, period.query)
        case .position: (FinanceERPAPI.financialPositionCSV, ["as_of": asOf])
        }
    }
}

struct FinanceReportsView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var vm = FinanceReportsModel()

    static let incomeByOptions: [FinanceFilterOption] = [.init("fund", "By fund"), .init("channel", "By channel"), .init("source", "By source")]
    static let expensesByOptions: [FinanceFilterOption] = [.init("category", "By category"), .init("fund", "By fund")]

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeReports.title,
                            subtitle: "The year in figures and the two financial statements — per currency, never added across currencies.",
                            onRefresh: { await vm.load() }) {
            FinanceExportButton(caps: caps, path: vm.csv.path, query: vm.csv.query, placement: .hero)
        } subheader: {
            FinanceTabs(tabs: FinanceReportsModel.Tab.allCases, selection: $vm.tab, label: \.title)
        } content: {
            controls
            switch vm.tab {
            case .income: matrix(vm.income, kind: "income")
            case .expenses: matrix(vm.expenses, kind: "expenses")
            case .pledges: pledges
            case .ie: incomeExpenditure
            case .position: position
            }
        }
        .task(id: vm.key) { await vm.load() }
        .onFinanceLink(.financeReports) { vm.apply(link: $0) }
    }

    // MARK: controls per tab

    @ViewBuilder private var controls: some View {
        switch vm.tab {
        case .income:
            FinanceFilterBar {
                FinanceYearMenu(year: $vm.year)
                FinBChoiceChips(options: Self.incomeByOptions, selection: $vm.incomeBy)
            }
            FinBExplain(text: "Succeeded gifts by the month they were given (East Africa Time) — the member statements' own basis; a reversed gift drops out of its month. A gift with no fund (a media purchase) is the row \"none\". Rows add up to the totals, months to the year.")
        case .expenses:
            FinanceFilterBar {
                FinanceYearMenu(year: $vm.year)
                FinBChoiceChips(options: Self.expensesByOptions, selection: $vm.expensesBy)
            }
            FinBExplain(text: "APPROVED expenses by the month they were spent. Recorded ones (awaiting approval) and void ones are not here — they are not in the books.")
        case .pledges:
            FinanceFilterBar { FinanceYearMenu(year: $vm.year) }
            FinBExplain(text: "Pledged: monthly instalments due in the month + a total pledge's target in the month it falls due. Paid: pledge payments by the month they were made. Kept / missed: monthly instalments due that month, paid in full (on time or late) or missed as of today — exactly as the member statement counts them. Behind: partners with a missed instalment due that month (the year's total counts each partner once).")
        case .ie:
            FinanceFilterBar(period: $vm.period)
            FinBExplain(text: "Income is gifts net of reversals per fund, plus other income (media sales); expenditure is approved expenses per category, by the day spent. Transfers between funds and opening balances move money inside the books, so they are left out. Surplus = income − expenditure.")
        case .position:
            HStack(spacing: 10) {
                Text("AS OF").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                FinBDayPicker(label: "As of", ymd: $vm.asOf, latest: FinanceDates.today())
                if vm.asOf != FinanceDates.today() {
                    FinanceButton(title: "Today", icon: "arrow.uturn.backward") { vm.asOf = FinanceDates.today() }
                }
                Spacer(minLength: 0)
            }
            FinBExplain(text: "Every posting up to the end of the day (East Africa Time): cash accounts (what the church holds, debits − credits), fund balances (credits − debits), and other accounts such as media sales. Balanced means assets = funds + other, per currency.")
        }
    }

    // MARK: Income / Expenses

    @ViewBuilder private func matrix(_ state: FinBLoad<FinReportMatrix>, kind: String) -> some View {
        switch state {
        case .idle, .loading:
            SkeletonTable(rows: 6)
        case .failed(let message):
            ErrorBanner(message: message) { Task { await vm.load() } }
        case .loaded(let m):
            if m.currencies.allSatisfy({ $0.rows.isEmpty }) {
                EmptyState(icon: "chart.bar.xaxis", title: "Nothing in \(String(m.year))",
                           message: kind == "income" ? "No succeeded gifts in \(String(m.year))." : "No approved expenses in \(String(m.year)).")
            } else {
                ForEach(m.currencies) { block in
                    FinanceReportMatrixCard(block: block, year: m.year, by: m.by, showChart: kind == "income",
                                            rowNoun: kind == "income" ? "Income" : "Spending")
                }
            }
        }
    }

    // MARK: Pledges

    @ViewBuilder private var pledges: some View {
        switch vm.pledges {
        case .idle, .loading:
            SkeletonTable(rows: 6)
        case .failed(let message):
            ErrorBanner(message: message) { Task { await vm.load() } }
        case .loaded(let r):
            if r.currencies.isEmpty {
                EmptyState(icon: "signature", title: "No pledges in \(String(r.year))", message: "Nothing was pledged or paid toward a pledge that year.")
            } else {
                ForEach(r.currencies) { c in FinancePledgesReportCard(block: c, year: r.year) }
            }
        }
    }

    // MARK: Income & expenditure

    @ViewBuilder private var incomeExpenditure: some View {
        switch vm.ie {
        case .idle, .loading:
            SkeletonTable(rows: 6)
        case .failed(let message):
            ErrorBanner(message: message) { Task { await vm.load() } }
        case .loaded(let s):
            Text("\(FinanceDates.displayRange(from: s.period.from, to: s.period.to))")
                .font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
            ForEach(s.currencies) { c in FinanceIncomeExpenditureCard(block: c) }
        }
    }

    // MARK: Financial position

    @ViewBuilder private var position: some View {
        switch vm.position {
        case .idle, .loading:
            SkeletonTable(rows: 6)
        case .failed(let message):
            ErrorBanner(message: message) { Task { await vm.load() } }
        case .loaded(let p):
            FinancePositionBanner(position: p)
            ForEach(p.currencies) { c in FinancePositionCard(block: c) }
        }
    }
}

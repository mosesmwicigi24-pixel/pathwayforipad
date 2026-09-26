// Finance → Reports — the tables and statements, and the checks that a server
// table foots before it is trusted (FinBFoot, asserted by FinanceBSelfCheck).
// One currency per card; amounts are exact (FinanceMoney) and never added
// across currencies. See FinanceReportsView.swift.
import SwiftUI
import Charts

// MARK: - Does it foot?

enum FinBFoot {
    /// A report matrix block: each row's months add to its total, each
    /// month's rows add to the totals row, the totals row's months to the year.
    static func matrixProblems(_ b: FinReportMatrix.Currency) -> [String] {
        var out: [String] = []
        let c = b.currency
        for r in b.rows {
            if r.months.count != 12 { out.append("\(r.label): \(r.months.count) months instead of 12."); continue }
            let s = r.months.reduce(0, +)
            if s != r.totalMinor {
                out.append("\(r.label): the months add to \(FinanceMoney.format(s, c)), the row says \(FinanceMoney.format(r.totalMinor, c)).")
            }
        }
        if b.totals.months.count == 12 {
            for m in 0..<12 {
                let col = b.rows.reduce(0) { $0 + ($1.months.indices.contains(m) ? $1.months[m] : 0) }
                if col != b.totals.months[m] {
                    out.append("\(FinBMath.monthName(m)): the rows add to \(FinanceMoney.format(col, c)), the total says \(FinanceMoney.format(b.totals.months[m], c)).")
                }
            }
            let year = b.totals.months.reduce(0, +)
            if year != b.totals.totalMinor {
                out.append("The months add to \(FinanceMoney.format(year, c)), the year total says \(FinanceMoney.format(b.totals.totalMinor, c)).")
            }
        } else {
            out.append("The totals row has \(b.totals.months.count) months instead of 12.")
        }
        return out
    }

    /// Income & expenditure: lines → subtotals, gifts + other = income,
    /// income − expenses = surplus.
    static func incomeExpenditureProblems(_ b: FinIncomeExpenditure.Currency) -> [String] {
        var out: [String] = []
        let c = b.currency, t = b.totals
        let gifts = b.income.reduce(0) { $0 + $1.amountMinor }
        let other = b.otherIncome.reduce(0) { $0 + $1.amountMinor }
        let spent = b.expenses.reduce(0) { $0 + $1.amountMinor }
        if gifts != t.giftsMinor { out.append("Income by fund adds to \(FinanceMoney.format(gifts, c)), the total says \(FinanceMoney.format(t.giftsMinor, c)).") }
        if other != t.otherIncomeMinor { out.append("Other income adds to \(FinanceMoney.format(other, c)), the total says \(FinanceMoney.format(t.otherIncomeMinor, c)).") }
        if t.giftsMinor + t.otherIncomeMinor != t.incomeMinor { out.append("Gifts + other income is not the income total.") }
        if spent != t.expensesMinor { out.append("Expenditure adds to \(FinanceMoney.format(spent, c)), the total says \(FinanceMoney.format(t.expensesMinor, c)).") }
        if t.incomeMinor - t.expensesMinor != t.surplusMinor { out.append("Income − expenditure is not the surplus shown.") }
        return out
    }

    /// Financial position: each section's lines add to its total, and the
    /// server's `balanced` agrees with assets = funds + other.
    static func positionProblems(_ b: FinFinancialPosition.Currency) -> [String] {
        var out: [String] = []
        let c = b.currency, t = b.totals
        let assets = b.assets.reduce(0) { $0 + $1.balanceMinor }
        let funds = b.funds.reduce(0) { $0 + $1.balanceMinor }
        let other = b.other.reduce(0) { $0 + $1.balanceMinor }
        if assets != t.assetsMinor { out.append("Cash accounts add to \(FinanceMoney.format(assets, c)), the total says \(FinanceMoney.format(t.assetsMinor, c)).") }
        if funds != t.fundsMinor { out.append("Fund balances add to \(FinanceMoney.format(funds, c)), the total says \(FinanceMoney.format(t.fundsMinor, c)).") }
        if other != t.otherMinor { out.append("Other accounts add to \(FinanceMoney.format(other, c)), the total says \(FinanceMoney.format(t.otherMinor, c)).") }
        if (t.assetsMinor == t.fundsMinor + t.otherMinor) != b.balanced { out.append("The balanced flag does not match assets = funds + other.") }
        return out
    }
}

/// "Does not add up" — shown above a table the checks flagged.
struct FinBFootWarning: View {
    let problems: [String]
    var body: some View {
        if !problems.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("This table does not add up — report it; do not rely on it until it is fixed.")
                    .font(.inter(12.5, .bold)).foregroundStyle(FinanceStatus.red.fg)
                ForEach(problems.prefix(6), id: \.self) { p in
                    Text("• \(p)").font(.nMicro).foregroundStyle(FinanceStatus.red.fg).fixedSize(horizontal: false, vertical: true)
                }
                if problems.count > 6 { Text("…and \(problems.count - 6) more.").font(.nMicro).foregroundStyle(FinanceStatus.red.fg) }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FinanceStatus.red.bg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        }
    }
}

/// The currency badge every report card leads with.
struct FinBCurrencyBadge: View {
    let currency: String
    var body: some View {
        Text(currency).font(.inter(12, .bold)).foregroundStyle(Nuru.goldLo)
            .padding(.horizontal, 9).padding(.vertical, 3)
            .background(Nuru.goldChipBg).clipShape(Capsule())
    }
}

// MARK: - Income / Expenses matrix

struct FinanceReportMatrixCard: View {
    let block: FinReportMatrix.Currency
    let year: Int
    /// fund · channel · source · category
    let by: String
    var showChart = false
    var rowNoun = "Income"

    private static let labelWidth: CGFloat = 180
    private static let monthWidth: CGFloat = 88
    private static let totalWidth: CGFloat = 120

    var body: some View {
        let problems = FinBFoot.matrixProblems(block)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                FinBCurrencyBadge(currency: block.currency)
                Text("\(rowNoun) \(String(year))").font(.inter(14.5, .bold)).foregroundStyle(Nuru.navy)
                Spacer(minLength: 8)
                Text("Total").font(.nCaption).foregroundStyle(Nuru.ink600)
                FinBAmount(minor: block.totals.totalMinor, currency: block.currency, size: 15)
            }
            FinBFootWarning(problems: problems)
            if showChart { chart }
            ScrollView(.horizontal, showsIndicators: true) {
                VStack(spacing: 0) {
                    gridRow(label: byTitle.uppercased(), cells: FinBMath.monthNames.map { $0.uppercased() }, total: "YEAR", header: true)
                    ForEach(block.rows) { r in
                        gridRow(label: r.label.isEmpty ? r.key : r.label, cells: r.months.map(cell), total: FinanceMoney.format(r.totalMinor, ""))
                    }
                    gridRow(label: "Total", cells: block.totals.months.map(cell), total: FinanceMoney.format(block.totals.totalMinor, ""), strong: true)
                }
            }
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private var byTitle: String {
        switch by { case "channel": "Channel"; case "source": "Source"; case "category": "Category"; default: "Fund" }
    }

    /// Zero months read "—" so the months with money stand out.
    private func cell(_ minor: Int) -> String { minor == 0 ? "—" : FinanceMoney.format(minor, "") }

    private func gridRow(label: String, cells: [String], total: String, header: Bool = false, strong: Bool = false) -> some View {
        HStack(spacing: 0) {
            Text(label).lineLimit(1).truncationMode(.tail)
                .frame(width: Self.labelWidth, alignment: .leading)
                .padding(.leading, 12)
            ForEach(Array(cells.enumerated()), id: \.offset) { _, v in
                Text(v).lineLimit(1).minimumScaleFactor(0.75)
                    .frame(width: Self.monthWidth, alignment: .trailing)
            }
            Text(total).lineLimit(1).minimumScaleFactor(0.75)
                .frame(width: Self.totalWidth, alignment: .trailing)
                .padding(.trailing, 12)
        }
        .font(header ? .inter(10.5, .bold) : .inter(12.5, strong ? .bold : .regular))
        .tracking(header ? 0.6 : 0)
        .monospacedDigit()
        .foregroundStyle(header ? Nuru.ink600 : Nuru.navy)
        .padding(.vertical, header ? 9 : 8)
        .background(header || strong ? Nuru.surface : Nuru.white)
        .overlay(alignment: .top) { if !header { Rectangle().fill(Nuru.border).frame(height: 1) } }
    }

    /// The year's months as bars (axes in major units, compact — the exact
    /// figures are in the table).
    private var chart: some View {
        Chart {
            ForEach(Array(block.totals.months.enumerated()), id: \.offset) { i, minor in
                BarMark(x: .value("Month", FinBMath.monthName(i)), y: .value("Amount", Double(minor) / 100))
                    .foregroundStyle(Nuru.lumGreen.gradient)
                    .cornerRadius(3)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Nuru.border)
                AxisValueLabel {
                    if let v = value.as(Double.self) { Text(FinanceMoney.compact(Int((v * 100).rounded()))).font(.nMicro).foregroundStyle(Nuru.ink600) }
                }
            }
        }
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel { if let s = value.as(String.self) { Text(s).font(.nMicro).foregroundStyle(Nuru.ink600) } }
            }
        }
        .frame(height: 150)
        .accessibilityLabel("\(rowNoun) by month, \(block.currency)")
    }
}

// MARK: - Pledges report

struct FinancePledgesReportCard: View {
    let block: FinPledgesReport.Currency
    let year: Int

    private static let widths: [CGFloat] = [70, 130, 130, 70, 70, 90]
    private static let titles = ["Month", "Pledged", "Paid", "Kept", "Missed", "Behind"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                FinBCurrencyBadge(currency: block.currency)
                Text("Pledges \(String(year))").font(.inter(14.5, .bold)).foregroundStyle(Nuru.navy)
                Spacer(minLength: 8)
                Text("Paid \(FinanceMoney.format(block.totals.paidMinor, block.currency)) of \(FinanceMoney.format(block.totals.pledgedMinor, block.currency))")
                    .font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).monospacedDigit()
            }
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(spacing: 0) {
                    row(Self.titles.map { $0.uppercased() }, header: true)
                    ForEach(block.months) { m in
                        row([FinBMath.monthName(m.month - 1), money(m.pledgedMinor), money(m.paidMinor),
                             String(m.kept), String(m.missed), String(m.behindPartners)],
                            missed: m.missed > 0)
                    }
                    let t = block.totals
                    row(["Year", money(t.pledgedMinor), money(t.paidMinor), String(t.kept), String(t.missed), String(t.behindPartners)], strong: true)
                }
            }
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            Text("Behind on the year row counts each partner once, however many months they missed.")
                .font(.nMicro).foregroundStyle(Nuru.ink400)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func money(_ minor: Int) -> String { minor == 0 ? "—" : FinanceMoney.format(minor, "") }

    private func row(_ cells: [String], header: Bool = false, strong: Bool = false, missed: Bool = false) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { i, v in
                Text(v).lineLimit(1).minimumScaleFactor(0.8)
                    .foregroundStyle(header ? Nuru.ink600 : (i == 4 && missed ? FinanceStatus.amber.fg : Nuru.navy))
                    .frame(width: Self.widths[i], alignment: i == 0 ? .leading : .trailing)
            }
        }
        .font(header ? .inter(10.5, .bold) : .inter(12.5, strong ? .bold : .regular))
        .tracking(header ? 0.6 : 0)
        .monospacedDigit()
        .padding(.horizontal, 12).padding(.vertical, header ? 9 : 7)
        .background(header || strong ? Nuru.surface : Nuru.white)
        .overlay(alignment: .top) { if !header { Rectangle().fill(Nuru.border).frame(height: 1) } }
    }
}

// MARK: - Income & expenditure

struct FinanceIncomeExpenditureCard: View {
    let block: FinIncomeExpenditure.Currency

    var body: some View {
        let t = block.totals
        let c = block.currency
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                FinBCurrencyBadge(currency: c)
                Text("Income & expenditure").font(.inter(14.5, .bold)).foregroundStyle(Nuru.navy)
                Spacer(minLength: 8)
                Text(t.surplusMinor < 0 ? "Deficit" : "Surplus").font(.nCaption).foregroundStyle(Nuru.ink600)
                FinBAmount(minor: abs(t.surplusMinor), currency: c, size: 15,
                           color: t.surplusMinor < 0 ? FinanceStatus.amber.fg : Nuru.success)
            }
            FinBFootWarning(problems: FinBFoot.incomeExpenditureProblems(block))
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) { incomeSide(c, t); expenseSide(c, t) }
                VStack(alignment: .leading, spacing: 16) { incomeSide(c, t); expenseSide(c, t) }
            }
            statementLine(t.surplusMinor < 0 ? "Deficit (income − expenditure)" : "Surplus (income − expenditure)",
                          abs(t.surplusMinor), c, strong: true, tint: t.surplusMinor < 0 ? FinanceStatus.amber.fg : Nuru.success)
                .padding(.top, 2)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func incomeSide(_ c: String, _ t: FinIncomeExpenditure.Totals) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle("Income")
            if block.income.isEmpty { none("No gifts in this period.") }
            ForEach(block.income) { l in statementLine(l.label.isEmpty ? l.key : l.label, l.amountMinor, c) }
            statementLine("Gifts, net of reversals", t.giftsMinor, c, subtotal: true)
            if !block.otherIncome.isEmpty {
                sectionTitle("Other income").padding(.top, 6)
                ForEach(block.otherIncome) { l in statementLine(l.label.isEmpty ? l.key : l.label, l.amountMinor, c) }
                statementLine("Other income", t.otherIncomeMinor, c, subtotal: true)
            }
            statementLine("Total income", t.incomeMinor, c, strong: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func expenseSide(_ c: String, _ t: FinIncomeExpenditure.Totals) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle("Expenditure")
            if block.expenses.isEmpty { none("No approved expenses in this period.") }
            ForEach(block.expenses) { l in statementLine(l.label.isEmpty ? l.key : l.label, l.amountMinor, c) }
            statementLine("Total expenditure", t.expensesMinor, c, strong: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sectionTitle(_ s: String) -> some View {
        Text(s.uppercased()).font(.nOverline).tracking(1.1).foregroundStyle(Nuru.ink600)
    }
    private func none(_ s: String) -> some View { Text(s).font(.nCaption).foregroundStyle(Nuru.ink400) }
}

/// A statement line: label on the left, the exact amount on the right.
func statementLine(_ label: String, _ minor: Int, _ currency: String, subtotal: Bool = false, strong: Bool = false, tint: Color? = nil) -> some View {
    HStack(alignment: .firstTextBaseline) {
        Text(label).font(.inter(13, strong ? .bold : subtotal ? .semibold : .regular))
            .foregroundStyle(strong || subtotal ? Nuru.navy : Nuru.ink).lineLimit(2)
        Spacer(minLength: 8)
        Text(FinanceMoney.format(minor, currency)).font(.inter(13, strong ? .bold : subtotal ? .semibold : .regular))
            .foregroundStyle(tint ?? Nuru.navy).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
    }
    .padding(.vertical, strong || subtotal ? 5 : 2)
    .overlay(alignment: .top) { if strong || subtotal { Rectangle().fill(Nuru.border).frame(height: 1) } }
}

// MARK: - Financial position

struct FinancePositionBanner: View {
    let position: FinFinancialPosition
    var body: some View {
        let unbalanced = position.currencies.filter { !$0.balanced }.map(\.currency)
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: position.balanced ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(position.balanced ? Nuru.success : FinanceStatus.red.fg)
            VStack(alignment: .leading, spacing: 3) {
                Text(position.balanced ? "Balanced ✓" : "Not balanced").font(.inter(14.5, .bold))
                    .foregroundStyle(position.balanced ? Nuru.success : FinanceStatus.red.fg)
                Text(position.balanced
                     ? "As of \(FinanceDates.display(position.asOf)), in every currency, the money the church holds equals its fund balances plus its other accounts."
                     : "As of \(FinanceDates.display(position.asOf)), \(unbalanced.joined(separator: " and ")) does not balance — assets differ from funds + other. Reconciliation → Integrity shows where.")
                    .font(.nCaption).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(position.balanced ? FinanceStatus.green.bg : FinanceStatus.red.bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
    }
}

struct FinancePositionCard: View {
    let block: FinFinancialPosition.Currency

    var body: some View {
        let t = block.totals
        let c = block.currency
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                FinBCurrencyBadge(currency: c)
                Text("Financial position").font(.inter(14.5, .bold)).foregroundStyle(Nuru.navy)
                Spacer(minLength: 8)
                FinanceStatusChip(status: block.balanced ? "approved" : "failed", label: block.balanced ? "Balanced ✓" : "Not balanced")
            }
            FinBFootWarning(problems: FinBFoot.positionProblems(block))
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) { assets(c, t); fundsSide(c, t) }
                VStack(alignment: .leading, spacing: 16) { assets(c, t); fundsSide(c, t) }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("Assets \(FinanceMoney.format(t.assetsMinor, c))")
                Text(t.assetsMinor == t.fundsMinor + t.otherMinor ? "=" : "≠").font(.inter(13, .bold))
                Text("funds \(FinanceMoney.format(t.fundsMinor, c)) + other \(FinanceMoney.format(t.otherMinor, c))")
            }
            .font(.inter(12.5, .semibold)).foregroundStyle(block.balanced ? Nuru.success : FinanceStatus.red.fg).monospacedDigit()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func assets(_ c: String, _ t: FinFinancialPosition.Totals) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("WHAT THE CHURCH HOLDS").font(.nOverline).tracking(1.1).foregroundStyle(Nuru.ink600)
            if block.assets.isEmpty { Text("No cash accounts.").font(.nCaption).foregroundStyle(Nuru.ink400) }
            ForEach(block.assets) { a in statementLine(a.label.isEmpty ? a.account : a.label, a.balanceMinor, c) }
            statementLine("Total assets", t.assetsMinor, c, strong: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func fundsSide(_ c: String, _ t: FinFinancialPosition.Totals) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("WHAT IT IS HELD FOR").font(.nOverline).tracking(1.1).foregroundStyle(Nuru.ink600)
            if block.funds.isEmpty { Text("No fund balances.").font(.nCaption).foregroundStyle(Nuru.ink400) }
            ForEach(block.funds) { f in
                statementLine(f.label.isEmpty ? f.code : f.label, f.balanceMinor, c, tint: f.balanceMinor < 0 ? FinanceStatus.red.fg : nil)
            }
            statementLine("Funds", t.fundsMinor, c, subtotal: true)
            if !block.other.isEmpty {
                ForEach(block.other) { o in statementLine(o.label.isEmpty ? o.account : o.label, o.balanceMinor, c) }
                statementLine("Other accounts", t.otherMinor, c, subtotal: true)
            }
            statementLine("Funds + other", t.fundsMinor + t.otherMinor, c, strong: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Finance → Reconciliation (pathway docs/FINANCE_ERP.md §5): do the books agree
// with the money?
//   Settlement — per EAT day and cash channel: gifts received, reversals, net.
//   Exceptions — everything the books flag, grouped by kind, each with what it
//                means and what to do; a row opens its transaction or journal.
//   Integrity  — Σ debits and Σ credits over the whole ledger, per currency.
// Deep link: tab=settlement|exceptions|integrity (+ from/to).
import SwiftUI

enum FinAReconTab: String, CaseIterable, Identifiable {
    case settlement, exceptions, integrity
    var id: String { rawValue }
    var title: String {
        switch self { case .settlement: "Daily settlement"; case .exceptions: "Exceptions"; case .integrity: "Integrity" }
    }
}

@MainActor
final class FinanceReconciliationModel: ObservableObject {
    @Published var tab: FinAReconTab = .settlement
    @Published var period: FinancePeriod = .thisMonth
    @Published private(set) var data: FinReconciliation?
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    private var generation = 0

    func load() async {
        generation += 1
        let gen = generation
        loading = true
        do {
            let r = try await FinanceERPAPI.reconciliation(period: period)
            guard gen == generation else { return }
            data = r
            error = nil
        } catch {
            guard gen == generation else { return }
            if !Task.isCancelled { self.error = FinanceARules.message(error) }
        }
        if gen == generation { loading = false }
    }

    func apply(_ p: [String: String]) {
        if let t = p["tab"], let tab = FinAReconTab(rawValue: t) { self.tab = tab }
        if let from = p["from"], let to = p["to"], FinanceDates.date(fromYMD: from) != nil, FinanceDates.date(fromYMD: to) != nil {
            period = .custom(from: from, to: to)
        }
    }

    /// Exceptions of one kind, as listed.
    func exceptions(_ kind: String) -> [FinReconciliation.Exception] { data?.exceptions.filter { $0.kind == kind } ?? [] }

    /// The server's count for a kind (exception_counts).
    func count(_ kind: String) -> Int {
        guard let c = data?.exceptionCounts else { return 0 }
        switch kind {
        case "stale_processing": return c.staleProcessing
        case "failed": return c.failed
        case "succeeded_without_ledger": return c.succeededWithoutLedger
        case "unbalanced_transaction": return c.unbalancedTransaction
        case "refunded_without_reversal": return c.refundedWithoutReversal
        case "duplicate_receipt": return c.duplicateReceipt
        case "unbalanced_journal": return c.unbalancedJournal
        default: return exceptions(kind).count
        }
    }

    var totalExceptions: Int { FinanceARules.exceptionKinds.reduce(0) { $0 + max(count($1), exceptions($1).count) } }
}

struct FinanceReconciliationView: View {
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceReconciliationModel()

    var body: some View {
        FinancePageScaffold(title: Section.financeReconciliation.title,
                            subtitle: "Do the books agree with the money that came in?",
                            onRefresh: { await vm.load() }) {
            EmptyView()
        } subheader: {
            FinanceTabs(tabs: FinAReconTab.allCases, selection: $vm.tab, label: \.title,
                        badge: { $0 == .exceptions ? vm.totalExceptions : nil })
        } content: {
            FinanceFilterBar(period: $vm.period)
            if let d = vm.data {
                Group {
                    switch vm.tab {
                    case .settlement: settlement(d)
                    case .exceptions: exceptions(d)
                    case .integrity: integrity(d)
                    }
                }
                .opacity(vm.loading ? 0.55 : 1)
                if let e = vm.error { FinanceNoticeBar(notice: .error("Couldn't refresh — \(e)")) }
            } else if let e = vm.error {
                ErrorBanner(message: e) { Task { await vm.load() } }
            } else {
                SkeletonTable(rows: 6)
            }
        }
        .task(id: vm.period) { await vm.load() }
        .onFinanceLink(.financeReconciliation) { vm.apply($0) }
        .finADebugLaunchParams(.financeReconciliation) { vm.apply($0) }
    }

    // MARK: Settlement

    private var settlementColumns: [FinanceColumn] { [
        FinanceColumn("Day", width: 92),
        FinanceColumn("Channel", minWidth: 130),
        FinanceColumn("Gifts", width: 64, align: .trailing),
        FinanceColumn("Received", width: 116, align: .trailing),
        FinanceColumn("Reversed", width: 108, align: .trailing),
        FinanceColumn("Net", width: 116, align: .trailing),
    ] }

    @ViewBuilder private func settlement(_ d: FinReconciliation) -> some View {
        let byCurrency = Dictionary(grouping: d.settlement, by: \.currency)
        let currencies = byCurrency.keys.sorted(by: FinanceMoney.currencyPrecedes)
        if !currencies.isEmpty {
            FinanceKpiGrid(minimum: 200) {
                ForEach(currencies, id: \.self) { c in
                    let rows = byCurrency[c] ?? []
                    let received = rows.reduce(0) { $0 + $1.receivedMinor }
                    let reversed = rows.reduce(0) { $0 + $1.reversedMinor }
                    FinanceKpiTile(label: "\(c) net in period", icon: "arrow.down.to.line", tint: Nuru.brandTint(0),
                                   values: [FinanceMoney.format(received - reversed, c)],
                                   hint: "Received \(FinanceMoney.format(received, c)) · reversed \(FinanceMoney.format(reversed, c)) · \(rows.reduce(0) { $0 + $1.count }) gifts")
                }
            }
        }
        let cols = settlementColumns
        let rows = d.settlement
        FinanceTable(rows: rows, columns: cols, emptyIcon: "calendar", emptyMessage: "No money came in during this period.") { s in
            let firstOfDay = rows.first { $0.day == s.day }?.id == s.id
            Text(firstOfDay ? FinanceDates.display(s.day) : "").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink).lineLimit(1)
                .minimumScaleFactor(0.8).financeCell(cols[0])
            VStack(alignment: .leading, spacing: 1) {
                Text(FinanceARules.cashChannelLabel(s.channel)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                Text("\(s.account) · \(s.currency)").font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1)
            }
            .financeCell(cols[1])
            VStack(alignment: .trailing, spacing: 1) {
                Text("\(s.count)").font(.nMono(12.5))
                if s.reversedCount > 0 { Text("−\(s.reversedCount)").font(.nMono(10.5)).foregroundStyle(FinanceStatus.violet.fg) }
            }
            .financeCell(cols[2])
            Text(FinanceMoney.format(s.receivedMinor, s.currency)).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[3])
            Text(s.reversedMinor == 0 ? "—" : FinanceMoney.format(-s.reversedMinor, s.currency)).font(.nMono(12.5))
                .foregroundStyle(s.reversedMinor == 0 ? Nuru.ink400 : FinanceStatus.violet.fg)
                .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[4])
            Text(FinanceMoney.format(s.amountMinor, s.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy)
                .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[5])
        }
        FinAExplain("What each cash account received per day (the posting's date, EAT), less reversals — a reversal is dated on the gift it corrects, so a day's net is what that day really kept. Compare a day's M-Pesa net with the till statement, cash on hand with the count.")
    }

    // MARK: Exceptions

    @ViewBuilder private func exceptions(_ d: FinReconciliation) -> some View {
        let kinds = FinanceARules.exceptionKinds.filter { vm.count($0) > 0 || !vm.exceptions($0).isEmpty }
        if kinds.isEmpty {
            FinanceNoticeBar(notice: .ok("No exceptions — every settled payment has balanced postings and nothing is stuck."))
        } else {
            FinAExplain("Only “failed” is limited to the period; every other kind is an open issue whenever it arose.")
            ForEach(kinds, id: \.self) { kind in exceptionGroup(kind) }
        }
    }

    private func exceptionGroup(_ kind: String) -> some View {
        let rows = vm.exceptions(kind)
        let n = max(vm.count(kind), rows.count)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(FinanceARules.exceptionTitle(kind)).font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
                Text("\(n)").font(.nMono(12, .medium)).foregroundStyle(FinanceStatus.amber.fg)
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(FinanceStatus.amberStrong.bg).clipShape(Capsule())
                Spacer(minLength: 0)
            }
            Text(FinanceARules.exceptionExplanation(kind)).font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "hand.point.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.goldLo)
                Text(FinanceARules.exceptionAction(kind)).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true)
            }
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { i, e in
                    Button { open(e) } label: {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(FinanceATime.day(e.at)).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink).lineLimit(1)
                                Text(FinanceATime.time(e.at)).font(.nMicro).foregroundStyle(Nuru.ink400)
                            }
                            .frame(width: 88, alignment: .leading)
                            Text(e.detail).font(.nCaption).foregroundStyle(Nuru.ink).lineLimit(3)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if let a = e.amountMinor, let c = e.currency {
                                Text(FinanceMoney.format(a, c)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy).lineLimit(1)
                            }
                            if e.transactionId != nil || e.journalId != nil {
                                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.ink300)
                            }
                        }
                        .padding(.vertical, 9).padding(.horizontal, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .disabled(e.transactionId == nil && e.journalId == nil)
                    .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                }
                if rows.isEmpty {
                    Text("Counted by the server; none listed in this period.").font(.nCaption).foregroundStyle(Nuru.ink400)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func open(_ e: FinReconciliation.Exception) {
        if let t = e.transactionId { router.openFinance(.financeTransactions, ["tx": t]) }
        else if let j = e.journalId { router.openFinance(.financeLedger, ["tab": "journals", "journal": j]) }
    }

    // MARK: Integrity

    @ViewBuilder private func integrity(_ d: FinReconciliation) -> some View {
        let all = d.integrity.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
        if all.allSatisfy(\.balanced) {
            FinanceNoticeBar(notice: .ok("The ledger balances — in every currency, total debits equal total credits."))
        } else {
            FinanceNoticeBar(notice: .error("The ledger does not balance in \(all.filter { !$0.balanced }.map(\.currency).joined(separator: ", ")). The Exceptions tab lists the postings that don't."))
        }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 14, alignment: .top)], alignment: .leading, spacing: 14) {
            ForEach(all) { i in
                FinACard(icon: i.balanced ? "checkmark.seal" : "exclamationmark.triangle", title: i.currency,
                         caption: i.balanced ? "balanced" : "not balanced") {
                    FinAFacts(facts: [
                        FinAFact("Debits", FinanceMoney.format(i.debitMinor, i.currency)),
                        FinAFact("Credits", FinanceMoney.format(i.creditMinor, i.currency)),
                        FinAFact("Difference", FinanceMoney.format(i.debitMinor - i.creditMinor, i.currency)),
                    ], minimum: 110)
                }
            }
        }
        FinAExplain("Σ debits and Σ credits over every posting ever made (not just this period), per currency. Double entry means they are always equal; a difference means a posting is missing its other half.")
    }
}

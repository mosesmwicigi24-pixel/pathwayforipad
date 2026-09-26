// Finance → Reconciliation (pathway docs/FINANCE_ERP.md §5). One read
// (GET /admin/finance/reconciliation?from&to), three tabs (tab=, so the
// Overview's alerts can open tab=exceptions):
//   Daily settlement — per day and cash channel, what came in, what was
//     reversed and the net: the figures to tick against the M-Pesa statement,
//     the bank statement and the cash book.
//   Exceptions — every payment or posting that needs a person, grouped by kind,
//     each kind with a one-line explanation and what to do, each row opening its
//     transaction or journal. Only `failed` is bounded by the period.
//   Integrity — Σ debits and Σ credits over the whole ledger, per currency.
// Same content and words as the web's Finance → Reconciliation.
import SwiftUI

enum FinAReconTab: String, CaseIterable, Identifiable {
    case settlement, exceptions, integrity
    var id: String { rawValue }
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
            if !Task.isCancelled { self.error = FinanceARules.message(error, fallback: "Could not load the reconciliation.") }
        }
        if gen == generation { loading = false }
    }

    /// tab=settlement|exceptions|integrity, period=<preset> or from/to.
    func apply(_ p: [String: String]) {
        if let t = p["tab"], let tab = FinAReconTab(rawValue: t) { self.tab = tab }
        if let period = FinanceARules.period(fromParams: p) { self.period = period }
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
        default: return 0
        }
    }

    /// Failed payments are information (nothing was posted, nothing to fix), so
    /// "open" counts only the kinds that need a person.
    var openExceptions: Int? {
        guard data != nil else { return nil }
        return FinanceARules.exceptionKinds.filter { $0 != "failed" }.reduce(0) { $0 + count($1) }
    }
    var integrityOk: Bool? { data.map { $0.integrity.allSatisfy(\.balanced) } }
}

/// One cash account's period totals (the web's "Period totals by channel").
struct FinAChannelSum: Identifiable, Hashable {
    let channel: String
    let account: String
    let currency: String
    var count = 0
    var received = 0
    var reversedCount = 0
    var reversed = 0
    var net = 0
    var id: String { "\(account)|\(currency)" }

    static func of(_ rows: [FinReconciliation.Settlement]) -> [FinAChannelSum] {
        var by: [String: FinAChannelSum] = [:]
        var order: [String] = []
        for r in rows {
            let k = "\(r.account)|\(r.currency)"
            if by[k] == nil {
                order.append(k)
                by[k] = FinAChannelSum(channel: r.channel, account: r.account, currency: r.currency)
            }
            guard var t = by[k] else { continue }
            t.count += r.count
            t.received += r.receivedMinor
            t.reversedCount += r.reversedCount
            t.reversed += r.reversedMinor
            t.net += r.amountMinor
            by[k] = t
        }
        return order.compactMap { by[$0] }.sorted {
            $0.currency != $1.currency ? FinanceMoney.currencyPrecedes($0.currency, $1.currency) : $0.net > $1.net
        }
    }
}

struct FinanceReconciliationView: View {
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceReconciliationModel()
    @State private var channelWidth: CGFloat = 0
    @State private var dayWidth: CGFloat = 0
    @State private var exceptionWidth: CGFloat = 0

    var body: some View {
        FinancePageScaffold(title: Section.financeReconciliation.title,
                            subtitle: "\(FinanceARules.fmtRange(from: vm.period.from, to: vm.period.to)). Tick what came in against the statements, work the exceptions, and confirm the books balance.",
                            onRefresh: { await vm.load() }) {
            EmptyView()
        } subheader: {
            FinanceTabs(tabs: FinAReconTab.allCases, selection: $vm.tab,
                        label: { t in
                            switch t {
                            case .settlement: "Daily settlement"
                            case .exceptions: "Exceptions"
                            case .integrity: vm.integrityOk == false ? "Integrity ✗" : "Integrity"
                            }
                        },
                        badge: { $0 == .exceptions ? vm.openExceptions : nil })
        } content: {
            kpis
            // Integrity is over the whole ledger (all time) — no period there.
            if vm.tab != .integrity { FinanceFilterBar(period: $vm.period) }
            if let d = vm.data {
                Group {
                    switch vm.tab {
                    case .settlement: settlement(d)
                    case .exceptions: exceptions(d)
                    case .integrity: integrity(d)
                    }
                }
                .opacity(vm.loading ? 0.55 : 1)
                .animation(.easeInOut(duration: 0.15), value: vm.loading)
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

    // MARK: KPI tiles

    private func totals(_ pairs: [(currency: String, minor: Int)]) -> [String] {
        var by: [String: Int] = [:]
        for p in pairs { by[p.currency, default: 0] += p.minor }
        return by.keys.sorted(by: FinanceMoney.currencyPrecedes).map { FinanceMoney.format(by[$0] ?? 0, $0) }
    }

    private var kpis: some View {
        let d = vm.data
        let s = d?.settlement ?? []
        let received = totals(s.map { ($0.currency, $0.receivedMinor) })
        let reversed = totals(s.filter { $0.reversedMinor > 0 }.map { ($0.currency, $0.reversedMinor) })
        let net = totals(s.map { ($0.currency, $0.amountMinor) })
        let open = vm.openExceptions
        let failed = vm.count("failed")
        let ok = vm.integrityOk
        let first = d == nil && vm.loading
        return FinanceKpiGrid(minimum: 190) {
            FinanceKpiTile(label: "Received", icon: "arrow.down.to.line", tint: Nuru.brandTint(0),
                           values: d == nil ? [] : received, hint: "Into the cash accounts, in the period", loading: first)
            FinanceKpiTile(label: "Reversed", icon: "arrow.uturn.backward", tint: Nuru.brandTint(3),
                           values: d == nil ? [] : (reversed.isEmpty ? ["None"] : reversed), hint: "Office entries taken back out", loading: first)
            FinanceKpiTile(label: "Net", icon: "plusminus", tint: Nuru.brandTint(2),
                           values: d == nil ? [] : net, hint: "Received − reversed", loading: first)
            FinAValueTile(label: "Open exceptions", icon: "exclamationmark.triangle", tint: Nuru.brandTint(1),
                          lines: open.map { [FinAValueTile.Line(text: "\($0)", color: $0 > 0 ? FinanceStatus.amber.fg : nil)] } ?? [],
                          hint: d != nil && failed > 0 ? "Need a person · plus \(FinanceARules.plural(failed, "failed payment")) to note" : "Need a person") {
                vm.tab = .exceptions
            }
            FinAValueTile(label: "Books", icon: "scale.3d", tint: Nuru.brandTint(2),
                          lines: ok.map { [FinAValueTile.Line(text: $0 ? "Balanced" : "Not balanced",
                                                              color: $0 ? FinanceStatus.green.fg : FinanceStatus.red.fg)] } ?? [],
                          hint: "Every debit has its credit") {
                vm.tab = .integrity
            }
        }
    }

    // MARK: Settlement

    @ViewBuilder private func settlement(_ d: FinReconciliation) -> some View {
        if d.settlement.isEmpty {
            EmptyState.compact(icon: "calendar", message: "Nothing settled in this period. Each day's money in — per M-Pesa, card, cash, bank and cheque account — appears here once gifts settle.")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                FinASectionTitle(icon: "list.bullet.rectangle", title: "Period totals by channel")
                FinAExplain("Tick each line against its statement: the M-Pesa till statement, the bank statement, the cash book.")
                channelTable(FinAChannelSum.of(d.settlement))
            }
            VStack(alignment: .leading, spacing: 8) {
                FinASectionTitle(icon: "calendar", title: "Day by day")
                FinAExplain("Newest day first. A reversal is dated at the gift it corrects, so it lands on the day it restates.")
                dayTable(d.settlement)
            }
        }
    }

    private func reversedText(_ minor: Int, _ currency: String) -> some View {
        Text(minor > 0 ? FinanceMoney.format(-minor, currency) : "—").font(.nMono(12.5))
            .foregroundStyle(minor > 0 ? FinanceStatus.red.fg : Nuru.ink400)
            .lineLimit(1).minimumScaleFactor(0.7)
    }

    private func channelTable(_ rows: [FinAChannelSum]) -> some View {
        let narrow = channelWidth > 0 && channelWidth < 600
        let cols = narrow ? [
            FinanceColumn("Channel", minWidth: 130),
            FinanceColumn("Received", width: 124, align: .trailing),
            FinanceColumn("Net", width: 124, align: .trailing),
        ] : [
            FinanceColumn("Channel", minWidth: 170),
            FinanceColumn("Gifts", width: 60, align: .trailing),
            FinanceColumn("Received", width: 122, align: .trailing),
            FinanceColumn("Reversed", width: 112, align: .trailing),
            FinanceColumn("Net", width: 122, align: .trailing),
        ]
        return FinanceTable(rows: rows, columns: cols, emptyIcon: "tray", emptyMessage: "") { c in
            VStack(alignment: .leading, spacing: 1) {
                Text(FinanceARules.cashChannelLabel(c.channel)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                Text("\(c.account) · \(c.currency)").font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1)
                if narrow { Text(FinanceARules.plural(c.count, "gift")).font(.nMicro).foregroundStyle(Nuru.ink400) }
            }
            .financeCell(cols[0])
            if narrow {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(FinanceMoney.format(c.received, c.currency)).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7)
                    if c.reversed > 0 { reversedText(c.reversed, c.currency).font(.nMono(10.5)) }
                }
                .financeCell(cols[1])
                Text(FinanceMoney.format(c.net, c.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy)
                    .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
            } else {
                Text("\(c.count)").font(.nMono(12.5)).financeCell(cols[1])
                Text(FinanceMoney.format(c.received, c.currency)).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
                reversedText(c.reversed, c.currency).financeCell(cols[3])
                Text(FinanceMoney.format(c.net, c.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy)
                    .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[4])
            }
        }
        .measureWidth($channelWidth)
    }

    private func dayTable(_ rows: [FinReconciliation.Settlement]) -> some View {
        let narrow = dayWidth > 0 && dayWidth < 640
        let cols = narrow ? [
            FinanceColumn("Day", width: 86),
            FinanceColumn("Channel", minWidth: 110),
            FinanceColumn("Received", width: 120, align: .trailing),
            FinanceColumn("Net", width: 120, align: .trailing),
        ] : [
            FinanceColumn("Day", width: 100),
            FinanceColumn("Channel", minWidth: 150),
            FinanceColumn("Gifts", width: 60, align: .trailing),
            FinanceColumn("Received", width: 120, align: .trailing),
            FinanceColumn("Reversed", width: 110, align: .trailing),
            FinanceColumn("Net", width: 120, align: .trailing),
        ]
        let firstOfDay = Set(rows.indices.filter { $0 == 0 || rows[$0 - 1].day != rows[$0].day }.map { rows[$0].id })
        return FinanceTable(rows: rows, columns: cols, emptyIcon: "calendar", emptyMessage: "") { s in
            Text(firstOfDay.contains(s.id) ? FinanceDates.display(s.day) : "").font(.nMono(12)).foregroundStyle(Nuru.navy)
                .lineLimit(1).minimumScaleFactor(0.8).financeCell(cols[0])
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    Text(FinanceARules.cashChannelLabel(s.channel)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    Text(s.currency).font(.nMono(10.5)).foregroundStyle(Nuru.ink400)
                }
                if narrow { Text(FinanceARules.plural(s.count, "gift")).font(.nMicro).foregroundStyle(Nuru.ink400) }
            }
            .financeCell(cols[1])
            if narrow {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(FinanceMoney.format(s.receivedMinor, s.currency)).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7)
                    if s.reversedMinor > 0 { reversedText(s.reversedMinor, s.currency).font(.nMono(10.5)) }
                }
                .financeCell(cols[2])
                Text(FinanceMoney.format(s.amountMinor, s.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy)
                    .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[3])
            } else {
                Text("\(s.count)").font(.nMono(12.5)).financeCell(cols[2])
                Text(FinanceMoney.format(s.receivedMinor, s.currency)).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[3])
                reversedText(s.reversedMinor, s.currency)
                    .accessibilityHint(s.reversedMinor > 0 ? FinanceARules.plural(s.reversedCount, "reversal") : "")
                    .financeCell(cols[4])
                Text(FinanceMoney.format(s.amountMinor, s.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy)
                    .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[5])
            }
        }
        .measureWidth($dayWidth)
    }

    // MARK: Exceptions

    private struct Group_: Identifiable { let kind: String; let rows: [FinReconciliation.Exception]; let count: Int; var id: String { kind } }

    @ViewBuilder private func exceptions(_ d: FinReconciliation) -> some View {
        let groups = FinanceARules.exceptionKinds.map { k in Group_(kind: k, rows: vm.exceptions(k), count: vm.count(k)) }
            .filter { $0.count > 0 || !$0.rows.isEmpty }
        if groups.isEmpty {
            EmptyState.compact(icon: "checkmark.seal", message: "No exceptions. Every payment settled or failed cleanly, nothing is stuck, and every posting has its other side.")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                FinanceFlowLayout(spacing: 8, rowSpacing: 8) {
                    ForEach(groups) { g in
                        let copy = FinanceARules.exceptionCopy(g.kind)
                        let t = FinanceARules.colors(copy.tone)
                        Text("\(copy.title) · \(g.count)").font(.inter(12, .bold)).foregroundStyle(t.fg)
                            .padding(.horizontal, 11).padding(.vertical, 4)
                            .background(t.bg).clipShape(Capsule())
                            .overlay(Capsule().stroke(t.border, lineWidth: 1))
                    }
                }
                FinAExplain("Only “Failed” is limited to the period; everything else stays here until it is fixed.")
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            ForEach(groups) { g in exceptionGroup(g) }
        }
    }

    private struct Numbered: Identifiable { let index: Int; let e: FinReconciliation.Exception; var id: Int { index } }

    private func exceptionGroup(_ g: Group_) -> some View {
        let copy = FinanceARules.exceptionCopy(g.kind)
        let t = FinanceARules.colors(copy.tone)
        let narrow = exceptionWidth > 0 && exceptionWidth < 640
        let cols = narrow ? [
            FinanceColumn("When", width: 116),
            FinanceColumn("Detail", minWidth: 180),
        ] : [
            FinanceColumn("When", width: 138),
            FinanceColumn("Amount", width: 120, align: .trailing),
            FinanceColumn("Detail", minWidth: 200),
            FinanceColumn("", width: 150),
        ]
        let rows = g.rows.enumerated().map { Numbered(index: $0.offset, e: $0.element) }
        return VStack(alignment: .leading, spacing: 10) {
            FinASectionTitle(title: "\(copy.title) · \(g.count)")
            FinAExplain(copy.explain)
            (Text("What to do: ").fontWeight(.bold) + Text(copy.todo).fontWeight(.medium))
                .font(.inter(12.5)).foregroundStyle(t.fg)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(t.bg)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(t.border, lineWidth: 1))
            if rows.isEmpty {
                FinAExplain("The count comes from the server; no rows were listed.")
            } else {
                FinanceTable(rows: rows, columns: cols, emptyIcon: "tray", emptyMessage: "") { n in
                    let x = n.e
                    VStack(alignment: .leading, spacing: 1) {
                        Text(x.at.map { FinanceATime.dayTime($0) } ?? "—").font(.nMono(12)).foregroundStyle(Nuru.ink)
                            .lineLimit(2).minimumScaleFactor(0.8)
                        if narrow { amount(x) }
                    }
                    .financeCell(cols[0])
                    if narrow {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(x.detail).font(.inter(12.5)).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true)
                            openLink(x, kind: g.kind)
                        }
                        .financeCell(cols[1])
                    } else {
                        amount(x).financeCell(cols[1])
                        Text(x.detail).font(.inter(12.5)).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true).financeCell(cols[2])
                        openLink(x, kind: g.kind).financeCell(cols[3])
                    }
                }
                .measureWidth($exceptionWidth)
            }
        }
    }

    @ViewBuilder private func amount(_ x: FinReconciliation.Exception) -> some View {
        if let a = x.amountMinor, let c = x.currency, !c.isEmpty {
            Text(FinanceMoney.format(a, c)).font(.nMono(12.5)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.7)
        } else {
            Text("—").font(.nMono(12.5)).foregroundStyle(Nuru.ink400)
        }
    }

    @ViewBuilder private func openLink(_ x: FinReconciliation.Exception, kind: String) -> some View {
        if let tx = x.transactionId {
            Button { router.openFinance(.financeTransactions, ["tx": tx]) } label: {
                Label(kind == "duplicate_receipt" ? "Open the office entry" : "Open transaction", systemImage: "arrow.up.right.square")
                    .font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
        } else if let j = x.journalId {
            Button { router.openFinance(.financeLedger, ["tab": "journals", "journal": j]) } label: {
                Label("Open journal", systemImage: "arrow.up.right.square").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
        }
    }

    // MARK: Integrity

    @ViewBuilder private func integrity(_ d: FinReconciliation) -> some View {
        let all = d.integrity.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
        if all.isEmpty {
            EmptyState.compact(icon: "book.closed", message: "The ledger is empty. Nothing has been posted yet.")
        } else {
            FinAExplain("Every debit and every credit ever posted, gifts and journals alike, per currency. They must be equal: each posting has its other side.")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 16, alignment: .top)], alignment: .leading, spacing: 16) {
                ForEach(all) { i in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(i.currency).font(.inter(20, .semibold)).foregroundStyle(Nuru.navy)
                            Spacer()
                            Label(i.balanced ? "Balanced" : "Not balanced", systemImage: i.balanced ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .font(.inter(13, .bold)).foregroundStyle(i.balanced ? FinanceStatus.green.fg : FinanceStatus.red.fg)
                        }
                        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
                            integrityRow("Debits", FinanceMoney.format(i.debitMinor, i.currency), strong: true)
                            integrityRow("Credits", FinanceMoney.format(i.creditMinor, i.currency), strong: true)
                            integrityRow("Difference", FinanceMoney.format(i.debitMinor - i.creditMinor, i.currency), strong: false)
                        }
                        if !i.balanced {
                            FinanceNoticeBar(notice: .error("Open Exceptions for the entries that don't balance and tell the developer. Don't post a correction by hand."))
                        }
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }
            }
        }
    }

    private func integrityRow(_ label: String, _ value: String, strong: Bool) -> some View {
        GridRow {
            Text(label).font(.inter(13)).foregroundStyle(Nuru.ink400)
            Text(value).font(.nMono(13, strong ? .medium : .regular)).foregroundStyle(Nuru.navy)
                .lineLimit(1).minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }
}

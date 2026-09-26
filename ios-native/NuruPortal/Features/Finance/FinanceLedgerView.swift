// Finance → Ledger (pathway docs/FINANCE_ERP.md §5): the books themselves.
//   Postings — every leg, giving transactions AND journals, by the posting's
//              economic date (EAT); account / kind / period filters; debits and
//              credits per currency; the CSV twin.
//   Journals — expenses, voids, transfers, opening balances, reversals; each
//              row opens to its legs; Reverse a transfer or an opening balance
//              (finance:approve).
//   Trial balance — every account's debits, credits and balance on its normal
//              side, per currency, for a period or all time: balanced or not.
// Deep links: tab=postings|journals|trial, account, kind, from/to,
// journal=<id> (opens it), tx=<id> (opens the transaction).
import SwiftUI
import Combine

enum FinALedgerTab: String, CaseIterable, Identifiable {
    case postings, journals, trial
    var id: String { rawValue }
    var title: String {
        switch self { case .postings: "Postings"; case .journals: "Journals"; case .trial: "Trial balance" }
    }
}

enum FinALedgerSheet: Identifiable {
    case transaction(String)
    case journal(String)
    var id: String {
        switch self { case .transaction(let id): "tx:\(id)"; case .journal(let id): "j:\(id)" }
    }
}

@MainActor
final class FinanceLedgerModel: ObservableObject {
    @Published var tab: FinALedgerTab = .postings
    @Published var postingsFilter = FinLedgerFilter()
    let postings = FinancePager<FinLedgerPage>()
    @Published var journalsFilter = FinJournalFilter()
    let journals = FinancePager<FinJournalList>()
    @Published var expanded: Set<String> = []
    @Published var trialPeriod: FinancePeriod?
    @Published private(set) var trial: FinTrialBalance?
    @Published private(set) var trialLoading = false
    @Published private(set) var trialError: String?
    @Published private(set) var funds: [FundOption] = []
    @Published var sheet: FinALedgerSheet?
    @Published var reverseTarget: FinJournal?
    private var bag = Set<AnyCancellable>()
    private var trialGeneration = 0

    init() {
        postings.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        journals.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
    }

    var fundNames: [String: String] { Dictionary(funds.map { ($0.code, $0.name) }, uniquingKeysWith: { a, _ in a }) }

    func loadFunds() async {
        guard funds.isEmpty else { return }
        funds = (try? await FinanceERPAPI.config().funds) ?? []
    }

    func loadTrial() async {
        trialGeneration += 1
        let gen = trialGeneration
        trialLoading = true
        do {
            let t = try await FinanceERPAPI.trialBalance(period: trialPeriod)
            guard gen == trialGeneration else { return }
            trial = t
            trialError = nil
        } catch {
            guard gen == trialGeneration else { return }
            if !Task.isCancelled { trialError = FinanceARules.message(error) }
        }
        if gen == trialGeneration { trialLoading = false }
    }

    func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    func apply(_ p: [String: String]) {
        var period: FinancePeriod?? = nil
        if let from = p["from"], let to = p["to"], FinanceDates.date(fromYMD: from) != nil, FinanceDates.date(fromYMD: to) != nil {
            period = .some(.custom(from: from, to: to))
        }
        switch p["tab"] ?? "" {
        case "journals": tab = .journals
        case "trial", "trial-balance", "trial_balance": tab = .trial
        case "postings": tab = .postings
        default: if p["journal"] != nil { tab = .journals }
        }
        if p["account"] != nil || p["kind"] != nil || period != nil {
            switch tab {
            case .postings:
                var f = FinLedgerFilter()
                if let a = p["account"] { f.account = a; f.period = nil }
                if let k = p["kind"] { f.kind = k }
                if let period { f.period = period }
                postingsFilter = f
            case .journals:
                var f = FinJournalFilter()
                if let k = p["kind"] { f.kind = k }
                if let period { f.period = period }
                journalsFilter = f
            case .trial:
                if let period { trialPeriod = period }
            }
        }
        if let id = p["journal"], !id.isEmpty { sheet = .journal(id) }
        else if let id = p["tx"], !id.isEmpty { sheet = .transaction(id) }
    }
}

struct FinanceLedgerView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceLedgerModel()

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeLedger.title,
                            subtitle: "Every posting — one debit, one credit, same amount and currency.",
                            onRefresh: { await refresh() }) {
            if vm.tab == .postings {
                FinanceExportButton(caps: caps, path: FinanceERPAPI.ledgerCSV, query: vm.postingsFilter.query, placement: .hero)
            }
        } subheader: {
            FinanceTabs(tabs: FinALedgerTab.allCases, selection: $vm.tab, label: \.title)
        } content: {
            switch vm.tab {
            case .postings: postingsTab
            case .journals: journalsTab(caps)
            case .trial: trialTab
            }
        }
        .task { await vm.loadFunds() }
        .onFinanceLink(.financeLedger) { vm.apply($0) }
        .finADebugLaunchParams(.financeLedger) { vm.apply($0) }
        .sheet(item: $vm.sheet) { s in
            switch s {
            case .transaction(let id):
                FinATransactionSheet(transactionId: id, caps: caps, fundNames: vm.fundNames,
                                     onChanged: { Task { await refresh() } },
                                     onOpenMember: { userId, name in
                                         DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { router.member(userId, name) }
                                     })
            case .journal(let id):
                FinAJournalSheet(journalId: id, caps: caps, fundNames: vm.fundNames, onChanged: { Task { await refresh() } })
            }
        }
        .finAJournalReversal(target: $vm.reverseTarget, fundNames: vm.fundNames) { Task { await refresh() } }
    }

    private func refresh() async {
        switch vm.tab {
        case .postings: await vm.postings.reload()
        case .journals: await vm.journals.reload()
        case .trial: await vm.loadTrial()
        }
    }

    // MARK: Postings

    private var accountOptions: [FinanceFilterOption] {
        var o: [FinanceFilterOption] = [.all("All accounts"), FinanceFilterOption("cash:", "All cash accounts")]
        for ch in ["onhand", "bank", "cheque", "mpesa", "airtel", "stripe", "paypal", "manual"] {
            o.append(FinanceFilterOption("cash:\(ch)", "cash:\(ch) · \(FinanceARules.cashChannelLabel(ch))"))
        }
        o.append(FinanceFilterOption("fund:", "All fund accounts"))
        for f in vm.funds { o.append(FinanceFilterOption("fund:\(f.code)", "fund:\(f.code) · \(f.name)")) }
        o.append(FinanceFilterOption("sales:media", "sales:media · Media sales"))
        let current = vm.postingsFilter.account
        if !current.isEmpty, !o.contains(where: { $0.value == current }) { o.append(FinanceFilterOption(current, current)) }
        return o
    }

    private var postingColumns: [FinanceColumn] { [
        FinanceColumn("Posted", width: 84),
        FinanceColumn("Account", width: 150),
        FinanceColumn("Source", minWidth: 170),
        FinanceColumn("Debit", width: 110, align: .trailing),
        FinanceColumn("Credit", width: 110, align: .trailing),
    ] }

    @ViewBuilder private var postingsTab: some View {
        let filtered = vm.postingsFilter != FinLedgerFilter()
        FinanceFilterBar(isFiltered: filtered, onClear: { vm.postingsFilter = FinLedgerFilter() }) {
            FinAPeriodMenu(period: $vm.postingsFilter.period)
            FinanceFilterMenu(title: "Account", selection: $vm.postingsFilter.account, options: accountOptions, icon: "book.closed")
            FinanceFilterMenu(title: "Kind", selection: $vm.postingsFilter.kind,
                              options: [.all("Both"), FinanceFilterOption("transaction", "Giving transactions"), FinanceFilterOption("journal", "Journals")])
        }
        VStack(alignment: .leading, spacing: 6) {
            FinALedgerTotalsStrip(totals: vm.postings.totals, loading: vm.postings.isLoadingFirstPage)
            FinAExplain("Each posting is dated at the day it records (a gift's received day; an expense's spent day; a reversal restates the day it corrects), in EAT. Over the whole ledger debits equal credits in every currency.")
        }
        let cols = postingColumns
        FinancePagedTable(pager: vm.postings, columns: cols, emptyIcon: "book.closed",
                          emptyMessage: "No postings match these filters.",
                          totalCount: vm.postings.totals.isEmpty ? nil : vm.postings.totals.reduce(0) { $0 + $1.count },
                          onSelect: { row in
                              if let t = row.transactionId { vm.sheet = .transaction(t) }
                              else if let j = row.journalId { vm.sheet = .journal(j) }
                          }) { p in
            Text(FinanceDates.display(p.postedOn)).font(.inter(12.5)).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.8)
                .financeCell(cols[0])
            VStack(alignment: .leading, spacing: 1) {
                Text(p.account).font(.nMono(12)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.75)
                Text(FinanceARules.accountLabel(p.account, fundNames: vm.fundNames)).font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1)
            }
            .financeCell(cols[1])
            VStack(alignment: .leading, spacing: 2) {
                if p.kind == "journal" {
                    HStack(spacing: 6) {
                        FinATag(text: FinWords.journalKind(p.journalKind), tone: FinAJournalDetail.tone(p.journalKind ?? ""))
                    }
                    Text(p.memo ?? "—").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                } else {
                    HStack(spacing: 6) {
                        Text(p.receiptCode ?? "Gift").font(.nMono(12)).foregroundStyle(Nuru.ink).lineLimit(1)
                        if let s = p.transactionStatus, s != "succeeded" {
                            FinanceStatusChip(status: s)
                        }
                    }
                    Text(p.memberName ?? "—").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                }
            }
            .financeCell(cols[2])
            Text(p.side == "debit" ? FinanceMoney.format(p.amountMinor, p.currency) : "")
                .font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[3])
            Text(p.side == "credit" ? FinanceMoney.format(p.amountMinor, p.currency) : "")
                .font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[4])
        }
        .task(id: vm.postingsFilter) {
            let filter = vm.postingsFilter
            await vm.postings.load { cursor in try await FinanceERPAPI.ledger(filter, cursor: cursor) }
        }
    }

    // MARK: Journals

    private static let kindOptions = [
        FinanceFilterOption.all("All kinds"), FinanceFilterOption("expense", "Expense"),
        FinanceFilterOption("expense_void", "Expense void"), FinanceFilterOption("transfer", "Transfer"),
        FinanceFilterOption("opening", "Opening balance"), FinanceFilterOption("reversal", "Reversal"),
    ]

    private var journalColumns: [FinanceColumn] { [
        FinanceColumn("Dated", width: 80),
        FinanceColumn("Kind", width: 104),
        FinanceColumn("Memo", minWidth: 180),
        FinanceColumn("Amount", width: 120, align: .trailing),
        FinanceColumn("", width: 100),
        FinanceColumn("", width: 28),
    ] }

    @ViewBuilder private func journalsTab(_ caps: FinanceCaps) -> some View {
        let filtered = vm.journalsFilter != FinJournalFilter()
        FinanceFilterBar(isFiltered: filtered, onClear: { vm.journalsFilter = FinJournalFilter() }) {
            FinAPeriodMenu(period: $vm.journalsFilter.period)
            FinanceFilterMenu(title: "Kind", selection: $vm.journalsFilter.kind, options: Self.kindOptions)
        }
        VStack(alignment: .leading, spacing: 6) {
            FinanceTotalsStrip(totals: vm.journals.totals, title: "Journals", noun: ("journal", "journals"), loading: vm.journals.isLoadingFirstPage)
            FinAExplain("Postings that are not giving: approved expenses and their voids, transfers between funds, opening balances and reversals. The amount is each journal's debits, per currency. Open a row for its legs.")
        }
        let cols = journalColumns
        FinancePagedTable(pager: vm.journals, columns: cols, emptyIcon: "books.vertical",
                          emptyMessage: "No journals match these filters.") { j in
            let open = vm.expanded.contains(j.journalId)
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Text(FinanceDates.display(j.occurredOn)).font(.inter(12.5)).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.8)
                        .financeCell(cols[0])
                    FinATag(text: FinWords.journalKind(j.kind), tone: FinAJournalDetail.tone(j.kind)).financeCell(cols[1])
                    VStack(alignment: .leading, spacing: 1) {
                        Text(j.memo?.isEmpty == false ? (j.memo ?? "") : "—").font(.inter(13, .medium)).foregroundStyle(Nuru.navy).lineLimit(1)
                        Text("by \(j.createdByName ?? "—") · entered \(FinanceATime.day(j.createdAt))").font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1)
                    }
                    .financeCell(cols[2])
                    VStack(alignment: .trailing, spacing: 1) {
                        ForEach(j.totals, id: \.currency) { t in
                            Text(FinanceMoney.format(t.amountMinor, t.currency)).font(.nMono(12.5, .medium)).lineLimit(1).minimumScaleFactor(0.7)
                        }
                    }
                    .financeCell(cols[3])
                    VStack(alignment: .leading, spacing: 3) {
                        if j.reversedByJournalId != nil { FinATag(text: "Reversed", tone: FinanceStatus.violet, icon: "arrow.uturn.backward") }
                        if j.reversalOf != nil { FinATag(text: "Reversal of…", tone: FinanceStatus.violet) }
                    }
                    .financeCell(cols[4])
                    Button { vm.toggle(j.journalId) } label: {
                        Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 11, weight: .bold)).foregroundStyle(Nuru.ink600)
                            .frame(width: 28, height: 28).background(Nuru.surface).clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(open ? "Hide the legs" : "Show the legs")
                    .financeCell(cols[5])
                }
                .contentShape(Rectangle())
                .onTapGesture { vm.toggle(j.journalId) }
                if open {
                    FinAJournalDetail(journal: j, caps: caps, fundNames: vm.fundNames,
                                      onReverse: { vm.reverseTarget = j },
                                      onOpen: { id in vm.sheet = .journal(id) })
                        .padding(12)
                        .background(Nuru.surface)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task(id: vm.journalsFilter) {
            let filter = vm.journalsFilter
            await vm.journals.load { cursor in try await FinanceERPAPI.journals(filter, cursor: cursor) }
        }
    }

    // MARK: Trial balance

    private var trialColumns: [FinanceColumn] { [
        FinanceColumn("Account", minWidth: 190),
        FinanceColumn("Debits", width: 124, align: .trailing),
        FinanceColumn("Credits", width: 124, align: .trailing),
        FinanceColumn("Balance", width: 156, align: .trailing),
    ] }

    @ViewBuilder private var trialTab: some View {
        FinanceFilterBar(isFiltered: vm.trialPeriod != nil, onClear: { vm.trialPeriod = nil }) {
            FinAPeriodMenu(period: $vm.trialPeriod)
        }
        Group {
            if let t = vm.trial {
                trialContent(t).opacity(vm.trialLoading ? 0.55 : 1)
                if let e = vm.trialError { FinanceNoticeBar(notice: .error("Couldn't refresh — \(e)")) }
            } else if let e = vm.trialError {
                ErrorBanner(message: e) { Task { await vm.loadTrial() } }
            } else {
                SkeletonTable(rows: 6)
            }
        }
        .task(id: vm.trialPeriod) { await vm.loadTrial() }
    }

    @ViewBuilder private func trialContent(_ t: FinTrialBalance) -> some View {
        if t.balanced {
            FinanceNoticeBar(notice: .ok("Balanced ✓ — in every currency, total debits equal total credits."))
        } else {
            VStack(alignment: .leading, spacing: 8) {
                let off = t.totals.filter { !$0.balanced }.map {
                    "\($0.currency): debits \(FinanceMoney.format($0.debitMinor, $0.currency)), credits \(FinanceMoney.format($0.creditMinor, $0.currency))"
                }
                FinanceNoticeBar(notice: .error("Not balanced — \(off.joined(separator: "; ")). Reconciliation shows where."))
                FinanceButton(title: "Open Reconciliation", icon: "arrow.triangle.2.circlepath") {
                    router.openFinance(.financeReconciliation, ["tab": "integrity"])
                }
            }
        }
        let rows = t.data.sorted { a, b in
            if a.currency != b.currency { return FinanceMoney.currencyPrecedes(a.currency, b.currency) }
            let ga = Self.group(a.account), gb = Self.group(b.account)
            return ga != gb ? ga < gb : a.account < b.account
        }
        let cols = trialColumns
        FinanceTable(rows: rows, columns: cols, emptyIcon: "book.closed", emptyMessage: "No postings in this period.") { r in
            VStack(alignment: .leading, spacing: 1) {
                Text(r.account).font(.nMono(12.5)).foregroundStyle(Nuru.navy).lineLimit(1)
                Text("\(FinanceARules.accountLabel(r.account, fundNames: vm.fundNames)) · \(r.currency)").font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1)
            }
            .financeCell(cols[0])
            Text(FinanceMoney.format(r.debitMinor, r.currency)).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[1])
            Text(FinanceMoney.format(r.creditMinor, r.currency)).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
            HStack(spacing: 4) {
                Text(FinanceMoney.format(r.balanceMinor, r.currency)).font(.nMono(12.5, .medium))
                    .foregroundStyle(r.balanceMinor < 0 ? FinanceStatus.red.fg : Nuru.navy)
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(r.normalSide == "debit" ? "Dr" : "Cr").font(.nMicro).foregroundStyle(Nuru.ink400)
            }
            .financeCell(cols[3])
        }
        VStack(alignment: .leading, spacing: 4) {
            ForEach(t.totals.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }) { tot in
                HStack(spacing: 6) {
                    Image(systemName: tot.balanced ? "checkmark.circle.fill" : "xmark.octagon.fill")
                        .foregroundStyle(tot.balanced ? FinanceStatus.green.fg : FinanceStatus.red.fg)
                    Text("\(tot.currency) — debits \(FinanceMoney.format(tot.debitMinor, tot.currency)) · credits \(FinanceMoney.format(tot.creditMinor, tot.currency))")
                        .font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                    Text(tot.balanced ? "balanced" : "off by \(FinanceMoney.format(tot.debitMinor - tot.creditMinor, tot.currency))")
                        .font(.nCaption).foregroundStyle(tot.balanced ? Nuru.ink600 : FinanceStatus.red.fg)
                }
            }
        }
        FinAExplain("\(t.period.from == nil ? "All time" : FinanceDates.displayRange(from: t.period.from ?? "", to: t.period.to ?? "")), by each posting's date (EAT). Cash accounts are debit-normal (Dr: debits − credits); funds and sales are credit-normal (Cr: credits − debits). A negative balance sits on the other side — a fund that has spent more than it received.")
    }

    private static func group(_ account: String) -> Int {
        if account.hasPrefix("cash:") { return 0 }
        if account.hasPrefix("fund:") { return 1 }
        return 2
    }
}

/// Debits and credits per currency of the WHOLE filtered set of postings.
struct FinALedgerTotalsStrip: View {
    let totals: [FinLedgerTotal]
    var loading = false

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Text("TOTALS").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600).fixedSize()
            Rectangle().fill(Nuru.border).frame(width: 1, height: 22)
            if loading && totals.isEmpty {
                Skeleton(height: 14, width: 200)
            } else if totals.isEmpty {
                Text("No matching postings").font(.nCaption).foregroundStyle(Nuru.ink400)
            } else {
                FinanceFlowLayout(spacing: 18, rowSpacing: 6) {
                    ForEach(totals.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }, id: \.currency) { t in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(t.currency).font(.inter(12, .bold)).foregroundStyle(Nuru.ink600)
                            Text("Dr \(FinanceMoney.format(t.debitMinor, ""))").font(.nMono(13, .medium)).foregroundStyle(Nuru.navy)
                            Text("Cr \(FinanceMoney.format(t.creditMinor, ""))").font(.nMono(13, .medium)).foregroundStyle(Nuru.navy)
                            Text("· \(t.count) \(t.count == 1 ? "posting" : "postings")").font(.nCaption).foregroundStyle(Nuru.ink600)
                        }
                        .fixedSize()
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .opacity(loading && !totals.isEmpty ? 0.55 : 1)
        .accessibilityElement(children: .combine)
    }
}

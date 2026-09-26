// Finance → Ledger (pathway docs/FINANCE_ERP.md §5): the books themselves.
//   Postings — every leg, gift and journal alike, by the day it counts on;
//              account / kind / period filters; debits and credits per currency
//              for the whole filter; the CSV twin.
//   Journals — transfers, opening balances, expenses and their voids,
//              reversals; each row expands to its legs; Reverse a transfer or an
//              opening balance (finance:approve).
//   Trial balance — per account and currency, debits, credits and the balance
//              on the account's normal side, all time or a period, with a plain
//              Balanced / Not balanced verdict.
// Deep links (the web's params): tab=postings|journals|trial; account, kind,
// period|from/to (postings); jkind, jperiod|jfrom/jto (journals); tbscope,
// tbperiod|tbfrom/tbto (trial); journal=<id> opens one journal from any tab;
// tx=<id> opens a transaction; expand=<id> opens a journal's row.
// Same content and words as the web's Finance → Ledger.
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
    static let journalsDefault = FinJournalFilter(period: .preset(.thisYear))

    @Published var tab: FinALedgerTab = .postings
    @Published var postingsFilter = FinLedgerFilter()
    let postings = FinancePager<FinLedgerPage>()
    @Published var journalsFilter = FinanceLedgerModel.journalsDefault
    let journals = FinancePager<FinJournalList>()
    @Published var expanded: Set<String> = []
    /// nil = all time (the trial balance's default scope).
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
            if !Task.isCancelled { trialError = FinanceARules.message(error, fallback: "Could not load the trial balance.") }
        }
        if gen == trialGeneration { trialLoading = false }
    }

    func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    /// A period from prefixed params: <prefix>period=<preset> or <prefix>from/<prefix>to.
    private static func period(_ p: [String: String], prefix: String) -> FinancePeriod? {
        var q: [String: String] = [:]
        for k in ["period", "from", "to"] { if let v = p[prefix + k] { q[k] = v } }
        return FinanceARules.period(fromParams: q)
    }

    func apply(_ p: [String: String]) {
        switch p["tab"] ?? "" {
        case "journals": tab = .journals
        case "trial", "trial-balance", "trial_balance": tab = .trial
        case "postings": tab = .postings
        default: break
        }
        // Postings: account, kind, period / from / to.
        if p["account"] != nil || p["kind"] != nil || Self.period(p, prefix: "") != nil, tab == .postings || p["tab"] == nil {
            var f = FinLedgerFilter()
            if let a = p["account"] { f.account = a }
            if let k = p["kind"], k == "transaction" || k == "journal" { f.kind = k }
            if let period = Self.period(p, prefix: "") { f.period = period }
            postingsFilter = f
        }
        // Journals: jkind, jperiod / jfrom / jto (and plain kind/from/to with tab=journals).
        if p["jkind"] != nil || Self.period(p, prefix: "j") != nil || (tab == .journals && (p["kind"] != nil || Self.period(p, prefix: "") != nil)) {
            var f = Self.journalsDefault
            if let k = p["jkind"] ?? (tab == .journals ? p["kind"] : nil) { f.kind = k }
            if let period = Self.period(p, prefix: "j") ?? (tab == .journals ? Self.period(p, prefix: "") : nil) { f.period = period }
            journalsFilter = f
        }
        // Trial balance: tbscope=period with tbperiod / tbfrom / tbto.
        if p["tbscope"] == "period" || Self.period(p, prefix: "tb") != nil {
            trialPeriod = Self.period(p, prefix: "tb") ?? .preset(.thisYear)
        } else if p["tbscope"] == "all" {
            trialPeriod = nil
        }
        if let id = p["expand"], !id.isEmpty { tab = .journals; expanded.insert(id) }
        if let id = p["journal"], !id.isEmpty { sheet = .journal(id) }
        else if let id = p["tx"], !id.isEmpty { sheet = .transaction(id) }
    }
}

extension FinanceARules {
    /// The Postings account picker (the web's accountOptions): every cash account,
    /// every fund, the prefixes, media sales — and the current value if unknown.
    static func ledgerAccountOptions(funds: [FundOption], current: String) -> [FinanceFilterOption] {
        var o: [FinanceFilterOption] = [.all("All accounts"), FinanceFilterOption("cash:", "All cash accounts (cash:)")]
        for a in ["cash:onhand", "cash:bank", "cash:cheque", "cash:mpesa", "cash:manual", "cash:stripe", "cash:airtel", "cash:paypal"] {
            o.append(FinanceFilterOption(a, "\(accountLabel(a)) (\(a))"))
        }
        o.append(FinanceFilterOption("fund:", "All funds (fund:)"))
        for f in funds { o.append(FinanceFilterOption("fund:\(f.code)", "\(f.name) (fund:\(f.code))\(f.isActive ? "" : " — inactive")")) }
        o.append(FinanceFilterOption("sales:media", "Media sales (sales:media)"))
        if !current.isEmpty, !o.contains(where: { $0.value == current }) { o.append(FinanceFilterOption(current, current)) }
        return o
    }

    /// Trial-balance order: cash, then funds, then the rest.
    static func accountRank(_ account: String) -> Int {
        if account.hasPrefix("cash:") { return 0 }
        if account.hasPrefix("fund:") { return 1 }
        return 2
    }
}

struct FinanceLedgerView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceLedgerModel()
    @State private var postingsWidth: CGFloat = 0
    @State private var journalsWidth: CGFloat = 0
    @State private var trialWidth: CGFloat = 0

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeLedger.title,
                            subtitle: "Double-entry books: every posting has a debit and a credit of the same amount and currency. Cash accounts (cash:…) are where money sits; fund accounts (fund:…) are what it is for. Nothing is deleted — mistakes are reversed.",
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
                                     },
                                     onOpenPartner: { userId in
                                         DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { router.openFinance(.partners, ["member": userId]) }
                                     },
                                     onOpenNeed: { needId in
                                         DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { router.openFinance(.financeNeeds, ["need": needId]) }
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

    private var postingsPeriod: Binding<FinancePeriod> {
        Binding(get: { vm.postingsFilter.period ?? .thisMonth }, set: { vm.postingsFilter.period = $0 })
    }

    @ViewBuilder private var postingsTab: some View {
        let f = vm.postingsFilter
        let filtered = !f.account.isEmpty || !f.kind.isEmpty || f.period?.preset != .thisMonth
        FinanceFilterBar(period: postingsPeriod, isFiltered: filtered, onClear: { vm.postingsFilter = FinLedgerFilter() }) {
            FinanceFilterMenu(title: "Account", selection: $vm.postingsFilter.account,
                              options: FinanceARules.ledgerAccountOptions(funds: vm.funds, current: vm.postingsFilter.account), icon: "book.closed")
            FinanceFilterMenu(title: "Kind", selection: $vm.postingsFilter.kind,
                              options: [.all("All"), FinanceFilterOption("transaction", "Gifts & payments"), FinanceFilterOption("journal", "Journals")])
        }
        FinALedgerTotalsStrip(totals: vm.postings.totals, loading: vm.postings.isLoadingFirstPage)
        VStack(alignment: .leading, spacing: 8) {
            FinASectionTitle(icon: "book.closed", title: "Postings")
            FinAExplain("Each leg on the day it counts: a gift on the day received, a reversal on the gift's own day, an expense on the day spent, a transfer on its date. Tap a row for its gift or journal.")
            postingsTable
        }
        .task(id: vm.postingsFilter) {
            let filter = vm.postingsFilter
            await vm.postings.load { cursor in try await FinanceERPAPI.ledger(filter, cursor: cursor) }
        }
    }

    private var postingsTable: some View {
        let wide = postingsWidth == 0 || postingsWidth >= 860
        let cols = wide ? [
            FinanceColumn("Posted on", width: 96),
            FinanceColumn("Account", minWidth: 170),
            FinanceColumn("Debit", width: 116, align: .trailing),
            FinanceColumn("Credit", width: 116, align: .trailing),
            FinanceColumn("Source", minWidth: 200),
        ] : [
            FinanceColumn("Posted on", width: 88),
            FinanceColumn("Account · source", minWidth: 170),
            FinanceColumn("Debit / credit", width: 140, align: .trailing),
        ]
        let names = vm.fundNames
        return FinancePagedTable(pager: vm.postings, columns: cols, emptyIcon: "book.closed",
                                 emptyMessage: "No postings match these filters.",
                                 onSelect: { row in
                                     if let t = row.transactionId { vm.sheet = .transaction(t) }
                                     else if let j = row.journalId { vm.sheet = .journal(j) }
                                 }) { p in
            Text(FinanceDates.display(p.postedOn)).font(.nMono(12)).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.8)
                .financeCell(cols[0])
            if wide {
                account(p.account, names).financeCell(cols[1])
                Text(p.side == "debit" ? FinanceMoney.format(p.amountMinor, p.currency) : "")
                    .font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
                Text(p.side == "credit" ? FinanceMoney.format(p.amountMinor, p.currency) : "")
                    .font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[3])
                source(p).financeCell(cols[4])
            } else {
                VStack(alignment: .leading, spacing: 3) {
                    account(p.account, names)
                    source(p)
                }
                .financeCell(cols[1])
                HStack(spacing: 4) {
                    Text(p.side == "debit" ? "Dr" : "Cr").font(.nMicro).foregroundStyle(Nuru.ink400)
                    Text(FinanceMoney.format(p.amountMinor, p.currency)).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7)
                }
                .financeCell(cols[2])
            }
        }
        .measureWidth($postingsWidth)
    }

    private func account(_ account: String, _ names: [String: String]) -> some View {
        (Text(FinanceARules.accountLabel(account, fundNames: names)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
         + Text("  " + account).font(.nMono(11)).foregroundStyle(Nuru.ink400))
            .lineLimit(2)
    }

    private func source(_ p: FinLedgerRow) -> some View {
        HStack(spacing: 8) {
            FinATag(text: p.kind == "journal" ? "Journal" : "Gift",
                    tone: p.kind == "journal" ? (Color(hex: 0x1E4068), Color(hex: 0xE6EDF5)) : (Color(hex: 0x0F6B33), Color(hex: 0xE8F6EC)))
            Text(FinanceARules.postingSource(kind: p.kind, receiptCode: p.receiptCode, memberName: p.memberName,
                                              journalKind: p.journalKind, memo: p.memo))
                .font(.inter(12.5)).foregroundStyle(Nuru.ink).lineLimit(1).truncationMode(.tail)
        }
    }

    // MARK: Journals

    private static let kindOptions = [
        FinanceFilterOption.all("All"), FinanceFilterOption("transfer", "Transfers"),
        FinanceFilterOption("opening", "Opening balances"), FinanceFilterOption("expense", "Expenses"),
        FinanceFilterOption("expense_void", "Expense voids"), FinanceFilterOption("reversal", "Reversals"),
    ]

    private var journalsPeriod: Binding<FinancePeriod> {
        Binding(get: { vm.journalsFilter.period ?? .preset(.thisYear) }, set: { vm.journalsFilter.period = $0 })
    }

    @ViewBuilder private func journalsTab(_ caps: FinanceCaps) -> some View {
        let f = vm.journalsFilter
        let filtered = !f.kind.isEmpty || f.period?.preset != .thisYear
        FinanceFilterBar(period: journalsPeriod, isFiltered: filtered, onClear: { vm.journalsFilter = FinanceLedgerModel.journalsDefault }) {
            FinanceFilterMenu(title: "Kind", selection: $vm.journalsFilter.kind, options: Self.kindOptions)
        }
        VStack(alignment: .leading, spacing: 6) {
            FinanceTotalsStrip(totals: vm.journals.totals, title: "Journals", noun: ("journal", "journals"), loading: vm.journals.isLoadingFirstPage)
            FinAExplain("Amount = the debit side of each journal, by its date")
        }
        journalsTable(caps)
            .task(id: vm.journalsFilter) {
                let filter = vm.journalsFilter
                await vm.journals.load { cursor in try await FinanceERPAPI.journals(filter, cursor: cursor) }
            }
    }

    private enum JLayout { case wide, medium, narrow }

    private func journalsTable(_ caps: FinanceCaps) -> some View {
        let layout: JLayout = journalsWidth == 0 || journalsWidth >= 900 ? .wide : journalsWidth >= 700 ? .medium : .narrow
        let cols: [FinanceColumn]
        switch layout {
        case .wide: cols = [
            FinanceColumn("", width: 24),
            FinanceColumn("Date", width: 96),
            FinanceColumn("Kind", width: 124),
            FinanceColumn("Memo", minWidth: 160),
            FinanceColumn("Amount", width: 124, align: .trailing),
            FinanceColumn("Entered", width: 150),
            FinanceColumn("State", width: 150),
        ]
        case .medium: cols = [
            FinanceColumn("", width: 24),
            FinanceColumn("Date · kind", width: 124),
            FinanceColumn("Memo · entered", minWidth: 170),
            FinanceColumn("Amount", width: 124, align: .trailing),
            FinanceColumn("State", width: 130),
        ]
        case .narrow: cols = [
            FinanceColumn("", width: 22),
            FinanceColumn("Date · kind", width: 112),
            FinanceColumn("Memo", minWidth: 150),
            FinanceColumn("Amount", width: 118, align: .trailing),
        ]
        }
        let names = vm.fundNames
        return FinancePagedTable(pager: vm.journals, columns: cols, emptyIcon: "books.vertical",
                                 emptyMessage: "No journals in this period. Transfers, opening balances, approved expenses and their voids appear here.") { j in
            let open = vm.expanded.contains(j.journalId)
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Image(systemName: open ? "chevron.down" : "chevron.right").font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Nuru.ink400).financeCell(cols[0])
                    VStack(alignment: .leading, spacing: 3) {
                        Text(FinanceDates.display(j.occurredOn)).font(.nMono(12)).foregroundStyle(Nuru.ink).lineLimit(1).minimumScaleFactor(0.8)
                        if layout != .wide { FinATag(text: FinWords.journalKind(j.kind), tone: FinAJournalDetail.tone(j.kind)) }
                    }
                    .financeCell(cols[1])
                    if layout == .wide {
                        FinATag(text: FinWords.journalKind(j.kind), tone: FinAJournalDetail.tone(j.kind)).financeCell(cols[2])
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(j.memo?.isEmpty == false ? (j.memo ?? "") : "—").font(.inter(13))
                            .foregroundStyle(j.memo?.isEmpty == false ? Nuru.navy : Nuru.ink400).lineLimit(2)
                        if layout != .wide { entered(j) }
                        if layout == .narrow { state(j) }
                    }
                    .financeCell(cols[layout == .wide ? 3 : 2])
                    VStack(alignment: .trailing, spacing: 1) {
                        ForEach(j.totals, id: \.currency) { t in
                            Text(FinanceMoney.format(t.amountMinor, t.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy)
                                .lineLimit(1).minimumScaleFactor(0.7)
                        }
                    }
                    .financeCell(cols[layout == .wide ? 4 : 3])
                    if layout == .wide {
                        entered(j).financeCell(cols[5])
                        state(j).financeCell(cols[6])
                    } else if layout == .medium {
                        state(j).financeCell(cols[4])
                    }
                }
                // The header line toggles the legs; the expanded part keeps its own buttons.
                .contentShape(Rectangle())
                .onTapGesture { vm.toggle(j.journalId) }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
                .accessibilityHint(open ? "Hides the legs" : "Shows the legs")
                if open {
                    FinAJournalDetail(journal: j, caps: caps, fundNames: names,
                                      onReverse: { vm.reverseTarget = j },
                                      onOpen: { id in vm.sheet = .journal(id) })
                        .padding(12)
                        .background(Color(hex: 0xFFFBF2))
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .measureWidth($journalsWidth)
    }

    private func entered(_ j: FinJournal) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(FinanceATime.dayTime(j.createdAt)).font(.inter(12)).foregroundStyle(Nuru.ink400).lineLimit(1).minimumScaleFactor(0.8)
            if let n = j.createdByName, !n.isEmpty { Text(n).font(.inter(12)).foregroundStyle(Nuru.ink400).lineLimit(1) }
        }
    }

    @ViewBuilder private func state(_ j: FinJournal) -> some View {
        FinanceFlowLayout(spacing: 4, rowSpacing: 4) {
            if j.reversedByJournalId != nil { FinanceStatusChip(status: "refunded", label: "Reversed") }
            if let o = j.reversalOf { Text("Mirrors journal \(o.prefix(8))").font(.inter(12)).foregroundStyle(Nuru.ink400) }
            if j.reversedByJournalId == nil && j.reversalOf == nil { Text("Posted").font(.inter(12)).foregroundStyle(Nuru.ink400) }
        }
    }

    // MARK: Trial balance

    private enum TrialScope: String, CaseIterable, Identifiable {
        case all, period
        var id: String { rawValue }
        var label: String { self == .all ? "All time" : "A period" }
    }

    private var trialScope: Binding<TrialScope> {
        Binding(get: { vm.trialPeriod == nil ? .all : .period },
                set: { vm.trialPeriod = $0 == .all ? nil : (vm.trialPeriod ?? .preset(.thisYear)) })
    }

    private var trialPeriodBinding: Binding<FinancePeriod> {
        Binding(get: { vm.trialPeriod ?? .preset(.thisYear) }, set: { vm.trialPeriod = $0 })
    }

    @ViewBuilder private var trialTab: some View {
        HStack(spacing: 12) {
            Picker("Trial balance scope", selection: trialScope) {
                ForEach(TrialScope.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .frame(width: 220)
            Text(vm.trialPeriod.map { "Postings dated \(FinanceARules.fmtRange(from: $0.from, to: $0.to)) only." }
                 ?? "Every posting ever made — the balances the funds and cash accounts hold today.")
                .font(.inter(12)).foregroundStyle(Nuru.ink400).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        if vm.trialPeriod != nil { FinanceFilterBar(period: trialPeriodBinding) }
        Group {
            if let e = vm.trialError, vm.trial == nil {
                ErrorBanner(message: e) { Task { await vm.loadTrial() } }
            } else if let t = vm.trial {
                trialContent(t).opacity(vm.trialLoading ? 0.55 : 1)
                if let e = vm.trialError { FinanceNoticeBar(notice: .error("Couldn't refresh — \(e)")) }
            } else {
                SkeletonTable(rows: 6)
            }
        }
        .task(id: vm.trialPeriod) { await vm.loadTrial() }
    }

    @ViewBuilder private func verdict(_ t: FinTrialBalance) -> some View {
        if t.data.isEmpty {
            let c = FinanceARules.colors(.info)
            HStack(spacing: 8) {
                Image(systemName: "info.circle").font(.system(size: 13, weight: .semibold))
                Text("No postings in this period — nothing to balance.").font(.inter(12.5, .semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(c.fg)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(c.bg)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(c.border, lineWidth: 1))
        } else {
            let ok = t.balanced
            let off = t.totals.filter { !$0.balanced }.map(\.currency).joined(separator: ", ")
            let c: (fg: Color, bg: Color, border: Color) = ok
                ? (Color(hex: 0x0F6B33), Color(hex: 0xE8F6EC), Color(hex: 0xBFE3CB))
                : (Color(hex: 0xB42318), Color(hex: 0xFDECEC), Color(hex: 0xF5C2C0))
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: ok ? "checkmark.circle" : "xmark.circle").font(.system(size: 20, weight: .semibold)).foregroundStyle(c.fg)
                VStack(alignment: .leading, spacing: 3) {
                    Text(ok ? "Balanced ✓" : "Not balanced").font(.inter(14, .bold)).foregroundStyle(c.fg)
                    Text(ok ? "Debits equal credits in every currency — every posting has its other side."
                            : "Debits and credits differ in \(off.isEmpty ? "a currency" : off). Reconciliation → Exceptions names the entries; tell the developer — don't post corrections by hand.")
                        .font(.inter(12.5)).foregroundStyle(Nuru.navy).fixedSize(horizontal: false, vertical: true)
                    if !ok {
                        FinanceButton(title: "Open Reconciliation → Exceptions", icon: "arrow.up.right.square") {
                            router.openFinance(.financeReconciliation, ["tab": "exceptions"])
                        }
                        .padding(.top, 4)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(c.bg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(c.border, lineWidth: 1))
            .accessibilityElement(children: .combine)
        }
    }

    /// One currency's trial-balance lines: the accounts, then the total.
    private enum TrialLine: Identifiable {
        case row(FinTrialBalance.Row)
        case total(FinTrialBalance.Total)
        var id: String {
            switch self { case .row(let r): r.id; case .total(let t): "total|\(t.currency)" }
        }
    }

    @ViewBuilder private func trialContent(_ t: FinTrialBalance) -> some View {
        verdict(t)
        let currencies = Array(Set(t.totals.map(\.currency) + t.data.map(\.currency))).sorted(by: FinanceMoney.currencyPrecedes)
        if currencies.isEmpty {
            EmptyState.compact(icon: "book.closed", message: "Nothing posted. Gifts, expenses, transfers and opening balances appear here once posted.")
        } else {
            ForEach(currencies, id: \.self) { c in trialSection(t, currency: c) }
        }
    }

    private func trialSection(_ t: FinTrialBalance, currency c: String) -> some View {
        let names = vm.fundNames
        let rows = t.data.filter { $0.currency == c }.sorted { a, b in
            let ra = FinanceARules.accountRank(a.account), rb = FinanceARules.accountRank(b.account)
            if ra != rb { return ra < rb }
            return FinanceARules.accountLabel(a.account, fundNames: names)
                .localizedCaseInsensitiveCompare(FinanceARules.accountLabel(b.account, fundNames: names)) == .orderedAscending
        }
        let lines: [TrialLine] = rows.map { .row($0) } + (t.totals.first { $0.currency == c }.map { [.total($0)] } ?? [])
        let narrow = trialWidth > 0 && trialWidth < 620
        let cols = narrow ? [
            FinanceColumn("Account", minWidth: 150),
            FinanceColumn("Debits · credits", width: 136, align: .trailing),
            FinanceColumn("Balance", width: 136, align: .trailing),
        ] : [
            FinanceColumn("Account", minWidth: 200),
            FinanceColumn("Debits", width: 130, align: .trailing),
            FinanceColumn("Credits", width: 130, align: .trailing),
            FinanceColumn("Balance", width: 150, align: .trailing),
        ]
        return VStack(alignment: .leading, spacing: 8) {
            FinASectionTitle(title: "\(c) accounts")
            FinAExplain("Balance is on the account's normal side: cash accounts hold debits; funds and income accounts hold credits.")
            FinanceTable(rows: lines, columns: cols, emptyIcon: "book.closed", emptyMessage: "") { line in
                switch line {
                case .row(let r):
                    account(r.account, names).financeCell(cols[0])
                    if narrow {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text("Dr " + FinanceMoney.format(r.debitMinor, "")).font(.nMono(11.5)).lineLimit(1).minimumScaleFactor(0.7)
                            Text("Cr " + FinanceMoney.format(r.creditMinor, "")).font(.nMono(11.5)).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.7)
                        }
                        .financeCell(cols[1])
                    } else {
                        Text(FinanceMoney.format(r.debitMinor, "")).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[1])
                        Text(FinanceMoney.format(r.creditMinor, "")).font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
                    }
                    HStack(spacing: 4) {
                        Text(FinanceMoney.format(r.balanceMinor, "")).font(.nMono(12.5, .semibold))
                            .foregroundStyle(r.balanceMinor < 0 ? FinanceStatus.red.fg : Nuru.navy)
                            .lineLimit(1).minimumScaleFactor(0.7)
                        Text(r.normalSide == "debit" ? "Dr" : "Cr").font(.inter(10.5, .bold)).foregroundStyle(Nuru.ink400)
                    }
                    .financeCell(cols[cols.count - 1])
                case .total(let tot):
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Total \(c)").font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                        Text(tot.balanced ? "✓ balanced" : "✗ off by \(FinanceMoney.format(tot.debitMinor - tot.creditMinor, c))")
                            .font(.inter(12, .semibold)).foregroundStyle(tot.balanced ? FinanceStatus.green.fg : FinanceStatus.red.fg)
                    }
                    .financeCell(cols[0])
                    if narrow {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text("Dr " + FinanceMoney.format(tot.debitMinor, "")).font(.nMono(11.5, .semibold)).lineLimit(1).minimumScaleFactor(0.7)
                            Text("Cr " + FinanceMoney.format(tot.creditMinor, "")).font(.nMono(11.5, .semibold)).lineLimit(1).minimumScaleFactor(0.7)
                        }
                        .financeCell(cols[1])
                    } else {
                        Text(FinanceMoney.format(tot.debitMinor, "")).font(.nMono(12.5, .semibold)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[1])
                        Text(FinanceMoney.format(tot.creditMinor, "")).font(.nMono(12.5, .semibold)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
                    }
                    Text("").financeCell(cols[cols.count - 1])
                }
            }
            .measureWidth($trialWidth)
        }
    }
}

/// "IN THIS FILTER  KES debits 1,234.00 credits 1,234.00 · 12 postings" — the
/// debits and credits per currency of the WHOLE filtered set of postings.
struct FinALedgerTotalsStrip: View {
    let totals: [FinLedgerTotal]
    var loading = false

    var body: some View {
        FinanceFlowLayout(spacing: 28, rowSpacing: 10) {
            Text("IN THIS FILTER").font(.inter(10.5, .semibold)).tracking(0.8).foregroundStyle(Nuru.ink600)
            if loading && totals.isEmpty {
                Skeleton(height: 16, width: 220)
            } else if totals.isEmpty {
                Text("No postings.").font(.inter(13)).foregroundStyle(Nuru.ink400)
            } else {
                ForEach(totals.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }, id: \.currency) { t in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(t.currency).font(.nMono(12.5, .bold)).foregroundStyle(Nuru.navy)
                        Text("debits").font(.inter(12.5)).foregroundStyle(Nuru.ink400)
                        Text(FinanceMoney.format(t.debitMinor, "")).font(.nMono(12.5, .semibold)).foregroundStyle(Nuru.navy)
                        Text("credits").font(.inter(12.5)).foregroundStyle(Nuru.ink400)
                        Text(FinanceMoney.format(t.creditMinor, "")).font(.nMono(12.5, .semibold)).foregroundStyle(Nuru.navy)
                        Text("· \(FinanceARules.plural(t.count, "posting"))").font(.inter(12.5)).foregroundStyle(Nuru.ink400)
                    }
                    .fixedSize()
                }
            }
            Text("On one account, debits − credits is its movement; over the whole ledger they are equal.")
                .font(.inter(11.5)).foregroundStyle(Nuru.ink400)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .opacity(loading && !totals.isEmpty ? 0.55 : 1)
        .accessibilityElement(children: .combine)
    }
}

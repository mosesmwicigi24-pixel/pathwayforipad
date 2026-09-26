// Finance → Department needs (pathway docs/FINANCE_ERP.md §5) — department
// needs as Finance sees them (GET /admin/finance/needs, finance:view): raised
// against target, gifts, deadline, and the fund a gift to the need is booked
// to. Read-only here: approving or closing a need stays with Departments
// ("Review in Departments" shows only with departments:view). Raised is the
// Departments page's own figure, so the two pages can never disagree.
import SwiftUI
import Combine

@MainActor
final class FinanceNeedsModel: ObservableObject {
    struct Filter: Equatable {
        /// approved (default) · pending · rejected · closed · all
        var status = "approved"
        var q = ""
    }
    @Published var filter = Filter()
    let pager = FinancePager<FinNeedsPage>()
    let lookups = FinBLookups()
    private var relays: [AnyCancellable] = []

    init() { relays = [finbRelay(pager), finbRelay(lookups)] }

    var isFiltered: Bool { filter.status != "approved" || FinanceERPAPI.searchTerm(filter.q) != nil }

    func load() async {
        let f = filter
        async let funds: Void = lookups.loadFunds()
        await pager.load { cursor in try await FinanceERPAPI.needs(status: f.status, q: f.q, cursor: cursor) }
        _ = await funds
    }

    func apply(link params: [String: String]) {
        var f = Filter()
        if let s = params["status"], ["approved", "pending", "rejected", "closed", "all"].contains(s) { f.status = s }
        if let q = params["q"] { f.q = q }
        filter = f
    }

    var totalsRows: [FinBCurrencyFigures.Row] {
        pager.totals.map { t in
            FinBCurrencyFigures.Row(currency: t.currency, figures: [
                .init(label: "Target", minor: t.targetMinor),
                .init(label: "Raised", minor: t.raisedMinor, tint: Nuru.success),
            ], note: "\(t.count) \(t.count == 1 ? "need" : "needs") · \(FinBMath.percent(t.raisedMinor, of: t.targetMinor))% raised")
        }
    }

    var totalCount: Int? { pager.phase == .loaded ? pager.totals.reduce(0) { $0 + $1.count } : nil }
}

struct FinanceNeedsView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceNeedsModel()
    @State private var open: FinNeedRow?

    static let statusOptions: [FinanceFilterOption] = [
        .init("approved", "Approved (open for giving)"), .init("pending", "Pending approval"), .init("closed", "Closed"),
        .init("rejected", "Rejected"), .init("all", "All"),
    ]

    private static let columns: [FinanceColumn] = [
        FinanceColumn("Need · department · books to", minWidth: 180),
        FinanceColumn("Raised of target", minWidth: 190),
        FinanceColumn("Gifts", width: 50, align: .trailing),
        FinanceColumn("Deadline", width: 110),
        FinanceColumn("Status", width: 86),
    ]

    /// Departments is its own module (departments:view) — the link shows only
    /// to people who can open it; nothing shows while /me loads.
    private var canOpenDepartments: Bool { auth.profile?.permissions.contains("departments:view") == true }

    var body: some View {
        FinancePageScaffold(title: Section.financeNeeds.title,
                            subtitle: "What each department has asked the church to give toward, and how far it has come. Read-only here — needs are approved and closed in Departments.",
                            stats: vm.totalCount.map { [HeroStat(label: "Needs", value: String($0),
                                                                 hint: Self.statusOptions.first { $0.value == vm.filter.status }?.label.lowercased() ?? "")] } ?? [],
                            onRefresh: { await vm.pager.reload() }) {
            if canOpenDepartments {
                HeroChip(label: "Review in Departments", icon: "building.2", trailingIcon: "arrow.up.right", style: .ghost) {
                    router.go(.departments)
                }
            }
        } content: {
            FinanceFilterBar(search: $vm.filter.q, searchPrompt: "Need or department",
                             isFiltered: vm.isFiltered, onClear: { vm.filter = .init() }) {
                FinanceFilterMenu(title: "Status", selection: $vm.filter.status, options: Self.statusOptions)
            }
            FinBCurrencyFigures(title: "Totals", rows: vm.totalsRows, noun: ("need", "needs"),
                                caption: "Over every need that matches, per currency.",
                                loading: vm.pager.isLoadingFirstPage || vm.pager.refreshing)
            FinBExplain(text: "Raised: every succeeded gift to the need, or to a pledge toward it — church-wide. The Departments page shows the same figure. Books to: the department's fund when it names an active one, else the fund the giver chose. Newest first.")
            FinancePagedTable(pager: vm.pager, columns: Self.columns, emptyIcon: "target",
                              emptyMessage: FinanceERPAPI.searchTerm(vm.filter.q) != nil ? "No needs match that search."
                                  : vm.filter.status == "approved" ? "No approved needs. Departments submit needs; once approved in Departments they appear here with what has been raised."
                                  : "No needs with this status.",
                              totalCount: vm.totalCount, onSelect: { open = $0 }) { n in
                row(n)
            }
        }
        .task(id: vm.filter) { await vm.load() }
        .onFinanceLink(.financeNeeds) { vm.apply(link: $0) }
        .sheet(item: $open) { n in
            FinanceNeedDetailSheet(need: n, fundName: n.fundCode.map(vm.lookups.fundName),
                                   onReview: canOpenDepartments ? { router.go(.departments) } : nil)
        }
    }

    @ViewBuilder private func row(_ n: FinNeedRow) -> some View {
        let cols = Self.columns
        FinBPersonCell(title: n.title,
                       subtitle: "\(n.departmentName) · books to \(n.fundCode.map(vm.lookups.fundName) ?? "the gift's own fund")")
            .financeCell(cols[0])
        VStack(alignment: .leading, spacing: 2) {
            FinBProgress(raised: n.raisedMinor, target: n.targetMinor, currency: n.currency, compact: true)
            if n.raisedMinor < n.targetMinor {
                Text("\(FinanceMoney.format(n.targetMinor - n.raisedMinor, n.currency)) to go").font(.nMicro).foregroundStyle(Nuru.ink600)
            }
        }
        .financeCell(cols[1])
        Text(String(n.giftsCount)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).monospacedDigit()
            .financeCell(cols[2])
        VStack(alignment: .leading, spacing: 2) {
            if let d = n.deadline, let note = Self.deadlineNote(n) {
                Text(FinanceDates.display(d)).font(.nMono(12)).foregroundStyle(Nuru.navy).lineLimit(1)
                Text(note.text).font(.nMicro).foregroundStyle(note.late ? FinanceStatus.amber.fg : Nuru.ink600).lineLimit(1)
            } else {
                Text("No deadline").font(.nCaption).foregroundStyle(Nuru.ink400)
            }
        }
        .financeCell(cols[3])
        FinanceStatusChip(status: n.status)
            .financeCell(cols[4])
    }

    /// "12 days left" / "due today" / "passed 3 days ago" — late when an
    /// approved need's deadline has passed short of its target (web deadlineNote).
    static func deadlineNote(_ n: FinNeedRow, today: String = FinanceDates.today()) -> (text: String, late: Bool)? {
        guard let deadline = n.deadline, let d = FinBTime.days(from: today, to: deadline) else { return nil }
        if d > 0 { return ("\(d) \(d == 1 ? "day" : "days") left", false) }
        if d == 0 { return ("due today", false) }
        return ("passed \(-d) \(-d == 1 ? "day" : "days") ago", n.raisedMinor < n.targetMinor && n.status == "approved")
    }
}

/// One need in full — the reason the department gave, and its dates.
struct FinanceNeedDetailSheet: View {
    let need: FinNeedRow
    var fundName: String? = nil
    /// Opens Departments — only for someone with departments:view.
    var onReview: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let n = need
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(n.title).font(.inter(17, .bold)).foregroundStyle(Nuru.navy)
                            Text(n.departmentName).font(.nCaption).foregroundStyle(Nuru.ink600)
                        }
                        Spacer()
                        FinanceStatusChip(status: n.status)
                    }
                    FinBProgress(raised: n.raisedMinor, target: n.targetMinor, currency: n.currency)
                    if !n.why.isEmpty {
                        FinBKeyValue(label: "Why the department asked") {
                            Text(n.why).font(.nBody).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        FinBKeyValue("Gifts", String(n.giftsCount))
                        FinBKeyValue("Deadline", n.deadline.map(FinanceDates.display) ?? "None")
                        FinBKeyValue("Books to", fundName ?? "The gift's own fund")
                        FinBKeyValue("Currency", n.currency)
                        FinBKeyValue("Asked", FinBTime.stamp(n.createdAt))
                        FinBKeyValue("Decided", FinBTime.stamp(n.decidedAt))
                    }
                    if let onReview {
                        FinanceButton(title: "Review in Departments", icon: "arrow.up.right") {
                            dismiss()
                            onReview()
                        }
                    }
                }
                .padding(24)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .navigationTitle("Department need")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

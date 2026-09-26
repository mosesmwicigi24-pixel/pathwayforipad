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
    private var relay: AnyCancellable?

    init() { relay = finbRelay(pager) }

    var isFiltered: Bool { filter.status != "approved" || FinanceERPAPI.searchTerm(filter.q) != nil }

    func load() async {
        let f = filter
        await pager.load { cursor in try await FinanceERPAPI.needs(status: f.status, q: f.q, cursor: cursor) }
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
                .init(label: "Raised", minor: t.raisedMinor, tint: Nuru.success),
                .init(label: "of target", minor: t.targetMinor),
            ], count: t.count)
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
        .init("approved", "Approved"), .init("pending", "Pending"), .init("rejected", "Rejected"),
        .init("closed", "Closed"), .init("all", "All"),
    ]

    private static let columns: [FinanceColumn] = [
        FinanceColumn("Need · department", minWidth: 170),
        FinanceColumn("Raised of target", minWidth: 190),
        FinanceColumn("Gifts", width: 56, align: .trailing),
        FinanceColumn("Deadline", width: 100),
        FinanceColumn("Status", width: 90),
    ]

    /// Departments is its own module (departments:view) — the link shows only
    /// to people who can open it; nothing shows while /me loads.
    private var canOpenDepartments: Bool { auth.profile?.permissions.contains("departments:view") == true }

    var body: some View {
        FinancePageScaffold(title: Section.financeNeeds.title,
                            subtitle: "What departments asked for, what has been raised, and where the money is booked. Approving a need stays with Departments.",
                            onRefresh: { await vm.pager.reload() }) {
            if canOpenDepartments {
                HeroChip(label: "Review in Departments", icon: "building.2", trailingIcon: "arrow.up.right", style: .ghost) {
                    router.go(.departments)
                }
            }
        } content: {
            FinanceFilterBar(search: $vm.filter.q, searchPrompt: "Need title or department",
                             isFiltered: vm.isFiltered, onClear: { vm.filter = .init() }) {
                FinanceFilterMenu(title: "Status", selection: $vm.filter.status, options: Self.statusOptions)
            }
            FinBCurrencyFigures(title: "All matching needs", rows: vm.totalsRows, noun: ("need", "needs"),
                                caption: "per currency — never added together",
                                loading: vm.pager.isLoadingFirstPage || vm.pager.refreshing)
            FinBExplain(text: "Raised is every succeeded gift to the need, or to a pledge toward it, from anyone in the church — the same figure the Departments page shows. A gift to a need is booked to the department's fund when it names an active one; otherwise to the fund the giver chose.")
            FinancePagedTable(pager: vm.pager, columns: Self.columns, emptyIcon: "target",
                              emptyMessage: "No \(vm.filter.status == "all" ? "" : "\(vm.filter.status) ")needs match these filters.",
                              totalCount: vm.totalCount, onSelect: { open = $0 }) { n in
                row(n)
            }
        }
        .task(id: vm.filter) { await vm.load() }
        .onFinanceLink(.financeNeeds) { vm.apply(link: $0) }
        .sheet(item: $open) { n in FinanceNeedDetailSheet(need: n) }
    }

    @ViewBuilder private func row(_ n: FinNeedRow) -> some View {
        let cols = Self.columns
        FinBPersonCell(title: n.title, subtitle: "\(n.departmentName) · \(n.fundCode.map { "booked to \($0)" } ?? "to the gift's own fund")")
            .financeCell(cols[0])
        FinBProgress(raised: n.raisedMinor, target: n.targetMinor, currency: n.currency, compact: true)
            .financeCell(cols[1])
        Text(String(n.giftsCount)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).monospacedDigit()
            .financeCell(cols[2])
        VStack(alignment: .leading, spacing: 2) {
            Text(n.deadline.map(FinanceDates.display) ?? "No deadline").font(.inter(12.5, .medium))
                .foregroundStyle(isPastDue(n) ? FinanceStatus.amber.fg : Nuru.navy).lineLimit(1)
            if isPastDue(n) { Text("passed").font(.nMicro).foregroundStyle(FinanceStatus.amber.fg) }
        }
        .financeCell(cols[3])
        FinanceStatusChip(status: n.status)
            .financeCell(cols[4])
    }

    /// An approved need whose deadline day has ended short of its target.
    private func isPastDue(_ n: FinNeedRow) -> Bool {
        guard n.status == "approved", let d = n.deadline, n.raisedMinor < n.targetMinor else { return false }
        return d < FinanceDates.today()
    }
}

/// One need in full — the reason the department gave, and its dates.
struct FinanceNeedDetailSheet: View {
    let need: FinNeedRow
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
                        FinBKeyValue("Booked to", n.fundCode ?? "The gift's own fund")
                        FinBKeyValue("Currency", n.currency)
                        FinBKeyValue("Asked", FinBTime.stamp(n.createdAt))
                        FinBKeyValue("Decided", FinBTime.stamp(n.decidedAt))
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

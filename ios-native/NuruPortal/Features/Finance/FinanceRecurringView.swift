// Finance → Recurring gifts (pathway docs/FINANCE_ERP.md §5) — every recurring
// schedule with its collection health (GET /admin/finance/schedules,
// finance:view): paused first, then most failures, then soonest due. Filters:
// status (default: everything not cancelled) and Needs attention (paused, or a
// consecutive failure — never cancelled). Totals per currency: the schedules
// listed and the APPROXIMATE monthly run-rate of the active ones — monthly
// amounts + weekly amounts × 52 ÷ 12, integer math (FinBMath.runRates).
// A row opens its detail (the full last error) with a jump to the partner.
// Deep link: attention=true (and status).
import SwiftUI

@MainActor
final class FinanceRecurringModel: ObservableObject {
    struct Filter: Equatable {
        /// active · paused · cancelled ("" = everything not cancelled)
        var status = ""
        var attention = false
    }
    enum Phase: Equatable { case loading, loaded, failed(String) }

    /// The endpoint's cap (?limit ≤ 200); reaching it is said on the page.
    static let cap = 200

    @Published var filter = Filter()
    @Published private(set) var rows: [FinSchedule] = []
    @Published private(set) var phase: Phase = .loading
    @Published private(set) var refreshing = false
    @Published private(set) var refreshError: String?
    private var seq = 0

    var isFiltered: Bool { filter != Filter() }

    func load() async {
        seq += 1
        let mine = seq
        let f = filter
        if rows.isEmpty { phase = .loading } else { refreshing = true }
        refreshError = nil
        do {
            var list = try await FinanceERPAPI.schedules(status: f.status.isEmpty ? nil : f.status,
                                                        attention: f.attention, limit: Self.cap)
            // The server applies ?attention; the same rule is kept here so the
            // list can never show more than the filter says.
            if f.attention { list = list.filter(\.needsAttention) }
            guard mine == seq else { return }
            rows = list
            phase = .loaded
        } catch {
            guard mine == seq else { return }
            if Task.isCancelled { refreshing = false; return }
            let message = FinBError.message(error, fallback: "Could not load the recurring gifts.")
            if rows.isEmpty || phase != .loaded { rows = []; phase = .failed(message) } else { refreshError = "Couldn't refresh — \(message)" }
        }
        if mine == seq { refreshing = false }
    }

    func apply(link params: [String: String]) {
        var f = Filter()
        if let a = params["attention"] { f.attention = a == "true" || a == "1" }
        if let s = params["status"], ["active", "paused", "cancelled"].contains(s) { f.status = s }
        filter = f
    }

    var runRates: [FinBMath.RunRate] {
        FinBMath.runRates(rows.map { .init(frequency: $0.frequency, amountMinor: $0.amountMinor, currency: $0.currency, status: $0.status) })
    }

    var totalsRows: [FinBCurrencyFigures.Row] {
        runRates.map { r in
            FinBCurrencyFigures.Row(currency: r.currency,
                                    figures: [.init(label: "≈ per month", minor: r.monthlyMinor, tint: Nuru.success)],
                                    count: r.active,
                                    note: r.unrated > 0 ? "of \(r.listed) listed · \(r.unrated) with another frequency not counted" : "of \(r.listed) listed")
        }
    }

    var attentionCount: Int { rows.filter(\.needsAttention).count }
}

struct FinanceRecurringView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceRecurringModel()
    @State private var open: FinSchedule?

    static let statusOptions: [FinanceFilterOption] = [
        .all("Not cancelled"), .init("active", "Active"), .init("paused", "Paused"), .init("cancelled", "Cancelled"),
    ]

    private static let columns: [FinanceColumn] = [
        FinanceColumn("Member", minWidth: 130),
        FinanceColumn("Gift · fund", width: 150),
        FinanceColumn("Next run", width: 118),
        FinanceColumn("Collection", minWidth: 130),
        FinanceColumn("Status", width: 84),
    ]

    var body: some View {
        FinancePageScaffold(title: Section.financeRecurring.title,
                            subtitle: "Recurring gifts and how their collections are going — the ones needing attention first.",
                            stats: stats,
                            onRefresh: { await vm.load() }) {
            FinanceFilterBar(isFiltered: vm.isFiltered, onClear: { vm.filter = .init() }) {
                FinanceFilterMenu(title: "Status", selection: $vm.filter.status, options: Self.statusOptions)
                attentionChip
            }
            FinBCurrencyFigures(title: "Run-rate of the active ones", rows: vm.totalsRows,
                                noun: ("active schedule", "active schedules"),
                                caption: "approximate · per currency", loading: vm.phase == .loading || vm.refreshing)
            FinBExplain(text: "≈ per month = the active monthly gifts + the active weekly gifts × 52 ÷ 12 (a weekly gift is counted as 52 ÷ 12 charges a month), in whole cents. Paused and cancelled schedules collect nothing, so they are listed but not counted.")
            if let e = vm.refreshError { FinanceNoticeBar(notice: .error(e)) }
            if vm.phase == .loaded, vm.rows.count >= FinanceRecurringModel.cap {
                FinanceNoticeBar(notice: .warn("Showing the first \(FinanceRecurringModel.cap) schedules — the list stops there. Narrow it with the filters."))
            }
            table
        }
        .task(id: vm.filter) { await vm.load() }
        .onFinanceLink(.financeRecurring) { vm.apply(link: $0) }
        .sheet(item: $open) { s in
            FinanceScheduleDetailSheet(schedule: s) { router.openFinance(.partners, ["member": s.userId]) }
        }
    }

    private var stats: [HeroStat] {
        guard vm.phase == .loaded else { return [] }
        let n = vm.attentionCount
        return [
            HeroStat(label: "Listed", value: String(vm.rows.count), hint: vm.filter.attention ? "needing attention" : "with these filters"),
            HeroStat(label: "Needs attention", value: String(n), hint: "paused or failing", tint: n > 0 ? Color(hex: 0xF5C77E) : nil),
        ]
    }

    private var attentionChip: some View {
        Button { vm.filter.attention.toggle() } label: {
            FinanceChipLabel(icon: "exclamationmark.triangle", title: "Needs attention",
                             value: vm.filter.attention ? "Only" : "Any", active: vm.filter.attention)
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("Needs attention filter")
        .accessibilityValue(vm.filter.attention ? "Only schedules needing attention" : "Any")
    }

    @ViewBuilder private var table: some View {
        switch vm.phase {
        case .loading:
            SkeletonTable(rows: 6)
        case .failed(let message):
            ErrorBanner(message: message) { Task { await vm.load() } }
        case .loaded:
            FinanceTable(rows: vm.rows, columns: Self.columns, emptyIcon: "repeat.circle",
                         emptyMessage: vm.filter.attention ? "Nothing needs attention — every schedule is collecting." : "No recurring gifts match these filters.",
                         onSelect: { open = $0 }) { s in
                row(s)
            }
            .opacity(vm.refreshing ? 0.6 : 1)
        }
    }

    @ViewBuilder private func row(_ s: FinSchedule) -> some View {
        let cols = Self.columns
        FinBPersonCell(title: s.fullName, subtitle: s.phoneNumber ?? "No phone")
            .financeCell(cols[0])
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 3) {
                FinBAmount(minor: s.amountMinor, currency: s.currency)
                Text(Self.per(s.frequency)).font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            Text("to \(s.fund) · \(FinWords.channel(s.method))").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
        }
        .financeCell(cols[1])
        VStack(alignment: .leading, spacing: 2) {
            Text(s.status == "active" ? FinBTime.day(s.nextRunAt) : "—").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
            Text("last \(FinBTime.day(s.lastRunAt))").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
        }
        .financeCell(cols[2])
        VStack(alignment: .leading, spacing: 2) {
            if s.consecutiveFailures > 0 {
                Text(s.consecutiveFailures == 1 ? "1 failure in a row" : "\(s.consecutiveFailures) failures in a row")
                    .font(.inter(12.5, .semibold)).foregroundStyle(FinanceStatus.red.fg)
                Text(s.lastError?.isEmpty == false ? s.lastError! : "no error recorded").font(.nMicro).foregroundStyle(FinanceStatus.rose.fg).lineLimit(1)
            } else if s.status == "paused" {
                Text("Paused").font(.inter(12.5, .semibold)).foregroundStyle(FinanceStatus.amber.fg)
                Text(s.pausedAt.map { "since \(FinBTime.day($0))" } ?? "collects nothing").font(.nMicro).foregroundStyle(Nuru.ink600)
            } else if s.status == "cancelled" {
                Text("Stopped").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink600)
            } else {
                Text("Collecting").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.success)
                Text("no failures").font(.nMicro).foregroundStyle(Nuru.ink600)
            }
        }
        .financeCell(cols[3])
        FinanceStatusChip(status: s.status)
            .financeCell(cols[4])
    }

    /// "a week" / "a month" after an amount.
    static func per(_ frequency: String) -> String {
        switch frequency {
        case "weekly": "a week"
        case "monthly": "a month"
        default: frequency.isEmpty ? "" : frequency
        }
    }
}

/// One schedule, every field — the last error in full.
struct FinanceScheduleDetailSheet: View {
    let schedule: FinSchedule
    let onOpenPartner: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let s = schedule
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(s.fullName).font(.inter(17, .bold)).foregroundStyle(Nuru.navy)
                            Text(s.phoneNumber ?? "No phone").font(.nCaption).foregroundStyle(Nuru.ink600)
                        }
                        Spacer()
                        FinanceStatusChip(status: s.status)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        FinBAmount(minor: s.amountMinor, currency: s.currency, size: 22)
                        Text(FinanceRecurringView.per(s.frequency)).font(.nBody).foregroundStyle(Nuru.ink600)
                    }
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        FinBKeyValue("Fund", s.fund)
                        FinBKeyValue("Method", FinWords.channel(s.method))
                        FinBKeyValue("Next run", s.status == "active" ? FinBTime.stamp(s.nextRunAt) : "— (not active)")
                        FinBKeyValue("Last run", FinBTime.stamp(s.lastRunAt))
                        FinBKeyValue("Failures in a row", String(s.consecutiveFailures))
                        FinBKeyValue("Last failed", FinBTime.stamp(s.lastFailedAt))
                        FinBKeyValue("Paused", FinBTime.stamp(s.pausedAt))
                        FinBKeyValue("Started", FinBTime.stamp(s.createdAt))
                    }
                    FinBKeyValue(label: "Last error") {
                        Text(s.lastError?.isEmpty == false ? s.lastError! : "None recorded")
                            .font(.nMono(12.5)).foregroundStyle(s.lastError?.isEmpty == false ? FinanceStatus.rose.fg : Nuru.ink600)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    FinBExplain(text: "The member manages this gift in the app (pause, resume, change, cancel); the office cannot charge or change it from here. Paused or failing ones are what \"Needs attention\" lists.")
                    if s.status != "cancelled" {
                        FinanceButton(title: "Open in Partners", icon: "person.crop.circle", style: .primary) {
                            dismiss()
                            onOpenPartner()
                        }
                    }
                    Text("Schedule \(s.scheduleId)").font(.nMono(11)).foregroundStyle(Nuru.ink400).textSelection(.enabled)
                }
                .padding(24)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .navigationTitle("Recurring gift")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.large])
    }
}

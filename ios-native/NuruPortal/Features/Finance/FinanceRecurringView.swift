// Finance → Recurring gifts (pathway docs/FINANCE_ERP.md §5) — every recurring
// giving schedule with its collection health (GET /admin/finance/schedules,
// finance:view): who, how much, how often, by which method, next and last
// run, consecutive failures with the last error, and status — paused first,
// then most failures, then soonest due. "Needs attention" (paused, or failing;
// never cancelled) is the Overview's failing-schedules alert (attention=true).
// Totals per currency: how many, and the "≈ per month" the ACTIVE ones bring
// in — (Σ weekly × 52 + Σ monthly × 12) ÷ 12, integer math, labelled
// approximate (FinBMath.runRates). A row opens the member's partner record.
import SwiftUI
import Combine

@MainActor
final class FinanceRecurringModel: ObservableObject {
    struct Filter: Equatable {
        /// active · paused · cancelled ("" = active and paused)
        var status = ""
        var attention = false
    }
    enum Phase: Equatable { case loading, loaded, failed(String) }

    /// The endpoint's cap (?limit ≤ 200; it does not page) — reaching it is said.
    static let cap = 200

    @Published var filter = Filter()
    @Published private(set) var rows: [FinSchedule] = []
    @Published private(set) var phase: Phase = .loading
    @Published private(set) var refreshing = false
    @Published private(set) var refreshError: String?
    let lookups = FinBLookups()
    private var relay: AnyCancellable?
    private var seq = 0

    init() { relay = finbRelay(lookups) }

    var isFiltered: Bool { filter != Filter() }

    func load() async {
        seq += 1
        let mine = seq
        let f = filter
        if rows.isEmpty { phase = .loading } else { refreshing = true }
        refreshError = nil
        async let funds: Void = lookups.loadFunds()
        do {
            var list = try await FinanceERPAPI.schedules(status: f.status.isEmpty ? nil : f.status,
                                                        attention: f.attention, limit: Self.cap)
            // The server applies ?attention; the same rule is kept here so the
            // list can never show more than the filter says.
            if f.attention { list = list.filter(\.needsAttention) }
            if mine == seq {
                rows = list
                phase = .loaded
            }
        } catch {
            if mine == seq, !Task.isCancelled {
                let message = FinBError.message(error, fallback: "Could not load the recurring gifts.")
                if rows.isEmpty || phase != .loaded { rows = []; phase = .failed(message) } else { refreshError = "Couldn't refresh — \(message)" }
            }
        }
        _ = await funds
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
                                    note: "\(r.listed) \(r.listed == 1 ? "schedule" : "schedules") · \(r.active) active"
                                        + (r.unrated > 0 ? " · \(r.unrated) with a frequency not counted" : ""))
        }
    }

    var attentionCount: Int { rows.filter(\.needsAttention).count }
    var failingCount: Int { rows.filter { $0.consecutiveFailures > 0 }.count }
    var unratedCount: Int { runRates.reduce(0) { $0 + $1.unrated } }
}

struct FinanceRecurringView: View {
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceRecurringModel()

    static let statusOptions: [FinanceFilterOption] = [
        .all("Active & paused"), .init("active", "Active"), .init("paused", "Paused"), .init("cancelled", "Cancelled"),
    ]

    private static let columns: [FinanceColumn] = [
        FinanceColumn("Member", minWidth: 130),
        FinanceColumn("Gift · fund · method", width: 160),
        FinanceColumn("Next · last run", width: 124),
        FinanceColumn("Failures", minWidth: 130),
        FinanceColumn("Status", width: 116),
    ]

    var body: some View {
        FinancePageScaffold(title: Section.financeRecurring.title,
                            subtitle: "Every giving schedule and whether it is collecting — failing and paused ones first. The run-rate is what the active schedules bring in a month, approximately.",
                            stats: stats,
                            onRefresh: { await vm.load() }) {
            FinanceFilterBar(isFiltered: vm.isFiltered, onClear: { vm.filter = .init() }) {
                FinanceFilterMenu(title: "Status", selection: $vm.filter.status, options: Self.statusOptions)
                FinanceFilterMenu(title: "Show", selection: Binding(get: { vm.filter.attention ? "true" : "" },
                                                                  set: { vm.filter.attention = $0 == "true" }),
                                  options: [.all("Everything"), .init("true", "Needs attention")], icon: "exclamationmark.triangle")
            }
            if vm.phase == .loaded, vm.rows.count >= FinanceRecurringModel.cap {
                FinanceNoticeBar(notice: .warn("Showing the first \(FinanceRecurringModel.cap) schedules the server returns (paused first, then the most failures) — the totals cover these \(FinanceRecurringModel.cap) only. Narrow the status to see the rest."))
            }
            FinBCurrencyFigures(title: "Run-rate", rows: vm.totalsRows, noun: ("schedule", "schedules"),
                                caption: "approximate · per currency", loading: vm.phase == .loading || vm.refreshing)
            FinBExplain(text: "Approximate: weekly gifts × 52 ÷ 12, plus monthly gifts — (Σ weekly × 52 + Σ monthly × 12) ÷ 12 over the ACTIVE schedules, rounded to the cent. Paused and cancelled schedules bring nothing in and are left out." + (vm.unratedCount > 0 ? " Schedules with another frequency are not in the figure." : ""))
            if let e = vm.refreshError { FinanceNoticeBar(notice: .error(e)) }
            table
        }
        .task(id: vm.filter) { await vm.load() }
        .onFinanceLink(.financeRecurring) { vm.apply(link: $0) }
    }

    private var stats: [HeroStat] {
        guard vm.phase == .loaded else { return [] }
        return [
            HeroStat(label: "Schedules", value: String(vm.rows.count), hint: vm.filter.status.isEmpty ? "active and paused" : "status \(vm.filter.status)"),
            HeroStat(label: "Needs attention", value: String(vm.attentionCount), hint: "paused, or failing",
                     tint: vm.attentionCount > 0 ? Color(hex: 0xF5C77E) : nil),
            HeroStat(label: "Failing", value: String(vm.failingCount), hint: "a collection failed last time",
                     tint: vm.failingCount > 0 ? Color(hex: 0xF5A3A3) : nil),
        ]
    }

    @ViewBuilder private var table: some View {
        switch vm.phase {
        case .loading:
            SkeletonTable(rows: 6)
        case .failed(let message):
            ErrorBanner(message: message) { Task { await vm.load() } }
        case .loaded:
            FinanceTable(rows: vm.rows, columns: Self.columns, emptyIcon: "repeat.circle",
                         emptyMessage: vm.filter.attention ? "Nothing needs attention — every schedule is collecting."
                             : !vm.filter.status.isEmpty ? "No \(vm.filter.status) schedules."
                             : "No recurring gifts yet — members set them up from Give in the app.",
                         onSelect: { router.openFinance(.partners, ["member": $0.userId]) }) { s in
                row(s)
            }
            .opacity(vm.refreshing ? 0.6 : 1)
        }
    }

    @ViewBuilder private func row(_ s: FinSchedule) -> some View {
        let cols = Self.columns
        FinBPersonCell(title: s.fullName.isEmpty ? "—" : s.fullName, subtitle: s.phoneNumber)
            .financeCell(cols[0])
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                FinBAmount(minor: s.amountMinor, currency: s.currency)
                Text(Self.every(s.frequency)).font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            Text("\(vm.lookups.fundName(s.fund)) · \(FinWords.channel(s.method))").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
        }
        .financeCell(cols[1])
        VStack(alignment: .leading, spacing: 2) {
            Text(s.status == "active" ? FinBTime.stamp(s.nextRunAt) : "—").font(.nMono(11.5)).foregroundStyle(Nuru.navy).lineLimit(1)
                .minimumScaleFactor(0.8)
            Text("last \(FinBTime.stamp(s.lastRunAt))").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.8)
        }
        .financeCell(cols[2])
        VStack(alignment: .leading, spacing: 2) {
            if s.consecutiveFailures > 0 {
                Text("\(s.consecutiveFailures) in a row").font(.nMono(12.5, .semibold)).foregroundStyle(FinanceStatus.red.fg)
                if let err = s.lastError, !err.isEmpty {
                    Text(err).font(.nMicro).foregroundStyle(FinanceStatus.red.fg).lineLimit(2)
                }
                if let at = s.lastFailedAt { Text("last failed \(FinBTime.stamp(at))").font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1) }
            } else {
                Text("0").font(.nMono(12.5)).foregroundStyle(Nuru.ink400)
            }
        }
        .financeCell(cols[3])
        VStack(alignment: .leading, spacing: 3) {
            FinanceStatusChip(status: s.status)
            if s.needsAttention && s.status != "paused" { FinanceStatusChip(status: "behind", label: "Needs attention") }
            if s.status == "paused", let at = s.pausedAt {
                Text("since \(FinBTime.stamp(at))").font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1).minimumScaleFactor(0.8)
            }
        }
        .financeCell(cols[4])
    }

    /// "Weekly" / "Monthly" as the amount's cadence.
    static func every(_ frequency: String) -> String {
        frequency.isEmpty ? "" : "· " + frequency.prefix(1).uppercased() + frequency.dropFirst()
    }
}

// Finance → Recurring gifts (pathway docs/FINANCE_ERP.md §5, docs/GIVING.md
// §10) — every recurring giving schedule with its collection health (GET
// /admin/finance/schedules, finance:view): who, how much, how often, by which
// method, next and last run, consecutive failures with the reason in the words
// the member was told, and status with WHY it is paused — the ones needing
// attention first. "Needs attention" is the server's one rule (Giving Cycle
// 7), also the Overview's failing-schedules alert (attention=true): failing,
// stopped after failed prompts, or our own outage — never a member's own
// pause. Totals per currency: how many, and the "≈ per month" the ACTIVE ones
// bring in — (Σ weekly × 52 + Σ monthly × 12) ÷ 12, integer math, labelled
// approximate (FinBMath.runRates). A row opens the member's partner record.
// With finance:manage the office can pause, resume or cancel a gift when the
// member asks — a reason is required and the member is told
// (FinanceScheduleOffice.swift). The page opens with "How collection is going"
// (Giving Cycle 9, FinanceCollectionHealth.swift), read beside the schedules.
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
    @Published var toast: ToastData?
    /// How collection is going (Giving Cycle 9); nil shows no card — an older
    /// server, or the read failed. Read on the first load, on pull-to-refresh
    /// and after an office action; a filter change does not touch it.
    @Published private(set) var health: FinCollectionHealth?
    private var healthRead = false
    let lookups = FinBLookups()
    private var relay: AnyCancellable?
    private var seq = 0

    init() { relay = finbRelay(lookups) }

    var isFiltered: Bool { filter != Filter() }

    func load(refreshHealth: Bool = false) async {
        seq += 1
        let mine = seq
        let f = filter
        if rows.isEmpty { phase = .loading } else { refreshing = true }
        refreshError = nil
        let readHealth = refreshHealth || !healthRead
        let shown = health
        async let funds: Void = lookups.loadFunds()
        // Alongside the schedules, never ahead of them: the rows land first.
        async let fetched = Self.health(read: readHealth, else: shown)
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
        let h = await fetched
        if mine == seq {
            health = h
            if readHealth { healthRead = true }
        }
        _ = await funds
        if mine == seq { refreshing = false }
    }

    /// GET /collection-health?days=30 when `read`, else what is shown now. A
    /// failed read or an unusable answer is nil — the page goes on without it.
    nonisolated static func health(read: Bool, else kept: FinCollectionHealth?) async -> FinCollectionHealth? {
        guard read else { return kept }
        guard let h = try? await FinanceERPAPI.collectionHealth(days: 30), h.isUsable else { return nil }
        return h
    }

    func apply(link params: [String: String]) {
        var f = Filter()
        if let a = params["attention"] { f.attention = a == "true" || a == "1" }
        if let s = params["status"], ["active", "paused", "cancelled"].contains(s) { f.status = s }
        filter = f
    }

    /// The office pauses, resumes or cancels a gift at the member's request
    /// (finance:manage). Throws for the sheet to show the server's own words
    /// (400 / 422); on success a toast, and the list reloads behind the closing
    /// sheet — the row may leave the current filter.
    func act(_ request: FinScheduleOfficeRequest, _ body: FinScheduleActionBody) async throws {
        _ = try await FinanceERPAPI.scheduleAction(request.row.scheduleId, request.action, body)
        toast = .success(request.action.done(name: request.row.fullName))
        Task { await load(refreshHealth: true) }
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
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceRecurringModel()
    /// The office action waiting for its reason (finance:manage).
    @State private var request: FinScheduleOfficeRequest?

    static let statusOptions: [FinanceFilterOption] = [
        .all("Active & paused"), .init("active", "Active"), .init("paused", "Paused"), .init("cancelled", "Cancelled"),
    ]

    /// The register's columns; the office's actions only with finance:manage
    /// (hidden while /me loads — FinanceCaps fails closed; web parity).
    static func columns(manage: Bool) -> [FinanceColumn] {
        var cols = [
            FinanceColumn("Member", minWidth: 130),
            FinanceColumn("Gift · fund · method", width: 180),
            FinanceColumn("Next · last run", width: 124),
            FinanceColumn("Failures", minWidth: 140),
            FinanceColumn("Status", minWidth: 160),
        ]
        if manage { cols.append(FinanceColumn("Office", width: 104, align: .trailing)) }
        return cols
    }

    var body: some View {
        FinancePageScaffold(title: Section.financeRecurring.title,
                            subtitle: "Every giving schedule and whether it is collecting — failing and paused ones first. The run-rate is what the active schedules bring in a month, approximately.",
                            stats: stats,
                            onRefresh: { await vm.load(refreshHealth: true) }) {
            if let h = vm.health { FinanceCollectionHealthCard(health: h) }
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
        .sheet(item: $request) { r in
            FinanceScheduleActionSheet(request: r) { body in try await vm.act(r, body) }
        }
        .toast($vm.toast)
    }

    private var stats: [HeroStat] {
        guard vm.phase == .loaded else { return [] }
        return [
            HeroStat(label: "Schedules", value: String(vm.rows.count), hint: vm.filter.status.isEmpty ? "active and paused" : "status \(vm.filter.status)"),
            HeroStat(label: "Needs attention", value: String(vm.attentionCount), hint: "failing, stopped after failures, or not sent by us",
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
            let manage = auth.financeCaps.manage
            let cols = Self.columns(manage: manage)
            FinanceTable(rows: vm.rows, columns: cols, emptyIcon: "repeat.circle",
                         emptyMessage: vm.filter.attention ? "Nothing needs attention — every schedule is collecting."
                             : !vm.filter.status.isEmpty ? "No \(vm.filter.status) schedules."
                             : "No recurring gifts yet — members set them up from Give in the app.",
                         onSelect: { router.openFinance(.partners, ["member": $0.userId]) }) { s in
                row(s, cols: cols, manage: manage)
            }
            .opacity(vm.refreshing ? 0.6 : 1)
        }
    }

    @ViewBuilder private func row(_ s: FinSchedule, cols: [FinanceColumn], manage: Bool) -> some View {
        FinBPersonCell(title: s.fullName.isEmpty ? "—" : s.fullName, subtitle: s.promptOrProfileNumber)
            .financeCell(cols[0])
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                FinBAmount(minor: s.amountMinor, currency: s.currency)
                Text(Self.every(s.frequency)).font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            if let next = s.nextAskLabel {
                Text(next).font(.nMicro).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
            }
            Text("\(fundName(s)) · \(FinWords.channel(s.method))").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
            if let p = s.pledge {
                Text(p.title.isEmpty ? "Collects a pledge" : "Collects “\(p.title)”")
                    .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(2)
            }
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
                // Why, in the words the member was told; the provider's raw
                // error stays as detail (help / accessibility), not on the row.
                if let why = s.failureWords {
                    let line = Text(why).font(.nMicro).foregroundStyle(FinanceStatus.red.fg).lineLimit(3)
                    if let raw = s.failureDetail { line.help(raw) } else { line }
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
            // Whose choice the pause was — only "stopped after failed prompts"
            // is the office's to chase.
            if let why = s.pauseReasonLabel {
                Text(why).font(.nMicro).foregroundStyle(s.pauseIsFailure ? FinanceStatus.red.fg : Nuru.ink600)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if s.status == "paused", let at = s.pausedAt {
                Text("since \(FinBTime.stamp(at))").font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1).minimumScaleFactor(0.8)
            }
            // Our own outage: the giver was NOT told — only the office can know.
            if let alert = s.officeAlert, !alert.isEmpty {
                Text(alert).font(.nMicro).foregroundStyle(FinanceStatus.red.fg).fixedSize(horizontal: false, vertical: true)
            }
        }
        .financeCell(cols[4])
        if manage {
            VStack(alignment: .trailing, spacing: 6) {
                ForEach(s.officeActions) { a in
                    FinanceButton(title: a.buttonTitle, icon: a.icon, style: a == .cancel ? .danger : .plain) {
                        request = FinScheduleOfficeRequest(row: s, action: a)
                    }
                    .accessibilityLabel("\(a.buttonTitle) \(s.fullName.isEmpty ? "this" : s.fullName + "'s") gift")
                    .accessibilityHint("At the member's request — a reason is required and they are told.")
                }
            }
            .financeCell(cols[5])
        }
    }

    /// The register's own fund name, else /config's, else the code.
    private func fundName(_ s: FinSchedule) -> String {
        if let name = s.fundName, !name.isEmpty { return name }
        return vm.lookups.fundName(s.fund)
    }

    /// "Weekly" / "Monthly" as the amount's cadence.
    static func every(_ frequency: String) -> String {
        frequency.isEmpty ? "" : "· " + frequency.prefix(1).uppercased() + frequency.dropFirst()
    }
}

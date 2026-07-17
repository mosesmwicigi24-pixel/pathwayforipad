// Dashboard — "The Pulse". Five zones composed from the whole app, each fetched
// concurrently and rendered independently (a failed zone shows a quiet dash,
// never a broken page):
//   1 HERO      — greeting + movement KPIs (every number carries context)
//   2 LIVE NOW  — on-air radio / next broadcast, next event countdown, urgent care
//   3 NEEDS YOU — one ranked action queue across the app (only non-zero rows)
//   4 THE FLOCK — engagement band bar + attendance sparkline
//   5 WORD      — curriculum · broadcast · plans · certificates · one giving tile
// plus an aggregated activity feed and the upcoming-events list.
import SwiftUI
import Charts

// MARK: - Time helpers (file-scope)

private let isoFrac: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
}()
private let isoPlainF = ISO8601DateFormatter()

private func parseISO(_ s: String?) -> Date? {
    guard let s, !s.isEmpty else { return nil }
    return isoFrac.date(from: s) ?? isoPlainF.date(from: s)
}

/// "in 12m" · "in 5h" · "in 2d 4h" · "now"
private func countdown(to d: Date) -> String {
    let secs = d.timeIntervalSinceNow
    guard secs > 0 else { return "now" }
    let mins = Int(secs / 60)
    if mins < 60 { return "in \(max(mins, 1))m" }
    let hours = mins / 60
    if hours < 24 { return "in \(hours)h" }
    let days = hours / 24
    let rem = hours % 24
    return rem > 0 ? "in \(days)d \(rem)h" : "in \(days)d"
}

private let todayLabel: String = Date().formatted(.dateTime.weekday(.wide).day().month(.wide))

// MARK: - Zone snapshots

/// Radio zone — derived once from GET /admin/radio/programs (+ health/listeners
/// for the live one). Data for both the LIVE NOW strip and the Word tile.
struct RadioPulse {
    var live: RadioProgram?
    var listeners: Int?
    var nowPlaying: String?
    var next: RadioProgram?
    var nextAt: Date?
    var lastEnded: RadioProgram?
    var lastEndedAt: Date?

    init(programs: [RadioProgram]) {
        live = programs.first { $0.isLive || $0.status == "live" }
        let now = Date()
        let upcoming = programs
            .filter { $0.status == "scheduled" }
            .compactMap { p in parseISO(p.scheduledAt).map { (p, $0) } }
            .filter { $0.1 > now }
            .min { $0.1 < $1.1 }
        next = upcoming?.0
        nextAt = upcoming?.1
        let ended = programs
            .filter { $0.status == "ended" }
            .compactMap { p in parseISO(p.liveEndedAt ?? p.updatedAt).map { (p, $0) } }
            .max { $0.1 < $1.1 }
        lastEnded = ended?.0
        lastEndedAt = ended?.1
    }
}

/// The month's giving, reduced to ONE tile: the dominant currency's total +
/// gift count. This is the dashboard's only finance mention.
struct GivingSnapshot {
    let monthMinor: Int
    let currency: String?
    let gifts: Int
    let fundCount: Int

    init(funds: [FundSummary]) {
        let byCurrency = Dictionary(grouping: funds) { $0.currency ?? "USD" }
        let best = byCurrency.max {
            $0.value.reduce(0) { $0 + $1.monthMinor } < $1.value.reduce(0) { $0 + $1.monthMinor }
        }
        currency = best?.key
        monthMinor = best?.value.reduce(0) { $0 + $1.monthMinor } ?? 0
        gifts = funds.reduce(0) { $0 + $1.giftCount }
        fundCount = funds.count
    }
}

/// Consecutive same-action audit rows collapsed into one line
/// ("6 enrollment starts · Jake Wealth +2 others · today").
struct ActivityGroup: Identifiable {
    let id: Int
    let action: String
    var count: Int
    var actors: [String]      // unique, first-seen order
    let entity: String?
    let newestAt: String      // feed is newest-first, so the first row's stamp

    static func aggregate(_ rows: [AuditRow]) -> [ActivityGroup] {
        var out: [ActivityGroup] = []
        for r in rows {
            if var last = out.last, last.action == r.action {
                last.count += 1
                if let n = r.actorName, !last.actors.contains(n) { last.actors.append(n) }
                out[out.count - 1] = last
            } else {
                if out.count == 6 { break }        // cap at 6 aggregated rows
                out.append(ActivityGroup(id: r.auditId, action: r.action, count: 1,
                                         actors: r.actorName.map { [$0] } ?? [],
                                         entity: r.entity, newestAt: r.createdAt))
            }
        }
        return out
    }
}

/// One row of the unified action queue.
struct NeedRow: Identifiable {
    let id: String
    let icon: String
    let tint: Color
    let title: String
    let detail: String
    let count: Int
    let dest: Section
}

// MARK: - View model

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var firstName = ""
    @Published var loading = true

    // Every zone value is optional: nil while loading, nil after a failed fetch
    // (→ quiet dash). A refresh only overwrites on success, so a flaky network
    // never blanks a zone that already rendered.
    @Published var overview: OverviewKpis?
    @Published var bands: [String: Int]?
    @Published var trend: [AttendanceTrendPoint]?
    @Published var radio: RadioPulse?
    @Published var upcoming: [CalendarOccurrence]?
    @Published var signals: [PulseSignal]?
    @Published var reviews: [LevelReviewItem]?
    @Published var stuckMedia: Int?
    @Published var consents: Int?
    @Published var levels: [AdminLevel]?
    @Published var plansLive: Int?
    @Published var giving: GivingSnapshot?
    @Published var activity: [ActivityGroup]?

    /// `.task` guard — true once `load()` has been kicked off.
    var startedOnce = false

    func load() async {
        let firstLoad = !startedOnce
        startedOnce = true
        if firstLoad { loading = true }

        // Zones land independently: each task assigns its slice as soon as its
        // call returns, so the page fills in progressively.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                if let me = try? await PortalAPI.me() {
                    self.firstName = me.fullName.split(separator: " ").first.map(String.init) ?? ""
                }
            }
            group.addTask { @MainActor in
                if let v = try? await PortalAPI.overview() { self.land { self.overview = v } }
            }
            group.addTask { @MainActor in
                if let v = try? await PortalAPI.engagement() { self.land { self.bands = v.bands } }
            }
            group.addTask { @MainActor in
                if let v = try? await PortalAPI.attendance(weeks: 8) {
                    self.land { self.trend = v.sorted { $0.weekStart < $1.weekStart } }
                }
            }
            group.addTask { @MainActor in
                let now = Date()
                let from = isoPlainF.string(from: now)
                let to = isoPlainF.string(from: now.addingTimeInterval(60 * 24 * 3600))
                if let v = try? await PortalAPI.calendar(from: from, to: to) {
                    self.land { self.upcoming = Array(v.sorted { $0.startAt < $1.startAt }.prefix(5)) }
                }
            }
            group.addTask { @MainActor in
                if let v = try? await PortalAPI.pulseSignals(sinceDays: 14) { self.land { self.signals = v } }
            }
            group.addTask { @MainActor in
                if let v = try? await PortalAPI.levelReviews() { self.land { self.reviews = v } }
            }
            group.addTask { @MainActor in
                if let v = try? await PortalAPI.mediaStuck() { self.land { self.stuckMedia = v } }
            }
            group.addTask { @MainActor in
                if let v = try? await PortalAPI.consentsCount() { self.land { self.consents = v } }
            }
            group.addTask { @MainActor in
                if let v = try? await PortalAPI.curriculumLevels() { self.land { self.levels = v } }
            }
            group.addTask { @MainActor in
                if let v = try? await PortalAPI.plans() { self.land { self.plansLive = v.filter(\.isActive).count } }
            }
            group.addTask { @MainActor in
                if let funds = try? await PortalAPI.financeSummary() { self.land { self.giving = GivingSnapshot(funds: funds) } }
            }
            group.addTask { @MainActor in
                if let rows = try? await PortalAPI.auditFeed() { self.land { self.activity = ActivityGroup.aggregate(rows) } }
            }
            group.addTask { @MainActor in
                guard let programs = try? await PortalAPI.radioPrograms() else { return }
                var pulse = RadioPulse(programs: programs)
                if let live = pulse.live {
                    async let h = try? PortalAPI.radioHealth(live.id)
                    async let r = try? PortalAPI.radioListeners(live.id)
                    let health = await h
                    let roster = await r
                    pulse.listeners = roster?.count ?? health?.listeners
                    pulse.nowPlaying = health?.nowPlaying
                }
                let landed = pulse
                self.land { self.radio = landed }
            }
        }
        land { self.loading = false }
    }

    /// Gentle crossfade as each zone's data lands (numericText values glide).
    private func land(_ apply: () -> Void) {
        withAnimation(.easeOut(duration: 0.25)) { apply() }
    }

    // MARK: Derived

    var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
        return firstName.isEmpty ? part : "\(part), \(firstName)"
    }

    var urgentSignals: [PulseSignal] { (signals ?? []).filter { $0.severity == "urgent" && $0.acknowledgedAt == nil } }
    var watchSignals: [PulseSignal] { (signals ?? []).filter { $0.severity == "watch" && $0.acknowledgedAt == nil } }

    /// Week-over-week check-in movement from the last two attendance points.
    var attendanceDelta: (up: Bool, pct: Int)? {
        guard let t = trend, t.count >= 2 else { return nil }
        let prev = t[t.count - 2].checkIns
        let last = t[t.count - 1].checkIns
        if prev == 0 { return last > 0 ? (true, 100) : nil }
        let pct = Int((Double(last - prev) / Double(prev) * 100).rounded())
        return (pct >= 0, abs(pct))
    }

    /// The three queue sources needed before the green all-clear can be honest.
    var needsReady: Bool { overview != nil && signals != nil && reviews != nil }

    /// The unified action queue, ranked red → orange → yellow. Zero rows hide.
    var needs: [NeedRow] {
        var rows: [NeedRow] = []
        let red = Nuru.danger
        let orange = Color(hex: 0xD97706)
        let yellow = Color(hex: 0xCA8A04)

        let urgent = urgentSignals
        if let first = urgent.first {
            rows.append(NeedRow(id: "urgent", icon: "heart.text.square.fill", tint: red,
                                title: urgent.count == 1 ? "1 urgent care signal" : "\(urgent.count) urgent care signals",
                                detail: "\(first.memberName) — \(first.summary)",
                                count: urgent.count, dest: .flockBrief))
        }
        if let r = reviews, !r.isEmpty {
            let oldestDays = r.compactMap { parseISO($0.createdAt) }.min()
                .map { max(0, Calendar.current.dateComponents([.day], from: $0, to: Date()).day ?? 0) }
            let detail = oldestDays.map { $0 == 0 ? "passed the exam today — usher them in" : "oldest has waited \($0)d for an usher" }
                ?? "passed the exam, awaiting usher"
            rows.append(NeedRow(id: "usher", icon: "checkmark.seal.fill", tint: orange,
                                title: r.count == 1 ? "1 member awaiting ushering" : "\(r.count) members awaiting ushering",
                                detail: detail, count: r.count, dest: .levelReviews))
        }
        if let o = overview, o.pendingReviews > 0 {
            let detail = o.reviewsOverdue > 0 ? "\(o.reviewsOverdue) already overdue past 3 days" : "waiting on a shepherd's eye"
            rows.append(NeedRow(id: "reflections", icon: "text.bubble.fill", tint: orange,
                                title: o.pendingReviews == 1 ? "1 reflection to review" : "\(o.pendingReviews) reflections to review",
                                detail: detail, count: o.pendingReviews, dest: .reflectionQueue))
        }
        let watch = watchSignals
        if let first = watch.first {
            rows.append(NeedRow(id: "watch", icon: "eye.fill", tint: yellow,
                                title: watch.count == 1 ? "1 watch signal" : "\(watch.count) watch signals",
                                detail: "\(first.memberName) — \(first.summary)",
                                count: watch.count, dest: .flockBrief))
        }
        if let s = stuckMedia, s > 0 {
            rows.append(NeedRow(id: "media", icon: "film.stack", tint: yellow,
                                title: s == 1 ? "1 video stuck encoding" : "\(s) videos stuck encoding",
                                detail: "queued in the media pipeline", count: s, dest: .videoLibrary))
        }
        if let o = overview, o.membersAtRisk > 0 {
            rows.append(NeedRow(id: "atrisk", icon: "exclamationmark.triangle.fill", tint: yellow,
                                title: o.membersAtRisk == 1 ? "1 member at risk" : "\(o.membersAtRisk) members at risk",
                                detail: "low attendance + missed reflections", count: o.membersAtRisk, dest: .cellEngagement))
        }
        if let c = consents, c > 0 {
            rows.append(NeedRow(id: "consents", icon: "figure.and.child.holdinghands", tint: yellow,
                                title: c == 1 ? "1 guardian consent to renew" : "\(c) guardian consents to renew",
                                detail: "minors whose consent is expiring", count: c, dest: .members))
        }
        return rows
    }
}

// MARK: - Page

struct DashboardView: View {
    @StateObject private var vm = DashboardViewModel()
    @EnvironmentObject private var router: NavRouter
    /// Measured content width — drives the desk breakpoints on Mac AND wide iPad.
    @State private var width: CGFloat = 0

    private enum DeskMode { case threeLane, twoLane, stacked }
    private var mode: DeskMode {
        // width 0 = the single pre-measurement frame; the Mac window defaults
        // wide, so start from the wide layout there and stacked elsewhere.
        if width == 0 { return MacDesign.isMac ? .threeLane : .stacked }
        if width >= 1440 { return .threeLane }
        if width >= 1100 { return .twoLane }
        return .stacked
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                heroBlock
                VStack(alignment: .leading, spacing: 18) {
                    LiveNowStrip(vm: vm)
                    zones
                }
                .padding(.horizontal, MacDesign.isMac ? 0 : 20)
                .measureWidth($width)
            }
            .padding(.bottom, 40)
            // Workspace page: fill the window (margins only) — the pulse composes
            // in lanes and takes the width, not a readable text column.
            .macContentColumn(MacDesign.workspaceMaxWidth)
        }
        .background(Nuru.paper)
        .navigationTitle("Dashboard")
        .navigationBarTitleDisplayMode(.inline)
        .task { if !vm.startedOnce { await vm.load() } }
        .refreshable { await vm.load() }
    }

    /// Zones 3–6 in the responsive composition:
    ///   threeLane — NEEDS YOU | FLOCK + WORD | ACTIVITY + EVENTS
    ///   twoLane   — NEEDS YOU + FLOCK (52%) | WORD + ACTIVITY + EVENTS
    ///   stacked   — one clean column, action queue first
    @ViewBuilder private var zones: some View {
        switch mode {
        case .threeLane:
            MacDashLanes {
                NeedsYouCard(vm: vm)
            } pulse: {
                FlockCard(vm: vm)
                WordPulseCard(vm: vm)
            } ahead: {
                ActivityCard(groups: vm.activity, loading: vm.loading)
                UpcomingCard(events: vm.upcoming, loading: vm.loading)
            }
        case .twoLane:
            MacLanes(split: 0.52) {
                NeedsYouCard(vm: vm)
                FlockCard(vm: vm)
            } secondary: {
                WordPulseCard(vm: vm)
                ActivityCard(groups: vm.activity, loading: vm.loading)
                UpcomingCard(events: vm.upcoming, loading: vm.loading)
            }
        case .stacked:
            NeedsYouCard(vm: vm)
            FlockCard(vm: vm)
            WordPulseCard(vm: vm)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 14, alignment: .top)], spacing: 14) {
                ActivityCard(groups: vm.activity, loading: vm.loading)
                UpcomingCard(events: vm.upcoming, loading: vm.loading)
            }
        }
    }

    /// The navy hero — full-bleed on iPad; on the Mac it floats inside the
    /// centered content column, so it gets card corners and top breathing room.
    @ViewBuilder private var heroBlock: some View {
        if MacDesign.isMac {
            hero
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
                .padding(.top, MacDesign.gutter)
        } else {
            hero
        }
    }

    // MARK: Hero (zone 1) — movement, not stock. Every number carries context.

    private var hero: some View {
        let o = vm.overview
        var stats: [HeroStat] = []
        stats.append(HeroStat(label: "Active this week",
                              value: o.map { "\($0.checkedInThisWeek)" } ?? "—",
                              hint: o.map { "of \($0.totalMembers) members checked in" } ?? "checked in"))
        if let d = vm.attendanceDelta {
            stats.append(HeroStat(label: "Attendance",
                                  value: "\(d.up ? "▲" : "▼") \(d.pct)%",
                                  hint: "check-ins vs prior week",
                                  tint: d.up ? Nuru.lumGreenHi : Nuru.lumRed))
        } else {
            stats.append(HeroStat(label: "Attendance", value: "—", hint: "needs two weeks of data"))
        }
        stats.append(HeroStat(label: "Reflections (wk.)",
                              value: o.map { "\($0.reflectionsThisWeek)" } ?? "—",
                              hint: o.map { "\($0.pendingReviews) awaiting review" } ?? "this week"))
        stats.append(HeroStat(label: "Active learners",
                              value: o.map { "\($0.activeLearners)" } ?? "—",
                              hint: o.map { "\($0.cohortsRunning) cohorts running" } ?? "on the pathway"))
        return PortalHero(breadcrumb: ["Nuru Pathway", "Dashboard"], title: vm.greeting, stats: stats) {
            HStack(spacing: 8) {
                HeroChip(label: todayLabel, icon: "sparkles", style: .tag)
                HeroChip(label: "Review queue", icon: "checklist", style: .ghost) { router.go(.reflectionQueue) }
                HeroChip(label: "Curriculum", icon: "book", style: .ghost) { router.go(.cms) }
                HeroChip(label: "Members", trailingIcon: "arrow.right", style: .gold) { router.go(.members) }
            }
        }
    }
}

// MARK: - Desktop lanes

/// Two top-aligned desktop lanes (~58/42 by default): heavy charts/tables in the
/// primary lane, feeds/lists in the secondary. The frozen kit's `MacColumns` sizes
/// itself with a GeometryReader, which collapses inside a vertical ScrollView —
/// this variant measures its width with `measureWidth` (background reader) instead,
/// so the lanes keep their natural content-driven heights on scrolling pages.
/// Shared by Dashboard and People Intelligence.
struct MacLanes<Primary: View, Secondary: View>: View {
    var split: CGFloat = 0.58
    @ViewBuilder var primary: () -> Primary
    @ViewBuilder var secondary: () -> Secondary
    @State private var width: CGFloat = 0

    var body: some View {
        HStack(alignment: .top, spacing: MacDesign.gutter) {
            VStack(alignment: .leading, spacing: MacDesign.gutter) { primary() }
                .frame(width: primaryWidth, alignment: .top)
            VStack(alignment: .leading, spacing: MacDesign.gutter) { secondary() }
                .frame(maxWidth: .infinity, alignment: .top)
        }
        .measureWidth($width)
    }

    /// nil until the first measurement lands — the lanes share the row evenly
    /// for that single frame, then settle on the split.
    private var primaryWidth: CGFloat? {
        width > 0 ? (width - MacDesign.gutter) * split : nil
    }
}

/// Three top-aligned lanes (needs 34 / pulse 36 / ahead 30). Hand-rolled HStack
/// measured with `measureWidth` (a GeometryReader wrapper would collapse inside
/// the vertical ScrollView), so each lane keeps its content-driven height.
private struct MacDashLanes<Needs: View, Pulse: View, Ahead: View>: View {
    var needsSplit: CGFloat = 0.34
    var pulseSplit: CGFloat = 0.36
    @ViewBuilder var needs: () -> Needs
    @ViewBuilder var pulse: () -> Pulse
    @ViewBuilder var ahead: () -> Ahead
    @State private var width: CGFloat = 0

    var body: some View {
        HStack(alignment: .top, spacing: MacDesign.gutter) {
            VStack(alignment: .leading, spacing: MacDesign.gutter) { needs() }
                .frame(width: laneWidth(needsSplit), alignment: .top)
            VStack(alignment: .leading, spacing: MacDesign.gutter) { pulse() }
                .frame(width: laneWidth(pulseSplit), alignment: .top)
            VStack(alignment: .leading, spacing: MacDesign.gutter) { ahead() }
                .frame(maxWidth: .infinity, alignment: .top)
        }
        .measureWidth($width)
    }

    private func laneWidth(_ split: CGFloat) -> CGFloat? {
        width > 0 ? (width - 2 * MacDesign.gutter) * split : nil
    }
}

// MARK: - Shared zone pieces

/// Sonar pulse dot — the strip's heartbeat. Static under Reduce Motion.
private struct PulseDot: View {
    var color: Color = Color(hex: 0xDC2626)
    var size: CGFloat = 8
    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        ZStack {
            Circle().fill(color.opacity(0.4))
                .frame(width: size * 2, height: size * 2)
                .scaleEffect(on ? 1.5 : 0.6)
                .opacity(on ? 0 : 0.9)
            Circle().fill(color).frame(width: size, height: size)
        }
        .frame(width: size * 2, height: size * 2)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.1).repeatForever(autoreverses: false)) { on = true }
        }
    }
}

/// A zone that failed to load: a quiet dash, never a broken page.
private struct QuietDash: View {
    var note: String? = nil
    var body: some View {
        HStack(spacing: 8) {
            Text("—").font(.nMono(16)).foregroundStyle(Nuru.ink300)
            if let note { Text(note).font(.nMicro).foregroundStyle(Nuru.ink400) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10)
    }
}

/// Shimmering placeholder lines while a zone loads.
private struct RedactedLines: View {
    var lines: Int = 3
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(0..<lines, id: \.self) { i in
                Skeleton(height: 12, width: i.isMultiple(of: 2) ? 190 : 130)
            }
        }
        .padding(.vertical, 4)
    }
}

/// Common shell for the LIVE NOW strip cards — equal height, card radius.
private extension View {
    func stripShell(bg: Color = Nuru.white, border: Color = Nuru.border) -> some View {
        self
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 98, alignment: .topLeading)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(border, lineWidth: 1))
            .nuruShadow()
    }
}

// MARK: - Zone 2 · LIVE NOW

private struct LiveNowStrip: View {
    @ObservedObject var vm: DashboardViewModel
    @EnvironmentObject private var router: NavRouter

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                PulseDot(color: vm.radio?.live != nil ? Color(hex: 0xDC2626) : Nuru.gold, size: 6)
                Text("LIVE NOW").font(.nOverline).tracking(1.8).foregroundStyle(Nuru.ink600)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 236), spacing: 12, alignment: .top)], spacing: 12) {
                RadioLiveCard(pulse: vm.radio, loading: vm.loading) { router.go(.radio) }
                NextEventCard(events: vm.upcoming, loading: vm.loading) { router.go(.events) }
                CareSignalsCard(urgent: vm.signals == nil ? nil : vm.urgentSignals, loading: vm.loading) { router.go(.flockBrief) }
            }
        }
    }
}

/// ● ON AIR when a program is live (title, listeners, now-playing, tap → Radio
/// Studio); otherwise the soonest scheduled broadcast with a countdown.
private struct RadioLiveCard: View {
    let pulse: RadioPulse?
    let loading: Bool
    let open: () -> Void

    var body: some View {
        if let pulse {
            if let live = pulse.live { onAir(live, pulse) } else { idle(pulse) }
        } else if loading {
            RedactedLines(lines: 3).stripShell()
        } else {
            VStack(alignment: .leading, spacing: 6) {
                overline("RADIO", icon: "dot.radiowaves.left.and.right")
                QuietDash(note: "radio unavailable")
            }
            .stripShell()
        }
    }

    private func onAir(_ live: RadioProgram, _ pulse: RadioPulse) -> some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    HStack(spacing: 6) {
                        PulseDot(color: .white, size: 6)
                        Text("ON AIR").font(.inter(10, .bold)).tracking(1).foregroundStyle(.white)
                    }
                    .padding(.horizontal, 10).frame(height: 24)
                    .background(Rs.liveGlow)
                    .clipShape(Capsule())
                    Spacer(minLength: 6)
                    if let l = pulse.listeners {
                        HStack(spacing: 4) {
                            Image(systemName: "headphones").font(.system(size: 10, weight: .semibold))
                            Text("\(l)").font(.nMono(13, .medium))
                                .contentTransition(.numericText())
                        }
                        .foregroundStyle(Nuru.goldGlow)
                        .accessibilityLabel("\(l) listening now")
                    }
                }
                Text(live.title).font(.inter(14, .bold)).foregroundStyle(.white).lineLimit(1)
                Text(pulse.nowPlaying.map { "♪ \($0)" } ?? "Live broadcast in progress")
                    .font(.nMicro).foregroundStyle(Nuru.onNavyDim).lineLimit(1)
            }
            .stripShell(bg: Nuru.navyCeremony, border: Color(hex: 0xDC2626).opacity(0.45))
            .contentShape(Rectangle())
        }
        .pressable()
        .hoverEffect(.lift)
        .accessibilityHint("Opens the Radio Studio")
    }

    private func idle(_ pulse: RadioPulse) -> some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 6) {
                overline("NEXT BROADCAST", icon: "dot.radiowaves.left.and.right")
                if let next = pulse.next, let at = pulse.nextAt {
                    Text(next.title).font(.inter(14, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    HStack(spacing: 6) {
                        Text(countdown(to: at)).font(.nMono(13, .medium)).foregroundStyle(Nuru.goldLo)
                        Text("· " + Fmt.date(next.scheduledAt, style: .dateTime.weekday(.abbreviated).hour().minute()))
                            .font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                } else {
                    Text("Nothing scheduled").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink600)
                    Text("Plan the next broadcast in Radio Studio").font(.nMicro).foregroundStyle(Nuru.ink400)
                }
            }
            .stripShell()
            .contentShape(Rectangle())
        }
        .pressable()
        .hoverEffect(.lift)
    }

    private func overline(_ t: String, icon: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.goldLo)
            Text(t).font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
        }
    }
}

/// Countdown to the next calendar event.
private struct NextEventCard: View {
    let events: [CalendarOccurrence]?
    let loading: Bool
    let open: () -> Void

    var body: some View {
        if let events {
            Button(action: open) {
                VStack(alignment: .leading, spacing: 6) {
                    header
                    if let (e, at) = nextEvent(events) {
                        Text(e.title).font(.inter(14, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        HStack(spacing: 6) {
                            Text(countdown(to: at)).font(.nMono(13, .medium)).foregroundStyle(Nuru.goldLo)
                            Text("· " + Fmt.date(e.startAt, style: .dateTime.weekday(.abbreviated).hour().minute())
                                 + (e.location.map { " · \($0)" } ?? ""))
                                .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                        }
                    } else {
                        Text("Nothing on the calendar").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink600)
                        Text("No events in the next 60 days").font(.nMicro).foregroundStyle(Nuru.ink400)
                    }
                }
                .stripShell()
                .contentShape(Rectangle())
            }
            .pressable()
            .hoverEffect(.lift)
        } else if loading {
            RedactedLines(lines: 3).stripShell()
        } else {
            VStack(alignment: .leading, spacing: 6) { header; QuietDash(note: "calendar unavailable") }.stripShell()
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "calendar").font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.goldLo)
            Text("NEXT EVENT").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
        }
    }

    private func nextEvent(_ events: [CalendarOccurrence]) -> (CalendarOccurrence, Date)? {
        let now = Date()
        return events
            .compactMap { e in parseISO(e.startAt).map { (e, $0) } }
            .filter { $0.1 > now }
            .min { $0.1 < $1.1 }
    }
}

/// Urgent care-signal badge → Flock Brief. Calm green when the flock is quiet.
private struct CareSignalsCard: View {
    let urgent: [PulseSignal]?     // nil = signals not loaded
    let loading: Bool
    let open: () -> Void

    var body: some View {
        if let urgent {
            Button(action: open) {
                VStack(alignment: .leading, spacing: 6) {
                    header
                    if let first = urgent.first {
                        HStack(spacing: 8) {
                            PulseDot(color: Nuru.danger, size: 6)
                            Text(urgent.count == 1 ? "1 urgent signal" : "\(urgent.count) urgent signals")
                                .font(.inter(14, .bold)).foregroundStyle(Nuru.danger)
                        }
                        Text("\(first.memberName) — \(first.summary)")
                            .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                    } else {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.shield.fill").font(.system(size: 13)).foregroundStyle(Nuru.success)
                            Text("Flock is quiet").font(.inter(14, .bold)).foregroundStyle(Nuru.success)
                        }
                        Text("No urgent care signals in 14 days").font(.nMicro).foregroundStyle(Nuru.ink400)
                    }
                }
                .stripShell(bg: urgent.isEmpty ? Nuru.white : Color(hex: 0xFDECEC),
                            border: urgent.isEmpty ? Nuru.border : Color(hex: 0xFECACA))
                .contentShape(Rectangle())
            }
            .pressable()
            .hoverEffect(.lift)
            .accessibilityHint("Opens the Flock Brief")
        } else if loading {
            RedactedLines(lines: 3).stripShell()
        } else {
            VStack(alignment: .leading, spacing: 6) { header; QuietDash(note: "signals unavailable") }.stripShell()
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "heart.text.square").font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.goldLo)
            Text("CARE SIGNALS").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
        }
    }
}

// MARK: - Zone 3 · NEEDS YOU

private struct NeedsYouCard: View {
    @ObservedObject var vm: DashboardViewModel
    @EnvironmentObject private var router: NavRouter

    var body: some View {
        let rows = vm.needs
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text("Needs you").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    if !rows.isEmpty {
                        Text("\(rows.count)")
                            .font(.nMono(12, .medium)).foregroundStyle(.white)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(Nuru.danger).clipShape(Capsule())
                            .accessibilityLabel("\(rows.count) queues need attention")
                    }
                    Spacer()
                    Image(systemName: "tray.full").font(.system(size: 13)).foregroundStyle(Nuru.ink400)
                }
                if vm.loading && !vm.needsReady {
                    RedactedLines(lines: 5)
                } else if rows.isEmpty && vm.needsReady {
                    allClear
                } else if rows.isEmpty {
                    QuietDash(note: "some queues couldn't be checked")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                            needRow(row)
                                .overlay(alignment: .top) {
                                    if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) }
                                }
                        }
                    }
                }
            }
        }
    }

    private var allClear: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Nuru.successBg)
                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Nuru.success)
            }
            .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text("Flock is tended").font(.inter(13, .bold)).foregroundStyle(Nuru.success)
                Text("Nothing needs you right now.").font(.nMicro).foregroundStyle(Nuru.ink600)
            }
        }
        .padding(.vertical, 10)
    }

    private func needRow(_ row: NeedRow) -> some View {
        Button { router.go(row.dest) } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(row.tint.opacity(0.12))
                    Image(systemName: row.icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(row.tint)
                }
                .frame(width: 34, height: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                    Text(row.detail).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                }
                Spacer(minLength: 8)
                Text("\(row.count)")
                    .font(.nMono(13, .medium)).foregroundStyle(row.tint)
                    .padding(.horizontal, 9).padding(.vertical, 3)
                    .background(row.tint.opacity(0.1)).clipShape(Capsule())
                Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(Nuru.ink300)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .pressable()
        .hoverEffect(.highlight)
    }
}

// MARK: - Zone 4 · THE FLOCK (band bar + attendance sparkline)

private let BANDS: [(key: String, name: String, color: Color)] = [
    ("thriving", "Thriving", Color(hex: 0x16A34A)),
    ("steady", "Steady", Color(hex: 0x1F3A6B)),
    ("watch", "Watch", Color(hex: 0xC89B3C)),
    ("at_risk", "At-risk", Color(hex: 0xDC2626)),
]

private struct FlockCard: View {
    @ObservedObject var vm: DashboardViewModel
    @EnvironmentObject private var router: NavRouter

    var body: some View {
        let total = (vm.bands ?? [:]).values.reduce(0, +)
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 6) {
                    Text("The Flock").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    if vm.bands != nil {
                        Text("· \(total) learners").font(.nCaption).foregroundStyle(Nuru.ink600)
                    }
                    Spacer()
                    Button { router.go(.cellEngagement) } label: {
                        HStack(spacing: 3) {
                            Text("Engagement").font(.inter(12, .semibold))
                            Image(systemName: "chevron.right").font(.system(size: 10))
                        }
                        .foregroundStyle(Nuru.goldLo)
                    }
                    .pressable()
                    .hoverEffect(.highlight)
                }
                if vm.bands == nil && vm.trend == nil {
                    if vm.loading { RedactedLines(lines: 4) } else { QuietDash(note: "engagement unavailable") }
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 20) {
                            bandBlock.frame(minWidth: 300, maxWidth: .infinity, alignment: .topLeading)
                            sparkBlock.frame(width: 216)
                        }
                        VStack(alignment: .leading, spacing: 16) {
                            bandBlock
                            sparkBlock
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var bandBlock: some View {
        if let bands = vm.bands {
            let total = bands.values.reduce(0, +)
            let slices = BANDS.map { (name: $0.name, value: bands[$0.key] ?? 0, color: $0.color) }
            VStack(alignment: .leading, spacing: 10) {
                // The stacked band bar — every band visible at a glance.
                GeometryReader { geo in
                    HStack(spacing: 0) {
                        if total == 0 {
                            Rectangle().fill(Nuru.mutedBg)
                        } else {
                            ForEach(slices.filter { $0.value > 0 }, id: \.name) { s in
                                Rectangle()
                                    .fill(s.color)
                                    .frame(width: geo.size.width * CGFloat(s.value) / CGFloat(total))
                            }
                        }
                    }
                }
                .frame(height: 20)
                .clipShape(Capsule())
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(slices.map { "\($0.name) \($0.value)" }.joined(separator: ", "))
                if total == 0 {
                    Text("No engagement data yet.").font(.nCaption).foregroundStyle(Nuru.ink600)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 128), spacing: 8, alignment: .leading)], spacing: 6) {
                        ForEach(slices, id: \.name) { s in
                            HStack(spacing: 6) {
                                Circle().fill(s.color).frame(width: 8, height: 8)
                                Text(s.name).font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                                Text("\(s.value) · \(total > 0 ? Int((Double(s.value) / Double(total) * 100).rounded()) : 0)%")
                                    .font(.nMono(11.5)).foregroundStyle(Nuru.ink600)
                            }
                        }
                    }
                }
            }
        } else {
            QuietDash(note: "bands unavailable")
        }
    }

    @ViewBuilder private var sparkBlock: some View {
        if let trend = vm.trend, !trend.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("ATTENDANCE · 8 WKS").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                Chart(Array(trend.enumerated()), id: \.element.id) { pair in
                    AreaMark(x: .value("Week", pair.offset), y: .value("Check-ins", pair.element.checkIns))
                        .interpolationMethod(.catmullRom)
                        .foregroundStyle(
                            LinearGradient(colors: [Nuru.gold.opacity(0.3), .clear], startPoint: .top, endPoint: .bottom))
                    LineMark(x: .value("Week", pair.offset), y: .value("Check-ins", pair.element.checkIns))
                        .interpolationMethod(.catmullRom)
                        .foregroundStyle(Nuru.gold)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .frame(height: 56)
                if let d = vm.attendanceDelta {
                    Text("\(d.up ? "▲" : "▼") \(d.pct)% vs prior week")
                        .font(.nMicro)
                        .foregroundStyle(d.up ? Nuru.success : Nuru.danger)
                } else {
                    Text("check-ins per week").font(.nMicro).foregroundStyle(Nuru.ink400)
                }
            }
        } else if vm.trend != nil {
            VStack(alignment: .leading, spacing: 6) {
                Text("ATTENDANCE · 8 WKS").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                Text("No attendance recorded yet.").font(.nCaption).foregroundStyle(Nuru.ink600)
            }
        } else {
            QuietDash(note: "attendance unavailable")
        }
    }
}

// MARK: - Zone 5 · PULSE OF THE WORD (each domain exactly once)

private struct WordPulseCard: View {
    @ObservedObject var vm: DashboardViewModel
    @EnvironmentObject private var router: NavRouter

    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 6) {
                    Image(systemName: "book.closed").font(.system(size: 13)).foregroundStyle(Nuru.navy)
                    Text("Pulse of the Word").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer()
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 168), spacing: 10, alignment: .top)], spacing: 10) {
                    WordTile(icon: "book.fill",
                             tint: Nuru.Tint(bg: Color(hex: 0xFDF5E5), fg: Color(hex: 0x8A6B1F)),
                             value: vm.overview.map { "\($0.modulesPublished)" },
                             loading: vm.loading,
                             label: "Modules published",
                             caption: vm.levels.map { "\($0.filter { $0.status == "in_review" }.count) levels in review" } ?? "curriculum") {
                        router.go(.cms)
                    }
                    broadcastTile
                    WordTile(icon: "list.bullet.rectangle.portrait",
                             tint: Nuru.Tint(bg: Color(hex: 0xE3EAF3), fg: Color(hex: 0x1D4E86)),
                             value: vm.plansLive.map { "\($0)" },
                             loading: vm.loading,
                             label: "Reading plans live",
                             caption: "walking members through the Word") {
                        router.go(.contentStudio)
                    }
                    WordTile(icon: "rosette",
                             tint: Nuru.Tint(bg: Color(hex: 0xE8F6EE), fg: Nuru.success),
                             value: vm.overview.map { "\($0.certificatesThisMonth)" },
                             loading: vm.loading,
                             label: "Certificates",
                             caption: "issued this month") {
                        router.go(.certificates)
                    }
                    // The ONLY finance mention on the dashboard.
                    WordTile(icon: "heart.circle",
                             tint: Nuru.Tint(bg: Color(hex: 0xFCEFD9), fg: Nuru.warning),
                             value: vm.giving.map { Fmt.money(minor: $0.monthMinor, currency: $0.currency) },
                             loading: vm.loading,
                             label: "Giving this month",
                             caption: vm.giving.map { "\($0.gifts) gifts across \($0.fundCount) funds" } ?? "generosity") {
                        router.go(.finance)
                    }
                }
            }
        }
    }

    /// Last broadcast + its peak listeners; falls back to the next scheduled one.
    private var broadcastTile: some View {
        let tint = Nuru.Tint(bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xA8281F))
        let value: String?
        let caption: String
        if let r = vm.radio {
            if let last = r.lastEnded {
                value = "\(last.peakListeners)"
                caption = "peak listeners · \(last.title)"
            } else if let next = r.next, let at = r.nextAt {
                value = countdown(to: at)
                caption = "next broadcast · \(next.title)"
            } else {
                value = "0"
                caption = "no broadcasts yet"
            }
        } else {
            value = nil
            caption = "radio"
        }
        return WordTile(icon: "dot.radiowaves.left.and.right", tint: tint,
                        value: value, loading: vm.loading,
                        label: "Broadcast", caption: caption) {
            router.go(.radio)
        }
    }
}

/// Compact stat tile — mono numeral, one-line caption, tap-through.
private struct WordTile: View {
    let icon: String
    let tint: Nuru.Tint
    let value: String?
    let loading: Bool
    let label: String
    let caption: String
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                TintedIcon(systemName: icon, color: tint.fg, size: 30)
                Text(value ?? (loading ? "888" : "—"))
                    .font(.nMono(19, .medium)).foregroundStyle(Nuru.navy)
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .contentTransition(.numericText())
                    .animation(.default, value: value)
                    .redacted(reason: value == nil && loading ? .placeholder : [])
                Text(label).font(.inter(12, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                Text(caption).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.bg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(tint.fg.opacity(0.16), lineWidth: 1))
        }
        .pressable()
        .hoverEffect(.lift)
        .accessibilityLabel(label)
        .accessibilityValue(value ?? "unavailable")
    }
}

// MARK: - Zone 6 · Recent activity (aggregated) + upcoming events

private struct ActivityCard: View {
    let groups: [ActivityGroup]?
    let loading: Bool
    @EnvironmentObject private var router: NavRouter

    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Recent activity").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer()
                    Button("View all") { router.go(.cellEngagement) }
                        .font(.inter(12, .semibold)).tint(Nuru.goldLo)
                }
                if let groups {
                    if groups.isEmpty {
                        Text("No recent activity recorded.").font(.nCaption).foregroundStyle(Nuru.ink600)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(groups.enumerated()), id: \.element.id) { i, g in
                                row(g)
                                    .overlay(alignment: .top) {
                                        if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) }
                                    }
                            }
                        }
                    }
                } else if loading {
                    RedactedLines(lines: 4)
                } else {
                    QuietDash(note: "audit feed unavailable")
                }
            }
        }
    }

    private func row(_ g: ActivityGroup) -> some View {
        let style = kindStyle(g.action)
        return HStack(spacing: 12) {
            TintedIcon(systemName: style.icon, color: style.color, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(title(g)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                Text(subtitle(g)).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(Fmt.relative(g.newestAt)).font(.nMicro).foregroundStyle(Nuru.ink600)
        }
        .padding(.vertical, 10)
    }

    private func humanize(_ a: String) -> String {
        let s = a.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " ")
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    /// "6 enrollment starts" for a burst, plain "Enrollment start" for one.
    private func title(_ g: ActivityGroup) -> String {
        let h = humanize(g.action)
        guard g.count > 1 else { return h }
        let lower = h.prefix(1).lowercased() + h.dropFirst()
        return "\(g.count) \(lower)\(lower.hasSuffix("s") ? "" : "s")"
    }

    private func subtitle(_ g: ActivityGroup) -> String {
        if let first = g.actors.first {
            return g.actors.count > 1 ? "\(first) +\(g.actors.count - 1) others" : first
        }
        return g.entity ?? "system"
    }

    /// Varied SF Symbols so the feed reads as a story, not one repeated glyph.
    private func kindStyle(_ action: String) -> (icon: String, color: Color) {
        let a = action.lowercased()
        if a.contains("enroll") { return ("person.badge.plus", Color(hex: 0x1D4E86)) }
        if a.contains("reflection") { return ("text.bubble", Color(hex: 0x8A6B1F)) }
        if a.contains("usher") || a.contains("advance") || a.contains("level") { return ("checkmark.seal", Nuru.success) }
        if a.contains("certificate") { return ("rosette", Nuru.success) }
        if a.contains("radio") || a.contains("broadcast") { return ("dot.radiowaves.left.and.right", Color(hex: 0xA8281F)) }
        if a.contains("media") || a.contains("video") { return ("play.rectangle", Color(hex: 0x5B2BB8)) }
        if a.contains("gift") || a.contains("donation") || a.contains("finance") { return ("heart", Nuru.warning) }
        if a.contains("login") || a.contains("auth") || a.contains("password") { return ("key", Nuru.ink600) }
        if a.contains("delete") || a.contains("remove") { return ("trash", Nuru.danger) }
        if a.contains("create") || a.contains("add") { return ("plus.circle", Color(hex: 0x166534)) }
        if a.contains("update") || a.contains("edit") || a.contains("patch") { return ("pencil", Color(hex: 0x1F3A6B)) }
        return ("sparkles", Nuru.ink600)
    }
}

private struct UpcomingCard: View {
    let events: [CalendarOccurrence]?
    let loading: Bool
    @EnvironmentObject private var router: NavRouter

    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Upcoming events").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer()
                    Button("Calendar") { router.go(.events) }
                        .font(.inter(12, .semibold)).tint(Nuru.goldLo)
                }
                if let events {
                    if events.isEmpty {
                        Text("No events scheduled in the next 60 days.").font(.nCaption).foregroundStyle(Nuru.ink600)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(events.prefix(4).enumerated()), id: \.element.id) { i, e in
                                HStack(spacing: 12) {
                                    VStack(spacing: 0) {
                                        Text(Fmt.date(e.startAt, style: .dateTime.weekday(.abbreviated)))
                                            .font(.inter(9, .bold)).foregroundStyle(Color(hex: 0x8A6B1F))
                                        Text(Fmt.date(e.startAt, style: .dateTime.day()))
                                            .font(.nMono(16, .medium)).foregroundStyle(Color(hex: 0x8A6B1F))
                                    }
                                    .frame(width: 46, height: 46)
                                    .background(Color(hex: 0xFDF5E5))
                                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(e.title).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                        Text(Fmt.date(e.startAt, style: .dateTime.hour().minute()) + (e.location.map { " · \($0)" } ?? ""))
                                            .font(.nMicro).foregroundStyle(Nuru.ink600)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Nuru.ink300)
                                }
                                .padding(.vertical, 10)
                                .overlay(alignment: .top) {
                                    if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) }
                                }
                            }
                        }
                    }
                } else if loading {
                    RedactedLines(lines: 3)
                } else {
                    QuietDash(note: "calendar unavailable")
                }
            }
        }
    }
}

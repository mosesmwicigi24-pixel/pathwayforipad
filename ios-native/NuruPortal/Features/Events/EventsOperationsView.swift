// Events Operations Center — the Events & Announcements hub, rebuilt to the
// canonical architecture (pathway docs/EVENTS_ARCHITECTURE.md §9):
//   · live hero with REAL insights (GET /admin/events/insights — the hard-coded
//     74%/23/12/5/48 row is gone; unavailable numbers render as "—", never fake),
//   · Month/Week/Agenda calendar with WINDOWED month fetching (per-month cache,
//     refetch on navigation, prefetch ±1 — the member CalendarView pattern; the
//     frozen now−1mo→+60d window is dead), jump-to-today and jump-to-date,
//   · instant search over the loaded window + GET /admin/events/search for the
//     archive,
//   · series rail from GET /admin/events/series (real next_at; falls back to
//     client-derived rows from loaded months until the server API ships),
//   · announcements grid with the §5 lifecycle (duplicate / archive / restore),
//   · moments. Desk-adaptive: MacDesign lanes on the Mac, stacked when narrow.
import SwiftUI

// MARK: - Navigation target

struct EvSeriesTarget: Identifiable, Hashable {
    let series: AdminSeriesRow
    let occurrence: EvOcc?
    var id: String { series.seriesId + (occurrence?.id ?? "") }
    static func == (l: EvSeriesTarget, r: EvSeriesTarget) -> Bool { l.id == r.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - Model

@MainActor
final class EventsOpsModel: ObservableObject {
    enum CalMode: String, CaseIterable { case month = "Month", week = "Week", agenda = "Agenda" }

    // Calendar — per-month cache, keyed "yyyy-MM". No fixed horizon anywhere.
    @Published var monthCache: [String: [EvOcc]] = [:]
    @Published var loadingMonths: Set<String> = []
    @Published var calendarError: String?
    @Published var anchor: Date
    @Published var mode: CalMode = .month
    @Published var selectedDay: String?

    // Zones (progressive: each loads and fails independently).
    @Published var insights: EventsInsights?
    @Published var insightsFailed = false
    @Published var seriesRows: [AdminSeriesRow] = []
    @Published var seriesDerived = false
    @Published var seriesLoaded = false
    @Published var announcements: [AnnouncementRow] = []
    @Published var announcementsLoaded = false
    @Published var announcementsError: String?
    @Published var archivedRows: [AnnouncementRow] = []
    @Published var moments: [EvMoment] = []

    // Search
    @Published var query = ""
    @Published var serverResults: EventsSearchResults?
    private var searchTask: Task<Void, Never>?

    let today = Date()
    private let cal = Calendar.current

    init() {
        anchor = EvDate.firstOfMonth(Date())
    }

    // MARK: Calendar windows

    func monthOccs(_ key: String) -> [EvOcc] { monthCache[key] ?? [] }
    var anchorKey: String { EvDate.monthKey(anchor) }

    /// All cached occurrences, chronological (agenda + search + series fallback).
    var allCached: [EvOcc] {
        monthCache.values.flatMap { $0 }.sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
    }
    var byDay: [String: [EvOcc]] {
        Dictionary(grouping: allCached, by: \.dayKey)
            .mapValues { $0.sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) } }
    }
    var todayOccs: [EvOcc] { byDay[EvDate.dayKey(today)] ?? [] }

    /// Fetch one month's window ([first, nextFirst)) into the cache. Refresh
    /// keeps the stale payload visible while the fresh one loads.
    func ensureMonth(_ month: Date, force: Bool = false) async {
        let key = EvDate.monthKey(month)
        if !force, monthCache[key] != nil { return }
        if loadingMonths.contains(key) { return }
        loadingMonths.insert(key)
        defer { loadingMonths.remove(key) }
        let first = EvDate.firstOfMonth(month)
        let next = cal.date(byAdding: .month, value: 1, to: first) ?? first
        do {
            let occ = try await PortalAPI.eventsWindow(fromISO: EvDate.iso.string(from: first),
                                                       toISO: EvDate.iso.string(from: next))
            monthCache[key] = occ.map(EvOcc.from)
            calendarError = nil
            if seriesDerived { deriveSeriesFromCache() }
        } catch {
            if monthCache[key] == nil { monthCache[key] = [] }
            calendarError = (error as? APIError)?.errorDescription ?? "Could not load the calendar."
        }
    }

    /// Load the visible month (fresh) and prefetch its neighbours — called on
    /// every month navigation, so the console never serves a rotted window.
    func loadVisibleWindow(force: Bool = true) async {
        await ensureMonth(anchor, force: force)
        let prev = cal.date(byAdding: .month, value: -1, to: anchor) ?? anchor
        let next = cal.date(byAdding: .month, value: 1, to: anchor) ?? anchor
        async let a: Void = ensureMonth(prev)
        async let b: Void = ensureMonth(next)
        _ = await (a, b)
    }

    func step(_ delta: Int) {
        let unit: Calendar.Component = mode == .week ? .weekOfYear : .month
        anchor = cal.date(byAdding: unit, value: delta, to: anchor) ?? anchor
        Task { await loadVisibleWindow() }
    }

    func goToday() {
        anchor = mode == .week ? today : EvDate.firstOfMonth(today)
        selectedDay = EvDate.dayKey(today)
        Task { await loadVisibleWindow() }
    }

    func jump(to date: Date) {
        anchor = mode == .week ? date : EvDate.firstOfMonth(date)
        selectedDay = EvDate.dayKey(date)
        Task { await loadVisibleWindow() }
    }

    // MARK: Zones

    func loadInsights() async {
        do {
            insights = try await PortalAPI.eventsInsights()
            insightsFailed = false
        } catch {
            insightsFailed = insights == nil
        }
    }

    func loadSeries() async {
        do {
            seriesRows = try await PortalAPI.adminSeriesList()
            seriesDerived = false
        } catch {
            // §3 admin series API not deployed yet → honest client-side fallback
            // from the loaded occurrence window (active series only).
            deriveSeriesFromCache()
            seriesDerived = true
        }
        seriesLoaded = true
    }

    func deriveSeriesFromCache() {
        var m: [String: AdminSeriesRow] = [:]
        let now = Date()
        for o in allCached where !o.seriesId.isEmpty {
            var row = m[o.seriesId] ?? {
                var r = AdminSeriesRow()
                r.seriesId = o.seriesId
                r.title = o.title
                r.category = o.category.apiKey
                r.location = o.location
                r.visibility = o.visibility
                r.status = o.status
                r.primaryImageUrl = o.imageUrl
                r.derived = true
                return r
            }()
            row.occurrenceCount = (row.occurrenceCount ?? 0) + 1
            if let d = o.date, d >= now {
                if row.nextAt == nil || o.startAt < row.nextAt! {
                    row.nextAt = o.startAt
                    row.nextOccurrenceId = o.id
                }
            }
            m[o.seriesId] = row
        }
        seriesRows = m.values.sorted { ($0.nextAt ?? "9999") < ($1.nextAt ?? "9999") }
    }

    func loadAnnouncements() async {
        do {
            announcements = try await PortalAPI.announcementsList()
            announcementsError = nil
        } catch {
            announcementsError = (error as? APIError)?.errorDescription ?? "Could not load announcements."
        }
        announcementsLoaded = true
        // Archived list is a §5 addition — quietly optional until deployed.
        archivedRows = ((try? await PortalAPI.announcementsList(archived: true)) ?? []).filter(\.isArchived)
    }

    func loadMoments() async {
        moments = (try? await PortalAPI.momentsList()) ?? []
    }

    func loadAll() async {
        async let cal: Void = loadVisibleWindow(force: true)
        async let ins: Void = loadInsights()
        async let ann: Void = loadAnnouncements()
        async let mom: Void = loadMoments()
        _ = await (cal, ins, ann, mom)
        await loadSeries()   // after the calendar so the derived fallback has data
    }

    func refreshAfterWrite() async {
        await loadVisibleWindow(force: true)
        async let s: Void = loadSeries()
        async let a: Void = loadAnnouncements()
        async let i: Void = loadInsights()
        _ = await (s, a, i)
    }

    // MARK: Search

    func queryChanged() {
        searchTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { serverResults = nil; return }
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            let results = try? await PortalAPI.eventsSearch(q)
            guard !Task.isCancelled else { return }
            self?.serverResults = results   // nil = archive search unavailable; local matches still show
        }
    }

    /// Instant matches over the loaded window (series + occurrences + announcements).
    func localMatches(_ q: String) -> (series: [AdminSeriesRow], occs: [EvOcc], anns: [AnnouncementRow]) {
        let needle = q.lowercased()
        func hit(_ parts: [String?]) -> Bool { parts.contains { $0?.lowercased().contains(needle) == true } }
        let s = seriesRows.filter { hit([$0.title, $0.location, $0.category]) }
        let o = allCached.filter { hit([$0.title, $0.location]) }.prefix(8)
        let a = announcements.filter { hit([$0.title, $0.body]) }.prefix(5)
        return (Array(s.prefix(6)), Array(o), Array(a))
    }

    /// The series row backing an occurrence (server row when known, else derived).
    func seriesRow(for occ: EvOcc) -> AdminSeriesRow {
        if let r = seriesRows.first(where: { $0.seriesId == occ.seriesId }) { return r }
        var r = AdminSeriesRow()
        r.seriesId = occ.seriesId
        r.title = occ.title
        r.category = occ.category.apiKey
        r.location = occ.location
        r.visibility = occ.visibility
        r.status = occ.status
        r.primaryImageUrl = occ.imageUrl
        r.derived = true
        return r
    }
}

// MARK: - View

struct EventsOperationsView: View {
    @StateObject private var model = EventsOpsModel()
    @State private var toast: ToastData?

    // Presentation
    @State private var openTarget: EvSeriesTarget?
    @State private var showCreateEvent = false
    @State private var showComposer = false
    @State private var composerEditing: AnnouncementRow?
    @State private var announcementDetail: AnnouncementRow?
    @State private var showPostMoment = false
    @State private var showJumpToDate = false
    @State private var jumpDate = Date()
    @State private var daySheetKey: String?
    @State private var annFilter = "all"
    @State private var deletingMomentId: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                VStack(alignment: .leading, spacing: 20) {
                    searchZone
                    insightsZone
                    if MacDesign.isMac {
                        HStack(alignment: .top, spacing: MacDesign.gutter) {
                            VStack(spacing: 20) { calendarCard; announcementsCard }
                                .frame(maxWidth: .infinity, alignment: .top)
                            VStack(spacing: 20) { seriesRail; momentsCard }
                                .frame(width: 440, alignment: .top)
                        }
                    } else {
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .top, spacing: 20) {
                                calendarCard.frame(maxWidth: .infinity)
                                seriesRail.frame(width: 380)
                            }
                            VStack(spacing: 20) { calendarCard; seriesRail }
                        }
                        announcementsCard
                        momentsCard
                    }
                    Text("Nuru Events Operations Center · All times in East Africa Time (UTC+3)")
                        .font(.nMicro).foregroundStyle(Nuru.muted)
                        .frame(maxWidth: .infinity).padding(.top, 6)
                }
                .padding(24)
                .macContentColumn(MacDesign.workspaceMaxWidth)
            }
        }
        .background(Nuru.paper)
        .navigationTitle("Events")
        .navigationBarTitleDisplayMode(.inline)
        .toast($toast)
        .task { await model.loadAll() }
        .refreshable { await model.loadAll() }
        .navigationDestination(item: $openTarget) { t in
            EventCommandCenterView(seed: t.series, focus: t.occurrence,
                                   onChanged: { Task { await model.refreshAfterWrite() } })
        }
        .sheet(isPresented: $showCreateEvent) {
            EventEditorView(mode: .create,
                            onSaved: { msg in showCreateEvent = false; toast = .success(msg); Task { await model.refreshAfterWrite() } },
                            onError: { msg in toast = .error(msg) })
        }
        .sheet(isPresented: $showComposer) {
            AnnouncementComposerView(editing: composerEditing,
                                     seriesOptions: model.seriesRows,
                                     occurrenceOptions: upcomingOccs,
                                     onSaved: { msg in showComposer = false; composerEditing = nil; toast = .success(msg); Task { await model.loadAnnouncements() } },
                                     onError: { msg in toast = .error(msg) })
        }
        .sheet(item: $announcementDetail) { a in
            AnnouncementDetailSheet(item: a,
                onEdit: { row in announcementDetail = nil; composerEditing = row; showComposer = true },
                onChanged: { msg in announcementDetail = nil; toast = .success(msg); Task { await model.loadAnnouncements() } },
                onError: { msg in toast = .error(msg) })
        }
        .sheet(isPresented: $showPostMoment) {
            EvPostMomentSheet(onPosted: { showPostMoment = false; toast = .success("Moment posted."); Task { await model.loadMoments() } },
                              onError: { msg in toast = .error(msg) })
        }
        .sheet(isPresented: $showJumpToDate) { jumpToDateSheet }
        .sheet(item: dayBinding) { day in
            EvDaySheet(dayKey: day.key, events: model.byDay[day.key] ?? []) { occ in
                daySheetKey = nil
                openTarget = EvSeriesTarget(series: model.seriesRow(for: occ), occurrence: occ)
            }
        }
    }

    private var upcomingOccs: [EvOcc] {
        model.allCached.filter { ($0.date ?? .distantPast) >= Date() }
    }

    private struct DayKeyBox: Identifiable { let key: String; var id: String { key } }
    private var dayBinding: Binding<DayKeyBox?> {
        Binding(get: { daySheetKey.map { DayKeyBox(key: $0) } }, set: { daySheetKey = $0?.key })
    }

    // MARK: Hero — real numbers only

    private var hero: some View {
        let ins = model.insights
        func v(_ n: Int?) -> String { n.map(String.init) ?? "—" }
        return PortalHero(
            breadcrumb: ["Operations", "Events & Announcements"],
            title: "Events",
            subtitle: "Calendar, RSVP, live QR attendance, series, and announcements.",
            stats: [
                HeroStat(label: "Today", value: "\(model.todayOccs.count)", hint: todayHint),
                HeroStat(label: "RSVP → attended", value: ins?.conversionPct.map { "\($0)%" } ?? "—", hint: "recent occurrences"),
                HeroStat(label: "First-time guests", value: v(ins?.firstTimeGuests30d), hint: "last 30 days"),
                HeroStat(label: "Needs follow-up", value: v(ins?.rsvpNoShow), hint: "RSVP'd, absent"),
            ]
        ) {
            HStack(spacing: 8) {
                HeroChip(label: "EAT timezone", icon: "clock", style: .tag)
                HeroChip(label: "Announcement", icon: "bell", style: .ghost) { composerEditing = nil; showComposer = true }
                HeroChip(label: "Create event", icon: "plus", style: .gold) { showCreateEvent = true }
            }
        }
    }
    private var todayHint: String {
        model.insightsFailed ? "live insights unavailable" : "on the calendar"
    }

    // MARK: Search zone

    @ViewBuilder
    private var searchZone: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Nuru.muted).font(.system(size: 14))
                TextField("Search events, series, announcements…", text: $model.query)
                    .textFieldStyle(.plain).font(.inter(14, .regular))
                    .onChange(of: model.query) { _, _ in model.queryChanged() }
                if !model.query.isEmpty {
                    Button { model.query = ""; model.serverResults = nil } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Nuru.ink300)
                    }.pressable()
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))

            let q = model.query.trimmingCharacters(in: .whitespaces)
            if q.count >= 2 { searchResults(q) }
        }
    }

    private func searchResults(_ q: String) -> some View {
        let local = model.localMatches(q)
        let server = model.serverResults
        // Merge: server rows extend the local window (archive coverage).
        var series = local.series
        for s in server?.series ?? [] where !series.contains(where: { $0.seriesId == s.seriesId }) { series.append(s) }
        var occs = local.occs
        for o in (server?.occurrences ?? []).map(EvOcc.from) where !occs.contains(where: { $0.id == o.id }) { occs.append(o) }
        var anns = local.anns
        for a in server?.announcements ?? [] where !anns.contains(where: { $0.announcementId == a.announcementId }) { anns.append(a) }

        return Card {
            VStack(alignment: .leading, spacing: 12) {
                if series.isEmpty && occs.isEmpty && anns.isEmpty {
                    Text("No matches for \"\(q)\"" + (server == nil ? " in the loaded window (archive search needs the updated server)." : "."))
                        .font(.nCaption).foregroundStyle(Nuru.muted)
                } else {
                    if !series.isEmpty {
                        Text("SERIES").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                        ForEach(series.prefix(5)) { s in
                            Button { openTarget = EvSeriesTarget(series: s, occurrence: nil) } label: {
                                searchRow(icon: "repeat", title: s.title,
                                          sub: [s.cadence, s.nextAt.map { "next \(EvDate.short($0))" }].compactMap { $0 }.joined(separator: " · "))
                            }.pressable()
                        }
                    }
                    if !occs.isEmpty {
                        Text("OCCURRENCES").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                        ForEach(occs.prefix(6)) { o in
                            Button { openTarget = EvSeriesTarget(series: model.seriesRow(for: o), occurrence: o) } label: {
                                searchRow(icon: "calendar", title: o.title, sub: "\(o.dateLong) · \(o.timeShort) · \(o.location)")
                            }.pressable()
                        }
                    }
                    if !anns.isEmpty {
                        Text("ANNOUNCEMENTS").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                        ForEach(anns.prefix(5)) { a in
                            Button { announcementDetail = a } label: {
                                searchRow(icon: "bell", title: a.title, sub: evAnnouncementStatusLabel(a))
                            }.pressable()
                        }
                    }
                }
            }
        }
    }

    private func searchRow(icon: String, title: String, sub: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.gold)
                .frame(width: 28, height: 28).background(Nuru.gold.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink).lineLimit(1)
                Text(sub).font(.nMicro).foregroundStyle(Nuru.muted).lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(Nuru.ink300)
        }
        .padding(.vertical, 6).contentShape(Rectangle())
    }

    // MARK: Insights zone (server truth or an honest gap — never invented)

    @ViewBuilder
    private var insightsZone: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                evCardHeader("Insights", "Live patterns from GET /admin/events/insights")
                if let ins = model.insights {
                    let cols = Array(repeating: GridItem(.flexible(), spacing: 10), count: MacDesign.isMac ? 6 : 3)
                    LazyVGrid(columns: cols, alignment: .leading, spacing: 10) {
                        insightTile("RSVP conversion", ins.conversionPct.map { "\($0)%" }, "RSVP → attended", "chart.line.uptrend.xyaxis", Color(hex: 0x15803D))
                        insightTile("First-time guests", ins.firstTimeGuests30d.map(String.init), "last 30 days", "person.badge.plus", Color(hex: 0x15803D))
                        insightTile("Manual check-ins", ins.manualCheckins7d.map(String.init), "last 7 days", "checkmark.shield", Color(hex: 0xA87616))
                        insightTile("RSVP'd, absent", ins.rsvpNoShow.map(String.init), "latest occurrences", "exclamationmark.circle", Color(hex: 0xB91C1C))
                        insightTile("No response", ins.noResponse.map(String.init), "members", "person.2", Color(hex: 0x6B7280))
                        insightTile("Low-RSVP events", "\(ins.lowRsvp.count)", "upcoming", "chart.line.downtrend.xyaxis", Color(hex: 0xB91C1C))
                    }
                    if !ins.lowRsvp.isEmpty {
                        EvFlexRow(spacing: 6) {
                            ForEach(ins.lowRsvp.prefix(4)) { e in
                                Text("\(e.title) · \(e.going.map(String.init) ?? "0") going")
                                    .font(.nMicro).foregroundStyle(Color(hex: 0x9A3412))
                                    .padding(.horizontal, 9).padding(.vertical, 4)
                                    .background(Color(hex: 0xFFE6D2)).clipShape(Capsule())
                            }
                        }
                    }
                } else if model.insightsFailed {
                    evEmptyZone(icon: "chart.bar",
                                title: "Live insights unavailable",
                                body: "The insights endpoint isn't reachable yet. Nothing is estimated — numbers appear when the server provides them.")
                } else {
                    SkeletonGrid(tiles: MacDesign.isMac ? 6 : 3, columns: MacDesign.isMac ? 6 : 3)
                }
            }
        }
    }

    private func insightTile(_ label: String, _ value: String?, _ hint: String, _ icon: String, _ tint: Color) -> some View {
        SurfaceTile(padding: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: icon).font(.system(size: 13)).foregroundStyle(tint)
                    .frame(width: 30, height: 30)
                    .background(tint.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                Text(value ?? "—").font(.fraunces(20, .medium)).foregroundStyle(Nuru.ink)
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(label.uppercased()).font(.nOverline).tracking(0.4).foregroundStyle(Nuru.muted)
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(hint).font(.nMicro).foregroundStyle(Nuru.muted).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Calendar card

    private var monthLabel: String { model.anchor.formatted(.dateTime.month(.wide).year()) }

    private var calendarCard: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(model.mode == .week ? weekLabel : monthLabel)
                        .font(.fraunces(22, .medium)).foregroundStyle(Nuru.ink)
                        .lineLimit(1).minimumScaleFactor(0.7)
                    if model.loadingMonths.contains(model.anchorKey) { ProgressView().controlSize(.mini) }
                    HStack(spacing: 4) {
                        navButton("chevron.left") { model.step(-1) }
                        navButton("chevron.right") { model.step(1) }
                        Button { model.goToday() } label: {
                            Text("Today").font(.inter(12, .semibold)).foregroundStyle(Nuru.ink)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                        }.pressable()
                        navButton("calendar.badge.clock") { jumpDate = model.anchor; showJumpToDate = true }
                    }
                    Spacer()
                    HStack(spacing: 2) {
                        ForEach(EventsOpsModel.CalMode.allCases, id: \.self) { v in
                            Button { model.mode = v } label: {
                                Text(v.rawValue).font(.inter(12, model.mode == v ? .bold : .medium)).foregroundStyle(Nuru.ink)
                                    .padding(.horizontal, 12).padding(.vertical, 6)
                                    .background(model.mode == v ? Nuru.white : .clear)
                                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                            }.pressable()
                        }
                    }
                    .padding(3).background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                }
                .padding(20)
                Divider().overlay(Nuru.border)

                VStack(alignment: .leading, spacing: 16) {
                    if let e = model.calendarError { Text(e).font(.nCaption).foregroundStyle(Nuru.danger) }
                    switch model.mode {
                    case .month: monthGrid
                    case .week: weekStrip
                    case .agenda: agendaList
                    }
                    Divider().overlay(Nuru.border)
                    legend
                }
                .padding(20)
            }
        }
    }

    private var weekLabel: String {
        let cal = Calendar.current
        let start = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: model.anchor)) ?? model.anchor
        let end = cal.date(byAdding: .day, value: 6, to: start) ?? start
        return "\(start.formatted(.dateTime.day().month(.abbreviated))) – \(end.formatted(.dateTime.day().month(.abbreviated).year()))"
    }

    private func navButton(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(Nuru.ink)
                .padding(8).background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        }.pressable()
    }

    private var monthGrid: some View {
        let cal = Calendar.current
        let first = EvDate.firstOfMonth(model.anchor)
        let firstWeekday = cal.component(.weekday, from: first) - 1
        let days = cal.range(of: .day, in: .month, for: first)?.count ?? 30
        var cells: [Date?] = Array(repeating: nil, count: firstWeekday)
        for d in 1...days { cells.append(cal.date(byAdding: .day, value: d - 1, to: first)) }
        while cells.count % 7 != 0 { cells.append(nil) }
        let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        let todayKey = EvDate.dayKey(model.today)
        return VStack(spacing: 6) {
            HStack(spacing: 4) {
                ForEach(["SUN","MON","TUE","WED","THU","FRI","SAT"], id: \.self) {
                    Text($0).font(.system(size: 10, weight: .bold)).tracking(0.8).foregroundStyle(Nuru.muted)
                        .frame(maxWidth: .infinity)
                }
            }
            LazyVGrid(columns: cols, spacing: 4) {
                ForEach(Array(cells.enumerated()), id: \.offset) { _, date in
                    if let date {
                        let key = EvDate.dayKey(date)
                        monthCell(date: date, key: key, isToday: key == todayKey, isSel: key == model.selectedDay)
                    } else { Color.clear.frame(minHeight: 92) }
                }
            }
        }
    }

    private func monthCell(date: Date, key: String, isToday: Bool, isSel: Bool) -> some View {
        let evs = model.byDay[key] ?? []
        let day = Calendar.current.component(.day, from: date)
        return Button { model.selectedDay = key; daySheetKey = key } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("\(day)").font(.inter(12, isToday || isSel ? .bold : .semibold)).monospaced().foregroundStyle(Nuru.ink)
                    Spacer()
                    if !evs.isEmpty { Text("\(evs.count)").font(.system(size: 9)).monospaced().foregroundStyle(Nuru.muted) }
                }
                ForEach(evs.prefix(2)) { e in
                    Text("\(e.timeHourOnly) \(e.title)")
                        .font(.inter(10, .semibold)).lineLimit(1)
                        .foregroundStyle(e.category.color)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(e.category.soft).clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                }
                if evs.count > 2 { Text("+\(evs.count - 2) more").font(.system(size: 10)).foregroundStyle(Nuru.muted) }
                Spacer(minLength: 0)
            }
            .padding(8).frame(minHeight: 92, alignment: .topLeading)
            .frame(maxWidth: .infinity)
            .background(isSel ? Nuru.inputBg : isToday ? Color(hex: 0xFBF1DA) : Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous)
                .stroke(isSel ? Nuru.navy : isToday ? Nuru.gold : Nuru.border, lineWidth: 1))
        }.pressable().hoverEffect(.highlight)
    }

    private var weekStrip: some View {
        let cal = Calendar.current
        let weekStart = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: model.anchor)) ?? model.anchor
        let cols = Array(repeating: GridItem(.flexible(), spacing: 8), count: 7)
        return LazyVGrid(columns: cols, spacing: 8) {
            ForEach(0..<7, id: \.self) { i in
                let d = cal.date(byAdding: .day, value: i, to: weekStart) ?? weekStart
                let key = EvDate.dayKey(d)
                let evs = model.byDay[key] ?? []
                Button { model.selectedDay = key } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(d.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                            .font(.system(size: 10, weight: .bold)).tracking(0.5).foregroundStyle(Nuru.muted)
                        Text("\(cal.component(.day, from: d))").font(.inter(20, .bold)).monospaced().foregroundStyle(Nuru.ink)
                        ForEach(evs) { e in
                            Text("\(e.timeHourOnly) \(e.title)").font(.inter(10, .semibold)).lineLimit(1)
                                .foregroundStyle(e.category.color)
                                .padding(.horizontal, 5).padding(.vertical, 3)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(e.category.soft).clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                                .onTapGesture { openTarget = EvSeriesTarget(series: model.seriesRow(for: e), occurrence: e) }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12).frame(maxWidth: .infinity, minHeight: 200, alignment: .topLeading)
                    .background(key == model.selectedDay ? Nuru.inputBg : Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous)
                        .stroke(key == model.selectedDay ? Nuru.navy : Nuru.border, lineWidth: 1))
                }.pressable().hoverEffect(.highlight)
            }
        }
    }

    private var agendaList: some View {
        let occs = model.monthOccs(model.anchorKey)
            .sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
        return Group {
            if occs.isEmpty {
                evEmptyZone(icon: "calendar", title: "Nothing in \(monthLabel)",
                            body: "Use the arrows to browse other months — every month loads on demand.")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(occs.enumerated()), id: \.element.id) { i, o in
                        if i > 0 { Divider().overlay(Nuru.border) }
                        agendaRow(o)
                    }
                }
            }
        }
    }

    private func agendaRow(_ o: EvOcc) -> some View {
        Button { openTarget = EvSeriesTarget(series: model.seriesRow(for: o), occurrence: o) } label: {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 3).fill(o.category.color).frame(width: 4, height: 36)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(o.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink)
                        if o.status == "draft" { EvStatusBadge(status: "draft") }
                        if o.rescheduled { EvStatusBadge(status: "rescheduled") }
                    }
                    HStack(spacing: 6) {
                        Text(o.dateLong).monospaced(); Text("·"); Text(o.timeShort).monospaced()
                        Text("·"); Text(o.location)
                    }.font(.inter(11, .regular)).foregroundStyle(Nuru.muted).lineLimit(1)
                }
                Spacer()
                if o.going > 0 {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text("\(o.going)").font(.inter(14, .heavy)).monospaced().foregroundStyle(Color(hex: 0x0F6B33))
                        Text("GOING").font(.system(size: 9, weight: .bold)).tracking(0.4).foregroundStyle(Nuru.muted)
                    }
                }
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.ink300)
            }.padding(.vertical, 10).contentShape(Rectangle())
        }.pressable().hoverEffect(.highlight)
    }

    private var legend: some View {
        EvFlexRow(spacing: 18) {
            ForEach(EvCategory.allCases, id: \.self) { c in
                HStack(spacing: 8) {
                    Circle().fill(c.color).frame(width: 8, height: 8)
                    Text(c.label).font(.nCaption).foregroundStyle(Nuru.ink)
                }
            }
        }
    }

    private var jumpToDateSheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                DatePicker("Jump to", selection: $jumpDate, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .tint(Nuru.gold)
                GoldButton(title: "Go to \(jumpDate.formatted(.dateTime.day().month(.wide).year()))") {
                    showJumpToDate = false
                    model.jump(to: jumpDate)
                }
            }
            .padding(24)
            .background(Nuru.paper)
            .navigationTitle("Jump to date").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { showJumpToDate = false } } }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: Series rail (GET /admin/events/series — real next_at)

    private var seriesRail: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                evCardHeader("Event series", model.seriesDerived
                             ? "Derived from the loaded window — the series API extends this"
                             : "Every series with its real next occurrence")
                if !model.seriesLoaded {
                    SkeletonList(rows: 4)
                } else if model.seriesRows.isEmpty {
                    evEmptyZone(icon: "repeat", title: "No series yet",
                                body: "Create an event — one-off or recurring — and it appears here.")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(model.seriesRows.prefix(12).enumerated()), id: \.element.id) { i, s in
                            if i > 0 { Divider().overlay(Nuru.border) }
                            seriesRow(s)
                        }
                    }
                }
            }
        }
    }

    private func seriesRow(_ s: AdminSeriesRow) -> some View {
        let cat = EvCategory.resolve(wire: s.category, title: s.title, cellGroupId: s.cellGroupId)
        return Button { openTarget = EvSeriesTarget(series: s, occurrence: nil) } label: {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 3).fill(cat.color).frame(width: 4, height: 40)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(s.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink).lineLimit(1)
                        if s.isPaused { EvStatusBadge(status: "paused") }
                        else if s.status == "draft" { EvStatusBadge(status: "draft") }
                        if s.showOnHome { Image(systemName: "house.fill").font(.system(size: 9)).foregroundStyle(Nuru.gold) }
                        if s.isFeatured { Image(systemName: "star.fill").font(.system(size: 9)).foregroundStyle(Nuru.gold) }
                    }
                    HStack(spacing: 6) {
                        if let cad = s.cadence { Text(cad) }
                        else if let next = s.nextAt { Text("Next \(EvDate.short(next))").monospaced() }
                        else { Text("No upcoming occurrence") }
                        if let f = s.follows { Text("· \(f) following") }
                    }.font(.inter(11, .regular)).foregroundStyle(Nuru.muted).lineLimit(1)
                    if let cad = s.cadence, let next = s.nextAt, !cad.isEmpty {
                        Text("Next \(EvDate.short(next)) · \(EvDate.time(next))")
                            .font(.nMicro).monospaced().foregroundStyle(Nuru.muted)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    if let n = s.rsvpCount {
                        Text("\(n)").font(.inter(14, .heavy)).monospaced().foregroundStyle(Color(hex: 0x0F6B33))
                        Text("GOING").font(.system(size: 9, weight: .bold)).tracking(0.4).foregroundStyle(Nuru.muted)
                    }
                }
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.ink300)
            }.padding(.vertical, 10).contentShape(Rectangle())
        }.pressable().hoverEffect(.highlight)
    }

    // MARK: Announcements grid (§5 lifecycle)

    private var filteredAnnouncements: [AnnouncementRow] {
        switch annFilter {
        case "archived": return model.archivedRows
        case "all": return model.announcements
        default: return model.announcements.filter { $0.status == annFilter }
        }
    }

    private var announcementsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    evCardHeader("Announcements", "Compose, schedule, attach to events — with honest delivery stats")
                    Spacer()
                    Button { composerEditing = nil; showComposer = true } label: {
                        Label("New", systemImage: "plus").font(.inter(12, .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                    }.pressable()
                }
                EvFlexRow(spacing: 6) {
                    ForEach([("all", "All"), ("draft", "Drafts"), ("scheduled", "Scheduled"), ("sent", "Sent"), ("archived", "Archived")], id: \.0) { key, label in
                        let on = annFilter == key
                        Button { annFilter = key } label: {
                            Text(label).font(.inter(11.5, on ? .bold : .medium))
                                .foregroundStyle(on ? .white : Nuru.ink)
                                .padding(.horizontal, 11).padding(.vertical, 6)
                                .background(on ? Nuru.navy : Nuru.inputBg)
                                .clipShape(Capsule())
                        }.pressable()
                    }
                }
                if let e = model.announcementsError { Text(e).font(.nCaption).foregroundStyle(Nuru.danger) }
                if !model.announcementsLoaded {
                    SkeletonList(rows: 3)
                } else if filteredAnnouncements.isEmpty {
                    evEmptyZone(icon: "bell",
                                title: annFilter == "archived" ? "No archived announcements" : "Nothing here yet",
                                body: annFilter == "archived"
                                    ? "Archive keeps sent history out of the way without deleting it."
                                    : "Send updates, reminders, and event notices to the right audience.")
                } else {
                    let cols = [GridItem(.adaptive(minimum: MacDesign.isMac ? 320 : 240), spacing: 12)]
                    LazyVGrid(columns: cols, alignment: .leading, spacing: 12) {
                        ForEach(filteredAnnouncements) { a in announcementTile(a) }
                    }
                }
            }
        }
    }

    private func announcementTile(_ a: AnnouncementRow) -> some View {
        Button { announcementDetail = a } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    Text(a.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink).lineLimit(2)
                    Spacer()
                    EvStatusBadge(status: evAnnouncementStatusLabel(a))
                }
                EvFlexRow(spacing: 4) {
                    ForEach(a.channels, id: \.self) { c in
                        let dead = c == "sms" || c == "whatsapp"
                        Text(c).font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(dead ? Nuru.ink400 : Nuru.ink)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    if let att = a.attachmentLabel {
                        Text(att).font(.system(size: 10, weight: .bold)).foregroundStyle(Nuru.goldChipText)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(Nuru.goldChipBg).clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                }
                HStack {
                    Text("Audience: \(evAudienceLabel(a))").font(.nMicro).foregroundStyle(Nuru.muted)
                    Spacer()
                    Text(Fmt.date(a.sentAt ?? a.scheduledAt, style: .dateTime.day().month(.abbreviated).hour().minute()))
                        .font(.nMicro).monospaced().foregroundStyle(Nuru.muted)
                }
                if let d = a.deliveredCount {
                    Divider().overlay(Nuru.border)
                    HStack {
                        Text("Delivered \(d)").font(.nMicro).foregroundStyle(Nuru.muted)
                        Spacer()
                        if let o = a.openedCount { Text("\(o) opened").font(.inter(11, .bold)).foregroundStyle(Color(hex: 0x15803D)) }
                    }
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .pressable().hoverEffect(.lift)
        .contextMenu {
            Button { duplicate(a) } label: { Label("Duplicate", systemImage: "doc.on.doc") }
            if a.isArchived {
                Button { restore(a) } label: { Label("Restore", systemImage: "arrow.uturn.backward") }
            } else {
                Button { archive(a) } label: { Label("Archive", systemImage: "archivebox") }
            }
        }
    }

    private func duplicate(_ a: AnnouncementRow) {
        Task {
            do { _ = try await PortalAPI.duplicateAnnouncement(a.announcementId); toast = .success("Draft copy created."); await model.loadAnnouncements() }
            catch { toast = .error((error as? APIError)?.errorDescription ?? "Duplicate needs the updated server.") }
        }
    }
    private func archive(_ a: AnnouncementRow) {
        Task {
            do { try await PortalAPI.archiveAnnouncement(a.announcementId); toast = .success("Archived."); await model.loadAnnouncements() }
            catch { toast = .error((error as? APIError)?.errorDescription ?? "Archive needs the updated server.") }
        }
    }
    private func restore(_ a: AnnouncementRow) {
        Task {
            do { try await PortalAPI.restoreAnnouncement(a.announcementId); toast = .success("Restored."); await model.loadAnnouncements() }
            catch { toast = .error((error as? APIError)?.errorDescription ?? "Restore needs the updated server.") }
        }
    }

    // MARK: Moments

    private var momentsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    evCardHeader("Moments", "Curated photo gallery in the member Events tab")
                    Spacer()
                    Button { showPostMoment = true } label: {
                        Label("Post", systemImage: "plus").font(.inter(12, .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                    }.pressable()
                }
                if model.moments.isEmpty {
                    evEmptyZone(icon: "photo", title: "No moments yet",
                                body: "Post a photo from a recent gathering — it shows in the member carousel.")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(model.moments.enumerated()), id: \.element.id) { i, m in
                            if i > 0 { Divider().overlay(Nuru.border) }
                            momentRow(m)
                        }
                    }
                }
            }
        }
    }

    private func momentRow(_ m: EvMoment) -> some View {
        HStack(spacing: 12) {
            CachedAsyncImage(url: URL(string: m.imageUrl)) { img in img.resizable().scaledToFill() } placeholder: { Nuru.inputBg }
                .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(m.caption?.isEmpty == false ? m.caption! : "No caption")
                    .font(.nCaption).foregroundStyle(m.caption?.isEmpty == false ? Nuru.ink : Nuru.muted).lineLimit(1)
                if let tag = m.tag, !tag.isEmpty {
                    Text(tag).font(.system(size: 10, weight: .bold)).foregroundStyle(Nuru.ink)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
            }
            Spacer()
            Button { Task { await removeMoment(m.id) } } label: {
                Group {
                    if deletingMomentId == m.id { ProgressView().controlSize(.mini) }
                    else { Image(systemName: "trash").font(.system(size: 12)) }
                }
                .foregroundStyle(Color(hex: 0xB91C1C))
                .padding(8).frame(width: 30, height: 30)
                .background(Color(hex: 0xFEE2E2)).clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
            }.pressable().disabled(deletingMomentId == m.id)
        }.padding(.vertical, 12)
    }

    private func removeMoment(_ id: String) async {
        deletingMomentId = id
        defer { deletingMomentId = nil }
        do { try await PortalAPI.deleteMoment(id); await model.loadMoments(); toast = .success("Moment deleted.") }
        catch { toast = .error((error as? APIError)?.errorDescription ?? "Could not delete moment.") }
    }
}

// MARK: - Day sheet

struct EvDaySheet: View {
    let dayKey: String
    let events: [EvOcc]
    var onOpen: (EvOcc) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("\(events.count) events").font(.nCaption).monospaced().foregroundStyle(Nuru.muted)
                    if events.isEmpty {
                        Text("No events on this day.").font(.nCaption).foregroundStyle(Nuru.muted).padding(.vertical, 24)
                    } else {
                        ForEach(events) { o in
                            Button { onOpen(o) } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(o.timeShort).font(.inter(12, .bold)).monospaced().foregroundStyle(Nuru.ink)
                                        Spacer(); EvStatusBadge(status: o.rescheduled ? "rescheduled" : o.status)
                                    }
                                    Text(o.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink)
                                    Label(o.location, systemImage: "mappin.and.ellipse").font(.nMicro).foregroundStyle(Nuru.muted)
                                }
                                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                                .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                                .contentShape(Rectangle())
                            }.pressable().hoverEffect(.highlight)
                        }
                    }
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle(dayTitle).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
    private var dayTitle: String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]
        return f.date(from: dayKey).map { $0.formatted(.dateTime.weekday(.wide).day().month(.wide)) } ?? "Day schedule"
    }
}

// MARK: - Post Moment sheet

struct EvPostMomentSheet: View {
    var onPosted: () -> Void
    var onError: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var imageUrl = ""
    @State private var caption = ""
    @State private var tag = ""
    @State private var busy = false
    @State private var err: String?

    private func post() async {
        let url = imageUrl.trimmingCharacters(in: .whitespaces)
        guard !url.isEmpty else { err = "An image is required."; return }
        busy = true; defer { busy = false }
        do {
            try await PortalAPI.createMoment(imageUrl: url,
                                             caption: caption.trimmingCharacters(in: .whitespaces),
                                             tag: tag.trimmingCharacters(in: .whitespaces))
            onPosted()
        } catch {
            let m = (error as? APIError)?.errorDescription ?? "Could not post moment."
            err = m; onError(m)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ImageUploadField(label: "Image", folder: "moments", url: $imageUrl)
                    HStack(alignment: .top, spacing: 12) {
                        evFormField("Caption (optional)") {
                            TextField("A moment from Sunday…", text: $caption).textFieldStyle(.plain).font(.inter(15, .regular))
                        }
                        evFormField("Tag (optional)") {
                            TextField("e.g. Worship", text: $tag).textFieldStyle(.plain).font(.inter(15, .regular))
                        }
                    }
                    if !imageUrl.trimmingCharacters(in: .whitespaces).isEmpty {
                        CachedAsyncImage(url: URL(string: imageUrl.trimmingCharacters(in: .whitespaces))) { img in img.resizable().scaledToFill() } placeholder: { Nuru.inputBg }
                            .frame(height: 160).frame(maxWidth: .infinity).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                    }
                    if let err { Text(err).font(.nCaption).foregroundStyle(Nuru.danger) }
                }
                .padding(24)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .scrollContentBackground(.hidden)
            .navigationTitle("Post moment").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await post() } } label: {
                        Group { if busy { ProgressView() } else { Text("Post").bold() } }
                            .font(.inter(14, .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(busy ? AnyShapeStyle(Nuru.muted) : AnyShapeStyle(Nuru.goldGradient))
                            .clipShape(Capsule())
                    }.disabled(busy)
                }
            }
        }
        .presentationDetents([.large])
    }
}

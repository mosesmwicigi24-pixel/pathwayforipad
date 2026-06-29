// Events — Nuru Events Command Center, ported from the web admin make
// (packages/admin-web/src/components/pages/Events.tsx), tailored for the iPad.
//
// Faithful section-by-section port:
//   - Navy PortalHero with the "Operations › Events & Announcements" breadcrumb,
//     an EAT-timezone tag + Calendar / Announcement / Create-event chips, and the
//     4-stat KPI strip (Upcoming / Recent / Checked in / Announcements).
//   - The EAT/QR alert strip.
//   - Calendar card with Month / Week / List toggle, prev/next/today nav, a month
//     grid (category-coloured event chips), a week strip, and a flat list view,
//     plus the category legend.
//   - "Today's Ministry Flow" timeline panel.
//   - "Upcoming events" list (date chip + time + location + type) and
//     "Active event series" list (grouped by title; count + next date; Active pill).
//     Series pause/resume is server-authoritative on the web — here it is a styled
//     read view (NEEDS: pause/resume + per-occurrence reschedule/cancel writes).
//   - "Announcements" grid (status pill, channels, audience, when, delivered/opened)
//     and a "Live QR" panel (procedural QR placeholder + rotating secret).
//   - "Moments" curated gallery (read; NEEDS: post/delete).
//   - "Event insights" + "Follow-up queue" (display-only on the web too).
//   - "Recent attendance" table (real, last 8 weeks) + a Charts bar of recent
//     check-ins.
//
// Tapping a calendar/list/upcoming/today/series row opens an event detail sheet
// (date chip, time, location, visibility, roster counts, QR, and read-only action
// rows). Separate sheets browse the RSVP roster, the attendance roster, the QR
// screen, and an announcement detail. Create/edit event + announcement forms are
// represented as styled read sheets (NEEDS) — wiring is noted inline.
//
// DATA: reuses PortalAPI.calendar(from:to:) → [CalendarOccurrence]; everything
// else (rosters, RSVPs, recent attendance, announcements, moments) is decoded by
// page-local Codable structs via APIClient.shared.get (actor, convertFromSnakeCase),
// since the shared CalendarOccurrence model omits series_id/cell_group_id.
import SwiftUI
import Charts

// MARK: - Category derivation (no category column on the wire — infer from title)

private enum EventCategory: CaseIterable {
    case worship, klass, cell, leadership, youth, special
    var label: String {
        switch self {
        case .worship: "Worship"; case .klass: "Class"; case .cell: "Cell"
        case .leadership: "Leadership"; case .youth: "Youth"; case .special: "Special"
        }
    }
    var color: Color {
        switch self {
        case .worship: Color(hex: 0xC89B3C); case .klass: Color(hex: 0x0B1F33)
        case .cell: Color(hex: 0x16A34A); case .leadership: Color(hex: 0x6366F1)
        case .youth: Color(hex: 0x2563EB); case .special: Color(hex: 0xF97316)
        }
    }
    var soft: Color {
        switch self {
        case .worship: Color(hex: 0xFBF1DA); case .klass: Color(hex: 0xE1E6ED)
        case .cell: Color(hex: 0xDCF7E4); case .leadership: Color(hex: 0xE4E5FB)
        case .youth: Color(hex: 0xDBE7FE); case .special: Color(hex: 0xFFE6D2)
        }
    }
}

private func deriveCategory(title: String, cellGroupId: String?) -> EventCategory {
    let t = title.lowercased()
    func has(_ words: [String]) -> Bool { words.contains { t.contains($0) } }
    if has(["worship", "service", "prayer"]) { return .worship }
    if has(["class", "discipleship", "pathway", "lesson", "study"]) { return .klass }
    if has(["leader", "training", "sync"]) { return .leadership }
    if has(["youth", "teen", "ablaze", "fellowship"]) { return .youth }
    if has(["cell", "home group"]) || (cellGroupId != nil && !cellGroupId!.isEmpty) { return .cell }
    return .special
}

// MARK: - Page-local wire types (shared CalendarOccurrence omits series/cell ids)

/// /calendar row including the fields the page groups + reschedules on.
private struct EventOcc: Codable, Identifiable {
    @DefaultEmpty var occurrenceId: String
    @DefaultEmpty var seriesId: String
    @DefaultEmpty var title: String
    let location: String?
    @DefaultEmpty var visibility: String
    let cellGroupId: String?
    @DefaultEmpty var startAt: String
    @DefaultEmpty var endAt: String
    @DefaultEmpty var originalStartAt: String
    var id: String { occurrenceId }
}
private struct EventCalPage: Codable { let data: [EventOcc] }

private struct RecentEvent: Codable, Identifiable {
    @DefaultEmpty var eventId: String
    @DefaultEmpty var title: String
    @DefaultEmpty var occursAt: String
    @DefaultZero var checkedIn: Int
    @DefaultZero var rsvpGoing: Int
    var id: String { eventId }
}
private struct AttendanceFull: Codable {
    let recentEvents: [RecentEvent]?
}

private struct AnnouncementItem: Codable, Identifiable {
    @DefaultEmpty var announcementId: String
    @DefaultEmpty var title: String
    @DefaultEmpty var body: String
    let channels: [String]?
    @DefaultEmpty var audienceKind: String     // all | cells | level
    @DefaultEmpty var status: String           // draft | scheduled | sent | cancelled
    let scheduledAt: String?
    let sentAt: String?
    let deliveredCount: Int?
    let openedCount: Int?
    var id: String { announcementId }
}
private struct AnnouncementsPage: Codable { let data: [AnnouncementItem] }
private struct AnnouncementStat: Codable, Identifiable {
    @DefaultEmpty var channel: String
    @DefaultZero var targeted: Int
    @DefaultZero var delivered: Int
    @DefaultZero var opened: Int
    var id: String { channel }
}
private struct AnnouncementDetail: Codable {
    let stats: [AnnouncementStat]?
}

private struct MomentItem: Codable, Identifiable {
    @DefaultEmpty var momentId: String
    @DefaultEmpty var imageUrl: String
    let caption: String?
    let tag: String?
    var id: String { momentId }
}
private struct MomentsPage: Codable { let data: [MomentItem] }

private struct CheckIn: Codable, Identifiable {
    @DefaultEmpty var attendanceId: String
    @DefaultEmpty var fullName: String
    @DefaultEmpty var method: String
    @DefaultEmpty var checkedInAt: String
    var id: String { attendanceId }
}
private struct GuestRow: Codable, Identifiable {
    @DefaultEmpty var guestId: String
    @DefaultEmpty var guestName: String
    @DefaultFalse var firstTime: Bool
    @DefaultEmpty var createdAt: String
    var id: String { guestId }
}
private struct NoShowRow: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    var id: String { userId }
}
private struct Roster: Codable {
    let checkedIn: [CheckIn]?
    let guests: [GuestRow]?
    let rsvpNoShow: [NoShowRow]?
}

private struct RsvpRow: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    @DefaultEmpty var response: String
    let cellName: String?
    let respondedAt: String?
    var id: String { userId }
}
private struct RsvpBuckets: Codable {
    let going: [RsvpRow]?; let maybe: [RsvpRow]?
    let declined: [RsvpRow]?; let noResponse: [RsvpRow]?
}
private struct RsvpCounts: Codable {
    @DefaultZero var going: Int; @DefaultZero var maybe: Int
    @DefaultZero var declined: Int; @DefaultZero var noResponse: Int
}
private struct RsvpRosterData: Codable {
    let buckets: RsvpBuckets?
    let counts: RsvpCounts?
    @DefaultEmpty var noResponseScope: String   // "cell" | "none"
}

// MARK: - UI occurrence (mapped from EventOcc)

private struct UiOcc: Identifiable {
    let id: String
    let seriesId: String
    let title: String
    let category: EventCategory
    let date: Date?
    let location: String
    let visibility: String
    let endDate: Date?
    var iso: String { UiOcc.isoDay(date) }

    static func isoDay(_ d: Date?) -> String {
        guard let d else { return "" }
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
    var timeShort: String { date.map { $0.formatted(.dateTime.hour().minute()) } ?? "—" }
    var timeHourOnly: String { date.map { $0.formatted(.dateTime.hour()) } ?? "" }
    var dateLong: String { date.map { $0.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).year()) } ?? "—" }
    var endTime: String { endDate.map { $0.formatted(.dateTime.hour().minute()) } ?? "—" }
    var duration: String {
        guard let s = date, let e = endDate else { return "—" }
        let mins = Int(e.timeIntervalSince(s) / 60)
        guard mins > 0 else { return "—" }
        return "\(mins / 60)h \(String(format: "%02d", mins % 60))m"
    }

    static func from(_ o: EventOcc) -> UiOcc {
        let iso = ISO8601DateFormatter()
        let isoF = ISO8601DateFormatter(); isoF.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func parse(_ s: String) -> Date? { isoF.date(from: s) ?? iso.date(from: s) }
        return UiOcc(
            id: o.occurrenceId, seriesId: o.seriesId, title: o.title,
            category: deriveCategory(title: o.title, cellGroupId: o.cellGroupId),
            date: parse(o.startAt),
            location: (o.location?.isEmpty == false ? o.location! : "Location TBC"),
            visibility: o.visibility.isEmpty ? "members" : o.visibility,
            endDate: parse(o.endAt))
    }
}

private struct SeriesRow: Identifiable {
    let seriesId: String
    let title: String
    let category: EventCategory
    let count: Int
    let next: UiOcc
    var id: String { seriesId }
}

// MARK: - Status pill colours (web StatusPill map)

private func statusColors(_ status: String) -> (bg: Color, fg: Color) {
    switch status.lowercased() {
    case "scheduled": return (Color(hex: 0xE1E6ED), Color(hex: 0x0B1F33))
    case "live", "completed", "sent", "verified": return (Color(hex: 0xDCF7E4), Color(hex: 0x15803D))
    case "cancelled", "failed": return (Color(hex: 0xFEE2E2), Color(hex: 0xB91C1C))
    case "rescheduled", "late": return (Color(hex: 0xFFE6D2), Color(hex: 0x9A3412))
    case "manual": return (Color(hex: 0xFBF1DA), Color(hex: 0xA87616))
    case "guest": return (Color(hex: 0xDBE7FE), Color(hex: 0x1D4ED8))
    default: return (Color(hex: 0xEEF0F3), Color(hex: 0x6B7280))
    }
}

private struct StatusBadge: View {
    let status: String
    var body: some View {
        let c = statusColors(status)
        Text(status.uppercased()).font(.inter(10, .bold)).tracking(0.4)
            .foregroundStyle(c.fg)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(c.bg).clipShape(Capsule())
    }
}

private func announcementStatusLabel(_ s: String) -> String {
    switch s { case "scheduled": "Scheduled"; case "sent": "Sent"; case "cancelled": "Failed"; default: "Draft" }
}
private func audienceLabel(_ kind: String) -> String {
    switch kind { case "cells": "Specific cells"; case "level": "Specific level"; default: "All members" }
}

// MARK: - Main view

struct EventsView: View {
    @State private var events: [UiOcc] = []
    @State private var recent: [RecentEvent] = []
    @State private var announcements: [AnnouncementItem] = []
    @State private var moments: [MomentItem] = []
    @State private var error: String?

    @State private var view: CalView = .month
    @State private var anchor = Date()           // month/week anchor
    @State private var selectedIso = UiOcc.isoDay(Date())

    // Sheets
    @State private var detailOcc: UiOcc?
    @State private var dayIso: String?
    @State private var rsvpOcc: UiOcc?
    @State private var attendanceOcc: UiOcc?
    @State private var qrOcc: UiOcc?
    @State private var announcementSheet: AnnouncementItem?
    @State private var showCreateEvent = false
    @State private var showCreateAnnouncement = false

    // Roster caches (lazy)
    @State private var rosters: [String: Roster] = [:]
    @State private var rsvpRosters: [String: RsvpRosterData] = [:]
    @State private var qrTick = 0

    enum CalView: String, CaseIterable { case month = "Month", week = "Week", list = "List" }

    private let now = Date()

    // Derived

    private var byDay: [String: [UiOcc]] {
        Dictionary(grouping: events, by: \.iso).mapValues { $0.sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) } }
    }
    private var todayOccs: [UiOcc] { byDay[UiOcc.isoDay(now)] ?? [] }
    private var upcoming: [UiOcc] {
        events.filter { ($0.date ?? .distantPast) >= now }.sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }.prefix(6).map { $0 }
    }
    private var seriesRows: [SeriesRow] {
        var m: [String: SeriesRow] = [:]
        let future = events.filter { ($0.date ?? .distantPast) >= now }
        for o in (future.isEmpty ? events : future) {
            // Group by series; the shared model carries no series id reliably, so fall
            // back to title when seriesId is blank.
            let key = o.seriesId.isEmpty ? o.title : o.seriesId
            if let ex = m[key] {
                let next = (o.date ?? .distantFuture) < (ex.next.date ?? .distantFuture) ? o : ex.next
                m[key] = SeriesRow(seriesId: ex.seriesId, title: ex.title, category: ex.category, count: ex.count + 1, next: next)
            } else {
                m[key] = SeriesRow(seriesId: key, title: o.title, category: o.category, count: 1, next: o)
            }
        }
        return m.values.sorted { ($0.next.date ?? .distantFuture) < ($1.next.date ?? .distantFuture) }.prefix(6).map { $0 }
    }
    private var checkedThisWeek: Int { recent.reduce(0) { $0 + $1.checkedIn } }
    private var scheduledAnnouncements: Int { announcements.filter { $0.status == "scheduled" }.count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                hero
                if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }
                alertStrip

                // Calendar + Today panel
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 20) {
                        calendarCard.frame(maxWidth: .infinity)
                        todayPanel.frame(width: 360)
                    }
                    VStack(spacing: 20) { calendarCard; todayPanel }
                }

                // Upcoming + Series
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 20) {
                        upcomingCard.frame(maxWidth: .infinity)
                        seriesCard.frame(maxWidth: .infinity)
                    }
                    VStack(spacing: 20) { upcomingCard; seriesCard }
                }

                // Announcements + QR
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 20) {
                        announcementsCard.frame(maxWidth: .infinity)
                        qrCard.frame(width: 340)
                    }
                    VStack(spacing: 20) { announcementsCard; qrCard }
                }

                momentsCard

                // Insights + Follow-up
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 20) {
                        insightsCard.frame(maxWidth: .infinity)
                        followUpCard.frame(maxWidth: .infinity)
                    }
                    VStack(spacing: 20) { insightsCard; followUpCard }
                }

                if !recent.isEmpty { recentAttendanceCard }

                Text("Nuru Events Command Center · All times in East Africa Time (UTC+3)")
                    .font(.nMicro).foregroundStyle(Nuru.muted)
                    .frame(maxWidth: .infinity).padding(.top, 6)
            }
            .padding(24)
        }
        .background(Nuru.paper)
        .navigationTitle("Events")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $detailOcc) { o in EventDetailSheet(occ: o, roster: rosters[o.id],
            onQr: { detailOcc = nil; qrOcc = o },
            onAttendance: { detailOcc = nil; attendanceOcc = o },
            onRsvp: { detailOcc = nil; rsvpOcc = o })
            .task { await loadRoster(o.id) } }
        .sheet(item: dayBinding) { day in DaySheet(iso: day.iso, events: byDay[day.iso] ?? []) { o in dayIso = nil; detailOcc = o } }
        .sheet(item: $rsvpOcc) { o in RsvpSheet(occ: o, roster: rsvpRosters[o.id]).task { await loadRsvp(o.id) } }
        .sheet(item: $attendanceOcc) { o in AttendanceSheet(occ: o, roster: rosters[o.id]).task { await loadRoster(o.id) } }
        .sheet(item: $qrOcc) { o in QrSheet(occ: o, roster: rosters[o.id], tick: $qrTick).task { await loadRoster(o.id) } }
        .sheet(item: $announcementSheet) { a in AnnouncementSheet(item: a) }
        .sheet(isPresented: $showCreateEvent) { CreateEventSheet() }
        .sheet(isPresented: $showCreateAnnouncement) { CreateAnnouncementSheet() }
    }

    // Wrap dayIso (String?) in an Identifiable for .sheet(item:)
    private struct DayKey: Identifiable { let iso: String; var id: String { iso } }
    private var dayBinding: Binding<DayKey?> {
        Binding(get: { dayIso.map { DayKey(iso: $0) } }, set: { dayIso = $0?.iso })
    }

    // MARK: Hero

    private var hero: some View {
        PortalHero(
            breadcrumb: ["Operations", "Events & Announcements"],
            title: "Events",
            subtitle: "Calendar, RSVP, QR attendance, series, and announcements.",
            stats: [
                HeroStat(label: "Upcoming events", value: "\(upcoming.count)", hint: "\(todayOccs.count) today"),
                HeroStat(label: "Recent events", value: "\(recent.count)", hint: "last 8 weeks"),
                HeroStat(label: "Checked in", value: "\(checkedThisWeek)", hint: "QR verified"),
                HeroStat(label: "Announcements", value: "\(announcements.count)", hint: "\(scheduledAnnouncements) scheduled"),
            ]
        ) {
            HStack(spacing: 8) {
                HeroChip(label: "EAT timezone", icon: "checkmark.shield", style: .tag)
                HeroChip(label: "Announcement", icon: "bell", style: .ghost) { showCreateAnnouncement = true }
                HeroChip(label: "Create event", icon: "plus", style: .gold) { showCreateEvent = true }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.hero, style: .continuous))
        .nuruShadow()
    }

    private var alertStrip: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "checkmark.shield.fill").foregroundStyle(Color(hex: 0xA87616))
            VStack(alignment: .leading, spacing: 2) {
                Text("QR attendance is occurrence-based.").font(.inter(13, .bold)).foregroundStyle(Color(hex: 0x7A5410))
                Text("Each occurrence has its own rotating QR code. Secrets refresh every 30 seconds and expire one hour after the occurrence ends.")
                    .font(.nCaption).foregroundStyle(Color(hex: 0x7A5410)).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Color(hex: 0xFFFBEB))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Color(hex: 0xF5E0A8), lineWidth: 1))
    }

    // MARK: Calendar card

    private var monthLabel: String { anchor.formatted(.dateTime.month(.wide).year()) }

    private var calendarCard: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(view == .week ? "This week" : monthLabel).font(.fraunces(22, .medium)).foregroundStyle(Nuru.ink)
                    HStack(spacing: 4) {
                        navButton("chevron.left") { step(-1) }
                        navButton("chevron.right") { step(1) }
                        Button { anchor = now; selectedIso = UiOcc.isoDay(now) } label: {
                            Text("Today").font(.inter(12, .semibold)).foregroundStyle(Nuru.ink)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }.buttonStyle(.plain)
                    }
                    Spacer()
                    HStack(spacing: 2) {
                        ForEach(CalView.allCases, id: \.self) { v in
                            Button { view = v } label: {
                                Text(v.rawValue).font(.inter(12, view == v ? .bold : .medium)).foregroundStyle(Nuru.ink)
                                    .padding(.horizontal, 12).padding(.vertical, 6)
                                    .background(view == v ? Nuru.white : .clear)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            }.buttonStyle(.plain)
                        }
                    }
                    .padding(3).background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                }
                .padding(20)
                Divider().overlay(Nuru.border)

                VStack(alignment: .leading, spacing: 16) {
                    switch view {
                    case .month: monthGrid
                    case .week: weekStrip
                    case .list: listView
                    }
                    Divider().overlay(Nuru.border)
                    legend
                }
                .padding(20)
            }
        }
    }

    private func navButton(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(Nuru.ink)
                .padding(8).background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }.buttonStyle(.plain)
    }

    private func step(_ dir: Int) {
        let cal = Calendar.current
        anchor = cal.date(byAdding: view == .week ? .weekOfYear : .month, value: dir, to: anchor) ?? anchor
    }

    private var monthGrid: some View {
        let cal = Calendar.current
        let comps = cal.dateComponents([.year, .month], from: anchor)
        let first = cal.date(from: comps)!
        let firstWeekday = cal.component(.weekday, from: first) - 1   // 0=Sun
        let days = cal.range(of: .day, in: .month, for: first)!.count
        var cells: [Date?] = Array(repeating: nil, count: firstWeekday)
        for d in 1...days { cells.append(cal.date(byAdding: .day, value: d - 1, to: first)) }
        while cells.count % 7 != 0 { cells.append(nil) }
        let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        let todayIso = UiOcc.isoDay(now)
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
                        let iso = UiOcc.isoDay(date)
                        monthCell(date: date, iso: iso, isToday: iso == todayIso, isSel: iso == selectedIso)
                    } else { Color.clear.frame(minHeight: 92) }
                }
            }
        }
    }

    private func monthCell(date: Date, iso: String, isToday: Bool, isSel: Bool) -> some View {
        let evs = byDay[iso] ?? []
        let day = Calendar.current.component(.day, from: date)
        return Button { selectedIso = iso; dayIso = iso } label: {
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
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(isSel ? Nuru.navy : isToday ? Nuru.gold : Nuru.border, lineWidth: 1))
        }.buttonStyle(.plain)
    }

    private var weekStrip: some View {
        let cal = Calendar.current
        let weekStart = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: anchor)) ?? anchor
        let cols = Array(repeating: GridItem(.flexible(), spacing: 8), count: 7)
        return LazyVGrid(columns: cols, spacing: 8) {
            ForEach(0..<7, id: \.self) { i in
                let d = cal.date(byAdding: .day, value: i, to: weekStart)!
                let iso = UiOcc.isoDay(d)
                let evs = byDay[iso] ?? []
                Button { selectedIso = iso } label: {
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
                                .onTapGesture { detailOcc = e }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12).frame(maxWidth: .infinity, minHeight: 200, alignment: .topLeading)
                    .background(iso == selectedIso ? Nuru.inputBg : Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(iso == selectedIso ? Nuru.navy : Nuru.border, lineWidth: 1))
                }.buttonStyle(.plain)
            }
        }
    }

    private var listView: some View {
        let sorted = events.sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
        return Group {
            if sorted.isEmpty {
                emptyState(icon: "calendar", title: "No events scheduled",
                           body: "Create your first event to manage RSVP, reminders, and attendance.")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(sorted.enumerated()), id: \.element.id) { i, o in
                        if i > 0 { Divider().overlay(Nuru.border) }
                        Button { detailOcc = o } label: {
                            HStack(spacing: 12) {
                                RoundedRectangle(cornerRadius: 3).fill(o.category.color).frame(width: 4, height: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(o.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink)
                                    HStack(spacing: 6) {
                                        Text(o.dateLong).monospaced(); Text("·"); Text(o.timeShort).monospaced()
                                        Text("·"); Text(o.location)
                                    }.font(.inter(11, .regular)).foregroundStyle(Nuru.muted).lineLimit(1)
                                }
                                Spacer()
                                StatusBadge(status: "scheduled")
                                VStack(alignment: .trailing, spacing: 1) {
                                    Text(o.category.label).font(.inter(13, .bold)).monospaced().foregroundStyle(Nuru.ink)
                                    Text("Type").font(.system(size: 10)).foregroundStyle(Nuru.muted)
                                }.frame(width: 70)
                            }.padding(.vertical, 12).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var legend: some View {
        FlexRow(spacing: 18) {
            ForEach(EventCategory.allCases, id: \.self) { c in
                HStack(spacing: 8) {
                    Circle().fill(c.color).frame(width: 8, height: 8)
                    Text(c.label).font(.nCaption).foregroundStyle(Nuru.ink)
                }
            }
        }
    }

    // MARK: Today panel

    private var todayPanel: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("TODAY'S MINISTRY FLOW").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                    Text(now.formatted(.dateTime.weekday(.wide).day().month(.wide).year()))
                        .font(.fraunces(18, .medium)).foregroundStyle(Nuru.ink)
                    Text("\(todayOccs.count) events").font(.nCaption).monospaced().foregroundStyle(Nuru.muted)
                }.padding(20)
                Divider().overlay(Nuru.border)
                VStack(spacing: 12) {
                    if todayOccs.isEmpty {
                        emptyState(icon: "calendar", title: "Nothing scheduled today",
                                   body: "Scheduled events appear here as a timeline.")
                    } else {
                        ForEach(todayOccs) { o in todayRow(o) }
                    }
                }.padding(20)
            }
        }
    }

    private func todayRow(_ o: UiOcc) -> some View {
        Button { detailOcc = o } label: {
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 3).fill(o.category.color).frame(width: 4, height: 44)
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(o.timeShort).font(.inter(12, .bold)).monospaced().foregroundStyle(Nuru.ink)
                        Spacer()
                        StatusBadge(status: "scheduled")
                    }
                    Text(o.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink)
                    Label(o.location, systemImage: "mappin.and.ellipse").font(.nMicro).foregroundStyle(Nuru.muted)
                    HStack(spacing: 6) {
                        miniChip("Show QR", "qrcode") { qrOcc = o }
                        miniChip("Attendance", "person.2") { attendanceOcc = o }
                    }
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private func miniChip(_ label: String, _ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(label, systemImage: icon).font(.inter(10, .semibold)).foregroundStyle(Nuru.ink)
                .padding(.horizontal, 8).padding(.vertical, 5)
                .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }.buttonStyle(.plain)
    }

    // MARK: Upcoming + Series

    private var upcomingCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                cardHeader("Upcoming events", "Next scheduled occurrences across all series")
                if upcoming.isEmpty {
                    emptyState(icon: "calendar", title: "No events scheduled yet",
                               body: "Create your first event to begin managing RSVP, reminders, and attendance.")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(upcoming.enumerated()), id: \.element.id) { i, o in
                            if i > 0 { Divider().overlay(Nuru.border) }
                            upcomingRow(o)
                        }
                    }
                }
            }
        }
    }

    private func upcomingRow(_ o: UiOcc) -> some View {
        Button { detailOcc = o } label: {
            HStack(spacing: 12) {
                VStack(spacing: 0) {
                    Text((o.date ?? now).formatted(.dateTime.month(.abbreviated)).uppercased())
                        .font(.system(size: 9, weight: .bold)).tracking(0.4)
                    Text("\(Calendar.current.component(.day, from: o.date ?? now))")
                        .font(.inter(16, .heavy)).monospaced()
                }
                .foregroundStyle(o.category.color)
                .frame(width: 48, height: 48)
                .background(o.category.soft).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(o.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink)
                    HStack(spacing: 6) {
                        Text(o.timeShort).monospaced(); Text("·")
                        Label(o.location, systemImage: "mappin.and.ellipse")
                    }.font(.inter(11, .regular)).foregroundStyle(Nuru.muted).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text(o.category.label).font(.inter(12, .bold)).foregroundStyle(o.category.color)
                    Text("TYPE").font(.system(size: 10)).tracking(0.4).foregroundStyle(Nuru.muted)
                }
            }.padding(.vertical, 12).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private var seriesCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                cardHeader("Active event series", "\(seriesRows.count) recurring series running")
                if seriesRows.isEmpty {
                    emptyState(icon: "repeat", title: "No recurring series",
                               body: "Create a recurring event and its series shows up here.")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(seriesRows.enumerated()), id: \.element.id) { i, s in
                            if i > 0 { Divider().overlay(Nuru.border) }
                            seriesRowView(s)
                        }
                    }
                }
            }
        }
    }

    private func seriesRowView(_ s: SeriesRow) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 3).fill(s.category.color).frame(width: 4, height: 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(s.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink)
                    Text("ACTIVE").font(.system(size: 9, weight: .bold)).tracking(0.4)
                        .foregroundStyle(Color(hex: 0x15803D))
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Color(hex: 0xDCF7E4)).clipShape(Capsule())
                }
                HStack(spacing: 6) {
                    Label("\(s.count) upcoming", systemImage: "repeat"); Text("·")
                    Text(s.next.dateLong).monospaced()
                }.font(.inter(11, .regular)).foregroundStyle(Nuru.muted)
            }
            Spacer()
            Button { detailOcc = s.next } label: {
                Image(systemName: "eye").font(.system(size: 12)).foregroundStyle(Nuru.ink)
                    .padding(7).background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }.buttonStyle(.plain)
        }.padding(.vertical, 12)
    }

    // MARK: Announcements + QR

    private var announcementsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    cardHeader("Announcements", "Send updates, reminders, and ministry notices")
                    Spacer()
                    Button { showCreateAnnouncement = true } label: {
                        Label("New", systemImage: "plus").font(.inter(12, .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }.buttonStyle(.plain)
                }
                if announcements.isEmpty {
                    emptyState(icon: "bell", title: "No announcements yet",
                               body: "Send updates, reminders, and event notices to the right audience.")
                } else {
                    let cols = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
                    LazyVGrid(columns: cols, spacing: 12) {
                        ForEach(announcements) { a in announcementTile(a) }
                    }
                }
            }
        }
    }

    private func announcementTile(_ a: AnnouncementItem) -> some View {
        Button { announcementSheet = a } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    Text(a.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink).lineLimit(2)
                    Spacer()
                    StatusBadge(status: announcementStatusLabel(a.status))
                }
                if let ch = a.channels, !ch.isEmpty {
                    FlexRow(spacing: 4) {
                        ForEach(ch, id: \.self) { c in
                            Text(c).font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.ink)
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                    }
                }
                HStack {
                    Text("Audience: \(audienceLabel(a.audienceKind))").font(.nMicro).foregroundStyle(Nuru.muted)
                    Spacer()
                    Text(announcementWhen(a)).font(.nMicro).monospaced().foregroundStyle(Nuru.muted)
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
        }.buttonStyle(.plain)
    }

    private func announcementWhen(_ a: AnnouncementItem) -> String {
        let iso = a.sentAt ?? a.scheduledAt
        return iso.map { Fmt.date($0, style: .dateTime.day().month(.abbreviated).year().hour().minute()) } ?? "—"
    }

    private var qrCard: some View {
        let occ = todayOccs.first ?? upcoming.first
        let secret = qrSecret(for: occ)
        return Card(padding: 0) {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("LIVE QR").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.onNavyDim)
                        Spacer()
                        Text("● LIVE").font(.system(size: 10, weight: .bold)).foregroundStyle(Color(hex: 0x7FE0A0))
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(Color(hex: 0x16A34A).opacity(0.25)).clipShape(Capsule())
                    }
                    Text(occ?.title ?? "Next occurrence").font(.fraunces(18, .medium)).foregroundStyle(.white)
                    Label("\(occ?.timeShort ?? "—") · \(occ?.location ?? "—")", systemImage: "clock")
                        .font(.nMicro).foregroundStyle(Nuru.onNavyDim)
                }
                .padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .background(Nuru.navy)

                VStack(spacing: 12) {
                    QrPlaceholder(value: secret, size: 180)
                    HStack(spacing: 8) {
                        Label("Rotating secret", systemImage: "sparkles").font(.nMicro).foregroundStyle(Nuru.muted)
                        Button { qrTick += 1 } label: {
                            Label("Refresh", systemImage: "arrow.clockwise").font(.nMicro).foregroundStyle(Nuru.ink)
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        }.buttonStyle(.plain)
                    }
                    Text(secret).font(.system(size: 10)).monospaced().tracking(1).foregroundStyle(Nuru.muted)
                    Button { if let occ { qrOcc = occ } } label: {
                        Text("Open full QR screen").font(.inter(12, .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 11)
                            .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                    }.buttonStyle(.plain)
                }.padding(20)
            }
        }
    }

    private func qrSecret(for occ: UiOcc?) -> String {
        let base = (occ?.id ?? "occurrence").prefix(8).uppercased()
        return "NURU-\(base)-\(String(qrTick, radix: 36).uppercased())"
    }

    // MARK: Moments

    private var momentsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                cardHeader("Moments", "Curated photo gallery shown in the mobile Events tab carousel")
                // NEEDS: post / delete moment writes. Read-only here.
                if moments.isEmpty {
                    emptyState(icon: "photo", title: "No moments yet",
                               body: "Post a photo from a recent gathering — it shows in the mobile Events carousel.")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(moments.enumerated()), id: \.element.id) { i, m in
                            if i > 0 { Divider().overlay(Nuru.border) }
                            HStack(spacing: 12) {
                                AsyncImage(url: URL(string: m.imageUrl)) { img in img.resizable().scaledToFill() } placeholder: { Nuru.inputBg }
                                    .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
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
                            }.padding(.vertical, 12)
                        }
                    }
                }
            }
        }
    }

    // MARK: Insights + Follow-up (display-only, as on the web)

    private var insightsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                cardHeader("Event insights", "Patterns across recent occurrences")
                let cols = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
                LazyVGrid(columns: cols, spacing: 12) {
                    insightTile("Checked in", "\(checkedThisWeek)", "Across recent events", up: true)
                    insightTile("Recent events", "\(recent.count)", "Last 8 weeks", up: true)
                    insightTile("RSVP conversion", "74%", "RSVP members checked in", up: true)
                    insightTile("Follow-up needed", "23", "RSVP'd but did not attend", up: false)
                }
            }
        }
    }

    private func insightTile(_ label: String, _ value: String, _ hint: String, up: Bool) -> some View {
        SurfaceTile(padding: 16) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(label.uppercased()).font(.nOverline).tracking(0.5).foregroundStyle(Nuru.muted)
                    Spacer()
                    Image(systemName: up ? "chart.line.uptrend.xyaxis" : "chart.line.downtrend.xyaxis")
                        .font(.system(size: 11)).foregroundStyle(up ? Color(hex: 0x15803D) : Color(hex: 0xB91C1C))
                }
                Text(value).font(.fraunces(26, .medium)).foregroundStyle(Nuru.ink)
                Text(hint).font(.nMicro).foregroundStyle(Nuru.muted)
            }
        }
    }

    private var followUpCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                cardHeader("Follow-up queue", "Connect attendance to discipleship care")
                let items: [(String, Int, String, Color)] = [
                    ("RSVP'd but absent", 23, "exclamationmark.circle", Color(hex: 0xB91C1C)),
                    ("First-time guests", 12, "person.badge.plus", Color(hex: 0x15803D)),
                    ("Manual check-ins", 5, "checkmark.shield", Color(hex: 0xA87616)),
                    ("No response", 48, "person.2", Color(hex: 0x6B7280)),
                ]
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.offset) { i, r in
                        if i > 0 { Divider().overlay(Nuru.border) }
                        HStack(spacing: 12) {
                            Image(systemName: r.2).font(.system(size: 14)).foregroundStyle(r.3)
                                .frame(width: 32, height: 32).background(Nuru.inputBg)
                                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(r.0).font(.inter(13, .bold)).foregroundStyle(Nuru.ink)
                                Text("\(r.1) members").font(.nMicro).foregroundStyle(Nuru.muted)
                            }
                            Spacer()
                            Button { showCreateAnnouncement = true } label: {
                                Label("Follow-up", systemImage: "paperplane").font(.inter(11, .semibold)).foregroundStyle(.white)
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }.buttonStyle(.plain)
                        }.padding(.vertical, 12)
                    }
                }
            }
        }
    }

    // MARK: Recent attendance (real)

    private var recentAttendanceCard: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Recent attendance").font(.fraunces(18, .medium)).foregroundStyle(Nuru.ink)
                    Spacer()
                    Text("last 8 weeks").font(.nMicro).foregroundStyle(Nuru.muted)
                }.padding(20)
                Divider().overlay(Nuru.border)

                Chart(recent) { e in
                    BarMark(x: .value("Event", e.title), y: .value("Checked in", e.checkedIn))
                        .foregroundStyle(Nuru.gold)
                        .cornerRadius(4)
                }
                .chartXAxis(.hidden)
                .frame(height: 140)
                .padding(.horizontal, 20).padding(.top, 16)

                // Header row
                HStack {
                    Text("EVENT").frame(maxWidth: .infinity, alignment: .leading)
                    Text("WHEN").frame(width: 120, alignment: .leading)
                    Text("CHECKED IN").frame(width: 90, alignment: .leading)
                    Text("RSVP").frame(width: 60, alignment: .leading)
                }
                .font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 8)
                .background(Nuru.surface)

                ForEach(recent) { e in
                    Divider().overlay(Nuru.border)
                    HStack {
                        Text(e.title).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                            .frame(maxWidth: .infinity, alignment: .leading).lineLimit(1)
                        Text(Fmt.date(e.occursAt, style: .dateTime.day().month(.abbreviated)))
                            .font(.nCaption).foregroundStyle(Nuru.muted).frame(width: 120, alignment: .leading)
                        Text("\(e.checkedIn)").font(.inter(13, .bold)).foregroundStyle(Color(hex: 0x0F6B33)).frame(width: 90, alignment: .leading)
                        Text("\(e.rsvpGoing)").font(.nCaption).foregroundStyle(Nuru.ink).frame(width: 60, alignment: .leading)
                    }.padding(.horizontal, 20).padding(.vertical, 12)
                }
            }
        }
    }

    // MARK: Shared bits

    private func cardHeader(_ title: String, _ subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.fraunces(20, .medium)).foregroundStyle(Nuru.ink)
            Text(subtitle).font(.nCaption).foregroundStyle(Nuru.muted)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func emptyState(icon: String, title: String, body: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 20)).foregroundStyle(Nuru.muted)
                .frame(width: 48, height: 48).background(Nuru.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            Text(title).font(.inter(14, .bold)).foregroundStyle(Nuru.ink)
            Text(body).font(.nCaption).foregroundStyle(Nuru.muted).multilineTextAlignment(.center).frame(maxWidth: 280)
        }.frame(maxWidth: .infinity).padding(.vertical, 28)
    }

    // MARK: Data

    private func load() async {
        let iso = ISO8601DateFormatter()
        let from = Calendar.current.date(byAdding: .month, value: -1, to: now) ?? now
        let to = now.addingTimeInterval(60 * 86400)
        do {
            let page = try await APIClient.shared.get("/calendar",
                query: ["from": iso.string(from: from), "to": iso.string(from: to)], as: EventCalPage.self)
            events = page.data.map(UiOcc.from)
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not load events."
        }
        // Best-effort secondary loads (each tolerant of failure).
        if let att = try? await APIClient.shared.get("/admin/reports/attendance", query: ["weeks": "8"], as: AttendanceFull.self) {
            recent = att.recentEvents ?? []
        }
        if let anns = try? await APIClient.shared.get("/admin/announcements", as: AnnouncementsPage.self) {
            announcements = anns.data
        }
        if let mom = try? await APIClient.shared.get("/admin/moments", as: MomentsPage.self) {
            moments = mom.data
        }
    }

    private func loadRoster(_ id: String) async {
        guard rosters[id] == nil else { return }
        if let r = try? await APIClient.shared.get("/admin/events/\(id)/attendance", as: Roster.self) {
            rosters[id] = r
        }
    }
    private func loadRsvp(_ id: String) async {
        guard rsvpRosters[id] == nil else { return }
        if let r = try? await APIClient.shared.get("/admin/events/\(id)/rsvps", as: RsvpRosterData.self) {
            rsvpRosters[id] = r
        }
    }
}

// MARK: - Simple wrapping row layout (flow)

private struct FlexRow: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > maxW, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
        return CGSize(width: maxW == .infinity ? x : maxW, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
    }
}

// MARK: - Procedural QR placeholder (display-only — no QR endpoint yet)

private struct QrPlaceholder: View {
    let value: String
    var size: CGFloat = 200
    private var cells: [Bool] {
        var seed: UInt32 = 0
        for ch in value.unicodeScalars { seed = seed &* 31 &+ ch.value }
        var arr: [Bool] = []
        for _ in 0..<(21 * 21) { seed = seed &* 1664525 &+ 1013904223; arr.append(seed & 1 == 1) }
        return arr
    }
    private func isCorner(_ r: Int, _ c: Int) -> Bool {
        (r < 7 && c < 7) || (r < 7 && c >= 14) || (r >= 14 && c < 7)
    }
    var body: some View {
        let m = cells
        Canvas { ctx, sz in
            let u = sz.width / 21
            ctx.fill(Path(CGRect(origin: .zero, size: sz)), with: .color(.white))
            for i in 0..<(21 * 21) {
                let r = i / 21, c = i % 21
                var on = false
                if isCorner(r, c) {
                    let lr = r < 7 ? r : r - 14, lc = c < 7 ? c : c - 14
                    let edge = lr == 0 || lr == 6 || lc == 0 || lc == 6
                    let inner = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4
                    on = edge || inner
                } else { on = m[i] }
                if on {
                    ctx.fill(Path(CGRect(x: CGFloat(c) * u, y: CGFloat(r) * u, width: u, height: u)),
                             with: .color(Color(hex: 0x0B1F33)))
                }
            }
        }
        .frame(width: size, height: size)
        .padding(14).background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}

// MARK: - Event detail sheet

private struct EventDetailSheet: View {
    let occ: UiOcc
    let roster: Roster?
    var onQr: () -> Void
    var onAttendance: () -> Void
    var onRsvp: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("\(occ.category.label.uppercased()) OCCURRENCE").font(.nOverline).tracking(0.5).foregroundStyle(occ.category.color)
                            Spacer()
                            StatusBadge(status: "scheduled")
                        }
                        Text(occ.title).font(.fraunces(24, .medium)).foregroundStyle(Nuru.ink)
                        VStack(alignment: .leading, spacing: 6) {
                            Label(occ.dateLong, systemImage: "calendar")
                            Label("\(occ.timeShort) – \(occ.endTime) · \(occ.duration)", systemImage: "clock")
                            Label(occ.location, systemImage: "mappin.and.ellipse")
                            Label("Visibility: \(occ.visibility)", systemImage: "eye")
                        }.font(.nCaption).foregroundStyle(Nuru.muted)
                    }

                    // Metric tiles
                    let cols = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
                    LazyVGrid(columns: cols, spacing: 8) {
                        metric("Checked in", "\(roster?.checkedIn?.count ?? 0)", Color(hex: 0x15803D))
                        metric("Guests", "\(roster?.guests?.count ?? 0)", Nuru.navy)
                        metric("No-shows", "\(roster?.rsvpNoShow?.count ?? 0)", Color(hex: 0xB91C1C))
                        metric("QR", "Ready", Nuru.gold)
                    }

                    // Actions (browse + write-as-read)
                    let acts = [GridItem(.flexible()), GridItem(.flexible())]
                    LazyVGrid(columns: acts, spacing: 8) {
                        action("Show QR", "qrcode", primary: true) { dismiss(); onQr() }
                        action("View attendance", "person.2") { dismiss(); onAttendance() }
                        action("View RSVPs", "person.crop.circle.badge.checkmark") { dismiss(); onRsvp() }
                        action("Manual check-in", "checkmark.circle") {}      // NEEDS write
                        action("Reschedule", "arrow.triangle.2.circlepath") {} // NEEDS write
                        action("Edit event", "pencil") {}                      // NEEDS write
                        action("Cancel occurrence", "xmark", danger: true) {}  // NEEDS write
                        action("Delete event", "trash", danger: true) {}       // NEEDS write
                    }

                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "checkmark.shield.fill").foregroundStyle(Color(hex: 0xA87616))
                        Text("Changing this occurrence will not affect the whole series unless \"entire series\" is selected.")
                            .font(.nMicro).foregroundStyle(Color(hex: 0x7A5410))
                    }
                    .padding(12).background(Color(hex: 0xFFFBEB))
                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(Color(hex: 0xF5E0A8), lineWidth: 1))
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle("Event").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }

    private func metric(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.fraunces(22, .medium)).foregroundStyle(color)
            Text(label.uppercased()).font(.system(size: 10, weight: .bold)).tracking(0.5).foregroundStyle(Nuru.muted)
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
    }

    private func action(_ label: String, _ icon: String, primary: Bool = false, danger: Bool = false, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Label(label, systemImage: icon).font(.inter(12, .semibold))
                .foregroundStyle(primary ? .white : danger ? Color(hex: 0xB91C1C) : Nuru.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 11)
                .background(primary ? Nuru.gold : danger ? Color(hex: 0xFEE2E2) : Nuru.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }.buttonStyle(.plain)
    }
}

// MARK: - Day schedule sheet

private struct DaySheet: View {
    let iso: String
    let events: [UiOcc]
    var onOpen: (UiOcc) -> Void
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
                                        Spacer(); StatusBadge(status: "scheduled")
                                    }
                                    Text(o.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink)
                                    Label(o.location, systemImage: "mappin.and.ellipse").font(.nMicro).foregroundStyle(Nuru.muted)
                                }
                                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                                .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                                .contentShape(Rectangle())
                            }.buttonStyle(.plain)
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
        return (f.date(from: iso)).map { $0.formatted(.dateTime.weekday(.wide).day().month(.wide)) } ?? "Day schedule"
    }
}

// MARK: - RSVP roster sheet

private struct RsvpSheet: View {
    let occ: UiOcc
    let roster: RsvpRosterData?
    @State private var filter = "going"
    @Environment(\.dismiss) private var dismiss

    private func bucket(_ k: String) -> [RsvpRow] {
        guard let b = roster?.buckets else { return [] }
        switch k { case "going": return b.going ?? []; case "maybe": return b.maybe ?? []
        case "declined": return b.declined ?? []; default: return b.noResponse ?? [] }
    }
    private func count(_ k: String) -> Int {
        guard let c = roster?.counts else { return 0 }
        switch k { case "going": return c.going; case "maybe": return c.maybe
        case "declined": return c.declined; default: return c.noResponse }
    }
    private func meta(_ k: String) -> (String, Color) {
        switch k { case "going": ("Going", Color(hex: 0x0F6B33)); case "maybe": ("Maybe", Color(hex: 0xB45309))
        case "declined": ("Not going", Color(hex: 0xB91C1C)); default: ("No response", Color(hex: 0x6B7280)) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("RSVP list · \(occ.title)").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                    if roster == nil {
                        Text("Loading RSVPs…").font(.nCaption).foregroundStyle(Nuru.muted).frame(maxWidth: .infinity).padding(.vertical, 32)
                    } else {
                        let tabs = ["going", "maybe", "declined"] + (roster?.noResponseScope == "cell" ? ["no_response"] : [])
                        FlexRow(spacing: 8) {
                            ForEach(tabs, id: \.self) { k in
                                let m = meta(k)
                                Button { filter = k } label: {
                                    Text("\(m.0) · \(count(k))").font(.inter(12, .bold))
                                        .foregroundStyle(filter == k ? m.1 : Nuru.muted)
                                        .padding(.horizontal, 12).padding(.vertical, 7)
                                        .background(filter == k ? m.1.opacity(0.12) : Nuru.inputBg)
                                        .clipShape(Capsule())
                                }.buttonStyle(.plain)
                            }
                        }
                        let rows = bucket(filter)
                        if rows.isEmpty {
                            Text("No members in \"\(meta(filter).0)\".").font(.nCaption).foregroundStyle(Nuru.muted)
                                .frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else {
                            ForEach(rows) { m in
                                HStack {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(m.fullName).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                                        Text(m.cellName ?? "—").font(.nMicro).foregroundStyle(Nuru.muted)
                                    }
                                    Spacer()
                                    let mm = meta(m.response)
                                    Text(m.respondedAt.map { Fmt.date($0, style: .dateTime.day().month(.abbreviated)) } ?? mm.0)
                                        .font(.system(size: 10.5, weight: .bold)).foregroundStyle(mm.1)
                                        .padding(.horizontal, 10).padding(.vertical, 4)
                                        .background(mm.1.opacity(0.12)).clipShape(Capsule())
                                }
                                .padding(.horizontal, 12).padding(.vertical, 10)
                                .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                            }
                        }
                    }
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle("RSVP responses").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
}

// MARK: - Attendance roster sheet

private struct AttendanceSheet: View {
    let occ: UiOcc
    let roster: Roster?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let checkedIn = roster?.checkedIn ?? []
        let guests = roster?.guests ?? []
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Attendance list · \(occ.title)").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                    Text("\(checkedIn.count + guests.count) checked in").font(.fraunces(22, .medium)).foregroundStyle(Nuru.ink)

                    HStack {
                        Text("MEMBER").frame(maxWidth: .infinity, alignment: .leading)
                        Text("TIME").frame(width: 70, alignment: .leading)
                        Text("METHOD").frame(width: 70, alignment: .leading)
                        Text("STATUS").frame(width: 84, alignment: .leading)
                    }.font(.system(size: 10, weight: .bold)).tracking(0.5).foregroundStyle(Nuru.muted)
                    Divider().overlay(Nuru.border)

                    if checkedIn.isEmpty && guests.isEmpty {
                        Text("No check-ins recorded yet.").font(.nCaption).foregroundStyle(Nuru.muted).padding(.vertical, 16)
                    } else {
                        ForEach(checkedIn) { c in
                            attRow(c.fullName, time: c.checkedInAt, method: c.method,
                                   status: c.method.lowercased() == "manual" ? "Manual" : "Verified")
                        }
                        ForEach(guests) { g in
                            attRow(g.guestName + (g.firstTime ? " · first-time" : ""), time: g.createdAt, method: "Guest", status: "Guest")
                        }
                    }
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle("Attendance").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }

    private func attRow(_ name: String, time: String, method: String, status: String) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text(name).font(.inter(12, .semibold)).foregroundStyle(Nuru.ink).frame(maxWidth: .infinity, alignment: .leading).lineLimit(1)
                Text(Fmt.date(time, style: .dateTime.hour().minute())).font(.system(size: 11)).monospaced().foregroundStyle(Nuru.muted).frame(width: 70, alignment: .leading)
                Text(method).font(.system(size: 11)).foregroundStyle(Nuru.muted).frame(width: 70, alignment: .leading)
                HStack { StatusBadge(status: status); Spacer() }.frame(width: 84, alignment: .leading)
            }.padding(.vertical, 10)
            Divider().overlay(Nuru.border)
        }
    }
}

// MARK: - QR full-screen sheet

private struct QrSheet: View {
    let occ: UiOcc
    let roster: Roster?
    @Binding var tick: Int
    @Environment(\.dismiss) private var dismiss

    private var secret: String {
        "NURU-\(occ.id.prefix(8).uppercased())-\(String(tick, radix: 36).uppercased())"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("● LIVE CHECK-IN").font(.nOverline).tracking(0.5).foregroundStyle(Color(hex: 0x15803D))
                        Text(occ.title).font(.fraunces(22, .medium)).foregroundStyle(Nuru.ink)
                        Text("\(occ.dateLong) · \(occ.timeShort) · \(occ.location)").font(.nCaption).monospaced().foregroundStyle(Nuru.muted)
                    }

                    VStack(spacing: 14) {
                        QrPlaceholder(value: secret, size: 280)
                        HStack(spacing: 8) {
                            Label("QR refreshes every 30 seconds", systemImage: "sparkles").font(.nMicro).foregroundStyle(Nuru.muted)
                            Button { tick += 1 } label: {
                                Label("Refresh", systemImage: "arrow.clockwise").font(.nMicro).foregroundStyle(Nuru.ink)
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                            }.buttonStyle(.plain)
                        }
                        Text(secret).font(.system(size: 12)).monospaced().tracking(1.5).foregroundStyle(Nuru.muted)
                    }.frame(maxWidth: .infinity).padding(20)
                    .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                    let cols = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
                    LazyVGrid(columns: cols, spacing: 8) {
                        qrMetric("Checked in", "\(roster?.checkedIn?.count ?? 0)", Color(hex: 0x15803D))
                        qrMetric("Guests", "\(roster?.guests?.count ?? 0)", Nuru.navy)
                        qrMetric("No-shows", "\(roster?.rsvpNoShow?.count ?? 0)", Color(hex: 0xA87616))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("RECENT CHECK-INS").font(.nOverline).tracking(0.5).foregroundStyle(Nuru.muted)
                        let ci = roster?.checkedIn ?? []
                        if ci.isEmpty {
                            Text("No check-ins yet.").font(.nCaption).foregroundStyle(Nuru.muted)
                        } else {
                            ForEach(ci) { c in
                                HStack {
                                    Text(Fmt.date(c.checkedInAt, style: .dateTime.hour().minute())).font(.system(size: 11, weight: .bold)).monospaced().foregroundStyle(Nuru.muted).frame(width: 52, alignment: .leading)
                                    Text(c.fullName).font(.inter(12, .semibold)).foregroundStyle(Nuru.ink)
                                    Spacer()
                                    Text(c.method).font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.muted)
                                }
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                            }
                        }
                    }
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle("Live check-in").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
    private func qrMetric(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.fraunces(22, .medium)).foregroundStyle(color)
            Text(label.uppercased()).font(.system(size: 10, weight: .bold)).tracking(0.5).foregroundStyle(Nuru.muted)
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
    }
}

// MARK: - Announcement detail sheet

private struct AnnouncementSheet: View {
    let item: AnnouncementItem
    @State private var stats: [AnnouncementStat] = []
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text("ANNOUNCEMENT").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                        Spacer(); StatusBadge(status: announcementStatusLabel(item.status))
                    }
                    Text(item.title).font(.fraunces(22, .medium)).foregroundStyle(Nuru.ink)
                    Text(item.body).font(.nBody).foregroundStyle(Nuru.ink)
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))

                    let cols = [GridItem(.flexible()), GridItem(.flexible())]
                    LazyVGrid(columns: cols, spacing: 12) {
                        detailField("Audience", audienceLabel(item.audienceKind))
                        detailField("Channels", (item.channels ?? []).joined(separator: ", "))
                        detailField("Send time", whenText, mono: true)
                        detailField("Status", announcementStatusLabel(item.status))
                    }

                    if !stats.isEmpty {
                        Text("DELIVERY").font(.nOverline).tracking(0.5).foregroundStyle(Nuru.muted)
                        ForEach(stats) { s in
                            HStack {
                                Text(s.channel).font(.inter(12, .semibold)).foregroundStyle(Nuru.ink)
                                Spacer()
                                Text("\(s.delivered)/\(s.targeted) delivered · \(s.opened) opened")
                                    .font(.nMicro).monospaced().foregroundStyle(Nuru.muted)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                        }
                    }
                    // NEEDS: send / cancel / edit / delete writes.
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle("Announcement").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .task {
                if let d = try? await APIClient.shared.get("/admin/announcements/\(item.announcementId)", as: AnnouncementDetail.self) {
                    stats = d.stats ?? []
                }
            }
        }
    }
    private var whenText: String {
        let iso = item.sentAt ?? item.scheduledAt
        return iso.map { Fmt.date($0, style: .dateTime.day().month(.abbreviated).year().hour().minute()) } ?? "—"
    }
    private func detailField(_ label: String, _ value: String, mono: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label.uppercased()).font(.system(size: 10, weight: .bold)).tracking(0.5).foregroundStyle(Nuru.muted)
            Text(value.isEmpty ? "—" : value).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink).monospaced(mono)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Create sheets (styled read views — NEEDS form wiring)

private struct CreateEventSheet: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Create event").font(.fraunces(22, .medium)).foregroundStyle(Nuru.ink)
                    Text("The full create form (title, type, date/time, recurrence, attendance toggles, visibility, images, featured) ships next — it wires to POST /admin/events/series. Captured here as a read view.")
                        .font(.nCaption).foregroundStyle(Nuru.muted)
                    ForEach(["Basic details", "Date & time", "Recurrence", "Attendance", "Visibility & reminders", "Images", "Featured"], id: \.self) { s in
                        SurfaceTile { Text(s).font(.inter(13, .bold)).foregroundStyle(Nuru.ink) }
                    }
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle("New event").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
}

private struct CreateAnnouncementSheet: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Create announcement").font(.fraunces(22, .medium)).foregroundStyle(Nuru.ink)
                    Text("The full compose form (title, body, attach-to-event, channels, audience, images, homepage feature, live preview) ships next — it wires to POST /admin/announcements. Captured here as a read view.")
                        .font(.nCaption).foregroundStyle(Nuru.muted)
                    ForEach(["Message details", "Channels", "Audience", "Images", "Homepage", "Live preview"], id: \.self) { s in
                        SurfaceTile { Text(s).font(.inter(13, .bold)).foregroundStyle(Nuru.ink) }
                    }
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle("New announcement").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
}

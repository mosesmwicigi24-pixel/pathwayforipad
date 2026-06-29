// Dashboard — a faithful native port of the web portal's Dashboard.tsx: navy hero
// with KPI strip + action chips, pastel KPI tiles, curriculum pipeline, and the
// Pathway Report (status donut, band breakdown, attendance bars via Swift Charts).
import SwiftUI
import Charts

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var overview: OverviewKpis?
    @Published var bands: [String: Int] = [:]
    @Published var trend: [AttendanceTrendPoint] = []
    @Published var levels: [AdminLevel] = []
    @Published var consents = 0
    @Published var stuck = 0
    @Published var countriesActive = 0
    @Published var languagesActive = 0
    @Published var upcoming: [CalendarOccurrence] = []
    @Published var activity: [AuditRow] = []
    @Published var firstName = ""
    @Published var loading = true

    func load() async {
        loading = true
        // Each call is independent and tolerant of failure (mirrors the web).
        async let o = try? PortalAPI.overview()
        async let e = try? PortalAPI.engagement()
        async let t = try? PortalAPI.attendance(weeks: 8)
        async let l = try? PortalAPI.curriculumLevels()
        async let c = try? PortalAPI.consentsCount()
        async let s = try? PortalAPI.mediaStuck()
        async let co = try? PortalAPI.countries()
        async let la = try? PortalAPI.languages()
        async let up = try? PortalAPI.calendar(from: ISO8601DateFormatter().string(from: Date()),
                                               to: ISO8601DateFormatter().string(from: Date().addingTimeInterval(60*24*3600)))
        async let au = try? PortalAPI.auditFeed()
        async let me = try? PortalAPI.me()

        overview = await o
        bands = await e?.bands ?? [:]
        trend = await t ?? []
        levels = await l ?? []
        consents = await c ?? 0
        stuck = await s ?? 0
        countriesActive = (await co)?.filter { $0.status == "active" }.count ?? 0
        languagesActive = (await la)?.filter { $0.status == "active" }.count ?? 0
        upcoming = Array((await up ?? []).sorted { $0.startAt < $1.startAt }.prefix(4))
        activity = Array((await au ?? []).prefix(6))
        firstName = (await me)?.fullName.split(separator: " ").first.map(String.init) ?? ""
        loading = false
    }

    var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
        return firstName.isEmpty ? part : "\(part), \(firstName)"
    }
}

private let todayLabel: String = Date().formatted(.dateTime.weekday(.wide).day().month(.wide))

struct DashboardView: View {
    @StateObject private var vm = DashboardViewModel()
    @EnvironmentObject private var router: NavRouter
    private let grid = [GridItem(.adaptive(minimum: 230), spacing: 14)]

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                hero
                if vm.loading && vm.overview == nil {
                    SkeletonList(rows: 4).padding(.horizontal, 20)
                } else {
                    LazyVGrid(columns: grid, spacing: 14) { kpiTiles }.padding(.horizontal, 20)
                    PipelineSection(levels: vm.levels).padding(.horizontal, 20)
                    PathwayReport(bands: vm.bands, trend: vm.trend).padding(.horizontal, 20)
                    bottomRow.padding(.horizontal, 20)
                }
            }
            .padding(.bottom, 40)
        }
        .background(Nuru.paper)
        .navigationTitle("Dashboard")
        .navigationBarTitleDisplayMode(.inline)
        .task { if vm.overview == nil { await vm.load() } }
        .refreshable { await vm.load() }
    }

    // Hero
    private var hero: some View {
        let o = vm.overview
        let stats = [
            HeroStat(label: "Active learners", value: "\(o?.activeLearners ?? 0)", hint: "\(o?.totalMembers ?? 0) total members"),
            HeroStat(label: "Cohorts running", value: "\(o?.cohortsRunning ?? 0)", hint: "live this term"),
            HeroStat(label: "Reflections (wk.)", value: "\(o?.reflectionsThisWeek ?? 0)", hint: "\(o?.pendingReviews ?? 0) pending review"),
            HeroStat(label: "Avg engagement", value: Pctf(o?.avgEngagement ?? 0), hint: "last 7 days"),
        ]
        return PortalHero(breadcrumb: ["Nuru Pathway", "Dashboard"], title: vm.greeting, stats: stats) {
            HStack(spacing: 8) {
                HeroChip(label: todayLabel, icon: "sparkles", style: .tag)
                HeroChip(label: "Review queue", icon: "checklist", style: .ghost) { router.go(.reflectionQueue) }
                HeroChip(label: "Curriculum", icon: "book", style: .ghost) { router.go(.cms) }
                HeroChip(label: "Members", trailingIcon: "arrow.right", style: .gold) { router.go(.members) }
            }
        }
    }

    @ViewBuilder private var kpiTiles: some View {
        let o = vm.overview
        KpiTile(label: "Modules published", value: "\(o?.modulesPublished ?? 0)", icon: "book.fill", tint: .init(bg: Color(hex: 0xFDF5E5), fg: Color(hex: 0x8A6B1F))) { router.go(.cms) }
        KpiTile(label: "Pending reviews", value: "\(o?.pendingReviews ?? 0)", icon: "checklist", tint: .init(bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xA8281F))) { router.go(.reflectionQueue) }
        KpiTile(label: "Certificates (mo.)", value: "\(o?.certificatesThisMonth ?? 0)", icon: "rosette", tint: .init(bg: Color(hex: 0xE8F6EE), fg: Color(hex: 0x0F6B33))) { router.go(.certificates) }
        KpiTile(label: "Members at risk", value: "\(o?.membersAtRisk ?? 0)", icon: "exclamationmark.triangle.fill", tint: .init(bg: Color(hex: 0xEEF1F8), fg: Color(hex: 0x1F3A6B))) { router.go(.cellEngagement) }
        KpiTile(label: "Countries", value: "\(vm.countriesActive)", icon: "globe", tint: .init(bg: Color(hex: 0xEEF1F8), fg: Color(hex: 0x1F3A6B))) { router.go(.countries) }
        KpiTile(label: "Languages", value: "\(vm.languagesActive)", icon: "character.bubble", tint: .init(bg: Color(hex: 0xF3E8FF), fg: Color(hex: 0x7C3AED))) { router.go(.languages) }
    }

    private var bottomRow: some View {
        VStack(spacing: 14) {
            ActivityCard(activity: vm.activity)
            UpcomingCard(events: vm.upcoming)
            RisksCard(overview: vm.overview, consents: vm.consents, stuck: vm.stuck)
        }
    }
}

func Pctf(_ v: Double) -> String { "\(Int((v * 100).rounded()))%" }

// MARK: - Curriculum pipeline

private struct PipelineSection: View {
    let levels: [AdminLevel]
    @EnvironmentObject private var router: NavRouter
    private func sum(_ pick: (AdminLevel) -> String) -> Int { levels.reduce(0) { $0 + (Int(pick($1)) ?? 0) } }
    var body: some View {
        let inReview = levels.filter { $0.status == "in_review" }.count
        let items = [
            ("Drafts", sum { $0.draftCount }, "square.and.pencil", Nuru.Tint(bg: Color(hex: 0xFDF5E5), fg: Color(hex: 0x8A6B1F))),
            ("In review", inReview, "eye", Nuru.Tint(bg: Color(hex: 0xEEF1F8), fg: Color(hex: 0x1F3A6B))),
            ("Archived", sum { $0.archivedCount }, "archivebox", Nuru.Tint(bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xA8281F))),
            ("Published", sum { $0.publishedCount }, "checkmark.seal", Nuru.Tint(bg: Color(hex: 0xE8F6EE), fg: Color(hex: 0x0F6B33))),
        ]
        let total = items.reduce(0) { $0 + $1.1 }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 6) {
                    Image(systemName: "chart.line.uptrend.xyaxis").font(.system(size: 13)).foregroundStyle(Nuru.navy)
                    Text("Curriculum pipeline").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Text("· \(total) items").font(.nCaption).foregroundStyle(Nuru.ink600)
                    Spacer()
                    Button { router.go(.cms) } label: {
                        HStack(spacing: 3) { Text("View all").font(.inter(12, .semibold)); Image(systemName: "chevron.right").font(.system(size: 10)) }
                            .foregroundStyle(Nuru.goldLo)
                    }.buttonStyle(.plain)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 12)], spacing: 12) {
                    ForEach(items, id: \.0) { it in
                        PipelineTile(label: it.0, value: "\(it.1)", icon: it.2, tint: it.3)
                    }
                }
            }
        }
    }
}

// MARK: - Pathway Report

private struct BandSlice: Identifiable { let name: String; let value: Int; let color: Color; var id: String { name } }

private let BANDS: [(key: String, name: String, color: Color)] = [
    ("thriving", "Thriving", Color(hex: 0x16A34A)),
    ("steady", "Steady", Color(hex: 0x1F3A6B)),
    ("watch", "Watch", Color(hex: 0xC89B3C)),
    ("at_risk", "At-risk", Color(hex: 0xDC2626)),
]

private struct PathwayReport: View {
    let bands: [String: Int]
    let trend: [AttendanceTrendPoint]
    @State private var tab = "Overview"
    private let tabs = ["Overview", "Curriculum", "Members"]

    var body: some View {
        let slices = BANDS.map { BandSlice(name: $0.name, value: bands[$0.key] ?? 0, color: $0.color) }
        let total = slices.reduce(0) { $0 + $1.value }
        return Card(padding: 20) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Pathway Report").font(.nTitle).foregroundStyle(Nuru.navy)
                        Text("Cohort performance, curriculum delivery and engagement signals.")
                            .font(.nCaption).foregroundStyle(Nuru.ink600)
                    }
                    Spacer()
                    HStack(spacing: 8) {
                        reportBtn("Export", "square.and.arrow.up")
                        reportBtn("Print", "printer")
                        HeroChip(label: todayLabel, icon: "calendar", style: .tag)
                    }
                }
                // tabs
                HStack(spacing: 4) {
                    ForEach(tabs, id: \.self) { t in
                        Button { tab = t } label: {
                            Text(t).font(.inter(12.5, .semibold))
                                .foregroundStyle(t == tab ? Nuru.navy : Nuru.ink600)
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .overlay(alignment: .bottom) {
                                    Rectangle().fill(t == tab ? Nuru.gold : .clear).frame(height: 2)
                                }
                        }.buttonStyle(.plain)
                    }
                    Spacer()
                }
                .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 16)], spacing: 16) {
                    DonutPanel(slices: slices, total: total)
                    BreakdownPanel(slices: slices, total: total)
                    AttendancePanel(trend: trend)
                }
            }
        }
    }
    private func reportBtn(_ label: String, _ icon: String) -> some View {
        HStack(spacing: 6) { Image(systemName: icon).font(.system(size: 11)); Text(label).font(.inter(12, .semibold)) }
            .foregroundStyle(Nuru.navy).padding(.horizontal, 12).padding(.vertical, 8)
            .background(Nuru.white).overlay(Capsule().stroke(Nuru.border, lineWidth: 1)).clipShape(Capsule())
    }
}

private struct ReportPanel<Content: View>: View {
    let title: String; var trailing: String? = nil; var icon: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(spacing: 5) {
                    if let icon { Image(systemName: icon).font(.system(size: 12)).foregroundStyle(Nuru.gold) }
                    Text(title).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                }
                Spacer()
                if let trailing { Text(trailing).font(.nMicro).foregroundStyle(Nuru.ink600) }
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}

private struct DonutPanel: View {
    let slices: [BandSlice]; let total: Int
    var body: some View {
        ReportPanel(title: "Status distribution", trailing: "\(total) learners") {
            ZStack {
                Chart(total == 0 ? [BandSlice(name: "None", value: 1, color: Nuru.border)] : slices) { s in
                    SectorMark(angle: .value("v", s.value), innerRadius: .ratio(0.62), angularInset: 1.5)
                        .foregroundStyle(s.color).cornerRadius(3)
                }
                .chartLegend(.hidden)
                .frame(height: 190)
                VStack(spacing: 2) {
                    Text("\(total)").font(.fraunces(26, .semibold)).foregroundStyle(Nuru.navy)
                    Text("TOTAL").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                }
            }
        }
    }
}

private struct BreakdownPanel: View {
    let slices: [BandSlice]; let total: Int
    var body: some View {
        ReportPanel(title: "Status breakdown", trailing: "by band") {
            VStack(spacing: 0) {
                ForEach(Array(slices.enumerated()), id: \.element.id) { i, d in
                    HStack {
                        Circle().fill(d.color).frame(width: 9, height: 9)
                        Text(d.name).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                        Spacer()
                        Text("\(d.value)").font(.fraunces(16, .medium)).foregroundStyle(Nuru.navy)
                        Text(total > 0 ? "\(Int((Double(d.value)/Double(total)*100).rounded()))%" : "0%")
                            .font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                }
            }
        }
    }
}

private struct AttBar: Identifiable { let id = UUID(); let week: String; let series: String; let value: Int }

private struct AttendancePanel: View {
    let trend: [AttendanceTrendPoint]
    private func weekLabel(_ s: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]
        let d = f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
        return d?.formatted(.dateTime.month(.abbreviated).day()) ?? s
    }
    var body: some View {
        let bars = trend.flatMap { t -> [AttBar] in
            let w = weekLabel(t.weekStart)
            return [AttBar(week: w, series: "Members", value: t.uniqueMembers),
                    AttBar(week: w, series: "Check-ins", value: t.checkIns)]
        }
        return ReportPanel(title: "Attendance", trailing: "last 8 weeks", icon: "chart.bar.fill") {
            VStack(alignment: .leading, spacing: 8) {
                if bars.isEmpty {
                    Text("No attendance recorded yet.").font(.nCaption).foregroundStyle(Nuru.ink600).frame(height: 190)
                } else {
                    Chart(bars) { b in
                        BarMark(x: .value("Week", b.week), y: .value("Count", b.value), width: .fixed(9))
                            .foregroundStyle(by: .value("Series", b.series))
                            .position(by: .value("Series", b.series))
                            .cornerRadius(3)
                    }
                    .chartForegroundStyleScale(["Members": Color(hex: 0xE8E3D3), "Check-ins": Nuru.gold])
                    .chartLegend(.hidden)
                    .chartYAxis(.hidden)
                    .frame(height: 190)
                }
                HStack(spacing: 16) {
                    legend("Check-ins", Nuru.gold); legend("Members", Color(hex: 0xE8E3D3))
                }
            }
        }
    }
    private func legend(_ t: String, _ c: Color) -> some View {
        HStack(spacing: 6) { RoundedRectangle(cornerRadius: 2).fill(c).frame(width: 9, height: 9); Text(t).font(.nMicro).foregroundStyle(Nuru.ink600) }
    }
}

// MARK: - Bottom cards

private struct ActivityCard: View {
    let activity: [AuditRow]
    @EnvironmentObject private var router: NavRouter
    private func humanize(_ a: String) -> String {
        let s = a.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " ")
        return s.prefix(1).uppercased() + s.dropFirst()
    }
    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Recent activity").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer()
                    Button("View all") { router.go(.cellEngagement) }.font(.inter(12, .semibold)).tint(Nuru.goldLo)
                }
                if activity.isEmpty {
                    Text("No recent activity recorded.").font(.nCaption).foregroundStyle(Nuru.ink600)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(activity.enumerated()), id: \.element.id) { i, a in
                            HStack(spacing: 12) {
                                TintedIcon(systemName: "chart.line.uptrend.xyaxis", color: Color(hex: 0x1F3A6B), size: 32)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(humanize(a.action)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                    Text([a.entity ?? "system", a.actorName].compactMap { $0 }.joined(separator: " · "))
                                        .font(.nMicro).foregroundStyle(Nuru.ink600)
                                }
                                Spacer()
                                Text(Fmt.relative(a.createdAt)).font(.nMicro).foregroundStyle(Nuru.ink600)
                            }
                            .padding(.vertical, 10)
                            .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                        }
                    }
                }
            }
        }
    }
}

private struct UpcomingCard: View {
    let events: [CalendarOccurrence]
    @EnvironmentObject private var router: NavRouter
    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Upcoming events").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer()
                    Button("Calendar") { router.go(.events) }.font(.inter(12, .semibold)).tint(Nuru.goldLo)
                }
                if events.isEmpty {
                    Text("No events scheduled in the next 60 days.").font(.nCaption).foregroundStyle(Nuru.ink600)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(events.enumerated()), id: \.element.id) { i, e in
                            HStack(spacing: 12) {
                                VStack(spacing: 0) {
                                    Text(Fmt.date(e.startAt, style: .dateTime.weekday(.abbreviated))).font(.inter(9, .bold)).foregroundStyle(Color(hex: 0x8A6B1F))
                                    Text(Fmt.date(e.startAt, style: .dateTime.day())).font(.fraunces(17, .medium)).foregroundStyle(Color(hex: 0x8A6B1F))
                                }
                                .frame(width: 46, height: 46).background(Color(hex: 0xFDF5E5)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(e.title).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                    Text(Fmt.date(e.startAt, style: .dateTime.hour().minute()) + (e.location.map { " · \($0)" } ?? ""))
                                        .font(.nMicro).foregroundStyle(Nuru.ink600)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Nuru.ink300)
                            }
                            .padding(.vertical, 10)
                            .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                        }
                    }
                }
            }
        }
    }
}

private struct RisksCard: View {
    let overview: OverviewKpis?; let consents: Int; let stuck: Int
    var body: some View {
        let risks: [(String, Int, Color, String)] = [
            ("Members at risk", overview?.membersAtRisk ?? 0, Color(hex: 0xDC2626), "low attendance + missed reflections"),
            ("Reviews overdue (>3 days)", overview?.reviewsOverdue ?? 0, Color(hex: 0xDC2626), "pastoral queue"),
            ("Guardian consents to renew", consents, Color(hex: 0xD97706), "minors needing renewal"),
            ("Videos stuck encoding", stuck, Color(hex: 0xD97706), "queued in the pipeline"),
        ]
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Needs attention").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer()
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 13)).foregroundStyle(Nuru.danger)
                }
                VStack(spacing: 0) {
                    ForEach(Array(risks.enumerated()), id: \.offset) { i, r in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(r.0).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                                Text(r.3).font(.nMicro).foregroundStyle(Nuru.ink600)
                            }
                            Spacer()
                            Text("\(r.1)").font(.inter(11.5, .bold)).foregroundStyle(r.2)
                                .padding(.horizontal, 9).padding(.vertical, 3)
                                .background(r.2.opacity(0.1)).clipShape(Capsule())
                        }
                        .padding(.vertical, 10)
                        .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                    }
                }
            }
        }
    }
}

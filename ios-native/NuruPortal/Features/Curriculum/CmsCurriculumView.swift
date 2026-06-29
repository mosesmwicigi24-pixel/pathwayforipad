// CMS — Curriculum: a line-by-line native port of the web make
// (packages/admin-web/src/components/pages/CmsCurriculum.tsx) plus LevelDetail.tsx.
//
// CmsCurriculum: navy hero (4 stats + chips) · search + status filter pills ·
// "Curriculum pipeline" (4 status tiles) · "Pathway report" (Overview/Modules/
// Engagement tabs → status-mix donut, breakdown list, modules-per-level bars) ·
// "The pathway" vertical timeline of numbered level nodes with level cards. On the
// iPad canvas a right inspector rail shows the selected level's modules.
//
// LevelDetailView ports LevelDetail.tsx — the modules of a level with status,
// sequence and question counts; tapping a module drills into ModuleQuizView.
//
// Data: PortalAPI.curriculumLevels() (/admin/levels → [AdminLevel]) is the level
// list; PortalAPI.levels() (/admin/reports/levels → [LevelAnalyticsRow]) supplies
// per-level learners + the modules-per-level chart. Server-authoritative (§1.1):
// this is a read/inspect surface — authoring mutations live on the web portal.
import SwiftUI
import Charts

// MARK: - Page-local helpers

/// Parse a CSS hex string (`#C89B3C` / `C89B3C` / `#fff`) into a SwiftUI Color,
/// falling back to gold. Level rows carry their accent as a web hex string.
private func cssColor(_ s: String, fallback: Color = Nuru.gold) -> Color {
    var h = s.trimmingCharacters(in: .whitespaces)
    if h.hasPrefix("#") { h.removeFirst() }
    if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
    guard h.count == 6, let v = UInt32(h, radix: 16) else { return fallback }
    return Color(hex: v)
}

/// Web Status (Published / Draft / In Review / Archived) derived from the BE token.
private enum CmsStatus: String, CaseIterable {
    case published = "Published", inReview = "In Review", draft = "Draft", archived = "Archived"
    static func from(_ be: String) -> CmsStatus {
        switch be {
        case "published": return .published
        case "in_review": return .inReview
        case "archived":  return .archived
        default:          return .draft
        }
    }
    /// (background, foreground) matching the web statusStyle map.
    var style: (bg: Color, fg: Color) {
        switch self {
        case .published: return (Color(hex: 0xE8F6EE), Color(hex: 0x0F6B33))
        case .draft:     return (Color(hex: 0xEEF1F8), Color(hex: 0x1F3A6B))
        case .inReview:  return (Color(hex: 0xFDF5E5), Color(hex: 0x8A6B1F))
        case .archived:  return (Color(hex: 0xFDECEC), Color(hex: 0xA8281F))
        }
    }
}

/// One pathway level resolved for the UI (web UiLevel).
private struct UiLevel: Identifiable {
    let number: Int
    let title: String
    let theme: String
    let passMark: Int
    let modules: Int
    let completedModules: Int
    let learners: Int
    let duration: String
    let status: CmsStatus
    let locked: Bool
    let color: Color
    var id: Int { number }
    var progress: Int { modules > 0 ? Int((Double(completedModules) / Double(modules) * 100).rounded()) : 0 }
}

/// Combined load: levels + the learners-by-level report, merged into [UiLevel].
private struct CmsPayload { let levels: [UiLevel] }

private enum CmsLoader {
    static func load() async throws -> CmsPayload {
        async let levelsCall = PortalAPI.curriculumLevels()
        // The report is best-effort — learners default to 0 if it fails.
        let report = (try? await PortalAPI.levels()) ?? []
        let levels = try await levelsCall
        let learnersByLevel = Dictionary(report.map { ($0.levelNumber, $0.learners) }, uniquingKeysWith: { a, _ in a })
        let ui: [UiLevel] = levels.map { l in
            let published = Int(l.publishedCount) ?? 0
            let draft = Int(l.draftCount) ?? 0
            let archived = Int(l.archivedCount) ?? 0
            return UiLevel(
                number: l.levelNumber,
                title: l.title,
                theme: l.theme ?? "",
                passMark: 0,                                  // pass mark is per-module / exam-side; not on the list row
                modules: published + draft + archived,
                completedModules: published,
                learners: learnersByLevel[l.levelNumber] ?? 0,
                duration: l.duration ?? "—",
                status: CmsStatus.from(l.status),
                locked: l.locked,
                color: cssColor(l.color))
        }
        return CmsPayload(levels: ui.sorted { $0.number < $1.number })
    }
}

// MARK: - CmsCurriculumView

struct CmsCurriculumView: View {
    var title = "CMS — Curriculum"

    var body: some View {
        AsyncView(CmsLoader.load) { payload in
            CmsCurriculumContent(levels: payload.levels)
        }
        .portalPage(title)
    }
}

/// Stateful body — holds search / filter / report-tab / selection. Split out so the
/// AsyncView only owns the fetch.
private struct CmsCurriculumContent: View {
    let levels: [UiLevel]
    @Environment(\.horizontalSizeClass) private var hSize

    @State private var search = ""
    @State private var filter: FilterPill = .all
    @State private var reportTab: ReportTab = .overview
    @State private var selectedNo: Int?

    enum FilterPill: String, CaseIterable { case all = "All", published = "Published", inReview = "In Review", draft = "Draft" }
    enum ReportTab: String, CaseIterable { case overview = "Overview", modules = "Modules", engagement = "Engagement" }

    // Derived counts (web aggregates).
    private var published: Int { levels.filter { $0.status == .published }.count }
    private var inReview: Int { levels.filter { $0.status == .inReview }.count }
    private var drafts: Int { levels.filter { $0.status == .draft }.count }
    private var lockedCount: Int { levels.filter { $0.locked }.count }
    private var totalLearners: Int { levels.reduce(0) { $0 + $1.learners } }
    private var totalModules: Int { levels.reduce(0) { $0 + $1.modules } }

    private var filtered: [UiLevel] {
        let q = search.lowercased()
        return levels.filter { l in
            let matchSearch = q.isEmpty || l.title.lowercased().contains(q) || l.theme.lowercased().contains(q)
            let matchStatus: Bool
            switch filter {
            case .all:       matchStatus = true
            case .published: matchStatus = l.status == .published
            case .inReview:  matchStatus = l.status == .inReview
            case .draft:     matchStatus = l.status == .draft
            }
            return matchSearch && matchStatus
        }
    }

    private var selected: UiLevel? { levels.first { $0.number == selectedNo } }
    private var isPad: Bool { hSize == .regular }

    // Donut slices (web donutData) — Published / In Review / Drafts.
    private struct StatusSlice: Identifiable { let name: String; let value: Int; let color: Color; var id: String { name } }
    private var donutData: [StatusSlice] {
        [StatusSlice(name: "Published", value: published, color: Color(hex: 0x0F6B33)),
         StatusSlice(name: "In Review", value: inReview, color: Color(hex: 0xC89B3C)),
         StatusSlice(name: "Drafts", value: drafts, color: Color(hex: 0x1F3A6B))]
    }
    private var totalLevels: Int { donutData.reduce(0) { $0 + $1.value } }

    var body: some View {
        Group {
            if isPad {
                HStack(spacing: 0) {
                    mainScroll
                    if let sel = selected {
                        Divider()
                        LevelInspectorRail(level: sel).frame(width: 360)
                    }
                }
            } else {
                mainScroll
            }
        }
        .onAppear { if selectedNo == nil { selectedNo = levels.first?.number } }
    }

    private var mainScroll: some View {
        ScrollView {
            VStack(spacing: 20) {
                hero
                filtersCard
                pipelineCard
                reportCard
                pathwaySection
            }
            .padding(.horizontal, Nuru.S.screen)
            .padding(.vertical, Nuru.S.lg)
        }
        .frame(maxWidth: .infinity)
        .background(Nuru.paper)
    }

    // MARK: Hero

    private var hero: some View {
        PortalHero(
            breadcrumb: ["Nuru Pathway", "CMS", "Curriculum"],
            title: "Curriculum",
            subtitle: nil,
            stats: [
                HeroStat(label: "Published", value: "\(published)", hint: "of \(levels.count) levels"),
                HeroStat(label: "In review", value: "\(inReview)", hint: "awaiting approval"),
                HeroStat(label: "Drafts", value: "\(drafts)", hint: "in progress"),
                HeroStat(label: "Active learners", value: totalLearners.formatted(), hint: "across pathway"),
            ]
        ) {
            HStack(spacing: 8) {
                HeroChip(label: "\(levels.count)-Level Pathway", icon: "sparkles", style: .tag)
                HeroChip(label: "Pathway overview", icon: "book", style: .ghost)
                HeroChip(label: "New Level", icon: "plus", style: .gold)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.hero, style: .continuous))
        .nuruShadow()
    }

    // MARK: Filters

    private var filtersCard: some View {
        Card {
            VStack(spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Nuru.ink400)
                    TextField("Search levels or themes…", text: $search)
                        .font(.inter(14, .regular)).foregroundStyle(Nuru.ink)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                .padding(.horizontal, 12).frame(height: 40)
                .background(Nuru.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))

                HStack(spacing: 8) {
                    ForEach(FilterPill.allCases, id: \.self) { s in
                        let active = filter == s
                        Button { filter = s } label: {
                            Text(s.rawValue).font(.inter(12, .semibold))
                                .foregroundStyle(active ? .white : Nuru.ink600)
                                .padding(.horizontal, 14).frame(height: 36)
                                .background(active ? AnyShapeStyle(Nuru.navy) : AnyShapeStyle(Nuru.white))
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(active ? .clear : Nuru.border, lineWidth: 1))
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer(minLength: 0)
                    HStack(spacing: 5) {
                        Image(systemName: "sparkles").font(.system(size: 11)).foregroundStyle(Nuru.gold)
                        Text("\(filtered.count) of \(levels.count) levels").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                }
            }
        }
    }

    // MARK: Pipeline strip

    private var pipelineCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text("Curriculum pipeline").font(.inter(13, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
                    Text("LIVE").font(.nMicro).foregroundStyle(Nuru.goldLo)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Nuru.gold.opacity(0.14)).clipShape(Capsule())
                }
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                    PipelineTile(label: "Drafts", value: "\(drafts)", icon: "pencil.line", tint: Nuru.tint(0))
                    PipelineTile(label: "In review", value: "\(inReview)", icon: "eye", tint: Nuru.tint(1))
                    PipelineTile(label: "Locked", value: "\(lockedCount)", icon: "paperplane", tint: Nuru.tint(4))
                    PipelineTile(label: "Live", value: "\(published)", icon: "rosette", tint: Nuru.tint(2))
                }
            }
        }
    }

    // MARK: Pathway report

    private var reportCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pathway report").font(.nTitle).foregroundStyle(Nuru.navy)
                    Text("Authoring progress, status mix and modules across all levels.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                }
                // Tabs
                HStack(spacing: 6) {
                    ForEach(ReportTab.allCases, id: \.self) { t in
                        let active = reportTab == t
                        Button { reportTab = t } label: {
                            Text(t.rawValue).font(.inter(12.5, active ? .bold : .medium))
                                .foregroundStyle(active ? Nuru.navy : Nuru.ink600)
                                .padding(.horizontal, 14).frame(height: 30)
                                .background(active ? Nuru.white : .clear)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .nuruShadow(active ? 0.5 : 0)
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer(minLength: 0)
                }
                .padding(4)
                .background(Nuru.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                // Panels — donut, breakdown, modules-per-level bars.
                VStack(spacing: 14) {
                    statusMixTile
                    breakdownTile
                    modulesPerLevelTile
                }
                Text("Source: Curriculum CMS · \(totalLevels) levels covering \(totalModules) modules and \(totalLearners.formatted()) active learners.")
                    .font(.nMicro).foregroundStyle(Nuru.ink400)
            }
        }
    }

    private var statusMixTile: some View {
        SurfaceTile {
            VStack(alignment: .leading, spacing: 10) {
                Text("STATUS MIX").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                ZStack {
                    Chart(totalLevels == 0
                          ? [StatusSlice(name: "None", value: 1, color: Nuru.border)]
                          : donutData) { s in
                        SectorMark(angle: .value("Levels", s.value), innerRadius: .ratio(0.62), angularInset: 2)
                            .foregroundStyle(s.color).cornerRadius(3)
                    }
                    .frame(height: 160)
                    VStack(spacing: 2) {
                        Text("\(totalLevels)").font(.fraunces(26, .semibold)).foregroundStyle(Nuru.navy)
                        Text("LEVELS").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                    }
                }
            }
        }
    }

    private var breakdownTile: some View {
        SurfaceTile {
            VStack(alignment: .leading, spacing: 12) {
                Text("BREAKDOWN").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                ForEach(donutData) { d in
                    let pct = totalLevels > 0 ? Int((Double(d.value) / Double(totalLevels) * 100).rounded()) : 0
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            HStack(spacing: 8) {
                                Circle().fill(d.color).frame(width: 8, height: 8)
                                Text(d.name).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                            }
                            Spacer()
                            HStack(spacing: 4) {
                                Text("\(d.value)").font(.fraunces(15, .medium)).foregroundStyle(Nuru.navy)
                                Text("· \(pct)%").font(.nMicro).foregroundStyle(Nuru.ink600)
                            }
                        }
                        ProgressBar(pct: Double(pct), fill: d.color, height: 5)
                    }
                }
            }
        }
    }

    private struct ModuleBar: Identifiable { let name: String; let series: String; let value: Int; var id: String { "\(name)-\(series)" } }
    /// Flattened to two series per level (web's modules + done bars).
    private var moduleBars: [ModuleBar] {
        levels.flatMap { l in
            [ModuleBar(name: "L\(l.number)", series: "Modules", value: l.modules),
             ModuleBar(name: "L\(l.number)", series: "Done", value: l.completedModules)]
        }
    }

    private var modulesPerLevelTile: some View {
        SurfaceTile {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("MODULES PER LEVEL").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                    Spacer()
                    Image(systemName: "chart.bar").font(.system(size: 12)).foregroundStyle(Nuru.ink400)
                }
                Chart(moduleBars) { b in
                    BarMark(x: .value("Level", b.name), y: .value("Count", b.value), width: .fixed(10))
                        .foregroundStyle(by: .value("Series", b.series))
                        .position(by: .value("Series", b.series))
                        .cornerRadius(4)
                }
                .chartForegroundStyleScale(["Modules": Color(hex: 0xF4E4BD), "Done": Color(hex: 0xC89B3C)])
                .chartLegend(.hidden)
                .chartYAxis(.hidden)
                .chartXAxis {
                    AxisMarks { _ in
                        AxisValueLabel().font(.inter(10.5, .regular)).foregroundStyle(Nuru.ink600)
                    }
                }
                .frame(height: 160)
            }
        }
    }

    // MARK: The pathway (vertical timeline)

    private var pathwaySection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("The pathway").font(.nTitle).foregroundStyle(Nuru.navy)
                    Text("Tap any level to inspect its modules.").font(.nCaption).foregroundStyle(Nuru.ink600)
                }
                Spacer()
                HStack(spacing: 3) {
                    Text("View all").font(.inter(12, .semibold)).foregroundStyle(Nuru.goldLo)
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Nuru.goldLo)
                }
            }

            // Timeline rail + numbered nodes.
            ZStack(alignment: .topLeading) {
                Rectangle()
                    .fill(LinearGradient(colors: [Nuru.gold, Nuru.gold.opacity(0.2)], startPoint: .top, endPoint: .bottom))
                    .frame(width: 2)
                    .padding(.leading, 27).padding(.vertical, 28)
                VStack(spacing: 16) {
                    ForEach(filtered) { level in
                        PathwayRow(level: level, selected: selectedNo == level.number) {
                            selectedNo = level.number
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Pathway timeline row

private struct PathwayRow: View {
    let level: UiLevel
    let selected: Bool
    let onSelect: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            node
            card
        }
    }

    private var node: some View {
        ZStack {
            Circle()
                .fill(level.locked ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(level.color))
                .frame(width: 56, height: 56)
                .overlay(level.locked
                         ? Circle().strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 2, dash: [4])) : nil)
                .shadow(color: level.locked ? .clear : level.color.opacity(0.27), radius: 7, y: 4)
            if level.locked {
                Image(systemName: "lock.fill").font(.system(size: 16)).foregroundStyle(Nuru.ink600)
            } else {
                Text("\(level.number)").font(.fraunces(22, .medium)).foregroundStyle(.white)
            }
        }
    }

    private var card: some View {
        Button(action: onSelect) {
            VStack(spacing: 0) {
                Rectangle().fill(level.locked ? Nuru.border : level.color).frame(height: 2)
                VStack(alignment: .leading, spacing: 0) {
                    leftPane
                    Divider()
                    metricsPane
                }
            }
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
                .stroke(selected ? level.color : Nuru.border, lineWidth: selected ? 2 : 1))
            .nuruShadow(selected ? 1 : 0.4)
        }
        .buttonStyle(.plain)
    }

    private var leftPane: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                HStack(spacing: 5) {
                    Text("LEVEL \(level.number)").font(.inter(10, .bold)).tracking(1).foregroundStyle(level.color)
                    if level.locked { Image(systemName: "lock.fill").font(.system(size: 8)).foregroundStyle(Nuru.ink600) }
                }
                Spacer()
                statusBadge
            }
            Text(level.title).font(.fraunces(18, .medium)).foregroundStyle(Nuru.navy).fixedSize(horizontal: false, vertical: true)
            Text(level.theme.isEmpty ? "—" : level.theme).font(.nCaption).foregroundStyle(Nuru.ink600)
            HStack(spacing: 14) {
                Label(level.duration, systemImage: "clock").font(.nMicro).foregroundStyle(Nuru.ink600)
                Label(level.learners.formatted(), systemImage: "person.2").font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusBadge: some View {
        Text(level.status.rawValue).font(.inter(10, .bold))
            .foregroundStyle(level.status.style.fg)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(level.status.style.bg).clipShape(Capsule())
    }

    private var metricsPane: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text("PUBLISHED METRICS").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                Text("LIVE").font(.nMicro).foregroundStyle(Nuru.goldLo)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                metric("Pass mark", "\(level.passMark)%", "checkmark.seal", Nuru.tint(2))
                metric("Modules", "\(level.completedModules)/\(level.modules)", "book", Nuru.tint(1))
                metric("Duration", level.duration, "clock", Nuru.tint(0))
                metric("Learners", level.learners.formatted(), "person.2", Nuru.tint(3))
            }
            HStack(spacing: 8) {
                ProgressBar(pct: Double(level.progress), fill: level.locked ? Nuru.border : level.color, height: 5)
                Text("\(level.progress)%").font(.fraunces(11, .medium)).foregroundStyle(Nuru.navy)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
    }

    private func metric(_ label: String, _ value: String, _ icon: String, _ tint: Nuru.Tint) -> some View {
        HStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(tint.fg.opacity(0.14))
                Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundStyle(tint.fg)
            }.frame(width: 26, height: 26)
            VStack(alignment: .leading, spacing: 1) {
                Text(label.uppercased()).font(.inter(9, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                Text(value).font(.fraunces(14, .medium)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}

// MARK: - Level inspector rail (iPad right rail, web detail drawer)

private struct LevelInspectorRail: View {
    let level: UiLevel

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Level \(level.number) · \(level.status.rawValue)")
                        .font(.nMicro).foregroundStyle(level.color)
                    Spacer()
                    Image(systemName: "ellipsis").font(.system(size: 14)).foregroundStyle(Nuru.ink400)
                }
                Text(level.title).font(.fraunces(24, .semibold)).foregroundStyle(Nuru.navy)
                    .fixedSize(horizontal: false, vertical: true)
                Text(level.theme.isEmpty ? "—" : level.theme).font(.nCaption).foregroundStyle(Nuru.ink600)
                HStack(spacing: 0) {
                    railStat("Pass Mark", "\(level.passMark)%")
                    railStat("Modules", "\(level.modules)")
                    railStat("Learners", level.learners.formatted())
                }
                .padding(.top, 4)
            }
            .padding(20)
            Divider()

            // Modules list (live).
            HStack {
                Text("MODULES").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                Spacer()
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            Divider()

            AsyncView({ try await PortalAPI.modules(level: level.number) }) { modules in
                if modules.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "book").font(.system(size: 26)).foregroundStyle(Nuru.ink300)
                        Text("No modules yet").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink600)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 40)
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(modules.sorted { $0.moduleSequenceNumber < $1.moduleSequenceNumber }) { m in
                                moduleRow(m)
                                Divider()
                            }
                        }
                    }
                }
            }

            // Footer actions
            Divider()
            HStack(spacing: 8) {
                Text("Edit Level").font(.inter(13, .semibold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).frame(height: 44)
                    .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                NavigationLink {
                    LevelDetailView(levelNumber: level.number, levelTitle: level.title, accent: level.color)
                } label: {
                    Text("Open →").font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                        .frame(maxWidth: .infinity).frame(height: 44)
                        .background(Nuru.white)
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(16)
        }
        .background(Nuru.white)
    }

    private func railStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.fraunces(20, .medium)).foregroundStyle(Nuru.navy)
            Text(label).font(.nMicro).foregroundStyle(Nuru.ink600)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func moduleRow(_ m: AdminModuleSummary) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Nuru.surface)
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                Image(systemName: moduleIcon(m.evaluationKind)).font(.system(size: 13)).foregroundStyle(moduleIconColor(m.evaluationKind))
            }.frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(m.moduleSequenceNumber). \(m.title)").font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                Text(moduleSub(m)).font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            Spacer(minLength: 0)
            Text(m.status).font(.inter(10.5, .bold))
                .foregroundStyle(m.status == "published" ? Color(hex: 0x0F6B33) : Color(hex: 0x1F3A6B))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(m.status == "published" ? Color(hex: 0xE8F6EE) : Color(hex: 0xEEF1F8))
                .clipShape(Capsule())
        }
        .padding(.horizontal, 20).padding(.vertical, 11)
    }

    private func moduleSub(_ m: AdminModuleSummary) -> String {
        let kind = m.evaluationKind == "none" ? "lesson" : m.evaluationKind
        let q = (Int(m.activeQuestionCount) ?? 0)
        return q > 0 ? "\(kind) · \(q) Q" : kind
    }
}

// Module type icon mapping (web TypeIcon).
private func moduleIcon(_ kind: String) -> String {
    switch kind {
    case "quiz", "exit_exam": return "questionmark.circle"
    case "reflection":        return "video"
    default:                  return "doc.text"
    }
}
private func moduleIconColor(_ kind: String) -> Color {
    switch kind {
    case "quiz", "exit_exam": return Color(hex: 0x5B2BB8)
    case "reflection":        return Color(hex: 0x8A6B1F)
    default:                  return Nuru.navy
    }
}

// MARK: - LevelDetailView (web LevelDetail.tsx — level's modules → quiz drilldown)

struct LevelDetailView: View {
    let levelNumber: Int
    let levelTitle: String
    var accent: Color = Nuru.gold

    /// Convenience for call sites that hold a decoded AdminLevel.
    init(level: AdminLevel) {
        self.levelNumber = level.levelNumber
        self.levelTitle = level.title
        self.accent = cssColor(level.color)
    }
    init(levelNumber: Int, levelTitle: String, accent: Color = Nuru.gold) {
        self.levelNumber = levelNumber
        self.levelTitle = levelTitle
        self.accent = accent
    }

    var body: some View {
        AsyncView({ try await PortalAPI.modules(level: levelNumber) }) { modules in
            ScrollView {
                VStack(spacing: 16) {
                    header(modules: modules)
                    if modules.isEmpty {
                        ContentUnavailableView("No modules yet", systemImage: "book",
                                               description: Text("This level has no modules."))
                            .padding(.top, 40)
                    } else {
                        VStack(spacing: 10) {
                            ForEach(modules.sorted { $0.moduleSequenceNumber < $1.moduleSequenceNumber }) { m in
                                NavigationLink { ModuleQuizView(module: m) } label: { moduleCard(m) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(Nuru.S.screen)
            }
        }
        .portalPage(levelTitle.isEmpty ? "Level Detail" : levelTitle)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func header(modules: [AdminModuleSummary]) -> some View {
        let published = modules.filter { $0.status == "published" }.count
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(accent).frame(width: 6, height: 6)
                Text(levelNumber > 0 ? "L\(levelNumber) · \(levelTitle)" : levelTitle)
                    .font(.inter(11, .bold)).foregroundStyle(accent)
            }
            Text("Levels & Modules").font(.nTitle).foregroundStyle(Nuru.navy)
            HStack(spacing: 10) {
                miniStat("Modules", "\(modules.count)")
                miniStat("Published", "\(published)")
                miniStat("Draft", "\(modules.count - published)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func miniStat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 1) {
            Text(value).font(.fraunces(20, .medium)).foregroundStyle(Nuru.navy)
            Text(label.uppercased()).font(.inter(9.5, .semibold)).tracking(0.8).foregroundStyle(Nuru.ink600)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(Nuru.surface).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func moduleCard(_ m: AdminModuleSummary) -> some View {
        Card {
            HStack(spacing: 12) {
                Text("\(m.moduleSequenceNumber)").font(.inter(13, .bold))
                    .foregroundStyle(.white).frame(width: 28, height: 28)
                    .background(accent).clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(m.title).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                    if let s = m.summary, !s.isEmpty {
                        Text(s).font(.nCaption).foregroundStyle(Nuru.ink600).lineLimit(2)
                    }
                    HStack(spacing: 6) {
                        let st = CmsStatus.from(m.status)
                        Text(m.status.uppercased()).font(.inter(9.5, .bold))
                            .foregroundStyle(st.style.fg)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(st.style.bg).clipShape(Capsule())
                        Pill(text: m.evaluationKind == "none" ? "lesson" : m.evaluationKind, color: Nuru.navy)
                        let q = Int(m.activeQuestionCount) ?? 0
                        if q > 0 { Pill(text: "\(q) Q", color: Nuru.gold) }
                    }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.nCaption).foregroundStyle(Nuru.ink400)
            }
        }
    }
}

// MARK: - ModuleQuizView (module question bank — unchanged shape)

struct ModuleQuizView: View {
    let module: AdminModuleSummary
    var body: some View {
        AsyncView({ try await PortalAPI.questions(moduleId: module.moduleId) }) { questions in
            if questions.isEmpty {
                ContentUnavailableView("No questions", systemImage: "questionmark.circle",
                                       description: Text("This module has no quiz questions yet."))
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(Array(questions.enumerated()), id: \.element.id) { idx, q in
                            Card {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(alignment: .top) {
                                        Text("Q\(idx + 1)").font(.inter(13, .bold)).foregroundStyle(Nuru.gold)
                                        Text(q.questionText).font(.inter(15, .medium)).foregroundStyle(Nuru.navy)
                                        Spacer()
                                        if !q.isActive { Pill(text: "Inactive", color: Nuru.muted) }
                                    }
                                    if !q.correctAnswer.isEmpty {
                                        Label(q.correctAnswer, systemImage: "checkmark.circle.fill")
                                            .font(.nCaption).foregroundStyle(Nuru.success)
                                    }
                                    if let e = q.explanation, !e.isEmpty {
                                        Text(e).font(.nCaption).foregroundStyle(Nuru.muted)
                                    }
                                    HStack(spacing: 6) {
                                        Pill(text: q.qType.replacingOccurrences(of: "_", with: " ").capitalized, color: Nuru.navy)
                                        Pill(text: "\(q.points) pts", color: Nuru.gold)
                                        if q.required { Pill(text: "Required", color: Nuru.danger) }
                                    }
                                }
                            }
                        }
                    }
                    .padding(20)
                }
            }
        }
        .portalPage(module.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

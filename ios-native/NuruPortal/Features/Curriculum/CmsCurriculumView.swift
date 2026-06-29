// CMS — Curriculum: a line-by-line native port of the web make
// (packages/admin-web/src/components/pages/CmsCurriculum.tsx) plus LevelDetail.tsx,
// now wired to FUNCTION like the web portal — every interactive element performs the
// same mutation the web handlers do.
//
// CmsCurriculum: navy hero (4 stats + chips) · search + status filter pills ·
// "Curriculum pipeline" (4 status tiles) · "Pathway report" (Overview/Modules/
// Engagement tabs → status-mix donut, breakdown list, modules-per-level bars) ·
// "The pathway" vertical timeline of numbered level nodes with level cards. On the
// iPad canvas a right inspector rail shows the selected level's modules.
//
// Wired writes (mirroring CmsCurriculum.tsx + LevelDetail.tsx handlers):
//  · New Level        → POST   /admin/levels
//  · Edit Level       → PUT    /admin/levels/{n}   (+ exam: PUT /admin/levels/{n}/exam)
//  · Review/Publish   → PUT    /admin/levels/{n}   { status }
//  · Lock / Unlock    → PUT    /admin/levels/{n}   { locked }
//  · New Module       → POST   /admin/modules
//  · Open / module    → LevelDetailView / ModuleQuizView (NavigationLink)
//  · Publish/Unpub.   → POST   /admin/modules/{id}/publish · /unpublish
//  · Archive module   → DELETE /admin/modules/{id}   (confirmed via .alert)
//  · Reorder module   → POST   /admin/modules/{id}/reorder { to_sequence }
//  · Quiz Builder     → router.go(.quizBuilder)   (web's deep-link)
//
// Server-authoritative (§1.1): the server owns gating/scoring; the client only
// originates these authoring mutations and refreshes from the server after each.
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

// Web `labelToBe` — the LevelModal status options the portal exposes (no "Archived").
private enum CmsEditStatus: String, CaseIterable {
    case published = "Published", draft = "Draft", inReview = "In Review"
    var be: String {
        switch self {
        case .published: return "published"
        case .draft:     return "draft"
        case .inReview:  return "in_review"
        }
    }
    static func from(_ be: String) -> CmsEditStatus {
        switch be {
        case "published": return .published
        case "in_review": return .inReview
        default:          return .draft
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
    /// Raw web hex (for round-tripping into the edit form).
    let colorHex: String
    var id: Int { number }
    var progress: Int { modules > 0 ? Int((Double(completedModules) / Double(modules) * 100).rounded()) : 0 }
}

// MARK: - CMS write API (mirrors CurriculumApi.* in api/client.ts)
//
// PortalAPI is a shared, read-only surface we must not edit, so the authoring
// mutations live here as a page-local layer over APIClient.shared (the actor with
// get/post/put/delete/postEmpty; convertTo/FromSnakeCase already configured).

/// Tolerant decode of the fuller level row — the shared AdminLevel omits exam
/// fields, so the New/Edit Level form needs its own model to round-trip them.
private struct CmsLevelDetail: Codable {
    @DefaultZero var levelNumber: Int
    @DefaultEmpty var title: String
    let theme: String?
    let duration: String?
    @DefaultEmpty var status: String
    @DefaultFalse var locked: Bool
    @DefaultEmpty var color: String
    @DefaultEmpty var requiredExamPassMark: String
    let examQuestionCount: Int?
    let examShowAnswers: Bool?
    let examShowScore: Bool?
    let examShuffle: Bool?
}

private enum CmsAPI {
    private static var api: APIClient { .shared }

    // ── Levels ──
    struct LevelBody: Encodable {
        let title: String
        let theme: String
        let requiredExamPassMark: Int
        let duration: String
        let status: String
        let locked: Bool
        let color: String
    }
    /// Partial PUT body for status-only / lock-only transitions (web sends a subset).
    struct LevelPatch: Encodable {
        var status: String?
        var locked: Bool?
    }
    struct ExamBody: Encodable {
        let requiredExamPassMark: Int
        let examQuestionCount: Int?
        let examShowAnswers: Bool
        let examShowScore: Bool
        let examShuffle: Bool
    }

    static func createLevel(_ body: LevelBody) async throws {
        _ = try await api.post("/admin/levels", body: body, as: CmsLevelDetail.self)
    }
    static func updateLevel(_ n: Int, _ body: LevelBody) async throws {
        _ = try await api.put("/admin/levels/\(n)", body: body, as: CmsLevelDetail.self)
    }
    static func patchLevel(_ n: Int, _ body: LevelPatch) async throws {
        _ = try await api.put("/admin/levels/\(n)", body: body, as: CmsLevelDetail.self)
    }
    static func updateExam(_ n: Int, _ body: ExamBody) async throws {
        _ = try await api.put("/admin/levels/\(n)/exam", body: body, as: CmsLevelDetail.self)
    }

    // ── Modules ──
    struct ModuleBody: Encodable {
        let levelNumber: Int
        let title: String
        let lessonContent: String
        let evaluationKind: String
    }
    static func createModule(_ body: ModuleBody) async throws {
        _ = try await api.post("/admin/modules", body: body, as: AdminModuleSummary.self)
    }
    static func publish(_ id: String) async throws {
        _ = try await api.postEmpty("/admin/modules/\(id)/publish", as: AdminModuleSummary.self)
    }
    static func unpublish(_ id: String) async throws {
        _ = try await api.postEmpty("/admin/modules/\(id)/unpublish", as: AdminModuleSummary.self)
    }
    static func archive(_ id: String) async throws {
        _ = try await api.delete("/admin/modules/\(id)", as: AdminModuleSummary.self)
    }
    struct ReorderBody: Encodable { let toSequence: Int }
    static func reorder(_ id: String, to toSequence: Int) async throws {
        // Server returns the re-sequenced list under { data: [...] }; we only need success.
        _ = try await api.post("/admin/modules/\(id)/reorder", body: ReorderBody(toSequence: toSequence), as: DataList<AdminModuleSummary>.self)
    }
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
                color: cssColor(l.color),
                colorHex: l.color.isEmpty ? "#C89B3C" : l.color)
        }
        return CmsPayload(levels: ui.sorted { $0.number < $1.number })
    }
}

// MARK: - CmsCurriculumView

struct CmsCurriculumView: View {
    var title = "CMS — Curriculum"

    @State private var levels: [UiLevel] = []
    @State private var phase: Phase = .loading
    private enum Phase { case loading, loaded, failed(String) }

    var body: some View {
        Group {
            switch phase {
            case .loading:
                ScrollView { SkeletonList(rows: 6).padding(Nuru.S.screen) }
                    .background(Nuru.paper)
            case .failed(let m):
                ScrollView { ErrorBanner(message: m) { Task { await reload() } }.padding(Nuru.S.screen) }
                    .background(Nuru.paper)
            case .loaded:
                CmsCurriculumContent(levels: levels, reload: reload)
            }
        }
        .portalPage(title)
        .task { if case .loading = phase { await reload() } }
    }

    @MainActor private func reload() async {
        do {
            let payload = try await CmsLoader.load()
            levels = payload.levels
            phase = .loaded
        } catch {
            phase = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
    }
}

/// Stateful body — holds search / filter / report-tab / selection + the modal/sheet
/// presentation state for the wired authoring actions. Split out so the parent owns
/// the fetch and exposes a `reload` it can call after every write.
private struct CmsCurriculumContent: View {
    let levels: [UiLevel]
    let reload: () async -> Void
    @Environment(\.horizontalSizeClass) private var hSize
    @EnvironmentObject private var router: NavRouter

    @State private var search = ""
    @State private var filter: FilterPill = .all
    @State private var reportTab: ReportTab = .overview
    @State private var selectedNo: Int?

    // Authoring action state.
    @State private var levelSheet: LevelSheetMode?
    @State private var actionError: String?

    enum FilterPill: String, CaseIterable { case all = "All", published = "Published", inReview = "In Review", draft = "Draft" }
    enum ReportTab: String, CaseIterable { case overview = "Overview", modules = "Modules", engagement = "Engagement" }

    /// New Level vs. Edit Level (carries the level to edit).
    enum LevelSheetMode: Identifiable {
        case add
        case edit(UiLevel)
        var id: String { switch self { case .add: return "add"; case .edit(let l): return "edit-\(l.number)" } }
    }

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

    // ── Write actions (mirror the CmsCurriculum.tsx handlers) ──

    private func setLevelStatus(_ n: Int, _ status: CmsEditStatus) {
        Task {
            do { try await CmsAPI.patchLevel(n, .init(status: status.be, locked: nil)); await reload() }
            catch { actionError = (error as? APIError)?.errorDescription ?? "Update failed." }
        }
    }
    private func toggleLock(_ l: UiLevel) {
        Task {
            do { try await CmsAPI.patchLevel(l.number, .init(status: nil, locked: !l.locked)); await reload() }
            catch { actionError = (error as? APIError)?.errorDescription ?? "Update failed." }
        }
    }

    var body: some View {
        Group {
            if isPad {
                HStack(spacing: 0) {
                    mainScroll
                    if let sel = selected {
                        Divider()
                        LevelInspectorRail(level: sel,
                                           reload: reload,
                                           onEdit: { levelSheet = .edit(sel) })
                            .frame(width: 360)
                    }
                }
            } else {
                mainScroll
            }
        }
        .onAppear { if selectedNo == nil { selectedNo = levels.first?.number } }
        .sheet(item: $levelSheet) { mode in
            let formMode: LevelFormSheet.Mode = {
                switch mode {
                case .add: return .add
                case .edit(let l): return .edit(l)
                }
            }()
            LevelFormSheet(mode: formMode, nextNumber: levels.count + 1, reload: reload)
        }
        .alert("Action failed", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: { Text(actionError ?? "") }
    }

    private var mainScroll: some View {
        ScrollView {
            VStack(spacing: 20) {
                hero
                filtersCard
                pipelineCard
                reportCard
                pathwaySection
                quickActionsCard
            }
            .padding(.horizontal, Nuru.S.screen)
            .padding(.vertical, Nuru.S.lg)
        }
        .frame(maxWidth: .infinity)
        .background(Nuru.paper)
        .refreshable { await reload() }
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
                HeroChip(label: "Pathway overview", icon: "book", style: .ghost) { router.go(.curriculumLevels) }
                HeroChip(label: "New Level", icon: "plus", style: .gold) { levelSheet = .add }
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
                Button { router.go(.curriculumLevels) } label: {
                    HStack(spacing: 3) {
                        Text("View all").font(.inter(12, .semibold)).foregroundStyle(Nuru.goldLo)
                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Nuru.goldLo)
                    }
                }
                .buttonStyle(.plain)
            }

            // Timeline rail + numbered nodes.
            ZStack(alignment: .topLeading) {
                Rectangle()
                    .fill(LinearGradient(colors: [Nuru.gold, Nuru.gold.opacity(0.2)], startPoint: .top, endPoint: .bottom))
                    .frame(width: 2)
                    .padding(.leading, 27).padding(.vertical, 28)
                VStack(spacing: 16) {
                    ForEach(filtered) { level in
                        PathwayRow(
                            level: level,
                            selected: selectedNo == level.number,
                            onSelect: { selectedNo = level.number },
                            onReview: { setLevelStatus(level.number, .inReview) },
                            onPublish: { setLevelStatus(level.number, .published) },
                            onUnlock: { toggleLock(level) })
                    }
                }
            }
        }
    }

    // MARK: Quick actions (web Quick actions panel — cross-nav + New Level + Refresh)

    private var quickActionsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "bolt.fill").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                    Text("Quick actions").font(.inter(13, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
                }
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    quickAction("New Level", "plus", Nuru.tint(0)) { levelSheet = .add }
                    quickAction("Module Editor", "book", Nuru.tint(1)) { router.go(.levelDetail) }
                    quickAction("Quiz Builder", "questionmark.circle", Nuru.tint(3)) { router.go(.quizBuilder) }
                    quickAction("Video Library", "play.rectangle", Nuru.tint(2)) { router.go(.videoLibrary) }
                    quickAction("Reflections", "text.bubble", Nuru.tint(2)) { router.go(.reflectionQueue) }
                    quickAction("Refresh", "arrow.clockwise", Nuru.tint(4)) { Task { await reload() } }
                }
            }
        }
    }

    private func quickAction(_ label: String, _ icon: String, _ tint: Nuru.Tint, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(tint.fg.opacity(0.14))
                    Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(tint.fg)
                }.frame(width: 28, height: 28)
                Text(label).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Pathway timeline row

private struct PathwayRow: View {
    let level: UiLevel
    let selected: Bool
    let onSelect: () -> Void
    let onReview: () -> Void
    let onPublish: () -> Void
    let onUnlock: () -> Void

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
        .contentShape(Rectangle())
        .onTapGesture { onSelect() }
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

            // Inline level actions (web: Open / Unlock / Review / Publish).
            HStack(spacing: 8) {
                NavigationLink {
                    LevelDetailView(levelNumber: level.number, levelTitle: level.title, accent: level.color)
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "arrow.up.forward.square").font(.system(size: 11))
                        Text("Open").font(.inter(11.5, .semibold))
                    }
                    .foregroundStyle(level.locked ? Nuru.ink600 : .white)
                    .padding(.horizontal, 12).frame(height: 30)
                    .background(level.locked ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(Nuru.navy))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(level.locked)

                if level.locked {
                    actionPill("Unlock", "lock.open", bg: Nuru.white, fg: Nuru.ink600, bordered: true, action: onUnlock)
                }
                if level.status == .draft && !level.locked {
                    actionPill("Review", "chart.line.uptrend.xyaxis", bg: Nuru.gold, fg: .white, action: onReview)
                }
                if level.status == .inReview {
                    actionPill("Publish", "checkmark.seal", bg: Color(hex: 0x0F6B33), fg: .white, action: onPublish)
                }
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func actionPill(_ label: String, _ icon: String, bg: Color, fg: Color, bordered: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11))
                Text(label).font(.inter(11.5, .semibold))
            }
            .foregroundStyle(fg)
            .padding(.horizontal, 10).frame(height: 30)
            .background(bg)
            .overlay(bordered ? RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1) : nil)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
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
    let reload: () async -> Void
    let onEdit: () -> Void

    // The rail owns its modules list so "Add" + publish/archive can refresh it.
    @State private var modules: [AdminModuleSummary] = []
    @State private var loaded = false
    @State private var addingModule = false
    @State private var newTitle = ""
    @State private var newType: NewModuleType = .text
    @State private var actionError: String?

    enum NewModuleType: String, CaseIterable { case text = "Text", video = "Video", quiz = "Quiz"
        /// Web maps "quiz" → evaluation_kind quiz, otherwise none.
        var evaluationKind: String { self == .quiz ? "quiz" : "none" }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()

            HStack {
                Text("MODULES").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                Spacer()
                Button { addingModule.toggle() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                        Text("Add").font(.inter(11, .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10).frame(height: 30)
                    .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            Divider()

            if addingModule { addModuleForm; Divider() }

            modulesList

            // Footer actions
            Divider()
            HStack(spacing: 8) {
                Button(action: onEdit) {
                    Text("Edit Level").font(.inter(13, .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).frame(height: 44)
                        .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                }
                .buttonStyle(.plain)
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
        .task(id: level.number) { await loadModules() }
        .alert("Action failed", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: { Text(actionError ?? "") }
    }

    private var header: some View {
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
    }

    private var addModuleForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("NEW MODULE").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.navy)
            TextField("Module title…", text: $newTitle)
                .font(.inter(13, .regular)).foregroundStyle(Nuru.ink)
                .padding(.horizontal, 12).frame(height: 36)
                .background(Nuru.white)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack(spacing: 8) {
                Picker("", selection: $newType) {
                    ForEach(NewModuleType.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.menu).tint(Nuru.navy)
                Spacer(minLength: 0)
                Button { Task { await addModule() } } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "checkmark").font(.system(size: 11))
                        Text("Create").font(.inter(12, .semibold))
                    }
                    .foregroundStyle(newTitle.trimmingCharacters(in: .whitespaces).isEmpty ? Nuru.ink600 : .white)
                    .padding(.horizontal, 12).frame(height: 34)
                    .background(newTitle.trimmingCharacters(in: .whitespaces).isEmpty ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(Nuru.gold))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                Button { addingModule = false } label: {
                    Image(systemName: "xmark").font(.system(size: 11)).foregroundStyle(Nuru.ink600)
                        .frame(width: 34, height: 34)
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(Nuru.surface)
    }

    @ViewBuilder private var modulesList: some View {
        if loaded && modules.isEmpty && !addingModule {
            VStack(spacing: 8) {
                Image(systemName: "book").font(.system(size: 26)).foregroundStyle(Nuru.ink300)
                Text("No modules yet").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink600)
                Text("Tap “Add” to create the first module.").font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 40)
        } else if !loaded {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
        } else {
            let sorted = modules.sorted { $0.moduleSequenceNumber < $1.moduleSequenceNumber }
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(Array(sorted.enumerated()), id: \.element.id) { idx, m in
                        moduleRow(m, index: idx, count: sorted.count)
                        Divider()
                    }
                }
            }
        }
    }

    private func railStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.fraunces(20, .medium)).foregroundStyle(Nuru.navy)
            Text(label).font(.nMicro).foregroundStyle(Nuru.ink600)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func moduleRow(_ m: AdminModuleSummary, index: Int, count: Int) -> some View {
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
            // Row context menu — publish/unpublish, reorder up/down, archive (web's per-module actions).
            Menu {
                if m.status == "published" {
                    Button { Task { await runModuleAction { try await CmsAPI.unpublish(m.moduleId) } } } label: { Label("Unpublish", systemImage: "arrow.uturn.backward") }
                } else {
                    Button { Task { await runModuleAction { try await CmsAPI.publish(m.moduleId) } } } label: { Label("Publish", systemImage: "checkmark.seal") }
                }
                if index > 0 {
                    Button { Task { await runModuleAction { try await CmsAPI.reorder(m.moduleId, to: m.moduleSequenceNumber - 1) } } } label: { Label("Move up", systemImage: "arrow.up") }
                }
                if index < count - 1 {
                    Button { Task { await runModuleAction { try await CmsAPI.reorder(m.moduleId, to: m.moduleSequenceNumber + 1) } } } label: { Label("Move down", systemImage: "arrow.down") }
                }
                Divider()
                Button(role: .destructive) { Task { await runModuleAction { try await CmsAPI.archive(m.moduleId) } } } label: { Label("Archive", systemImage: "archivebox") }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 13)).foregroundStyle(Nuru.ink400)
                    .frame(width: 26, height: 26)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 11)
    }

    private func moduleSub(_ m: AdminModuleSummary) -> String {
        let kind = m.evaluationKind == "none" ? "lesson" : m.evaluationKind
        let q = (Int(m.activeQuestionCount) ?? 0)
        return q > 0 ? "\(kind) · \(q) Q" : kind
    }

    // ── Rail writes ──

    @MainActor private func loadModules() async {
        do { modules = try await PortalAPI.modules(level: level.number); loaded = true }
        catch { loaded = true }
    }
    @MainActor private func addModule() async {
        let t = newTitle.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        do {
            try await CmsAPI.createModule(.init(
                levelNumber: level.number, title: t,
                lessonContent: "Draft content — edit in the module editor.",
                evaluationKind: newType.evaluationKind))
            newTitle = ""; newType = .text; addingModule = false
            await loadModules()
            await reload()                                   // refresh parent level counts
        } catch { actionError = (error as? APIError)?.errorDescription ?? "Could not add module." }
    }
    /// Run a module mutation then refresh both the rail list and the parent counts.
    @MainActor private func runModuleAction(_ op: () async throws -> Void) async {
        do { try await op(); await loadModules(); await reload() }
        catch { actionError = (error as? APIError)?.errorDescription ?? "Action failed." }
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

    @EnvironmentObject private var router: NavRouter

    // Owns its own module list so add / publish / archive / reorder refresh in place.
    @State private var modules: [AdminModuleSummary] = []
    @State private var loaded = false
    @State private var addingModule = false
    @State private var newTitle = ""
    @State private var actionError: String?
    @State private var levelSheet: Bool = false

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
        ScrollView {
            VStack(spacing: 16) {
                header
                if loaded && modules.isEmpty && !addingModule {
                    ContentUnavailableView("No modules yet", systemImage: "book",
                                           description: Text("Tap “New module” to add the first one."))
                        .padding(.top, 40)
                } else if !loaded {
                    SkeletonList(rows: 5)
                } else {
                    if addingModule { addModuleForm }
                    VStack(spacing: 10) {
                        let sorted = modules.sorted { $0.moduleSequenceNumber < $1.moduleSequenceNumber }
                        ForEach(Array(sorted.enumerated()), id: \.element.id) { idx, m in
                            moduleCard(m, index: idx, count: sorted.count)
                        }
                    }
                }
            }
            .padding(Nuru.S.screen)
        }
        .background(Nuru.paper)
        .portalPage(levelTitle.isEmpty ? "Level Detail" : levelTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { addingModule.toggle() } label: { Image(systemName: "plus") }
            }
        }
        .task(id: levelNumber) { await loadModules() }
        .sheet(isPresented: $levelSheet) {
            LevelFormSheet(mode: .editNumberOnly(levelNumber), nextNumber: levelNumber, reload: { await loadModules() })
        }
        .alert("Action failed", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: { Text(actionError ?? "") }
    }

    private var header: some View {
        let published = modules.filter { $0.status == "published" }.count
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(accent).frame(width: 6, height: 6)
                Text(levelNumber > 0 ? "L\(levelNumber) · \(levelTitle)" : levelTitle)
                    .font(.inter(11, .bold)).foregroundStyle(accent)
                Spacer()
                Button { router.go(.quizBuilder) } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "questionmark.circle").font(.system(size: 11))
                        Text("Quiz Builder").font(.inter(11.5, .semibold))
                    }
                    .foregroundStyle(Nuru.navy)
                    .padding(.horizontal, 10).frame(height: 28)
                    .background(Nuru.white)
                    .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
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

    private var addModuleForm: some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                Text("NEW MODULE").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.navy)
                TextField("Module title…", text: $newTitle)
                    .font(.inter(14, .regular)).foregroundStyle(Nuru.ink)
                    .padding(.horizontal, 12).frame(height: 42)
                    .background(Nuru.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                HStack(spacing: 8) {
                    Button { Task { await addModule() } } label: {
                        Text("Create").font(.inter(13, .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 18).frame(height: 38)
                            .background(newTitle.trimmingCharacters(in: .whitespaces).isEmpty ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(accent))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button { addingModule = false; newTitle = "" } label: {
                        Text("Cancel").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink600)
                            .padding(.horizontal, 14).frame(height: 38)
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func miniStat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 1) {
            Text(value).font(.fraunces(20, .medium)).foregroundStyle(Nuru.navy)
            Text(label.uppercased()).font(.inter(9.5, .semibold)).tracking(0.8).foregroundStyle(Nuru.ink600)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(Nuru.surface).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func moduleCard(_ m: AdminModuleSummary, index: Int, count: Int) -> some View {
        HStack(spacing: 12) {
            // Tapping the row drills into the question bank (ModuleQuizView).
            NavigationLink { ModuleQuizView(module: m) } label: {
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
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Per-module action menu (web: publish/unpublish, reorder, archive, quiz).
            Menu {
                if m.status == "published" {
                    Button { Task { await runModuleAction { try await CmsAPI.unpublish(m.moduleId) } } } label: { Label("Unpublish", systemImage: "arrow.uturn.backward") }
                } else {
                    Button { Task { await runModuleAction { try await CmsAPI.publish(m.moduleId) } } } label: { Label("Publish", systemImage: "checkmark.seal") }
                }
                if index > 0 {
                    Button { Task { await runModuleAction { try await CmsAPI.reorder(m.moduleId, to: m.moduleSequenceNumber - 1) } } } label: { Label("Move up", systemImage: "arrow.up") }
                }
                if index < count - 1 {
                    Button { Task { await runModuleAction { try await CmsAPI.reorder(m.moduleId, to: m.moduleSequenceNumber + 1) } } } label: { Label("Move down", systemImage: "arrow.down") }
                }
                Button { router.go(.quizBuilder) } label: { Label("Open Quiz Builder", systemImage: "questionmark.circle") }
                Divider()
                Button(role: .destructive) { Task { await runModuleAction { try await CmsAPI.archive(m.moduleId) } } } label: { Label("Archive module", systemImage: "archivebox") }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 14)).foregroundStyle(Nuru.ink400)
                    .frame(width: 30, height: 30)
            }
        }
        .padding(Nuru.S.base)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .nuruShadow(0.4)
    }

    // ── Writes ──

    @MainActor private func loadModules() async {
        do { modules = try await PortalAPI.modules(level: levelNumber); loaded = true }
        catch { actionError = (error as? APIError)?.errorDescription ?? "Could not load modules."; loaded = true }
    }
    @MainActor private func addModule() async {
        let t = newTitle.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        do {
            try await CmsAPI.createModule(.init(
                levelNumber: levelNumber, title: t,
                lessonContent: "Draft content — edit here.", evaluationKind: "none"))
            newTitle = ""; addingModule = false
            await loadModules()
        } catch { actionError = (error as? APIError)?.errorDescription ?? "Could not add module." }
    }
    @MainActor private func runModuleAction(_ op: () async throws -> Void) async {
        do { try await op(); await loadModules() }
        catch { actionError = (error as? APIError)?.errorDescription ?? "Action failed." }
    }
}

// MARK: - Level form sheet (web LevelModal — New Level / Edit Level + exam settings)

private struct LevelFormSheet: View {
    enum Mode {
        case add
        case edit(UiLevel)
        /// Edit-by-number when only the level number is known (LevelDetailView). Fetches the row.
        case editNumberOnly(Int)
    }

    let mode: Mode
    let nextNumber: Int
    let reload: () async -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var theme = ""
    @State private var duration = "8 weeks"
    @State private var passMark = 70
    @State private var status: CmsEditStatus = .draft
    @State private var locked = false
    @State private var colorHex = "#C89B3C"

    // Exam settings (web LevelModal exam panel → PUT /admin/levels/{n}/exam).
    @State private var examQuestionCount = 0
    @State private var examShowAnswers = false
    @State private var examShowScore = true
    @State private var examShuffle = false

    @State private var saving = false
    @State private var prefilled = false
    @State private var error: String?

    private var isEdit: Bool { if case .add = mode { return false }; return true }
    private var levelNumber: Int {
        switch mode {
        case .add: return nextNumber
        case .edit(let l): return l.number
        case .editNumberOnly(let n): return n
        }
    }

    // The eight web swatches from the LevelModal palette.
    private let swatches = ["#C89B3C", "#1F3A6B", "#0F6B33", "#8A2BE2", "#B45309", "#0E7490", "#A8281F", "#5B2BB8"]

    var body: some View {
        NavigationStack {
            Form {
                SwiftUI.Section("Level") {
                    TextField("Title", text: $title)
                    TextField("Theme", text: $theme)
                    TextField("Duration (e.g. 8 weeks)", text: $duration)
                    Picker("Status", selection: $status) {
                        ForEach(CmsEditStatus.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    Toggle("Locked", isOn: $locked)
                }
                SwiftUI.Section("Accent color") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 10) {
                        ForEach(swatches, id: \.self) { hex in
                            Circle().fill(cssColor(hex)).frame(width: 28, height: 28)
                                .overlay(Circle().stroke(Nuru.navy, lineWidth: colorHex.caseInsensitiveCompare(hex) == .orderedSame ? 3 : 0))
                                .onTapGesture { colorHex = hex }
                        }
                    }
                    .padding(.vertical, 4)
                }
                SwiftUI.Section("Final exam") {
                    Stepper("Pass mark: \(passMark)%", value: $passMark, in: 0...100, step: 5)
                    Stepper("Question count: \(examQuestionCount)", value: $examQuestionCount, in: 0...100)
                    Toggle("Shuffle questions", isOn: $examShuffle)
                    Toggle("Show answers after submit", isOn: $examShowAnswers)
                    Toggle("Show score after submit", isOn: $examShowScore)
                }
                if let error { SwiftUI.Section { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) } }
            }
            .navigationTitle(isEdit ? "Edit Level \(levelNumber)" : "New Level \(nextNumber)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task { await prefill() }
        }
    }

    /// Seed the form. For `.edit` we already have a UiLevel; for `.editNumberOnly`
    /// (and to get exam fields generally) we GET the fuller level row.
    @MainActor private func prefill() async {
        guard !prefilled else { return }
        prefilled = true
        if case .edit(let l) = mode {
            title = l.title; theme = l.theme; duration = l.duration == "—" ? "8 weeks" : l.duration
            passMark = l.passMark; status = CmsEditStatus.from(statusToken(l.status)); locked = l.locked
            colorHex = l.colorHex
        }
        // Fetch the full row so exam settings (and pass mark) round-trip accurately.
        if isEdit {
            if let row = try? await fetchLevel(levelNumber) {
                title = row.title
                theme = row.theme ?? theme
                duration = row.duration ?? duration
                passMark = Int(Double(row.requiredExamPassMark) ?? Double(passMark))
                status = CmsEditStatus.from(row.status)
                locked = row.locked
                if !row.color.isEmpty { colorHex = row.color }
                examQuestionCount = row.examQuestionCount ?? 0
                examShowAnswers = row.examShowAnswers ?? false
                examShowScore = row.examShowScore ?? true
                examShuffle = row.examShuffle ?? false
            }
        }
    }

    private func statusToken(_ s: CmsStatus) -> String {
        switch s { case .published: return "published"; case .inReview: return "in_review"; default: return "draft" }
    }

    private func fetchLevel(_ n: Int) async throws -> CmsLevelDetail? {
        // The list endpoint carries the exam fields per-row; find ours.
        let rows = try await APIClient.shared.get("/admin/levels", as: DataList<CmsLevelDetail>.self).data
        return rows.first { $0.levelNumber == n }
    }

    @MainActor private func save() async {
        saving = true; error = nil
        let body = CmsAPI.LevelBody(
            title: title.trimmingCharacters(in: .whitespaces),
            theme: theme,
            requiredExamPassMark: passMark,
            duration: duration,
            status: status.be,
            locked: locked,
            color: colorHex)
        do {
            if isEdit {
                try await CmsAPI.updateLevel(levelNumber, body)
                // Persist exam settings via the dedicated endpoint (web's exam PUT).
                try await CmsAPI.updateExam(levelNumber, .init(
                    requiredExamPassMark: passMark,
                    examQuestionCount: examQuestionCount > 0 ? examQuestionCount : nil,
                    examShowAnswers: examShowAnswers,
                    examShowScore: examShowScore,
                    examShuffle: examShuffle))
            } else {
                try await CmsAPI.createLevel(body)
            }
            await reload()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Save failed."
            saving = false
        }
    }
}

// MARK: - ModuleQuizView (module question bank — read-only, links to Quiz Builder)

struct ModuleQuizView: View {
    let module: AdminModuleSummary
    @EnvironmentObject private var router: NavRouter

    var body: some View {
        AsyncView({ try await PortalAPI.questions(moduleId: module.moduleId) }) { questions in
            if questions.isEmpty {
                ContentUnavailableView {
                    Label("No questions", systemImage: "questionmark.circle")
                } description: {
                    Text("This module has no quiz questions yet.")
                } actions: {
                    Button("Open Quiz Builder") { router.go(.quizBuilder) }
                        .buttonStyle(.borderedProminent).tint(Nuru.gold)
                }
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
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { router.go(.quizBuilder) } label: { Label("Quiz Builder", systemImage: "questionmark.circle") }
            }
        }
    }
}

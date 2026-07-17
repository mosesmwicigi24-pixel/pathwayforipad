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

// MARK: - Bright form kit (Pass v6 — roomy, readable editor sheets)
//
// Shared styling so the CMS editor forms read like the bright web forms: warm cream
// background behind a hidden Form chrome, white field rows with visible borders, dark
// readable labels, navy section headers, and paired fields in two columns to cut
// scrolling. Layout/typography only — no field or binding changes.

/// Warm bright sheet chrome: hide the system grouped background and paint Nuru.paper,
/// constrain the content to a roomy centred column, and open the sheet large.
private extension View {
    func cmsFormSheet() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(Nuru.paper)
            .tint(Nuru.gold)
            .presentationDetents([.large])
    }
}

/// Navy section header for a Form section (replaces the faint default grey caption).
private struct CmsSectionHeader: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.inter(12, .bold)).tracking(0.8)
            .foregroundStyle(Nuru.navy)
            .padding(.bottom, 2)
    }
}

/// A bright white labelled field cell: dark-ink overline label above the control,
/// white surface with a visible border. Used to build two-column form rows.
private struct CmsFieldCell<Content: View>: View {
    let label: String
    var required = false
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 3) {
                Text(label.uppercased()).font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                if required { Text("*").font(.inter(11, .bold)).foregroundStyle(Nuru.gold) }
            }
            content
                .font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).frame(minHeight: 40)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
    }
}

/// Pair two cells side-by-side on the wide canvas (falls to a sensible min width).
private struct CmsFieldPair<L: View, R: View>: View {
    @ViewBuilder var left: L
    @ViewBuilder var right: R
    var body: some View {
        HStack(alignment: .top, spacing: 14) { left; right }
    }
}

/// A bright toggle/stepper tile (white surface + border) for boolean / numeric rows.
private struct CmsControlTile<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(.horizontal, 12).frame(minHeight: 44)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
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

    // ── Full module load + save (web LevelDetail right pane) ──

    /// GET /admin/modules/{id} → the full AdminModule for the editor.
    static func module(_ id: String) async throws -> ModuleFull {
        try await api.get("/admin/modules/\(id)", as: ModuleFull.self)
    }
    /// PUT /admin/modules/{id} with the edited fields + expected_row_version
    /// (web's optimistic-concurrency guard). Returns the refreshed row.
    static func updateModule(_ id: String, _ body: ModuleUpdateBody) async throws -> ModuleFull {
        try await api.put("/admin/modules/\(id)", body: body, as: ModuleFull.self)
    }
}

/// Tolerant decode of the full module row (web AdminModule). Optionals + the shared
/// @Default* wrappers guard against null/missing — synthesized Codable would throw
/// on a plain `var x = default`, so every non-optional uses a wrapper.
private struct ModuleFull: Codable {
    @DefaultEmpty var moduleId: String
    @DefaultEmpty var title: String
    let summary: String?
    @DefaultEmpty var status: String
    @DefaultZero var moduleSequenceNumber: Int
    @DefaultEmpty var evaluationKind: String
    @DefaultEmpty var lessonContent: String
    let keyVerses: [String]?
    let objectives: String?
    let tags: String?
    @DefaultEmpty var visibility: String           // "members" | "leaders" | "public"
    @DefaultEmpty var difficulty: String           // "beginner" | "intermediate" | "advanced"
    let videoUrl: String?
    let estimatedMinutes: Int?
    @DefaultFalse var required: Bool
    @DefaultEmpty var quizPassMark: String
    let timeLimitSec: Int?
    let maxAttempts: Int?
    @DefaultFalse var quizShuffle: Bool
    @DefaultFalse var quizShowAnswers: Bool
    @DefaultFalse var quizShowScore: Bool
    @DefaultZero var currentVersion: Int
    @DefaultZero var rowVersion: Int
    @DefaultZero var levelNumber: Int
}

/// PUT body for the module editor. camelCase encodes to snake_case via the actor's
/// convertToSnakeCase (so `expectedRowVersion` → `expected_row_version`, matching web).
private struct ModuleUpdateBody: Encodable {
    let title: String
    let summary: String?
    let lessonContent: String
    let evaluationKind: String
    let quizPassMark: Int
    let estimatedMinutes: Int?
    let videoUrl: String?
    let keyVerses: [String]?
    let maxAttempts: Int?
    let difficulty: String
    let objectives: String?
    let tags: String?
    let visibility: String
    let required: Bool
    let quizShuffle: Bool
    let quizShowAnswers: Bool
    let quizShowScore: Bool
    let timeLimitSec: Int?
    let expectedRowVersion: Int
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
        .background(Nuru.paper)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
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
    @EnvironmentObject private var router: NavRouter

    @State private var search = ""
    @State private var filter: FilterPill = .all
    @State private var selectedNo: Int?

    // Authoring action state.
    @State private var levelSheet: LevelSheetMode?
    @State private var actionError: String?
    // In portrait the 360pt rail would crush the main column, so the inspector
    // is presented as a sheet instead (toggled when a level is tapped on narrow).
    @State private var inspectorSheet = false
    // Mirrors the GeometryReader's dock decision so row taps know whether the
    // inspector is already docked (just select) or needs the sheet (select + open).
    @State private var docked = false

    enum FilterPill: String, CaseIterable { case all = "All", published = "Published", inReview = "In Review", draft = "Draft" }

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

    // Donut slices (web donutData) — Published / In Review / Drafts.
    private struct StatusSlice: Identifiable { let name: String; let value: Int; let color: Color; var id: String { name } }
    private var donutData: [StatusSlice] {
        // Brand triad, no decorative blue: bright lumGreen · gold · neutral ink for drafts.
        [StatusSlice(name: "Published", value: published, color: Nuru.lumGreen),
         StatusSlice(name: "In Review", value: inReview, color: Nuru.gold),
         StatusSlice(name: "Drafts", value: drafts, color: Nuru.ink400)]
    }
    private var totalLevels: Int { donutData.reduce(0) { $0 + $1.value } }

    // ── Deep-link (router.pendingLevel → focus that level) ──

    /// If the shared router carries a pending level number, select it and clear the
    /// flag so a subsequent navigation to the page doesn't re-trigger the jump.
    private func applyPendingLevel() {
        guard let n = router.pendingLevel else { return }
        if levels.contains(where: { $0.number == n }) { selectedNo = n }
        router.pendingLevel = nil
    }

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
        GeometryReader { geo in
            // Only dock the 360pt inspector beside the main column when there's
            // genuine room for both (landscape). In portrait (~740pt usable) the
            // rail would crush the charts, so main goes full width and the
            // inspector opens as a sheet on selection.
            let canDock = geo.size.width >= 1040
            Group {
                if canDock, let sel = selected {
                    HStack(spacing: 0) {
                        mainScroll
                        Divider()
                        LevelInspectorRail(level: sel,
                                           reload: reload,
                                           onEdit: { levelSheet = .edit(sel) })
                            .frame(width: 360)
                    }
                } else {
                    mainScroll
                }
            }
            .onAppear { docked = canDock }
            .onChange(of: canDock) { _, isDocked in
                docked = isDocked
                // When docked the rail is inline, so the sheet must not also be up.
                if isDocked { inspectorSheet = false }
            }
        }
        .onAppear {
            if selectedNo == nil { selectedNo = levels.first?.number }
            applyPendingLevel()
        }
        .onChange(of: router.pendingLevel) { _, _ in applyPendingLevel() }
        .sheet(item: $levelSheet) { mode in
            let formMode: LevelFormSheet.Mode = {
                switch mode {
                case .add: return .add
                case .edit(let l): return .edit(l)
                }
            }()
            LevelFormSheet(mode: formMode, nextNumber: levels.count + 1, reload: reload)
        }
        .sheet(isPresented: $inspectorSheet) {
            if let sel = selected {
                NavigationStack {
                    LevelInspectorRail(level: sel,
                                       reload: reload,
                                       onEdit: { inspectorSheet = false; levelSheet = .edit(sel) })
                        .navigationTitle("Level \(sel.number)")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { inspectorSheet = false } } }
                }
            }
        }
        .alert("Action failed", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: { Text(actionError ?? "") }
    }

    private var mainScroll: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero                  // full-bleed — flush to the top + sides, attached to the sidebar
                VStack(spacing: 18) {
                    filtersCard
                    pipelineCard          // 1. compact pipeline stat strip
                    quickActionsCard      // 2. Quick actions moved up — before the report
                    reportCard            // 3. report panels in a 2-up grid
                    pathwaySection        // 4. level list as a 3-up grid of compact cards
                }
                .padding(.horizontal, Nuru.S.screen)
                .padding(.vertical, Nuru.S.lg)
                .macContentColumn(MacDesign.workspaceMaxWidth)   // Mac: workspace width — report panels + level grid flow wider
            }
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
                                .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous)
                                    .stroke(active ? .clear : Nuru.border, lineWidth: 1))
                                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
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
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text("Curriculum pipeline").font(.inter(12.5, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
                    Text("LIVE").font(.nMicro).foregroundStyle(Nuru.goldLo)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Nuru.gold.opacity(0.14)).clipShape(Capsule())
                    Spacer(minLength: 0)
                }
                // One compact row of small tiles (was a 2×2 grid of large tiles).
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 10)], spacing: 10) {
                    pipelineTile("Drafts", "\(drafts)", "pencil.line", Nuru.brandTint(2))
                    pipelineTile("In review", "\(inReview)", "eye", Nuru.brandTint(3))
                    pipelineTile("Locked", "\(lockedCount)", "lock", Nuru.brandTint(1))
                    pipelineTile("Live", "\(published)", "rosette", Nuru.brandTint(0))
                }
            }
        }
    }

    /// Compact pipeline tile — small icon, value, one-line label. Sized for a single
    /// 4-up row at portrait width (~740pt).
    private func pipelineTile(_ label: String, _ value: String, _ icon: String, _ tint: Nuru.Tint) -> some View {
        HStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous).fill(tint.fg.opacity(0.14))
                Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(tint.fg)
            }.frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 0) {
                Text(value).font(.fraunces(18, .semibold)).foregroundStyle(Nuru.navy)
                Text(label).font(.inter(10.5, .medium)).foregroundStyle(Nuru.ink600)
                    .lineLimit(1).minimumScaleFactor(0.85)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 11).padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // MARK: Pathway report

    private var reportCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pathway report").font(.nTitle).foregroundStyle(Nuru.navy)
                    Text("Status mix, breakdown, modules and engagement — all in one view.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                }
                // No tab switcher: Status mix · Breakdown · Modules per level · Engagement
                // are FOUR separate compact cards, all visible together in a tidy grid
                // (2-up at portrait ~740pt; more columns when wider).
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12, alignment: .top)], spacing: 12) {
                    statusMixTile
                    breakdownTile
                    modulesPerLevelTile
                    engagementTile
                }

                Text("Source: Curriculum CMS · \(totalLevels) levels covering \(totalModules) modules and \(totalLearners.formatted()) active learners.")
                    .font(.nMicro).foregroundStyle(Nuru.ink400)
            }
        }
    }

    // Engagement — compact card: two summary stats + a tight per-level learners list.
    private var engagementTile: some View {
        SurfaceTile {
            VStack(alignment: .leading, spacing: 10) {
                Text("ENGAGEMENT").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                HStack(spacing: 8) {
                    engagementStat("Learners", totalLearners.formatted(), "person.2", Nuru.lumGreen)
                    engagementStat("Live", "\(levels.reduce(0) { $0 + $1.completedModules })", "rosette", Nuru.gold)
                }
                VStack(spacing: 6) {
                    ForEach(levels) { l in
                        HStack(spacing: 8) {
                            Text("L\(l.number)").font(.inter(10, .bold)).tracking(0.3)
                                .foregroundStyle(.white).frame(width: 24, height: 20)
                                .background(l.color).clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                            Text(l.title).font(.inter(11.5, .medium)).foregroundStyle(Nuru.navy).lineLimit(1)
                            Spacer(minLength: 0)
                            Label(l.learners.formatted(), systemImage: "person.2")
                                .font(.inter(10.5, .medium)).foregroundStyle(Nuru.ink600).labelStyle(.titleAndIcon)
                        }
                    }
                }
            }
        }
    }

    private func engagementStat(_ label: String, _ value: String, _ icon: String, _ accent: Color) -> some View {
        HStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(accent.opacity(0.14))
                Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(accent)
            }.frame(width: 26, height: 26)
            VStack(alignment: .leading, spacing: 0) {
                Text(value).font(.fraunces(16, .semibold)).foregroundStyle(Nuru.navy)
                Text(label).font(.inter(9.5, .medium)).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.85)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(Nuru.border, lineWidth: 1))
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
                    .frame(height: 108)
                    VStack(spacing: 2) {
                        Text("\(totalLevels)").font(.fraunces(21, .semibold)).foregroundStyle(Nuru.navy)
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
                .chartForegroundStyleScale(["Modules": Color(hex: 0xF4E4BD), "Done": Nuru.lumGreen])
                .chartLegend(.hidden)
                .chartYAxis(.hidden)
                .chartXAxis {
                    AxisMarks { _ in
                        AxisValueLabel().font(.inter(10.5, .regular)).foregroundStyle(Nuru.ink600)
                    }
                }
                .frame(height: 108)
            }
        }
    }

    // MARK: The pathway (level grid)

    private var pathwaySection: some View {
        VStack(alignment: .leading, spacing: 12) {
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

            // Level list as small cards in a 3-up grid (≈3 columns at portrait width).
            // Mac: roomier level cards (≥340pt) in the desktop column.
            LazyVGrid(columns: [GridItem(.adaptive(minimum: MacDesign.isMac ? 340 : 220), spacing: 12, alignment: .top)], spacing: 12) {
                ForEach(filtered) { level in
                    PathwayLevelCard(
                        level: level,
                        selected: selectedNo == level.number,
                        onSelect: {
                            selectedNo = level.number
                            // Portrait: surface the module inspector as a sheet
                            // since there's no room to dock it beside the page.
                            if !docked { inspectorSheet = true }
                        },
                        onReview: { setLevelStatus(level.number, .inReview) },
                        onPublish: { setLevelStatus(level.number, .published) },
                        onUnlock: { toggleLock(level) })
                }
            }
        }
    }

    // MARK: Quick actions (web Quick actions panel — cross-nav + New Level + Refresh)

    private var quickActionsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "bolt.fill").font(.system(size: 12)).foregroundStyle(Nuru.gold)
                    Text("Quick actions").font(.inter(12.5, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 0)
                }
                // ONE ROW of compact action buttons (each keeps its existing behavior).
                HStack(spacing: 8) {
                    quickAction("New Level", "plus", Nuru.brandTint(0)) { levelSheet = .add }
                    quickAction("Editor", "book", Nuru.brandTint(2)) { router.go(.levelDetail) }
                    quickAction("Quiz", "questionmark.circle", Nuru.brandTint(1)) { router.go(.quizBuilder) }
                    quickAction("Video", "play.rectangle", Nuru.brandTint(0)) { router.go(.videoLibrary) }
                    quickAction("Reflect", "text.bubble", Nuru.brandTint(3)) { router.go(.reflectionQueue) }
                    quickAction("Refresh", "arrow.clockwise", Nuru.brandTint(2)) { Task { await reload() } }
                }
            }
        }
    }

    /// Compact single-row action — small tinted icon over a short label.
    private func quickAction(_ label: String, _ icon: String, _ tint: Nuru.Tint, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous).fill(tint.fg.opacity(0.14))
                    Image(systemName: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(tint.fg)
                }.frame(width: 30, height: 30)
                Text(label).font(.inter(10.5, .semibold)).foregroundStyle(Nuru.navy)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 6).padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Pathway level card (compact — for the 3-up grid)

private struct PathwayLevelCard: View {
    let level: UiLevel
    let selected: Bool
    let onSelect: () -> Void
    let onReview: () -> Void
    let onPublish: () -> Void
    let onUnlock: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header: number monogram + level eyebrow, status pill trailing.
            HStack(alignment: .top, spacing: 10) {
                node
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text("LEVEL \(level.number)").font(.inter(9.5, .bold)).tracking(0.8).foregroundStyle(level.color)
                        if level.locked { Image(systemName: "lock.fill").font(.system(size: 8)).foregroundStyle(Nuru.ink600) }
                    }
                    Text(level.title).font(.fraunces(15, .medium)).foregroundStyle(Nuru.navy)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                statusBadge
            }

            if !level.theme.isEmpty {
                Text(level.theme).font(.inter(11, .regular)).foregroundStyle(Nuru.ink600).lineLimit(1)
            }

            // One compact stat row: modules + learners.
            HStack(spacing: 12) {
                Label("\(level.completedModules)/\(level.modules)", systemImage: "book")
                    .font(.inter(10.5, .medium)).foregroundStyle(Nuru.ink600).labelStyle(.titleAndIcon)
                Label(level.learners.formatted(), systemImage: "person.2")
                    .font(.inter(10.5, .medium)).foregroundStyle(Nuru.ink600).labelStyle(.titleAndIcon)
            }

            // Progress.
            HStack(spacing: 6) {
                ProgressBar(pct: Double(level.progress), fill: level.locked ? Nuru.border : level.color, height: 4)
                Text("\(level.progress)%").font(.fraunces(10.5, .medium)).foregroundStyle(Nuru.navy)
            }

            // Actions: Open + contextual Unlock / Review / Publish.
            HStack(spacing: 6) {
                NavigationLink {
                    LevelDetailView(levelNumber: level.number, levelTitle: level.title, accent: level.color)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.up.forward.square").font(.system(size: 10))
                        Text("Open").font(.inter(11, .semibold))
                    }
                    .foregroundStyle(level.locked ? Nuru.ink600 : .white)
                    .padding(.horizontal, 10).frame(height: 28)
                    .background(level.locked ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(Nuru.navy))
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
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
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
            .stroke(selected ? level.color : Nuru.border, lineWidth: selected ? 2 : 1))
        .nuruShadow(selected ? 1 : 0.4)
        .contentShape(Rectangle())
        .onTapGesture { onSelect() }
    }

    private var node: some View {
        ZStack {
            Circle()
                .fill(level.locked ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(level.color))
                .frame(width: 36, height: 36)
                .overlay(level.locked
                         ? Circle().strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1.5, dash: [3])) : nil)
            if level.locked {
                Image(systemName: "lock.fill").font(.system(size: 12)).foregroundStyle(Nuru.ink600)
            } else {
                Text("\(level.number)").font(.fraunces(16, .medium)).foregroundStyle(.white)
            }
        }
    }

    private func actionPill(_ label: String, _ icon: String, bg: Color, fg: Color, bordered: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 10))
                Text(label).font(.inter(11, .semibold))
            }
            .foregroundStyle(fg)
            .padding(.horizontal, 9).frame(height: 28)
            .background(bg)
            .overlay(bordered ? RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous).stroke(Nuru.border, lineWidth: 1) : nil)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var statusBadge: some View {
        Text(level.status.rawValue).font(.inter(9, .bold))
            .foregroundStyle(level.status.style.fg)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(level.status.style.bg).clipShape(Capsule())
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
                    .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
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
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
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
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                Button { addingModule = false } label: {
                    Image(systemName: "xmark").font(.system(size: 11)).foregroundStyle(Nuru.ink600)
                        .frame(width: 34, height: 34)
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
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
                    // Clean compact list (was tall stacked cards).
                    VStack(spacing: 0) {
                        let sorted = modules.sorted { $0.moduleSequenceNumber < $1.moduleSequenceNumber }
                        ForEach(Array(sorted.enumerated()), id: \.element.id) { idx, m in
                            moduleCard(m, index: idx, count: sorted.count)
                            if idx < sorted.count - 1 { Divider() }
                        }
                    }
                    .background(Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    .nuruShadow(0.4)
                }
            }
            .padding(Nuru.S.screen)
            .macContentColumn(980)   // Mac: module list reads best in a narrower column
        }
        .background(Nuru.paper)
        .navigationTitle(levelTitle.isEmpty ? "Level Detail" : levelTitle)
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
            // Compact stat tiles in one row.
            HStack(spacing: 10) {
                miniStat("Modules", "\(modules.count)", "book", Nuru.brandTint(2))
                miniStat("Published", "\(published)", "rosette", Nuru.brandTint(0))
                miniStat("Draft", "\(modules.count - published)", "pencil.line", Nuru.brandTint(1))
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
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                HStack(spacing: 8) {
                    Button { Task { await addModule() } } label: {
                        Text("Create").font(.inter(13, .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 18).frame(height: 38)
                            .background(newTitle.trimmingCharacters(in: .whitespaces).isEmpty ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(accent))
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button { addingModule = false; newTitle = "" } label: {
                        Text("Cancel").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink600)
                            .padding(.horizontal, 14).frame(height: 38)
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func miniStat(_ label: String, _ value: String, _ icon: String, _ tint: Nuru.Tint) -> some View {
        HStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous).fill(tint.fg.opacity(0.14))
                Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(tint.fg)
            }.frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 0) {
                Text(value).font(.fraunces(18, .semibold)).foregroundStyle(Nuru.navy)
                Text(label.uppercased()).font(.inter(9, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                    .lineLimit(1).minimumScaleFactor(0.85)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 11).padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func moduleCard(_ m: AdminModuleSummary, index: Int, count: Int) -> some View {
        HStack(spacing: 10) {
            // Tapping the row drills into the question bank (ModuleQuizView).
            NavigationLink { ModuleQuizView(module: m) } label: {
                HStack(spacing: 10) {
                    Text("\(m.moduleSequenceNumber)").font(.inter(12, .bold))
                        .foregroundStyle(.white).frame(width: 26, height: 26)
                        .background(accent).clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(m.title).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        if let s = m.summary, !s.isEmpty {
                            Text(s).font(.inter(11, .regular)).foregroundStyle(Nuru.ink600).lineLimit(1)
                        }
                        HStack(spacing: 6) {
                            let st = CmsStatus.from(m.status)
                            Text(m.status.uppercased()).font(.inter(9, .bold))
                                .foregroundStyle(st.style.fg)
                                .padding(.horizontal, 6).padding(.vertical, 2)
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
                Image(systemName: "ellipsis").font(.system(size: 13)).foregroundStyle(Nuru.ink400)
                    .frame(width: 28, height: 28)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
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
                SwiftUI.Section {
                    // Title spans full width; the rest pair into two columns.
                    CmsFieldCell(label: "Title", required: true) {
                        TextField("A New Creation", text: $title)
                    }
                    CmsFieldPair {
                        CmsFieldCell(label: "Theme") { TextField("Foundations of faith", text: $theme) }
                    } right: {
                        CmsFieldCell(label: "Duration") { TextField("8 weeks", text: $duration) }
                    }
                    CmsFieldPair {
                        CmsFieldCell(label: "Status") {
                            Picker("", selection: $status) {
                                ForEach(CmsEditStatus.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                            }
                            .labelsHidden().pickerStyle(.menu).tint(Nuru.navy)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } right: {
                        CmsControlTile {
                            Toggle(isOn: $locked) {
                                Text("Locked").font(.inter(14, .medium)).foregroundStyle(Nuru.ink)
                            }
                            .tint(Nuru.gold)
                        }
                        .padding(.top, 18)   // align with the labelled field beside it
                    }
                } header: { CmsSectionHeader(text: "Level") }
                .listRowBackground(Color.clear)

                SwiftUI.Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 12) {
                        ForEach(swatches, id: \.self) { hex in
                            Circle().fill(cssColor(hex)).frame(width: 30, height: 30)
                                .overlay(Circle().stroke(Nuru.navy, lineWidth: colorHex.caseInsensitiveCompare(hex) == .orderedSame ? 3 : 0))
                                .onTapGesture { colorHex = hex }
                        }
                    }
                    .padding(.vertical, 6)
                } header: { CmsSectionHeader(text: "Accent color") }
                .listRowBackground(Color.clear)

                SwiftUI.Section {
                    CmsFieldPair {
                        CmsControlTile { Stepper("Pass mark: \(passMark)%", value: $passMark, in: 0...100, step: 5).tint(Nuru.gold) }
                    } right: {
                        CmsControlTile { Stepper("Questions: \(examQuestionCount)", value: $examQuestionCount, in: 0...100).tint(Nuru.gold) }
                    }
                    CmsControlTile { Toggle("Shuffle questions", isOn: $examShuffle).tint(Nuru.lumGreen) }
                    CmsFieldPair {
                        CmsControlTile { Toggle("Show answers", isOn: $examShowAnswers).tint(Nuru.lumGreen) }
                    } right: {
                        CmsControlTile { Toggle("Show score", isOn: $examShowScore).tint(Nuru.lumGreen) }
                    }
                } header: { CmsSectionHeader(text: "Final exam") }
                .listRowBackground(Color.clear)

                if let error {
                    SwiftUI.Section {
                        Text(error).font(.nCaption).foregroundStyle(Nuru.danger)
                    }
                    .listRowBackground(Color.clear)
                }
            }
            .cmsFormSheet()
            .frame(maxWidth: 820)
            .frame(maxWidth: .infinity)
            .background(Nuru.paper)
            .navigationTitle(isEdit ? "Edit Level \(levelNumber)" : "New Level \(nextNumber)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .font(.inter(15, .semibold))
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

// MARK: - ModuleQuizView (module screen — Editor + question bank, links to Quiz Builder)
//
// Ports the web LevelDetail.tsx right pane: a segmented control toggles between the
// full module editor (Content tab) and this module's read-only question bank (Quiz
// tab). The Quiz Builder cross-nav stays in the toolbar.

struct ModuleQuizView: View {
    let module: AdminModuleSummary
    @EnvironmentObject private var router: NavRouter

    enum Pane: String, CaseIterable, Identifiable { case editor = "Editor", questions = "Questions"; var id: String { rawValue } }
    @State private var pane: Pane = .editor

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $pane) {
                ForEach(Pane.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Nuru.S.screen)
            .padding(.vertical, 10)
            .background(Nuru.white)

            Divider()

            switch pane {
            case .editor:
                ModuleEditorPane(moduleId: module.moduleId, fallbackTitle: module.title)
            case .questions:
                questionBank
            }
        }
        .background(Nuru.paper)
        .portalPage(module.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { router.go(.quizBuilder) } label: { Label("Quiz Builder", systemImage: "questionmark.circle") }
            }
        }
    }

    // The original read-only question bank, unchanged in behavior.
    private var questionBank: some View {
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
                    .macContentColumn(900)   // Mac: question cards in a readable column
                }
            }
        }
    }
}

// MARK: - ModuleEditorPane (web LevelDetail.tsx right-pane module editor)
//
// Loads the full module (GET /admin/modules/{id}), exposes every editable field as a
// Form, and saves via PUT with expected_row_version for optimistic concurrency.

private struct ModuleEditorPane: View {
    let moduleId: String
    let fallbackTitle: String

    @State private var loaded: ModuleFull?
    @State private var phase: Phase = .loading
    private enum Phase { case loading, ready, failed(String) }

    // Editable fields.
    @State private var title = ""
    @State private var summary = ""
    @State private var lessonContent = ""
    @State private var objectives = ""
    @State private var tags = ""
    @State private var keyVersesText = ""
    @State private var evaluationKind = "none"
    @State private var difficulty = "beginner"
    @State private var visibility = "members"
    @State private var required = false
    @State private var videoUrl = ""
    @State private var estimatedMinutes = 0
    @State private var quizPassMark = 70
    @State private var maxAttempts = 3
    @State private var timeLimitMinutes = 0
    @State private var quizShuffle = false
    @State private var quizShowAnswers = false
    @State private var quizShowScore = true

    @State private var saving = false
    @State private var notice: String?
    @State private var error: String?

    // Markdown editor mode (web LevelDetail's mdView write/preview toggle) + the
    // learner-preview sheet (web ModulePreview.tsx — here it renders the CURRENT
    // edited draft, unsaved changes included, which the web's saved-only tab can't).
    @State private var mdMode: MdEditorMode = .write
    @State private var showLearnerPreview = false

    // Web option sets.
    private let evalOpts: [(v: String, l: String)] = [("none", "— none —"), ("quiz", "Quiz"), ("reflection", "Reflection"), ("exit_exam", "Exit exam")]
    private let difficultyOpts: [(v: String, l: String)] = [("beginner", "Beginner"), ("intermediate", "Intermediate"), ("advanced", "Advanced")]
    private let visibilityOpts: [(v: String, l: String)] = [("members", "Members"), ("leaders", "Leaders only"), ("public", "Public")]
    private var isQuiz: Bool { evaluationKind == "quiz" }

    // Titled teaching sections — a convention over lesson_content (no backend
    // change). The server splits lesson_content on <!-- page-break --> markers
    // into the mobile reader's pages; we treat each page as a "section" whose
    // title is its leading Markdown heading. Authors add / rename / delete
    // sections here; the marker written is byte-identical to the web's, so
    // backend pagination stays consistent across surfaces.
    private static let pageBreakMarker = "<!-- page-break -->"
    private static let sectionJoiner = "\n\n<!-- page-break -->\n\n"

    private struct Section: Identifiable {
        let id = UUID()
        var title: String?
        var body: String
    }

    // Split on the literal marker (the app only ever writes the literal marker),
    // then derive each piece's title from a leading `#…######`-style heading.
    private func parseSections(_ content: String) -> [Section] {
        content
            .components(separatedBy: ModuleEditorPane.pageBreakMarker)
            .map { piece -> Section in
                let trimmed = piece.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty { return Section(title: nil, body: "") }
                var lines = trimmed.components(separatedBy: "\n")
                // First non-empty line (guaranteed present — trimmed is non-empty).
                let firstIdx = lines.firstIndex { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ?? 0
                let first = lines[firstIdx]
                if let title = Self.headingTitle(first) {
                    lines.remove(at: firstIdx)
                    // Drop one following blank line so the body doesn't start hollow.
                    if firstIdx < lines.count, lines[firstIdx].trimmingCharacters(in: .whitespaces).isEmpty {
                        lines.remove(at: firstIdx)
                    }
                    let body = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                    return Section(title: title, body: body)
                }
                return Section(title: nil, body: trimmed)
            }
            .filter { !($0.title == nil && $0.body.isEmpty) }
    }

    // `^#{1,6}[ \t]+(.+?)[ \t]*$` → the captured heading text, else nil.
    private static func headingTitle(_ line: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: "^#{1,6}[ \\t]+(.+?)[ \\t]*$") else { return nil }
        let range = NSRange(line.startIndex..<line.endIndex, in: line)
        guard let m = re.firstMatch(in: line, range: range),
              let capRange = Range(m.range(at: 1), in: line) else { return nil }
        return String(line[capRange])
    }

    private func sectionLabel(_ title: String?, _ index0: Int) -> String {
        title ?? "Section \(index0 + 1)"
    }

    // Mutations operate on the RAW lessonContent split verbatim on the marker,
    // then rejoin the surviving pieces with the canonical joiner.
    private func rawPieces() -> [String] {
        lessonContent.components(separatedBy: ModuleEditorPane.pageBreakMarker)
    }

    private func addSection() {
        if lessonContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            lessonContent = "## New section\n\n"
        } else {
            lessonContent += "\n\n<!-- page-break -->\n\n## New section\n\n"
        }
    }

    private func deleteSection(_ index: Int) {
        var pieces = rawPieces()
        guard pieces.indices.contains(index) else { return }
        pieces.remove(at: index)
        lessonContent = pieces.joined(separator: ModuleEditorPane.sectionJoiner)
    }

    private func renameSection(_ index: Int, to title: String) {
        var pieces = rawPieces()
        guard pieces.indices.contains(index) else { return }
        let clean = title.trimmingCharacters(in: .whitespaces)
        var lines = pieces[index].components(separatedBy: "\n")
        let firstIdx = lines.firstIndex { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        if let firstIdx, Self.headingTitle(lines[firstIdx]) != nil {
            // Rewrite the existing leading heading in place.
            lines[firstIdx] = "## \(clean)"
            pieces[index] = lines.joined(separator: "\n")
        } else {
            // No heading yet — prepend one.
            let existing = pieces[index].trimmingCharacters(in: .whitespacesAndNewlines)
            pieces[index] = existing.isEmpty ? "## \(clean)\n\n" : "## \(clean)\n\n\(existing)"
        }
        lessonContent = pieces.joined(separator: ModuleEditorPane.sectionJoiner)
    }

    var body: some View {
        Group {
            switch phase {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let m):
                ScrollView { ErrorBanner(message: m) { Task { await load() } }.padding(Nuru.S.screen) }
            case .ready:
                VStack(spacing: 0) {
                    editorHeaderBar
                    Divider()
                    editorForm
                }
            }
        }
        .task(id: moduleId) { await load() }
        // Learner preview — snapshots the live editor fields at presentation time,
        // so unsaved draft content previews exactly as a disciple would see it.
        .sheet(isPresented: $showLearnerPreview) {
            LearnerPreviewSheet(snapshot: makeLearnerSnapshot())
        }
    }

    /// Slim bar above the editor form: the "Eye" learner-preview affordance
    /// (web ModuleEditorPane header's Preview button, closes ledger D-06).
    private var editorHeaderBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "square.and.pencil").font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.gold)
            Text("Module editor").font(.inter(12.5, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
            Spacer(minLength: 0)
            Button { showLearnerPreview = true } label: {
                HStack(spacing: 5) {
                    Image(systemName: "eye").font(.system(size: 11, weight: .semibold))
                    Text("Learner preview").font(.inter(12, .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 12).frame(height: 30)
                .background(Nuru.navy)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, Nuru.S.screen).padding(.vertical, 9)
        .background(Nuru.white)
    }

    /// Freeze the current (possibly unsaved) editor state into the preview model.
    private func makeLearnerSnapshot() -> LearnerPreviewSnapshot {
        let secs = parseSections(lessonContent).map { LpSection(title: $0.title, body: $0.body) }
        let words = lessonContent.split(whereSeparator: { $0.isWhitespace }).count
        return LearnerPreviewSnapshot(
            moduleId: moduleId,
            levelNumber: loaded?.levelNumber ?? 0,
            sequence: loaded?.moduleSequenceNumber ?? 0,
            title: title.trimmingCharacters(in: .whitespaces),
            summary: summary.trimmingCharacters(in: .whitespacesAndNewlines),
            difficulty: difficulty,
            estimatedMinutes: estimatedMinutes,
            evaluationKind: evaluationKind,
            quizPassMark: quizPassMark,
            objectives: objectives.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
            keyVerses: keyVersesText.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
            tags: tags.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
            videoUrl: videoUrl.trimmingCharacters(in: .whitespaces),
            sections: secs,
            wordCount: words)
    }

    private var editorForm: some View {
        Form {
            SwiftUI.Section {
                CmsFieldCell(label: "Title", required: true) { TextField("Module title", text: $title) }
                CmsFieldPair {
                    CmsFieldCell(label: "Difficulty") {
                        Picker("", selection: $difficulty) {
                            ForEach(difficultyOpts, id: \.v) { Text($0.l).tag($0.v) }
                        }
                        .labelsHidden().pickerStyle(.menu).tint(Nuru.navy)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } right: {
                    CmsControlTile {
                        Stepper("Est. minutes: \(estimatedMinutes)", value: $estimatedMinutes, in: 0...600, step: 5).tint(Nuru.gold)
                    }
                    .padding(.top, 18)
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text("SUMMARY").font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                    TextEditor(text: $summary).frame(minHeight: 64).font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                        .scrollContentBackground(.hidden).padding(8).background(Nuru.white)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }
            } header: { CmsSectionHeader(text: "Module basics") }
            .listRowBackground(Color.clear)

            SwiftUI.Section {
                // ── Markdown toolbar + Write/Preview toggle (web LevelDetail tools row) ──
                markdownToolbarRow
                if mdMode == .write {
                    TextEditor(text: $lessonContent)
                        .frame(minHeight: 220)
                        .font(.system(.body, design: .monospaced)).foregroundStyle(Nuru.ink)
                        .scrollContentBackground(.hidden).padding(8).background(Nuru.white)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                } else {
                    // Rendered markdown preview of the draft (web's mdView === "preview").
                    Group {
                        if lessonContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text("Nothing to preview yet.").font(.nCaption).foregroundStyle(Nuru.ink400)
                        } else {
                            MarkdownBlocksView(content: lessonContent)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 220, alignment: .topLeading)
                    .padding(14).background(Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }
                HStack(alignment: .top) {
                    if mdMode == .write {
                        // TextEditor exposes no cursor, so tools append at the end
                        // (same limitation the page-break button already documents).
                        Text("Toolbar snippets are added at the end of the lesson — move them into place while editing.")
                            .font(.nMicro).foregroundStyle(Nuru.ink400)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    Text("\(lessonContent.count) chars")
                        .font(.nMicro).foregroundStyle(Nuru.ink400)
                }

                // ── Sections outline ──
                let sections = parseSections(lessonContent)
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("SECTIONS").font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                        Spacer(minLength: 8)
                        Text("\(sections.count) \(sections.count == 1 ? "section" : "sections")")
                            .font(.nMicro).foregroundStyle(Nuru.ink400)
                    }
                    if sections.isEmpty {
                        Text("No sections yet — add one to start.")
                            .font(.nCaption).foregroundStyle(Nuru.ink400)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 6)
                    } else {
                        ForEach(Array(sections.enumerated()), id: \.element.id) { i, sec in
                            SectionOutlineRow(
                                index0: i,
                                seed: sectionLabel(sec.title, i),
                                onRename: { renameSection(i, to: $0) },
                                onDelete: { deleteSection(i) })
                        }
                    }
                    Button { addSection() } label: {
                        Label("Add section", systemImage: "rectangle.split.1x2")
                            .font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 42)
                            .background(Nuru.gold)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 2)
                }
                .padding(12)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            } header: { CmsSectionHeader(text: "Lesson content · Markdown") }
            .listRowBackground(Color.clear)

            SwiftUI.Section {
                CmsFieldPair {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("OBJECTIVES (ONE PER LINE)").font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                        TextEditor(text: $objectives).frame(minHeight: 80).font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                            .scrollContentBackground(.hidden).padding(8).background(Nuru.white)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                } right: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("KEY SCRIPTURE (ONE PER LINE)").font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                        TextEditor(text: $keyVersesText).frame(minHeight: 80).font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                            .scrollContentBackground(.hidden).padding(8).background(Nuru.white)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                }
                CmsFieldCell(label: "Tags (comma-separated)") { TextField("grace, identity", text: $tags) }
            } header: { CmsSectionHeader(text: "Objectives & scripture") }
            .listRowBackground(Color.clear)

            SwiftUI.Section {
                CmsFieldPair {
                    CmsFieldCell(label: "Evaluation kind") {
                        Picker("", selection: $evaluationKind) {
                            ForEach(evalOpts, id: \.v) { Text($0.l).tag($0.v) }
                        }
                        .labelsHidden().pickerStyle(.menu).tint(Nuru.navy)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } right: {
                    CmsFieldCell(label: "Visibility") {
                        Picker("", selection: $visibility) {
                            ForEach(visibilityOpts, id: \.v) { Text($0.l).tag($0.v) }
                        }
                        .labelsHidden().pickerStyle(.menu).tint(Nuru.navy)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                CmsControlTile { Toggle("Required to advance", isOn: $required).tint(Nuru.lumGreen) }
            } header: { CmsSectionHeader(text: "Evaluation & gating") }
            .listRowBackground(Color.clear)

            SwiftUI.Section {
                CmsFieldPair {
                    CmsControlTile { Stepper("Pass mark: \(quizPassMark)%", value: $quizPassMark, in: 0...100, step: 5).tint(Nuru.gold) }
                        .disabled(!isQuiz)
                } right: {
                    CmsControlTile { Stepper("Attempts: \(maxAttempts)", value: $maxAttempts, in: 1...50).tint(Nuru.gold) }
                        .disabled(!isQuiz)
                }
                CmsControlTile {
                    Stepper(timeLimitMinutes > 0 ? "Time limit: \(timeLimitMinutes) min" : "Time limit: none",
                            value: $timeLimitMinutes, in: 0...240, step: 5).tint(Nuru.gold)
                }
                CmsControlTile { Toggle("Shuffle questions", isOn: $quizShuffle).tint(Nuru.lumGreen) }
                CmsFieldPair {
                    CmsControlTile { Toggle("Show answers", isOn: $quizShowAnswers).tint(Nuru.lumGreen) }
                } right: {
                    CmsControlTile { Toggle("Show score", isOn: $quizShowScore).tint(Nuru.lumGreen) }
                }
            } header: { CmsSectionHeader(text: "Quiz settings") }
            .listRowBackground(Color.clear)

            SwiftUI.Section {
                CmsFieldCell(label: "Lesson video URL") {
                    TextField("https://", text: $videoUrl)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                }
            } header: { CmsSectionHeader(text: "Lesson media") }
            .listRowBackground(Color.clear)

            if let notice {
                SwiftUI.Section { Text(notice).font(.nCaption).foregroundStyle(Nuru.success) }.listRowBackground(Color.clear)
            }
            if let error {
                SwiftUI.Section { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }.listRowBackground(Color.clear)
            }

            SwiftUI.Section {
                Button { Task { await save() } } label: {
                    HStack {
                        Spacer()
                        Text(saving ? "Saving…" : "Save module").font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                        Spacer()
                    }
                    .frame(minHeight: 50)
                    .background(title.trimmingCharacters(in: .whitespaces).isEmpty ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(Nuru.gold))
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                }
                .buttonStyle(.plain)
                .listRowBackground(Color.clear)
                .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Nuru.paper)
        .tint(Nuru.gold)
        .frame(maxWidth: 820)
        .frame(maxWidth: .infinity)
        .background(Nuru.paper)
    }

    // ── Markdown toolbar (web LevelDetail `tools` — H1…divider + Add section) ──

    /// One scrollable row of snippet buttons + the Write/Preview segmented toggle.
    /// The toolbar dims and stops responding while previewing, mirroring the web.
    private var markdownToolbarRow: some View {
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(MdTool.all) { tool in
                        if tool.newGroup {
                            Rectangle().fill(Nuru.border).frame(width: 1, height: 18).padding(.horizontal, 3)
                        }
                        Button { applyTool(tool) } label: {
                            Group {
                                if let icon = tool.icon {
                                    Image(systemName: icon).font(.system(size: 13, weight: .medium))
                                } else {
                                    Text(tool.label).font(.inter(11, .bold))
                                }
                            }
                            .foregroundStyle(Nuru.navy)
                            .frame(width: 30, height: 28)
                            .background(Nuru.white)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(tool.label)
                    }
                }
                .padding(.vertical, 1)
            }
            .opacity(mdMode == .preview ? 0.45 : 1)
            .allowsHitTesting(mdMode == .write)

            Spacer(minLength: 4)

            // Write / Preview segmented toggle (web's Eye Preview button).
            HStack(spacing: 0) {
                ForEach(MdEditorMode.allCases, id: \.self) { m in
                    let active = mdMode == m
                    Button { mdMode = m } label: {
                        HStack(spacing: 4) {
                            Image(systemName: m == .write ? "pencil" : "eye").font(.system(size: 10, weight: .semibold))
                            Text(m.rawValue).font(.inter(11.5, .semibold))
                        }
                        .foregroundStyle(active ? .white : Nuru.ink600)
                        .padding(.horizontal, 10).frame(height: 28)
                        .background(active ? AnyShapeStyle(Nuru.navy) : AnyShapeStyle(Color.clear))
                    }
                    .buttonStyle(.plain)
                }
            }
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
    }

    /// Append the tool's snippet at the end of the lesson ("Add section" reuses
    /// the canonical page-break flow so backend pagination stays byte-identical).
    private func applyTool(_ tool: MdTool) {
        if tool.isAddSection { addSection(); return }
        lessonContent += tool.snippet
    }

    // ── Load / reflect / save ──

    @MainActor private func load() async {
        phase = .loading
        do {
            let m = try await CmsAPI.module(moduleId)
            reflect(m)
            phase = .ready
        } catch {
            phase = .failed((error as? APIError)?.errorDescription ?? "Could not load module.")
        }
    }

    private func reflect(_ m: ModuleFull) {
        loaded = m
        title = m.title
        summary = m.summary ?? ""
        lessonContent = m.lessonContent
        objectives = m.objectives ?? ""
        tags = m.tags ?? ""
        keyVersesText = (m.keyVerses ?? []).joined(separator: "\n")
        evaluationKind = m.evaluationKind.isEmpty ? "none" : m.evaluationKind
        difficulty = m.difficulty.isEmpty ? "beginner" : m.difficulty
        visibility = m.visibility.isEmpty ? "members" : m.visibility
        required = m.required
        videoUrl = m.videoUrl ?? ""
        estimatedMinutes = m.estimatedMinutes ?? 0
        quizPassMark = Int(Double(m.quizPassMark) ?? 70)
        maxAttempts = m.maxAttempts ?? 3
        timeLimitMinutes = m.timeLimitSec != nil ? Int((m.timeLimitSec! / 60)) : 0
        quizShuffle = m.quizShuffle
        quizShowAnswers = m.quizShowAnswers
        quizShowScore = m.quizShowScore
    }

    @MainActor private func save() async {
        guard let m = loaded else { return }
        saving = true; error = nil; notice = nil
        let verses = keyVersesText.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let body = ModuleUpdateBody(
            title: title.trimmingCharacters(in: .whitespaces),
            summary: summary.isEmpty ? nil : summary,
            lessonContent: lessonContent,
            evaluationKind: evaluationKind,
            quizPassMark: quizPassMark,
            estimatedMinutes: estimatedMinutes > 0 ? estimatedMinutes : nil,
            videoUrl: videoUrl.trimmingCharacters(in: .whitespaces).isEmpty ? nil : videoUrl,
            keyVerses: verses.isEmpty ? nil : verses,
            maxAttempts: maxAttempts,
            difficulty: difficulty,
            objectives: objectives.isEmpty ? nil : objectives,
            tags: tags.trimmingCharacters(in: .whitespaces).isEmpty ? nil : tags,
            visibility: visibility,
            required: required,
            quizShuffle: quizShuffle,
            quizShowAnswers: quizShowAnswers,
            quizShowScore: quizShowScore,
            timeLimitSec: timeLimitMinutes > 0 ? timeLimitMinutes * 60 : nil,
            expectedRowVersion: m.rowVersion)
        do {
            let updated = try await CmsAPI.updateModule(moduleId, body)
            reflect(updated)
            notice = "Saved."
            saving = false
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Save failed — the module may have changed elsewhere (reload)."
            saving = false
        }
    }
}

// MARK: - SectionOutlineRow
//
// One row in the ModuleEditorPane sections outline: number + an inline rename
// field + a delete button. The field carries its own local @State seeded from
// the parsed section title so re-parses upstream don't thrash focus — it only
// pushes back to the model on end-editing (submit / focus loss).

private struct SectionOutlineRow: View {
    let index0: Int
    let seed: String
    let onRename: (String) -> Void
    let onDelete: () -> Void

    @State private var draft: String = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            Text("\(index0 + 1)")
                .font(.inter(12, .bold)).foregroundStyle(Nuru.gold)
                .frame(width: 22, height: 22)
                .background(Nuru.gold.opacity(0.14))
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

            TextField("Section title", text: $draft)
                .font(.inter(14, .medium)).foregroundStyle(Nuru.ink)
                .textFieldStyle(.plain)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit { commit() }

            Button(role: .destructive) { onDelete() } label: {
                Image(systemName: "trash")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Nuru.danger)
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Nuru.paper)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .onAppear { draft = seed }
        .onChange(of: seed) { _, new in if !focused { draft = new } }
        .onChange(of: focused) { _, isFocused in if !isFocused { commit() } }
    }

    private func commit() {
        let clean = draft.trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty, clean != seed else {
            if clean.isEmpty { draft = seed }
            return
        }
        onRename(clean)
    }
}

// MARK: - Markdown editing kit (web LevelDetail toolbar + write/preview toggle)

/// Editor mode for the lesson-content pane (web `mdView`).
private enum MdEditorMode: String, CaseIterable { case write = "Write", preview = "Preview" }

/// One toolbar snippet (web `tools` array). H1–H3 render as text labels; the rest
/// use SF Symbols. `newGroup` draws the thin divider the web puts between groups.
private struct MdTool: Identifiable {
    let label: String
    let icon: String?
    let snippet: String
    var newGroup = false
    var isAddSection = false
    var id: String { label }

    static let all: [MdTool] = [
        MdTool(label: "H1", icon: nil, snippet: "\n# Heading\n"),
        MdTool(label: "H2", icon: nil, snippet: "\n## Heading\n"),
        MdTool(label: "H3", icon: nil, snippet: "\n### Heading\n"),
        MdTool(label: "Bold", icon: "bold", snippet: "**bold**", newGroup: true),
        MdTool(label: "Italic", icon: "italic", snippet: "_italic_"),
        MdTool(label: "Strikethrough", icon: "strikethrough", snippet: "~~strike~~"),
        MdTool(label: "Code", icon: "chevron.left.forwardslash.chevron.right", snippet: "`code`"),
        MdTool(label: "Quote", icon: "text.quote", snippet: "\n> Quote\n", newGroup: true),
        MdTool(label: "Bullets", icon: "list.bullet", snippet: "\n- List item\n"),
        MdTool(label: "Numbered", icon: "list.number", snippet: "\n1. List item\n"),
        MdTool(label: "Link", icon: "link", snippet: "[link](https://)", newGroup: true),
        MdTool(label: "Image", icon: "photo", snippet: "![alt](https://)"),
        MdTool(label: "Table", icon: "tablecells", snippet: "\n| A | B |\n| --- | --- |\n| 1 | 2 |\n"),
        MdTool(label: "Divider", icon: "minus", snippet: "\n---\n"),
        MdTool(label: "Add section", icon: "rectangle.split.1x2", snippet: "", newGroup: true, isAddSection: true),
    ]
}

// MARK: - MarkdownBlocksView (native MarkdownPreview — simple block rendering)
//
// A lightweight block-level markdown renderer with the app's fonts: headings,
// paragraphs (inline **bold**/_italic_/`code` via AttributedString), bullet and
// numbered lists, quotes, fenced code, pipe tables, and dividers. Page-break
// markers render as rules so raw content previews cleanly too.
private struct MarkdownBlocksView: View {
    let content: String
    var accent: Color = Nuru.gold

    private enum Block {
        case heading(level: Int, text: String)
        case paragraph(String)
        case bullets([String])
        case numbered([String])
        case quote(String)
        case code(String)
        case table([[String]])
        case rule
    }

    var body: some View {
        let blocks = Array(Self.parse(content).enumerated())
        VStack(alignment: .leading, spacing: 12) {
            ForEach(blocks, id: \.offset) { _, block in
                render(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func render(_ block: Block) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(Self.inline(text))
                .font(level == 1 ? .fraunces(24, .semibold) : level == 2 ? .fraunces(19, .semibold) : .inter(16, .bold))
                .foregroundStyle(Nuru.navy)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
        case .paragraph(let text):
            Text(Self.inline(text))
                .font(.inter(14.5, .regular)).foregroundStyle(Nuru.ink).lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
        case .bullets(let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(accent).frame(width: 5, height: 5).padding(.top, 7)
                        Text(Self.inline(item)).font(.inter(14.5, .regular)).foregroundStyle(Nuru.ink).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        case .numbered(let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    HStack(alignment: .top, spacing: 8) {
                        Text("\(i + 1).").font(.inter(13, .bold)).foregroundStyle(accent)
                            .frame(minWidth: 16, alignment: .trailing)
                        Text(Self.inline(item)).font(.inter(14.5, .regular)).foregroundStyle(Nuru.ink).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        case .quote(let text):
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 2).fill(accent).frame(width: 3)
                Text(Self.inline(text)).font(.inter(14.5, .regular)).italic().foregroundStyle(Nuru.ink600).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
        case .code(let text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text).font(.system(size: 12.5, design: .monospaced)).foregroundStyle(Nuru.ink)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
        case .table(let rows):
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                ForEach(Array(rows.enumerated()), id: \.offset) { r, cells in
                    GridRow {
                        ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                            Text(Self.inline(cell))
                                .font(.inter(13, r == 0 ? .bold : .regular))
                                .foregroundStyle(r == 0 ? Nuru.navy : Nuru.ink)
                        }
                    }
                    if r == 0 { Divider().gridCellUnsizedAxes(.horizontal) }
                }
            }
            .padding(10)
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        case .rule:
            Rectangle().fill(Nuru.border).frame(height: 1).padding(.vertical, 2)
        }
    }

    /// Inline markdown (bold/italic/code/links) → AttributedString; plain on failure.
    private static func inline(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(s)
    }

    private static func headingLevel(_ line: String) -> (Int, String)? {
        guard line.hasPrefix("#") else { return nil }
        let hashes = line.prefix(while: { $0 == "#" })
        guard hashes.count <= 6 else { return nil }
        let rest = line.dropFirst(hashes.count)
        guard rest.first == " " || rest.first == "\t" else { return nil }
        return (hashes.count, rest.trimmingCharacters(in: .whitespaces))
    }

    private static func orderedItem(_ line: String) -> String? {
        guard let dot = line.firstIndex(of: "."), line.startIndex < dot else { return nil }
        let head = line[line.startIndex..<dot]
        guard !head.isEmpty, head.allSatisfy(\.isNumber) else { return nil }
        let rest = line[line.index(after: dot)...]
        guard rest.first == " " else { return nil }
        return rest.trimmingCharacters(in: .whitespaces)
    }

    private static func tableCells(_ line: String) -> [String] {
        line.trimmingCharacters(in: CharacterSet(charactersIn: "|"))
            .components(separatedBy: "|")
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }
    private static func isTableSeparator(_ cells: [String]) -> Bool {
        !cells.isEmpty && cells.allSatisfy { !$0.isEmpty && $0.allSatisfy { c in c == "-" || c == ":" } }
    }

    private static func parse(_ s: String) -> [Block] {
        var blocks: [Block] = []
        let lines = s.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var i = 0
        var para: [String] = []
        func flushPara() {
            if !para.isEmpty { blocks.append(.paragraph(para.joined(separator: " "))); para = [] }
        }
        while i < lines.count {
            let line = lines[i].trimmingCharacters(in: .whitespaces)
            if line.isEmpty { flushPara(); i += 1; continue }
            if line == "<!-- page-break -->" || line == "---" || line == "***" || line == "___" {
                flushPara(); blocks.append(.rule); i += 1; continue
            }
            if line.hasPrefix("```") {
                flushPara()
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    code.append(lines[i]); i += 1
                }
                i += 1 // consume the closing fence (or run off the end)
                blocks.append(.code(code.joined(separator: "\n")))
                continue
            }
            if let h = headingLevel(line) { flushPara(); blocks.append(.heading(level: h.0, text: h.1)); i += 1; continue }
            if line.hasPrefix("|") {
                flushPara()
                var rows: [[String]] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    guard t.hasPrefix("|") else { break }
                    let cells = tableCells(t)
                    if !isTableSeparator(cells) { rows.append(cells) }
                    i += 1
                }
                if !rows.isEmpty { blocks.append(.table(rows)) }
                continue
            }
            if line.hasPrefix(">") {
                flushPara()
                var quote: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    guard t.hasPrefix(">") else { break }
                    quote.append(String(t.dropFirst()).trimmingCharacters(in: .whitespaces))
                    i += 1
                }
                blocks.append(.quote(quote.joined(separator: " ")))
                continue
            }
            if line.hasPrefix("- ") || line.hasPrefix("* ") {
                flushPara()
                var items: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    guard t.hasPrefix("- ") || t.hasPrefix("* ") else { break }
                    items.append(String(t.dropFirst(2)).trimmingCharacters(in: .whitespaces))
                    i += 1
                }
                blocks.append(.bullets(items))
                continue
            }
            if orderedItem(line) != nil {
                flushPara()
                var items: [String] = []
                while i < lines.count, let item = orderedItem(lines[i].trimmingCharacters(in: .whitespaces)) {
                    items.append(item); i += 1
                }
                blocks.append(.numbered(items))
                continue
            }
            para.append(line)
            i += 1
        }
        flushPara()
        return blocks
    }
}

// MARK: - Learner preview (web ModulePreview.tsx — closes ledger D-06)
//
// A read-only learner's-eye render of the module: hero (level eyebrow · title ·
// summary · chips), objectives, video placeholder, the lesson split into titled
// sections with labelled dividers, key scripture, tags, and a non-interactive
// rendering of the module's quiz questions. Presented full-height off the module
// editor and fed the CURRENT draft — unsaved edits preview exactly as members
// will see them once saved. Questions come from the same questions API the Quiz
// Builder uses; the level's accent colour resolves best-effort from /admin/levels.

/// One titled teaching section of the snapshot (parseSections output).
private struct LpSection { let title: String?; let body: String }

/// Frozen copy of the editor's current fields at the moment Preview is tapped.
private struct LearnerPreviewSnapshot {
    let moduleId: String
    let levelNumber: Int
    let sequence: Int
    let title: String
    let summary: String
    let difficulty: String
    let estimatedMinutes: Int
    let evaluationKind: String
    let quizPassMark: Int
    let objectives: [String]
    let keyVerses: [String]
    let tags: [String]
    let videoUrl: String
    let sections: [LpSection]
    let wordCount: Int

    /// Reader-facing minutes: authored estimate, else ~200 wpm read time.
    var minutes: Int { estimatedMinutes > 0 ? estimatedMinutes : max(1, Int((Double(wordCount) / 200.0).rounded(.up))) }
}

// ── Question rows with the polymorphic answer_options the shared model omits ──
// (decode parity with QuizBuilderView's QBQuestion; that type is fileprivate there.)

private struct LpChoice: Decodable { let id: String?; let text: String; let isCorrect: Bool? }
private struct LpScale: Decodable { let min: Int; let max: Int; let minLabel: String?; let maxLabel: String? }

private enum LpAnswerOptions: Decodable {
    case strings([String])
    case choices([LpChoice])
    case scale(LpScale)
    case none

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(), single.decodeNil() { self = .none; return }
        if let arr = try? decoder.singleValueContainer().decode([String].self) { self = .strings(arr); return }
        if let c = try? decoder.container(keyedBy: K.self) {
            if let ch = try? c.decode([LpChoice].self, forKey: .choices) { self = .choices(ch); return }
            if let sc = try? c.decode(LpScale.self, forKey: .scale) { self = .scale(sc); return }
        }
        self = .none
    }
    enum K: String, CodingKey { case choices, scale }
}

private struct LpQuestion: Decodable, Identifiable {
    var questionId = ""
    var qType = "short_answer"
    var questionText = ""
    var isActive = true
    var points = 1
    var required = true
    var answerOptions: LpAnswerOptions = .none
    var id: String { questionId }

    enum CodingKeys: String, CodingKey { case questionId, qType, questionText, isActive, points, required, answerOptions }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        questionId = (try? c.decode(String.self, forKey: .questionId)) ?? UUID().uuidString
        qType = (try? c.decode(String.self, forKey: .qType)) ?? "short_answer"
        questionText = (try? c.decode(String.self, forKey: .questionText)) ?? ""
        isActive = (try? c.decode(Bool.self, forKey: .isActive)) ?? true
        points = (try? c.decode(Int.self, forKey: .points)) ?? 1
        required = (try? c.decode(Bool.self, forKey: .required)) ?? true
        answerOptions = (try? c.decode(LpAnswerOptions.self, forKey: .answerOptions)) ?? .none
    }

    /// Learner-side option labels (web previewOptions): TrueFalse is fixed;
    /// legacy string[] and Figma {choices} both flatten to their texts.
    var options: [String] {
        if qType == "TrueFalse" { return ["True", "False"] }
        switch answerOptions {
        case .strings(let s): return s
        case .choices(let cs): return cs.map(\.text)
        default: return []
        }
    }
    var isChoice: Bool { ["MultipleChoice", "TrueFalse", "multiple_choice", "dropdown", "checkbox"].contains(qType) }
    var isMulti: Bool { qType == "checkbox" }
    var scale: LpScale? {
        if qType == "linear_scale", case .scale(let s) = answerOptions { return s }
        return nil
    }
}
private struct LpQuestionList: Decodable { let data: [LpQuestion] }

private struct LearnerPreviewSheet: View {
    let snapshot: LearnerPreviewSnapshot
    @Environment(\.dismiss) private var dismiss

    @State private var accent: Color = Nuru.gold          // level colour, resolved async
    @State private var levelTitle: String?
    @State private var questions: [LpQuestion] = []

    private var totalPoints: Int { questions.reduce(0) { $0 + $1.points } }

    /// Web diffStyle map (beginner green · intermediate amber · advanced red).
    private var diffStyle: (bg: Color, fg: Color) {
        switch snapshot.difficulty {
        case "intermediate": return (Color(hex: 0xFDF5E5), Color(hex: 0x8A6B1F))
        case "advanced":     return (Color(hex: 0xFDECEC), Color(hex: 0xA8281F))
        default:             return (Color(hex: 0xE8F6EE), Color(hex: 0x0F6B33))
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    banner
                    hero
                    contentColumn
                }
            }
            .background(Nuru.paper)
            .navigationTitle("Learner preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }
        }
        .presentationDetents([.large])
    }

    // Navy strip (web's sticky "Learner preview · how disciples see this module").
    private var banner: some View {
        HStack(spacing: 8) {
            Image(systemName: "eye").font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.gold)
            Text("Learner preview").font(.inter(12, .semibold)).foregroundStyle(.white)
            Text("· how disciples see this module — includes unsaved edits")
                .font(.inter(12, .regular)).foregroundStyle(.white.opacity(0.55))
                .lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20).padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(Nuru.navyDeep)
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "graduationcap").font(.system(size: 12, weight: .semibold)).foregroundStyle(accent)
                Text(levelTitle.map { "Level \(snapshot.levelNumber) · \($0)" } ?? "Level \(snapshot.levelNumber)")
                    .font(.inter(11, .semibold)).foregroundStyle(Nuru.ink600)
                Text("· Module \(snapshot.sequence)").font(.inter(11, .regular)).foregroundStyle(Nuru.ink600)
            }
            Text(snapshot.title.isEmpty ? "Untitled module" : snapshot.title)
                .font(.fraunces(30, .semibold)).foregroundStyle(Nuru.navy)
                .fixedSize(horizontal: false, vertical: true)
            if !snapshot.summary.isEmpty {
                Text(snapshot.summary).font(.inter(15, .regular)).foregroundStyle(Nuru.ink600).lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Text(snapshot.difficulty.prefix(1).uppercased() + snapshot.difficulty.dropFirst())
                    .font(.inter(11.5, .bold)).foregroundStyle(diffStyle.fg)
                    .padding(.horizontal, 11).padding(.vertical, 5)
                    .background(diffStyle.bg).clipShape(Capsule())
                Label("\(snapshot.minutes) min", systemImage: "clock")
                    .font(.inter(11.5, .semibold)).foregroundStyle(Nuru.navy)
                    .padding(.horizontal, 11).padding(.vertical, 5)
                    .background(Nuru.mutedBg).clipShape(Capsule())
                if !questions.isEmpty {
                    Label("\(questions.count) question\(questions.count == 1 ? "" : "s")", systemImage: "questionmark.circle")
                        .font(.inter(11.5, .semibold)).foregroundStyle(Nuru.navy)
                        .padding(.horizontal, 11).padding(.vertical, 5)
                        .background(Nuru.mutedBg).clipShape(Capsule())
                }
            }
        }
        .padding(.horizontal, 24).padding(.top, 26).padding(.bottom, 22)
        .frame(maxWidth: 760, alignment: .leading)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(colors: [accent.opacity(0.10), Color.clear], startPoint: .top, endPoint: .bottom)
        )
        .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }
    }

    private var contentColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !snapshot.objectives.isEmpty { objectivesCard.padding(.top, 22) }
            if !snapshot.videoUrl.isEmpty { videoPlaceholder.padding(.top, 20) }

            if snapshot.sections.isEmpty {
                Text("No lesson content yet.").font(.inter(14, .regular)).italic().foregroundStyle(Nuru.ink600)
                    .padding(.top, 26)
            } else {
                ForEach(Array(snapshot.sections.enumerated()), id: \.offset) { i, sec in
                    sectionDivider(i, sec.title)
                    MarkdownBlocksView(content: sec.body, accent: accent)
                }
            }

            if !snapshot.keyVerses.isEmpty { scriptureCard.padding(.top, 26) }
            if !snapshot.tags.isEmpty { tagsRow.padding(.top, 18) }
            if !questions.isEmpty { quizBlock.padding(.top, 36) }
        }
        .padding(.horizontal, 24).padding(.bottom, 56)
        .frame(maxWidth: 760, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    private var objectivesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "target").font(.system(size: 14, weight: .semibold)).foregroundStyle(accent)
                Text("What you'll learn").font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(snapshot.objectives.enumerated()), id: \.offset) { _, o in
                    HStack(alignment: .top, spacing: 10) {
                        Circle().fill(accent).frame(width: 6, height: 6).padding(.top, 6)
                        Text(o).font(.inter(14, .regular)).foregroundStyle(Nuru.ink).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private var videoPlaceholder: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x0B1F33), Color(hex: 0x1E4068)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            VStack(spacing: 8) {
                Image(systemName: "play.circle").font(.system(size: 44, weight: .light)).foregroundStyle(.white.opacity(0.9))
                Text("Lesson video").font(.inter(13, .semibold)).foregroundStyle(.white)
            }
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    /// "— SECTION N · TITLE —" between hairlines (web SectionDivider).
    private func sectionDivider(_ index0: Int, _ title: String?) -> some View {
        let label = title.map { "Section \(index0 + 1) · \($0)" } ?? "Section \(index0 + 1)"
        return HStack(spacing: 12) {
            Rectangle().fill(Nuru.border).frame(height: 1)
            Text("— \(label) —".uppercased())
                .font(.inter(10.5, .bold)).tracking(0.8).foregroundStyle(accent)
                .lineLimit(1).minimumScaleFactor(0.7)
                .layoutPriority(1)
            Rectangle().fill(Nuru.border).frame(height: 1)
        }
        .padding(.vertical, 22)
    }

    private var scriptureCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "book").font(.system(size: 14, weight: .semibold)).foregroundStyle(Color(hex: 0xA87616))
                Text("Key scripture").font(.inter(13, .bold)).foregroundStyle(Color(hex: 0x7A5410))
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                ForEach(Array(snapshot.keyVerses.enumerated()), id: \.offset) { _, v in
                    Text(v).font(.inter(12.5, .semibold)).foregroundStyle(Color(hex: 0x0B1F33))
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white.opacity(0.7))
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [Color(hex: 0xFFFBEB), Color(hex: 0xFDF5DA)], startPoint: .top, endPoint: .bottom))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Color(hex: 0xF5E0A8), lineWidth: 1))
    }

    private var tagsRow: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(Array(snapshot.tags.enumerated()), id: \.offset) { _, t in
                HStack(spacing: 4) {
                    Image(systemName: "number").font(.system(size: 9, weight: .semibold)).foregroundStyle(accent)
                    Text(t).font(.inter(11, .semibold)).foregroundStyle(Nuru.ink600).lineLimit(1)
                }
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(Nuru.mutedBg).clipShape(Capsule())
            }
        }
    }

    private var quizBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(Nuru.border).frame(height: 1).padding(.bottom, 26)
            HStack(alignment: .firstTextBaseline) {
                Text(snapshot.evaluationKind == "reflection" ? "Reflection" : "Module quiz")
                    .font(.fraunces(24, .semibold)).foregroundStyle(Nuru.navy)
                Spacer(minLength: 8)
                HStack(spacing: 12) {
                    Label("\(questions.count) questions", systemImage: "questionmark.circle")
                    Label("\(totalPoints) points", systemImage: "rosette")
                    if snapshot.evaluationKind == "quiz" { Text("Pass: \(snapshot.quizPassMark)%") }
                }
                .font(.inter(11.5, .semibold)).foregroundStyle(Nuru.ink600)
            }
            Text("Answer the questions below to complete this module.")
                .font(.inter(13, .regular)).foregroundStyle(Nuru.ink600)
                .padding(.top, 4).padding(.bottom, 18)
            VStack(spacing: 14) {
                ForEach(Array(questions.enumerated()), id: \.element.id) { i, q in
                    LpQuestionCard(q: q, index: i, accent: accent)
                }
            }
            Text("Submit answers")
                .font(.inter(14, .bold)).foregroundStyle(.white)
                .padding(.horizontal, 26).frame(height: 44)
                .background(accent.opacity(0.85))
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                .padding(.top, 20)
            Text("Preview only — submission is disabled.")
                .font(.nMicro).foregroundStyle(Nuru.ink600)
                .padding(.top, 6)
        }
    }

    @MainActor private func load() async {
        // Accent + level title (best-effort — the preview still renders without them).
        if let levels = try? await PortalAPI.curriculumLevels(),
           let level = levels.first(where: { $0.levelNumber == snapshot.levelNumber }) {
            accent = cssColor(level.color)
            levelTitle = level.title
        }
        // The module's active questions (same endpoint the Quiz Builder loads).
        if let list = try? await APIClient.shared.get("/admin/modules/\(snapshot.moduleId)/questions", as: LpQuestionList.self) {
            questions = list.data.filter { $0.isActive }
        }
    }
}

/// One non-interactive question card: MCQ / TrueFalse / checkbox / dropdown show
/// their options with empty radios or checkboxes; short answer, fill-blank and
/// paragraph show a disabled answer field; linear scale shows its steps. Answers
/// are never marked — the learner view hides correctness (web QuestionView).
private struct LpQuestionCard: View {
    let q: LpQuestion
    let index: Int
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Text("\(index + 1)").font(.inter(12, .bold)).foregroundStyle(.white)
                    .frame(width: 24, height: 24).background(accent).clipShape(Circle())
                VStack(alignment: .leading, spacing: 3) {
                    if q.questionText.isEmpty {
                        Text("Untitled question").font(.inter(14.5, .semibold)).italic().foregroundStyle(Nuru.ink400)
                    } else {
                        Text(q.questionText).font(.inter(14.5, .semibold)).foregroundStyle(Nuru.navy)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text("\(q.points) \(q.points == 1 ? "point" : "points")\(q.required ? "" : " · optional")")
                        .font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 9) {
                if q.isChoice {
                    ForEach(Array(q.options.enumerated()), id: \.offset) { _, option in
                        HStack(spacing: 10) {
                            RoundedRectangle(cornerRadius: q.isMulti ? 4 : 9, style: .continuous)
                                .strokeBorder(Nuru.border, lineWidth: 2)
                                .frame(width: 18, height: 18)
                            Text(option).font(.inter(14, .regular)).foregroundStyle(Nuru.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                if q.qType == "short_answer" || q.qType == "FillInTheBlank" {
                    answerPlaceholder(minHeight: 42)
                }
                if q.qType == "paragraph" {
                    answerPlaceholder(minHeight: 72)
                }
                if let s = q.scale { scaleRow(s) }
            }
            .padding(.leading, 34)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func answerPlaceholder(minHeight: CGFloat) -> some View {
        Text("Your answer")
            .font(.inter(13.5, .regular)).foregroundStyle(Nuru.ink400)
            .padding(.horizontal, 12).padding(.vertical, 11)
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .topLeading)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1.5))
    }

    private func scaleRow(_ s: LpScale) -> some View {
        let steps = s.max >= s.min ? Array(s.min...min(s.max, s.min + 10)) : []
        return HStack(alignment: .top, spacing: 8) {
            Text(s.minLabel?.isEmpty == false ? s.minLabel! : "\(s.min)")
                .font(.nMicro).foregroundStyle(Nuru.ink600)
            Spacer(minLength: 4)
            HStack(spacing: 12) {
                ForEach(steps, id: \.self) { n in
                    VStack(spacing: 4) {
                        Circle().strokeBorder(Nuru.border, lineWidth: 2).frame(width: 18, height: 18)
                        Text("\(n)").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                }
            }
            Spacer(minLength: 4)
            Text(s.maxLabel?.isEmpty == false ? s.maxLabel! : "\(s.max)")
                .font(.nMicro).foregroundStyle(Nuru.ink600)
        }
    }
}

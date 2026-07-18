// Curriculum Dashboard (docs/CURRICULUM_ARCHITECTURE.md §5.1) — replaces the
// old Curriculum Levels page + the CMS Curriculum overview. Answers: is the
// curriculum healthy, what needs attention, what do I work on next?
//
//  • Curriculum Health — the summary grid from GET /admin/curriculum/summary
//    (ONE stats source, §3). Every count is a link.
//  • Pipeline — Draft / In Review / Locked / Live, now CLICKABLE: each tile
//    filters the level cards below.
//  • Needs attention — the validation report (GET /validate), ranked
//    errors-first; tapping opens the workspace at the level/module.
//  • Activity — classified server-side (GET /activity), not a flat feed.
//  • Quick actions by workflow — Create · Manage · Utilities.
//  • Analytics — expandable (donut / bars / trend reused from the retired
//    Curriculum Levels page), collapsed by default — no chart wall.
//  • Level summary cards — with ONE Open button into the workspace; all other
//    actions live inside the workspace.
import SwiftUI
import Charts

// MARK: - Workspace navigation target

struct WorkspaceTarget: Identifiable, Hashable {
    let level: Int?
    var moduleId: String? = nil
    var id: String { "\(level.map(String.init) ?? "root")-\(moduleId ?? "-")" }
}

// MARK: - Root

struct CurriculumDashboardView: View {
    @EnvironmentObject private var router: NavRouter

    @State private var summary: CurriculumSummary?
    @State private var issues: [CurriculumIssue] = []
    @State private var activity: [CurriculumActivityRow] = []
    @State private var phase: Phase = .loading
    private enum Phase { case loading, loaded, failed(String) }

    @State private var pipelineFilter: PipelineFilter?
    @State private var analyticsOpen = false
    @State private var analyticsReport: CdReport?
    @State private var levelSheet = false
    @State private var workspaceTarget: WorkspaceTarget?

    enum PipelineFilter: String { case drafts = "Drafts", inReview = "In review", locked = "Locked", live = "Live" }

    private var totals: CurriculumTotals? { summary?.totals }
    private var levels: [CurriculumLevelCard] { summary?.levels ?? [] }

    private var filteredLevels: [CurriculumLevelCard] {
        guard let f = pipelineFilter else { return levels }
        switch f {
        case .drafts:   return levels.filter { $0.status == "draft" }
        case .inReview: return levels.filter { $0.status == "in_review" }
        case .locked:   return levels.filter { $0.locked }
        case .live:     return levels.filter { $0.status == "published" }
        }
    }

    var body: some View {
        Group {
            switch phase {
            case .loading:
                ScrollView { SkeletonList(rows: 6).padding(Nuru.S.screen) }
            case .failed(let m):
                ScrollView { ErrorBanner(message: m) { Task { await reload() } }.padding(Nuru.S.screen) }
            case .loaded:
                content
            }
        }
        .background(Nuru.paper)
        .navigationBarTitleDisplayMode(.inline)
        .task { if case .loading = phase { await reload() } }
        .onAppear { applyPendingLevel() }
        .onChange(of: router.pendingLevel) { _, _ in applyPendingLevel() }
        .sheet(isPresented: $levelSheet) {
            LevelFormSheet(mode: .add, nextNumber: levels.count + 1, reload: { await reload() })
        }
        .navigationDestination(item: $workspaceTarget) { target in
            CurriculumWorkspaceView(initialLevel: target.level, initialModuleId: target.moduleId)
        }
    }

    /// NavRouter.openLevel deep link → route straight into the workspace.
    private func applyPendingLevel() {
        guard let n = router.pendingLevel else { return }
        router.pendingLevel = nil
        workspaceTarget = WorkspaceTarget(level: n)
    }

    @MainActor private func reload() async {
        do {
            async let s = PortalAPI.curriculumSummary()
            // Validate + activity are best-effort — the dashboard still stands without them.
            async let i = PortalAPI.curriculumValidate()
            async let a = PortalAPI.curriculumActivity()
            summary = try await s
            issues = (try? await i) ?? []
            activity = (try? await a) ?? []
            phase = .loaded
        } catch {
            if case .loading = phase {
                phase = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
            }
        }
    }

    @MainActor private func loadAnalytics() async {
        guard analyticsReport == nil else { return }
        analyticsReport = try? await CdReport.fetch()
    }

    // MARK: Layout

    private var content: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                VStack(alignment: .leading, spacing: 18) {
                    healthCard
                    pipelineCard
                    if !issues.isEmpty { needsAttentionCard }
                    quickActionsCard
                    analyticsCard
                    levelCardsSection
                    if !activity.isEmpty { activityCard }
                }
                .padding(.horizontal, Nuru.S.screen)
                .padding(.vertical, Nuru.S.lg)
                .macContentColumn(MacDesign.workspaceMaxWidth)
            }
        }
        .refreshable { await reload() }
    }

    // MARK: Hero

    private var hero: some View {
        PortalHero(
            breadcrumb: ["Nuru Pathway", "Curriculum"],
            title: "Curriculum",
            subtitle: "One dashboard for health, attention and work — open a level to edit.",
            stats: [
                HeroStat(label: "Levels live", value: "\(totals?.levels?.published ?? 0)", hint: "of \(totals?.levels?.total ?? 0) levels"),
                HeroStat(label: "Modules published", value: "\(totals?.modules?.published ?? 0)", hint: "of \(totals?.modules?.total ?? 0) modules"),
                HeroStat(label: "Active learners", value: (totals?.learnersActive ?? 0).formatted(), hint: "across the pathway"),
                HeroStat(label: "Avg completion", value: "\(totals?.avgCompletionPct ?? 0)%", hint: "one formula, server-side"),
            ]
        ) {
            HStack(spacing: 8) {
                HeroChip(label: "\(levels.count)-Level Pathway", icon: "sparkles", style: .tag)
                HeroChip(label: "Open workspace", icon: "square.and.pencil", style: .ghost) {
                    workspaceTarget = WorkspaceTarget(level: levels.first?.levelNumber)
                }
                HeroChip(label: "New Level", icon: "plus", style: .gold) { levelSheet = true }
            }
        }
    }

    // MARK: Curriculum Health (every count is a link)

    private var healthCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "heart.text.square").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                    Text("Curriculum health").font(.inter(12.5, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 0)
                    Text("Every count is a link").font(.nMicro).foregroundStyle(Nuru.ink400)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 148), spacing: 10)], spacing: 10) {
                    healthTile("Levels live", "\(totals?.levels?.published ?? 0)", "rosette", Nuru.brandTint(0)) { pipelineFilter = .live }
                    healthTile("Level drafts", "\(totals?.levels?.draft ?? 0)", "pencil.line", Nuru.brandTint(2)) { pipelineFilter = .drafts }
                    healthTile("In review", "\(totals?.levels?.inReview ?? 0)", "eye", Nuru.brandTint(3)) { pipelineFilter = .inReview }
                    healthTile("Modules live", "\(totals?.modules?.published ?? 0)", "book", Nuru.brandTint(0)) { openWorkspace() }
                    healthTile("Module drafts", "\(totals?.modules?.draft ?? 0)", "square.and.pencil", Nuru.brandTint(2)) { openWorkspace() }
                    healthTile("Missing video", "\(totals?.modulesMissingVideo ?? 0)", "video.slash", Nuru.brandTint(1)) { openWorkspace() }
                    healthTile("Missing quiz", "\(totals?.modulesMissingQuiz ?? 0)", "questionmark.circle", Nuru.brandTint(1)) { openWorkspace() }
                    healthTile("Missing content", "\(totals?.modulesMissingContent ?? 0)", "doc.text.magnifyingglass", Nuru.brandTint(1)) { openWorkspace() }
                    healthTile("Learners", (totals?.learnersActive ?? 0).formatted(), "person.2", Nuru.brandTint(0)) { router.go(.members) }
                    healthTile("Avg quiz score", totals?.avgQuizScore.map { "\($0)%" } ?? "—", "chart.bar", Nuru.brandTint(3)) { analyticsOpen = true; Task { await loadAnalytics() } }
                    healthTile("Certificates", "\(totals?.certificatesIssued ?? 0)", "rosette", Nuru.brandTint(0)) { router.go(.certificates) }
                    healthTile("Badges", "\(totals?.badgesConfigured ?? 0)", "star", Nuru.brandTint(3)) { router.go(.badges) }
                    healthTile("Reflection queue", "\(totals?.reflectionQueue ?? 0)", "text.bubble", Nuru.brandTint(1)) { router.go(.reflectionQueue) }
                    healthTile("Reviews waiting", "\(totals?.levelReviewsWaiting ?? 0)", "checkmark.seal", Nuru.brandTint(1)) { router.go(.levelReviews) }
                    healthTile("Assets attached", "\(totals?.videoAssets?.attached ?? 0)", "play.rectangle", Nuru.brandTint(0)) { router.go(.videoLibrary) }
                    healthTile("Assets unattached", "\(totals?.videoAssets?.unattached ?? 0)", "rectangle.on.rectangle.slash", Nuru.brandTint(2)) { router.go(.videoLibrary) }
                }
            }
        }
    }

    private func healthTile(_ label: String, _ value: String, _ icon: String, _ tint: Nuru.Tint, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 9) {
                ZStack {
                    RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous).fill(tint.fg.opacity(0.14))
                    Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(tint.fg)
                }.frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 0) {
                    Text(value).font(.fraunces(17, .semibold)).foregroundStyle(Nuru.navy)
                    Text(label).font(.inter(10, .medium)).foregroundStyle(Nuru.ink600)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Nuru.ink300)
            }
            .padding(.horizontal, 10).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func openWorkspace() {
        workspaceTarget = WorkspaceTarget(level: levels.first?.levelNumber)
    }

    // MARK: Pipeline (clickable — filters the level cards)

    private var pipelineCard: some View {
        let p = summary?.pipeline
        return Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text("Curriculum pipeline").font(.inter(12.5, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
                    Text("LIVE").font(.nMicro).foregroundStyle(Nuru.goldLo)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Nuru.gold.opacity(0.14)).clipShape(Capsule())
                    Spacer(minLength: 0)
                    if pipelineFilter != nil {
                        Button { pipelineFilter = nil } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                                Text("Clear filter").font(.inter(11, .semibold))
                            }
                            .foregroundStyle(Nuru.goldLo)
                        }
                        .buttonStyle(.plain)
                    }
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 10)], spacing: 10) {
                    pipelineTile(.drafts, "\(p?.drafts ?? 0)", "pencil.line", Nuru.brandTint(2))
                    pipelineTile(.inReview, "\(p?.inReview ?? 0)", "eye", Nuru.brandTint(3))
                    pipelineTile(.locked, "\(p?.locked ?? 0)", "lock", Nuru.brandTint(1))
                    pipelineTile(.live, "\(p?.live ?? 0)", "rosette", Nuru.brandTint(0))
                }
            }
        }
    }

    private func pipelineTile(_ f: PipelineFilter, _ value: String, _ icon: String, _ tint: Nuru.Tint) -> some View {
        let active = pipelineFilter == f
        return Button { pipelineFilter = active ? nil : f } label: {
            HStack(spacing: 9) {
                ZStack {
                    RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous).fill(tint.fg.opacity(active ? 0.28 : 0.14))
                    Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(tint.fg)
                }.frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 0) {
                    Text(value).font(.fraunces(18, .semibold)).foregroundStyle(Nuru.navy)
                    Text(f.rawValue).font(.inter(10.5, .medium)).foregroundStyle(Nuru.ink600)
                        .lineLimit(1).minimumScaleFactor(0.85)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 11).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(active ? tint.fg.opacity(0.08) : Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous)
                .stroke(active ? tint.fg : Nuru.border, lineWidth: active ? 1.5 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Needs attention (validation report, ranked)

    private var needsAttentionCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle").font(.system(size: 13)).foregroundStyle(Nuru.warning)
                    Text("Needs attention").font(.inter(12.5, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 0)
                    let errs = issues.filter { $0.severity == "error" }.count
                    let warns = issues.filter { $0.severity == "warning" }.count
                    Text("\(errs) errors · \(warns) warnings").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                VStack(spacing: 6) {
                    // Already ranked server-side: errors → warnings → info.
                    ForEach(issues.prefix(12)) { issue in issueRow(issue) }
                }
                if issues.count > 12 {
                    Text("+ \(issues.count - 12) more — fix the ones above first.")
                        .font(.nMicro).foregroundStyle(Nuru.ink400)
                }
            }
        }
    }

    private func issueRow(_ issue: CurriculumIssue) -> some View {
        let tint: Color = issue.severity == "error" ? Nuru.danger : issue.severity == "warning" ? Nuru.warning : Nuru.ink600
        return Button {
            // Tapping opens the workspace at the level/module in question.
            workspaceTarget = WorkspaceTarget(level: issue.levelNumber, moduleId: issue.moduleId)
        } label: {
            HStack(spacing: 10) {
                Circle().fill(tint).frame(width: 7, height: 7)
                Text("L\(issue.levelNumber)").font(.inter(10.5, .bold)).foregroundStyle(Nuru.navy)
                    .frame(width: 26, height: 20)
                    .background(Nuru.mutedBg).clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                Text(issue.message).font(.inter(12.5, .medium)).foregroundStyle(Nuru.ink)
                    .lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.forward.square").font(.system(size: 11)).foregroundStyle(Nuru.ink400)
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(tint.opacity(0.2), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Quick actions (Create · Manage · Utilities)

    private var quickActionsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "bolt.fill").font(.system(size: 12)).foregroundStyle(Nuru.gold)
                    Text("Quick actions").font(.inter(12.5, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 0)
                }
                actionRow("CREATE", [
                    ("New Level", "plus", { levelSheet = true }),
                    ("New Module", "book", { openWorkspace() }),
                    ("New Quiz", "questionmark.circle", {
                        if let n = levels.first?.levelNumber { router.openQuizBuilder(level: n) }
                    }),
                    ("Upload Video", "arrow.up.circle", { router.go(.videoLibrary) }),
                    ("Register External", "link", { router.go(.videoLibrary) }),
                ])
                actionRow("MANAGE", [
                    ("Reflection Queue", "text.bubble", { router.go(.reflectionQueue) }),
                    ("Reviews", "checkmark.seal", { router.go(.levelReviews) }),
                    ("Learners", "person.2", { router.go(.members) }),
                    ("Certificates", "rosette", { router.go(.certificates) }),
                ])
                actionRow("UTILITIES", [
                    ("Refresh Analytics", "arrow.clockwise", { Task { analyticsReport = nil; await reload(); await loadAnalytics() } }),
                    ("Validate Curriculum", "checklist", { Task { issues = (try? await PortalAPI.curriculumValidate()) ?? issues } }),
                ])
            }
        }
    }

    private func actionRow(_ label: String, _ actions: [(String, String, () -> Void)]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.inter(9.5, .bold)).tracking(1.0).foregroundStyle(Nuru.ink400)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(actions.enumerated()), id: \.offset) { _, a in
                        Button(action: a.2) {
                            HStack(spacing: 6) {
                                Image(systemName: a.1).font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.gold)
                                Text(a.0).font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                            }
                            .padding(.horizontal, 12).frame(height: 34)
                            .background(Nuru.white)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: Analytics (expandable, collapsed by default)

    private var analyticsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    analyticsOpen.toggle()
                    if analyticsOpen { Task { await loadAnalytics() } }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "chart.pie").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                        Text("Analytics").font(.inter(12.5, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
                        Text("learners · completion · enrolment trend").font(.nMicro).foregroundStyle(Nuru.ink400)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.ink400)
                            .rotationEffect(.degrees(analyticsOpen ? 180 : 0))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if analyticsOpen {
                    if let report = analyticsReport {
                        if MacDesign.isMac {
                            HStack(alignment: .top, spacing: 18) {
                                CdLearnersByLevel(levels: report.levels).frame(maxWidth: .infinity, alignment: .top)
                                CdCompletionByLevel(levels: report.levels).frame(maxWidth: .infinity, alignment: .top)
                                CdEnrolmentTrend(levels: report.levels, trend: report.trend).frame(maxWidth: .infinity, alignment: .top)
                            }
                        } else {
                            ViewThatFits(in: .horizontal) {
                                HStack(alignment: .top, spacing: 18) {
                                    CdLearnersByLevel(levels: report.levels).frame(maxWidth: .infinity)
                                    CdCompletionByLevel(levels: report.levels).frame(maxWidth: .infinity)
                                }
                                VStack(spacing: 18) {
                                    CdLearnersByLevel(levels: report.levels)
                                    CdCompletionByLevel(levels: report.levels)
                                }
                            }
                            CdEnrolmentTrend(levels: report.levels, trend: report.trend)
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                    }
                }
            }
        }
    }

    // MARK: Level summary cards (§5.1 — ONE Open button)

    private var levelCardsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("The pathway").font(.nTitle).foregroundStyle(Nuru.navy)
                    Text(pipelineFilter.map { "Filtered: \($0.rawValue) — tap the pipeline tile again to clear." }
                         ?? "Open a level to work on it — everything else lives in the workspace.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                }
                Spacer()
            }
            if filteredLevels.isEmpty {
                Text("No levels match this filter.").font(.nCaption).foregroundStyle(Nuru.ink600)
                    .frame(maxWidth: .infinity).padding(.vertical, 30)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: MacDesign.isMac ? 360 : 250), spacing: 12, alignment: .top)], spacing: 12) {
                    ForEach(filteredLevels) { card in
                        LevelSummaryCard(card: card) {
                            workspaceTarget = WorkspaceTarget(level: card.levelNumber)
                        }
                    }
                }
            }
        }
    }

    // MARK: Activity (classified groups, not a flat feed)

    private static let activityGroups: [(kind: String, label: String, icon: String)] = [
        ("published", "Recently Published", "checkmark.seal"),
        ("edited", "Recently Edited", "square.and.pencil"),
        ("review", "Pending Review", "text.bubble"),
        ("video", "Videos", "play.rectangle"),
        ("quiz", "Quiz changes", "questionmark.circle"),
        ("module", "Module changes", "book"),
        ("milestone", "Learner milestones", "rosette"),
    ]

    private var activityCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "clock.arrow.circlepath").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                    Text("Activity").font(.inter(12.5, .bold)).tracking(0.4).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 0)
                    Text("classified server-side").font(.nMicro).foregroundStyle(Nuru.ink400)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12, alignment: .top)], spacing: 12) {
                    ForEach(Self.activityGroups, id: \.kind) { group in
                        let rows = activity.filter { $0.kind == group.kind }
                        if !rows.isEmpty {
                            activityGroupTile(group.label, group.icon, rows)
                        }
                    }
                }
            }
        }
    }

    private func activityGroupTile(_ label: String, _ icon: String, _ rows: [CurriculumActivityRow]) -> some View {
        SurfaceTile {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.gold)
                    Text(label.uppercased()).font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                    Spacer(minLength: 0)
                    Text("\(rows.count)").font(.inter(10.5, .bold)).foregroundStyle(Nuru.ink400)
                }
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(rows.prefix(4)) { r in
                        HStack(alignment: .top, spacing: 6) {
                            Circle().fill(Nuru.gold.opacity(0.6)).frame(width: 5, height: 5).padding(.top, 5)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(activityLine(r)).font(.inter(12, .medium)).foregroundStyle(Nuru.ink).lineLimit(2)
                                Text("\(r.actorName ?? "System") · \(Fmt.relative(r.occurredAt))")
                                    .font(.nMicro).foregroundStyle(Nuru.ink600)
                            }
                        }
                    }
                }
            }
        }
    }

    private func activityLine(_ r: CurriculumActivityRow) -> String {
        // "module.published" → "Module published", "level.exam_configured" → "Level exam configured"
        let words = r.action
            .replacingOccurrences(of: ".", with: " ")
            .replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}

// MARK: - Level summary card (§5.1)

private struct LevelSummaryCard: View {
    let card: CurriculumLevelCard
    let onOpen: () -> Void

    private var accent: Color { cssColor(card.color) }
    private var status: CmsStatus { CmsStatus.from(card.status) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header: number monogram + eyebrow, status pill + validation badge.
            HStack(alignment: .top, spacing: 10) {
                ZStack {
                    Circle()
                        .fill(card.locked ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(accent))
                        .frame(width: 36, height: 36)
                    if card.locked {
                        Image(systemName: "lock.fill").font(.system(size: 12)).foregroundStyle(Nuru.ink600)
                    } else {
                        Text("\(card.levelNumber)").font(.fraunces(16, .medium)).foregroundStyle(.white)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text("LEVEL \(card.levelNumber)").font(.inter(9.5, .bold)).tracking(0.8).foregroundStyle(accent)
                        if card.locked { Image(systemName: "lock.fill").font(.system(size: 8)).foregroundStyle(Nuru.ink600) }
                    }
                    Text(card.title).font(.fraunces(15, .medium)).foregroundStyle(Nuru.navy)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(status.rawValue).font(.inter(9, .bold))
                        .foregroundStyle(status.style.fg)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(status.style.bg).clipShape(Capsule())
                    validationBadge
                }
            }

            if let theme = card.theme, !theme.isEmpty {
                Text(theme).font(.inter(11, .regular)).foregroundStyle(Nuru.ink600).lineLimit(1)
            }

            // Stat rows: modules · quiz · videos · duration | learners · completion · certs.
            HStack(spacing: 12) {
                statChip("book", "\(card.modulesPublished)/\(card.modulesTotal) pub")
                statChip("play.rectangle", "\(card.videosAttached) videos")
                statChip("clock", card.estimatedMinutes > 0 ? "\(card.estimatedMinutes)m" : (card.duration ?? "—"))
            }
            HStack(spacing: 12) {
                statChip("person.2", card.learners.formatted())
                statChip("rosette", "\(card.certificates) certs")
                quizChip
            }

            // Completion.
            HStack(spacing: 6) {
                ProgressBar(pct: Double(card.completionPct), fill: card.locked ? Nuru.border : accent, height: 4)
                Text("\(card.completionPct)%").font(.fraunces(10.5, .medium)).foregroundStyle(Nuru.navy)
            }

            HStack {
                Text(card.lastUpdated != nil ? "Updated \(Fmt.relative(card.lastUpdated))" : "Never updated")
                    .font(.nMicro).foregroundStyle(Nuru.ink400)
                Spacer(minLength: 0)
                // ONE Open button — every other action lives in the workspace (§5.1).
                Button(action: onOpen) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.up.forward.square").font(.system(size: 10))
                        Text("Open").font(.inter(11.5, .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12).frame(height: 30)
                    .background(Nuru.navy)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .nuruShadow(0.4)
    }

    private var quizChip: some View {
        let q = card.quiz
        let ok = (q?.examExists ?? false) && (q?.examPublished ?? false)
        let label = q == nil ? "quiz —"
            : !(q!.examExists) ? "no exam"
            : ok ? "exam live · \(q!.questionCount) Q"
            : "exam draft · \(q!.questionCount) Q"
        return HStack(spacing: 4) {
            Image(systemName: ok ? "checkmark.seal" : "questionmark.circle").font(.system(size: 9))
            Text(label).font(.inter(10.5, .medium))
        }
        .foregroundStyle(ok ? Color(hex: 0x0F6B33) : Nuru.ink600)
        .lineLimit(1).minimumScaleFactor(0.8)
    }

    private func statChip(_ icon: String, _ text: String) -> some View {
        Label(text, systemImage: icon)
            .font(.inter(10.5, .medium)).foregroundStyle(Nuru.ink600).labelStyle(.titleAndIcon)
            .lineLimit(1).minimumScaleFactor(0.8)
    }

    private var validationBadge: some View {
        let v = card.validation
        let status = v?.status ?? "ok"
        let (icon, tint): (String, Color) = status == "errors"
            ? ("exclamationmark.octagon.fill", Nuru.danger)
            : status == "warnings" ? ("exclamationmark.triangle.fill", Nuru.warning)
            : ("checkmark.circle.fill", Nuru.lumGreen)
        let label = status == "errors" ? "\(v?.errors ?? 0) issues"
            : status == "warnings" ? "\(v?.warnings ?? 0) warnings" : "Valid"
        return HStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 8))
            Text(label).font(.inter(8.5, .bold))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(tint.opacity(0.12)).clipShape(Capsule())
    }
}

// MARK: - Analytics charts (reused from the retired Curriculum Levels page)

/// /admin/reports/levels → { levels, trend } — re-decoded page-locally to keep
/// the `trend` array (rows keyed by month + per-level `L1…Ln` counts) that the
/// shared `LevelsReport` drops.
private struct CdReport: Decodable {
    let levels: [LevelAnalyticsRow]
    let trend: [CdTrendPoint]

    static func fetch() async throws -> CdReport {
        try await APIClient.shared.get("/admin/reports/levels", as: CdReport.self)
    }
}

/// One month of the enrolment trend. Decodes `month` + a bag of `L1…Ln` ints.
private struct CdTrendPoint: Decodable {
    let month: String
    let counts: [Int: Int]   // levelNumber → enrolments that month

    private struct Key: CodingKey {
        let stringValue: String
        init?(stringValue: String) { self.stringValue = stringValue }
        var intValue: Int? { nil }
        init?(intValue: Int) { return nil }
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        var month = ""
        var counts: [Int: Int] = [:]
        for k in c.allKeys {
            if k.stringValue == "month" {
                month = (try? c.decode(String.self, forKey: k)) ?? ""
            } else if k.stringValue.first == "L", let n = Int(k.stringValue.dropFirst()) {
                counts[n] = (try? c.decode(Int.self, forKey: k)) ?? 0
            }
        }
        self.month = month
        self.counts = counts
    }
}

/// Stable per-level accent — on-brand, mutually distinct.
private func cdColor(_ levelNumber: Int) -> Color {
    let palette: [Color] = [
        Nuru.lumGreen, Nuru.gold, Color(hex: 0x0E8C8C), Color(hex: 0x7C3AED),
        Color(hex: 0xEC4899), Nuru.lumAmber, Nuru.navy,
    ]
    return palette[((levelNumber - 1) % palette.count + palette.count) % palette.count]
}

private struct CdLearnerSlice: Identifiable { let level: Int; let value: Int; let color: Color; var id: Int { level } }

private struct CdLearnersByLevel: View {
    let levels: [LevelAnalyticsRow]
    var body: some View {
        let slices = levels.map { CdLearnerSlice(level: $0.levelNumber, value: $0.learners, color: cdColor($0.levelNumber)) }
        let total = slices.reduce(0) { $0 + $1.value }
        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 6) {
                    Image(systemName: "graduationcap.fill").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                    Text("Learners by level").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                }
                Text("Distribution across the pathway").font(.nCaption).foregroundStyle(Nuru.ink600)
                ZStack {
                    Chart(total == 0 ? [CdLearnerSlice(level: 0, value: 1, color: Nuru.border)] : slices) { s in
                        SectorMark(angle: .value("Learners", s.value), innerRadius: .ratio(0.62), angularInset: 1.5)
                            .foregroundStyle(s.color).cornerRadius(3)
                    }
                    .chartLegend(.hidden)
                    .frame(height: 190)
                    VStack(spacing: 2) {
                        Text("\(total)").font(.fraunces(26, .semibold)).foregroundStyle(Nuru.navy)
                        Text("LEARNERS").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                    }
                }
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(levels) { l in
                        HStack(spacing: 8) {
                            Circle().fill(cdColor(l.levelNumber)).frame(width: 8, height: 8)
                            Text("L\(l.levelNumber)").font(.inter(11.5, .semibold)).foregroundStyle(Nuru.navy)
                            Spacer()
                            Text("\(l.learners)").font(.nMicro).foregroundStyle(Nuru.ink600)
                        }
                    }
                }
            }
        }
    }
}

private struct CdCompletionBar: Identifiable { let level: Int; let pct: Double; let color: Color; var id: Int { level } }

private struct CdCompletionByLevel: View {
    let levels: [LevelAnalyticsRow]
    var body: some View {
        let bars = levels.map { CdCompletionBar(level: $0.levelNumber, pct: $0.completionPct, color: cdColor($0.levelNumber)) }
        let avg = levels.isEmpty ? 0 : Int((levels.reduce(0.0) { $0 + $1.completionPct } / Double(levels.count)).rounded())
        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    HStack(spacing: 6) {
                        Image(systemName: "chart.line.uptrend.xyaxis").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                        Text("Completion by level").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    }
                    Spacer()
                    Text("Avg \(avg)%").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                Text("Published modules completed by enrolled learners")
                    .font(.nCaption).foregroundStyle(Nuru.ink600)
                if bars.isEmpty {
                    Text("No level data yet.").font(.nCaption).foregroundStyle(Nuru.ink600).frame(height: 200)
                } else {
                    Chart(bars) { b in
                        BarMark(x: .value("Level", "L\(b.level)"), y: .value("Completion", b.pct), width: .fixed(22))
                            .foregroundStyle(b.color)
                            .cornerRadius(6)
                    }
                    .chartYScale(domain: 0...100)
                    .chartXAxis {
                        AxisMarks { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisTick().foregroundStyle(Nuru.border)
                            AxisValueLabel {
                                if let s = value.as(String.self) {
                                    Text(s).font(.inter(10, .medium)).foregroundStyle(Nuru.ink600)
                                }
                            }
                        }
                    }
                    .chartYAxis {
                        AxisMarks(values: [0, 25, 50, 75, 100]) { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisTick().foregroundStyle(Nuru.border)
                            AxisValueLabel {
                                if let v = value.as(Int.self) {
                                    Text("\(v)%").font(.inter(10, .medium)).foregroundStyle(Nuru.ink600)
                                }
                            }
                        }
                    }
                    .frame(height: 220)
                }
            }
        }
    }
}

/// One month's roll-up: total new enrolments + per-level split for the
/// segmented bar.
private struct CdMonthRoll: Identifiable {
    let month: String
    let total: Int
    let perLevel: [(level: Int, value: Int)]
    var id: String { month }
}

private struct CdEnrolmentTrend: View {
    let levels: [LevelAnalyticsRow]
    let trend: [CdTrendPoint]

    private var rolls: [CdMonthRoll] {
        trend.suffix(6).map { p in
            let split = levels.map { (level: $0.levelNumber, value: p.counts[$0.levelNumber] ?? 0) }
            return CdMonthRoll(month: p.month, total: split.reduce(0) { $0 + $1.value }, perLevel: split)
        }
    }

    var body: some View {
        let months = rolls
        let peak = max(months.map { $0.total }.max() ?? 0, 1)
        return Card(padding: 20) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    HStack(spacing: 6) {
                        Image(systemName: "flame.fill").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                        Text("Enrolment trend (6 months)").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    }
                    Spacer()
                    HStack(spacing: 10) {
                        ForEach(levels) { l in
                            HStack(spacing: 5) {
                                Circle().fill(cdColor(l.levelNumber)).frame(width: 8, height: 8)
                                Text("L\(l.levelNumber)").font(.nMicro).foregroundStyle(Nuru.ink600)
                            }
                        }
                    }
                }
                Text("New enrolments by month started — bar segments coloured by level")
                    .font(.nCaption).foregroundStyle(Nuru.ink600)

                if months.isEmpty {
                    Text("No enrolment trend recorded yet.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    VStack(spacing: 9) {
                        ForEach(months) { m in
                            CdEnrolmentMonthRow(roll: m, peak: peak)
                        }
                    }
                }
            }
        }
    }
}

/// A single month: label · count · a proportional, level-segmented horizontal bar.
private struct CdEnrolmentMonthRow: View {
    let roll: CdMonthRoll
    let peak: Int

    var body: some View {
        HStack(spacing: 12) {
            Text(monthLabel(roll.month))
                .font(.inter(11.5, .semibold)).foregroundStyle(Nuru.navy)
                .frame(width: 58, alignment: .leading)
                .lineLimit(1).minimumScaleFactor(0.8)

            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Nuru.ink600.opacity(0.08))
                        .frame(height: 16)
                    if roll.total > 0 {
                        let filled = w * CGFloat(roll.total) / CGFloat(peak)
                        HStack(spacing: 0) {
                            ForEach(roll.perLevel.filter { $0.value > 0 }, id: \.level) { seg in
                                Rectangle()
                                    .fill(cdColor(seg.level))
                                    .frame(width: max(filled * CGFloat(seg.value) / CGFloat(roll.total), 2))
                            }
                        }
                        .frame(height: 16)
                        .clipShape(Capsule())
                    }
                }
                .frame(height: 16)
                .frame(maxHeight: .infinity, alignment: .center)
            }
            .frame(height: 16)

            Text("\(roll.total)")
                .font(.inter(12, .bold))
                .foregroundStyle(roll.total > 0 ? Nuru.navy : Nuru.ink600.opacity(0.6))
                .frame(width: 26, alignment: .trailing)
                .monospacedDigit()
        }
    }

    /// "2026-01" → "Jan ’26"; falls back to the raw string if it doesn't parse.
    private func monthLabel(_ raw: String) -> String {
        let parts = raw.split(separator: "-")
        guard parts.count >= 2, let m = Int(parts[1]), (1...12).contains(m) else { return raw }
        let names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        let yr = parts[0].suffix(2)
        return "\(names[m - 1]) ’\(yr)"
    }
}

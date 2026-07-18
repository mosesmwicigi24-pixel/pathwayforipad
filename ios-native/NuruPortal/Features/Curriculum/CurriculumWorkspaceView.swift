// Levels & Modules Workspace (docs/CURRICULUM_ARCHITECTURE.md §5.2) — replaces
// the old Level Detail page (and the CMS page's pushed LevelDetailView /
// ModuleQuizView / ModuleEditorPane, which evolved into this).
//
// Left tree: levels expand to modules — search, add, publish/review, lock,
// reorder, archive. Right: the SECTIONED module editor — one module, sections
// not pages: Overview · Content · Media · Quiz · Publishing.
//   • Media = the module's placements (§2.2): list / add from the library /
//     remove / required flag; the level is INFERRED from the module and shown,
//     never asked. The legacy free-text video URL survives as an "advanced"
//     fallback only.
//   • Quiz = the editable question bank mounted WITH module context
//     (QuestionBankKit) — non-exam module questions become editable natively
//     for the first time — plus the module's quiz settings.
//   • Publishing = status/visibility/required/version.
// Selecting the LEVEL node shows the Final Assessment section: exam settings +
// the exam_status publish gate surfaced here (§5.2), with the specialized Quiz
// Builder launched context-aware (never re-selecting what the click knew).
//
// Server-authoritative (§1.1): the client only originates authoring mutations
// and refreshes from the server after each.
import SwiftUI

// MARK: - Root

struct CurriculumWorkspaceView: View {
    var initialLevel: Int? = nil
    var initialModuleId: String? = nil

    @EnvironmentObject private var router: NavRouter

    @State private var levels: [CmsLevelDetail] = []
    @State private var modulesByLevel: [Int: [AdminModuleSummary]] = [:]
    @State private var expandedLevels: Set<Int> = []
    @State private var selection: WsSelection?
    @State private var search = ""
    @State private var phase: Phase = .loading
    @State private var levelSheet: LevelSheetMode?
    @State private var actionError: String?
    @State private var appliedInitial = false

    private enum Phase { case loading, loaded, failed(String) }

    enum WsSelection: Equatable {
        case level(Int)
        case module(String)
    }

    enum LevelSheetMode: Identifiable {
        case add
        case edit(Int)
        var id: String { switch self { case .add: return "add"; case .edit(let n): return "edit-\(n)" } }
    }

    var body: some View {
        GeometryReader { geo in
            let wide = geo.size.width >= 960
            Group {
                switch phase {
                case .loading:
                    ScrollView { SkeletonList(rows: 6).padding(Nuru.S.screen) }
                case .failed(let m):
                    ScrollView { ErrorBanner(message: m) { Task { await reloadLevels() } }.padding(Nuru.S.screen) }
                case .loaded:
                    if wide {
                        HStack(spacing: 0) {
                            tree
                                .frame(width: 330)
                            Divider().background(Nuru.border)
                            editor(wide: true)
                                .frame(maxWidth: .infinity)
                        }
                    } else {
                        // Narrow: the tree IS the page; a selection swaps to the
                        // editor with a back affordance (stacked composition).
                        if selection == nil {
                            tree
                        } else {
                            VStack(spacing: 0) {
                                narrowBackBar
                                editor(wide: false)
                            }
                        }
                    }
                }
            }
        }
        .background(Nuru.paper)
        .navigationTitle("Levels & Modules")
        .navigationBarTitleDisplayMode(.inline)
        .task { if case .loading = phase { await bootstrap() } }
        .sheet(item: $levelSheet) { mode in
            switch mode {
            case .add:
                LevelFormSheet(mode: .add, nextNumber: levels.count + 1, reload: { await reloadLevels() })
            case .edit(let n):
                LevelFormSheet(mode: .edit(n), nextNumber: n, reload: { await reloadLevels() })
            }
        }
        .alert("Action failed", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: { Text(actionError ?? "") }
    }

    private var narrowBackBar: some View {
        HStack {
            Button { selection = nil } label: {
                HStack(spacing: 5) {
                    Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold))
                    Text("Levels & modules").font(.inter(13, .semibold))
                }
                .foregroundStyle(Nuru.navy)
            }
            .buttonStyle(.plain)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Nuru.white)
        .overlay(Rectangle().fill(Nuru.border).frame(height: 1), alignment: .bottom)
    }

    // MARK: Data

    @MainActor private func bootstrap() async {
        await reloadLevels()
        guard case .loaded = phase else { return }
        guard !appliedInitial else { return }
        appliedInitial = true
        let target = initialLevel ?? levels.first?.levelNumber
        if let target {
            expandedLevels.insert(target)
            await loadModules(target)
            if let wanted = initialModuleId,
               let m = modulesByLevel[target]?.first(where: { $0.moduleId == wanted }) {
                selection = .module(m.moduleId)
            } else {
                selection = .level(target)
            }
        }
    }

    @MainActor private func reloadLevels() async {
        do {
            levels = try await CmsAPI.levels().sorted { $0.levelNumber < $1.levelNumber }
            phase = .loaded
        } catch {
            if case .loading = phase {
                phase = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
            } else {
                actionError = (error as? APIError)?.errorDescription ?? "Could not refresh levels."
            }
        }
    }

    @MainActor private func loadModules(_ level: Int) async {
        do { modulesByLevel[level] = try await PortalAPI.modules(level: level) }
        catch { actionError = (error as? APIError)?.errorDescription ?? "Could not load modules." }
    }

    /// Run a mutation then refresh the affected level's modules + level counts.
    @MainActor private func runAction(level: Int, _ op: () async throws -> Void) async {
        do { try await op(); await loadModules(level); await reloadLevels() }
        catch { actionError = (error as? APIError)?.errorDescription ?? "Action failed." }
    }

    // MARK: Tree

    private var filteredLevels: [CmsLevelDetail] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return levels }
        return levels.filter { l in
            l.title.lowercased().contains(q)
                || (l.theme ?? "").lowercased().contains(q)
                || (modulesByLevel[l.levelNumber] ?? []).contains { $0.title.lowercased().contains(q) }
        }
    }

    private func treeModules(_ level: Int) -> [AdminModuleSummary] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        let all = (modulesByLevel[level] ?? []).sorted { $0.moduleSequenceNumber < $1.moduleSequenceNumber }
        guard !q.isEmpty else { return all }
        // While searching, keep every module visible for levels matched by name;
        // narrow to matching modules when the module title is what matched.
        let matching = all.filter { $0.title.lowercased().contains(q) }
        return matching.isEmpty ? all : matching
    }

    private var tree: some View {
        VStack(spacing: 0) {
            // Search + New Level.
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Nuru.ink400)
                    TextField("Search levels & modules…", text: $search)
                        .font(.inter(13)).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                .padding(.horizontal, 10).frame(height: 36)
                .background(Nuru.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                Button { levelSheet = .add } label: {
                    Image(systemName: "plus").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(Nuru.navy)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("New level")
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            Divider().background(Nuru.border)

            ScrollView {
                VStack(spacing: 4) {
                    ForEach(filteredLevels) { l in
                        levelNode(l)
                        if expandedLevels.contains(l.levelNumber) {
                            moduleNodes(l)
                        }
                    }
                }
                .padding(10)
            }
        }
        .background(Nuru.white)
    }

    private func levelNode(_ l: CmsLevelDetail) -> some View {
        let isSelected = selection == .level(l.levelNumber)
        let expanded = expandedLevels.contains(l.levelNumber)
        let st = CmsStatus.from(l.status)
        return HStack(spacing: 8) {
            Button {
                toggleExpand(l.levelNumber)
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.ink400)
                    .rotationEffect(.degrees(expanded ? 90 : 0))
                    .frame(width: 22, height: 22)
            }
            .buttonStyle(.plain)

            Button {
                selection = .level(l.levelNumber)
                if !expanded { toggleExpand(l.levelNumber) }
            } label: {
                HStack(spacing: 8) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(l.locked ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(l.accent))
                        if l.locked {
                            Image(systemName: "lock.fill").font(.system(size: 10)).foregroundStyle(Nuru.ink600)
                        } else {
                            Text("\(l.levelNumber)").font(.fraunces(13, .medium)).foregroundStyle(.white)
                        }
                    }.frame(width: 26, height: 26)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(l.title).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        Text("\(l.publishedCount)/\(moduleTotal(l)) published").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                    Spacer(minLength: 0)
                    Text(st.rawValue).font(.inter(8.5, .bold))
                        .foregroundStyle(st.style.fg)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(st.style.bg).clipShape(Capsule())
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            levelMenu(l)
        }
        .padding(.horizontal, 8).padding(.vertical, 7)
        .background(isSelected ? l.accent.opacity(0.08) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous)
            .stroke(isSelected ? l.accent : Color.clear, lineWidth: 1.5))
    }

    private func moduleTotal(_ l: CmsLevelDetail) -> Int {
        (Int(l.publishedCount) ?? 0) + (Int(l.draftCount) ?? 0)
    }

    private func toggleExpand(_ n: Int) {
        if expandedLevels.contains(n) {
            expandedLevels.remove(n)
        } else {
            expandedLevels.insert(n)
            if modulesByLevel[n] == nil { Task { await loadModules(n) } }
        }
    }

    private func levelMenu(_ l: CmsLevelDetail) -> some View {
        Menu {
            Button { levelSheet = .edit(l.levelNumber) } label: { Label("Edit level", systemImage: "square.and.pencil") }
            Button { addModule(l.levelNumber) } label: { Label("Add module", systemImage: "plus") }
            Divider()
            if l.status == "draft" {
                Button { setLevelStatus(l.levelNumber, .inReview) } label: { Label("Send to review", systemImage: "eye") }
            }
            if l.status == "in_review" {
                Button { setLevelStatus(l.levelNumber, .published) } label: { Label("Publish level", systemImage: "checkmark.seal") }
            }
            if l.status == "published" {
                Button { setLevelStatus(l.levelNumber, .draft) } label: { Label("Back to draft", systemImage: "arrow.uturn.backward") }
            }
            Button { toggleLock(l) } label: {
                Label(l.locked ? "Unlock level" : "Lock level", systemImage: l.locked ? "lock.open" : "lock")
            }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 12)).foregroundStyle(Nuru.ink400)
                .frame(width: 24, height: 24)
        }
    }

    @ViewBuilder private func moduleNodes(_ l: CmsLevelDetail) -> some View {
        let mods = treeModules(l.levelNumber)
        if modulesByLevel[l.levelNumber] == nil {
            HStack { ProgressView().controlSize(.small); Spacer() }.padding(.leading, 44).padding(.vertical, 6)
        } else if mods.isEmpty {
            Button { addModule(l.levelNumber) } label: {
                Label("Add the first module", systemImage: "plus")
                    .font(.inter(12, .semibold)).foregroundStyle(Nuru.goldLo)
                    .padding(.leading, 44).padding(.vertical, 6)
            }
            .buttonStyle(.plain)
        } else {
            ForEach(Array(mods.enumerated()), id: \.element.id) { idx, m in
                moduleNode(m, level: l, index: idx, count: mods.count)
            }
        }
    }

    private func moduleNode(_ m: AdminModuleSummary, level l: CmsLevelDetail, index: Int, count: Int) -> some View {
        let isSelected = selection == .module(m.moduleId)
        let isExam = m.evaluationKind == "exit_exam"
        return HStack(spacing: 8) {
            Button {
                selection = .module(m.moduleId)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: isExam ? "rosette" : moduleKindIcon(m.evaluationKind))
                        .font(.system(size: 11)).foregroundStyle(isExam ? Nuru.gold : Nuru.ink600)
                        .frame(width: 18)
                    Text("\(m.moduleSequenceNumber). \(m.title)")
                        .font(.inter(12.5, isSelected ? .semibold : .medium))
                        .foregroundStyle(Nuru.navy).lineLimit(1)
                    Spacer(minLength: 0)
                    if m.status == "published" {
                        Circle().fill(Nuru.lumGreen).frame(width: 6, height: 6)
                    } else {
                        Circle().stroke(Nuru.ink400, lineWidth: 1.2).frame(width: 6, height: 6)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Menu {
                if m.status == "published" {
                    Button { Task { await runAction(level: l.levelNumber) { try await CmsAPI.unpublish(m.moduleId) } } } label: { Label("Unpublish", systemImage: "arrow.uturn.backward") }
                } else {
                    Button { Task { await runAction(level: l.levelNumber) { try await CmsAPI.publish(m.moduleId) } } } label: { Label("Publish", systemImage: "checkmark.seal") }
                }
                if index > 0 {
                    Button { Task { await runAction(level: l.levelNumber) { try await CmsAPI.reorder(m.moduleId, to: m.moduleSequenceNumber - 1) } } } label: { Label("Move up", systemImage: "arrow.up") }
                }
                if index < count - 1 {
                    Button { Task { await runAction(level: l.levelNumber) { try await CmsAPI.reorder(m.moduleId, to: m.moduleSequenceNumber + 1) } } } label: { Label("Move down", systemImage: "arrow.down") }
                }
                Divider()
                Button(role: .destructive) {
                    Task {
                        await runAction(level: l.levelNumber) { try await CmsAPI.archive(m.moduleId) }
                        if selection == .module(m.moduleId) { selection = .level(l.levelNumber) }
                    }
                } label: { Label("Archive module", systemImage: "archivebox") }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 11)).foregroundStyle(Nuru.ink400)
                    .frame(width: 22, height: 22)
            }
        }
        .padding(.leading, 36).padding(.trailing, 8).padding(.vertical, 5)
        .background(isSelected ? l.accent.opacity(0.10) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
    }

    private func moduleKindIcon(_ kind: String) -> String {
        switch kind {
        case "quiz": return "questionmark.circle"
        case "reflection": return "text.bubble"
        default: return "doc.text"
        }
    }

    // MARK: Tree writes

    private func setLevelStatus(_ n: Int, _ status: CmsEditStatus) {
        Task {
            do { try await CmsAPI.patchLevel(n, .init(status: status.be, locked: nil)); await reloadLevels() }
            catch { actionError = (error as? APIError)?.errorDescription ?? "Update failed." }
        }
    }
    private func toggleLock(_ l: CmsLevelDetail) {
        Task {
            do { try await CmsAPI.patchLevel(l.levelNumber, .init(status: nil, locked: !l.locked)); await reloadLevels() }
            catch { actionError = (error as? APIError)?.errorDescription ?? "Update failed." }
        }
    }
    private func addModule(_ level: Int) {
        Task {
            await runAction(level: level) {
                try await CmsAPI.createModule(.init(
                    levelNumber: level, title: "New module",
                    lessonContent: "Draft content — edit in the module editor.",
                    evaluationKind: "none"))
            }
            expandedLevels.insert(level)
            if let created = modulesByLevel[level]?.max(by: { $0.moduleSequenceNumber < $1.moduleSequenceNumber }) {
                selection = .module(created.moduleId)
            }
        }
    }

    // MARK: Editor pane

    @ViewBuilder private func editor(wide: Bool) -> some View {
        switch selection {
        case .none:
            VStack(spacing: 10) {
                Image(systemName: "square.stack.3d.up").font(.system(size: 36)).foregroundStyle(Nuru.ink300)
                Text("Select a level or module").font(.inter(14, .semibold)).foregroundStyle(Nuru.ink600)
                Text("Everything about one module lives in its sections — no separate pages.")
                    .font(.nCaption).foregroundStyle(Nuru.ink400)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .level(let n):
            if let l = levels.first(where: { $0.levelNumber == n }) {
                WorkspaceLevelPane(
                    level: l,
                    modules: modulesByLevel[n] ?? [],
                    onEdit: { levelSheet = .edit(n) },
                    onCreatedExam: { Task { await loadModules(n); await reloadLevels() } },
                    onExamChanged: { Task { await reloadLevels() } })
                    // @State (exam settings) is seeded from the level row — re-key
                    // per level so switching levels never shows stale settings.
                    .id(n)
            } else {
                EmptyView()
            }
        case .module(let id):
            let owner = levels.first { l in (modulesByLevel[l.levelNumber] ?? []).contains { $0.moduleId == id } }
            WorkspaceModuleEditor(
                moduleId: id,
                accent: owner?.accent ?? Nuru.gold,
                levelTitle: owner?.title,
                onChanged: {
                    Task {
                        if let n = owner?.levelNumber { await loadModules(n) }
                        await reloadLevels()
                    }
                })
            .id(id)
        }
    }
}

// MARK: - Level pane (Final Assessment surfaced here, §5.2)

private struct WorkspaceLevelPane: View {
    let level: CmsLevelDetail
    let modules: [AdminModuleSummary]
    let onEdit: () -> Void
    let onCreatedExam: () -> Void
    let onExamChanged: () -> Void

    @EnvironmentObject private var router: NavRouter

    @State private var passMark: Int
    @State private var questionCount: Int
    @State private var shuffle: Bool
    @State private var showAnswers: Bool
    @State private var showScore: Bool
    @State private var savingExam = false
    @State private var togglingStatus = false
    @State private var creatingExam = false
    @State private var notice: String?
    @State private var error: String?

    init(level: CmsLevelDetail, modules: [AdminModuleSummary],
         onEdit: @escaping () -> Void, onCreatedExam: @escaping () -> Void, onExamChanged: @escaping () -> Void) {
        self.level = level
        self.modules = modules
        self.onEdit = onEdit
        self.onCreatedExam = onCreatedExam
        self.onExamChanged = onExamChanged
        _passMark = State(initialValue: level.passMark)
        _questionCount = State(initialValue: level.examQuestionCount ?? 0)
        _shuffle = State(initialValue: level.examShuffle ?? false)
        _showAnswers = State(initialValue: level.examShowAnswers ?? false)
        _showScore = State(initialValue: level.examShowScore ?? true)
    }

    private var examModule: AdminModuleSummary? { modules.first { $0.evaluationKind == "exit_exam" } }
    private var examPublished: Bool { (level.examStatus ?? "review") == "published" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let notice { QbBanner(tone: .ok, text: notice) }
                if let error { QbBanner(tone: .err, text: error) }
                statRow
                finalAssessmentCard
            }
            .padding(Nuru.S.screen)
            .macContentColumn(980)
        }
        .background(Nuru.paper)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                HStack(spacing: 8) {
                    Circle().fill(level.accent).frame(width: 8, height: 8)
                    Text("LEVEL \(level.levelNumber)").font(.inter(11, .bold)).tracking(0.8).foregroundStyle(level.accent)
                    let st = CmsStatus.from(level.status)
                    Text(st.rawValue).font(.inter(9, .bold))
                        .foregroundStyle(st.style.fg)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(st.style.bg).clipShape(Capsule())
                    if level.locked { Image(systemName: "lock.fill").font(.system(size: 10)).foregroundStyle(Nuru.ink600) }
                }
                Spacer()
                Button(action: onEdit) {
                    HStack(spacing: 5) {
                        Image(systemName: "square.and.pencil").font(.system(size: 11))
                        Text("Edit level").font(.inter(12, .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12).frame(height: 32)
                    .background(Nuru.navy).clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            Text(level.title).font(.fraunces(26, .semibold)).foregroundStyle(Nuru.navy)
                .fixedSize(horizontal: false, vertical: true)
            if let theme = level.theme, !theme.isEmpty {
                Text(theme).font(.nCaption).foregroundStyle(Nuru.ink600)
            }
        }
    }

    private var statRow: some View {
        HStack(spacing: 10) {
            wsStat("Modules", "\(modules.count)", "book", Nuru.brandTint(2))
            wsStat("Published", level.publishedCount.isEmpty ? "0" : level.publishedCount, "rosette", Nuru.brandTint(0))
            wsStat("Draft", level.draftCount.isEmpty ? "0" : level.draftCount, "pencil.line", Nuru.brandTint(1))
            wsStat("Duration", level.duration ?? "—", "clock", Nuru.brandTint(3))
        }
    }

    private func wsStat(_ label: String, _ value: String, _ icon: String, _ tint: Nuru.Tint) -> some View {
        HStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous).fill(tint.fg.opacity(0.14))
                Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(tint.fg)
            }.frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 0) {
                Text(value).font(.fraunces(17, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.7)
                Text(label.uppercased()).font(.inter(9, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                    .lineLimit(1).minimumScaleFactor(0.85)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 11).padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // ── Final Assessment (exam settings + publish gate; §5.2) ──

    private var finalAssessmentCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Image(systemName: "rosette").font(.system(size: 14, weight: .semibold)).foregroundStyle(level.accent)
                    Text("Final Assessment").font(.nTitle).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 0)
                    examStatusChip
                }
                Text("The exit exam disciples take to complete Level \(level.levelNumber). Members see it only once it is published.")
                    .font(.nCaption).foregroundStyle(Nuru.ink600)

                if examModule == nil {
                    noExamRow
                } else {
                    examSettingsGrid
                    HStack(spacing: 8) {
                        Button { Task { await saveExamSettings() } } label: {
                            Text(savingExam ? "Saving…" : "Save exam settings")
                                .font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                .padding(.horizontal, 16).frame(height: 38)
                                .background(Nuru.gold)
                                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(savingExam)

                        Button { Task { await toggleExamStatus() } } label: {
                            Text(togglingStatus ? "Saving…" : (examPublished ? "Move to review" : "Publish exam"))
                                .font(.inter(13, .semibold))
                                .foregroundStyle(examPublished ? Nuru.ink600 : .white)
                                .padding(.horizontal, 16).frame(height: 38)
                                .background(examPublished ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(Color(hex: 0x0F6B33)))
                                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(togglingStatus)

                        Spacer(minLength: 0)

                        // Context-aware launch — the builder never re-asks for the level.
                        Button { router.openQuizBuilder(level: level.levelNumber) } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "questionmark.circle").font(.system(size: 12))
                                Text("Edit exam questions").font(.inter(13, .semibold))
                            }
                            .foregroundStyle(Nuru.navy)
                            .padding(.horizontal, 14).frame(height: 38)
                            .background(Nuru.white)
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var examStatusChip: some View {
        HStack(spacing: 4) {
            Image(systemName: examPublished ? "checkmark.seal.fill" : "clock").font(.system(size: 10, weight: .bold))
            Text(examPublished ? "Published" : "In Review").font(.inter(10, .bold))
        }
        .foregroundStyle(examPublished ? Color(hex: 0x0F6B33) : Color(hex: 0x8A6B1F))
        .padding(.horizontal, 9).padding(.vertical, 3)
        .background(examPublished ? Color(hex: 0xE8F6EE) : Color(hex: 0xFDF5E5))
        .clipShape(Capsule())
    }

    private var noExamRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("This level has no exit-exam module yet.")
                .font(.inter(13, .medium)).foregroundStyle(Nuru.ink600)
            Button { Task { await createExam() } } label: {
                HStack(spacing: 6) {
                    if creatingExam { ProgressView().controlSize(.small).tint(.white) }
                    else { Image(systemName: "plus").font(.system(size: 12, weight: .bold)) }
                    Text(creatingExam ? "Creating…" : "Create level exam").font(.inter(13, .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16).frame(height: 38)
                .background(Nuru.gold).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(creatingExam)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous)
            .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
    }

    private var examSettingsGrid: some View {
        VStack(spacing: 10) {
            CmsFieldPair {
                CmsControlTile { Stepper("Pass mark: \(passMark)%", value: $passMark, in: 0...100, step: 5).tint(Nuru.gold) }
            } right: {
                CmsControlTile { Stepper(questionCount > 0 ? "Questions served: \(questionCount)" : "Questions served: all", value: $questionCount, in: 0...100).tint(Nuru.gold) }
            }
            CmsControlTile { Toggle("Shuffle questions", isOn: $shuffle).tint(Nuru.lumGreen) }
            CmsFieldPair {
                CmsControlTile { Toggle("Show answers", isOn: $showAnswers).tint(Nuru.lumGreen) }
            } right: {
                CmsControlTile { Toggle("Show score", isOn: $showScore).tint(Nuru.lumGreen) }
            }
        }
    }

    // ── Writes ──

    @MainActor private func saveExamSettings() async {
        savingExam = true; notice = nil; error = nil
        do {
            try await CmsAPI.updateExam(level.levelNumber, .init(
                requiredExamPassMark: passMark,
                examQuestionCount: questionCount > 0 ? questionCount : nil,
                examShowAnswers: showAnswers,
                examShowScore: showScore,
                examShuffle: shuffle,
                examStatus: nil))
            notice = "Exam settings saved."
            onExamChanged()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Save failed." }
        savingExam = false
    }

    @MainActor private func toggleExamStatus() async {
        togglingStatus = true; notice = nil; error = nil
        let next = examPublished ? "review" : "published"
        do {
            try await CmsAPI.updateExam(level.levelNumber, .init(
                requiredExamPassMark: passMark,
                examQuestionCount: nil,
                examShowAnswers: nil,
                examShowScore: nil,
                examShuffle: nil,
                examStatus: next))
            notice = next == "published" ? "Exam published — members can now take it." : "Exam moved back to review."
            onExamChanged()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not update the publish state." }
        togglingStatus = false
    }

    @MainActor private func createExam() async {
        creatingExam = true; error = nil
        do {
            try await CmsAPI.createModule(.init(
                levelNumber: level.levelNumber,
                title: "Level \(level.levelNumber) Review",
                lessonContent: "Level exit exam.",
                evaluationKind: "exit_exam"))
            onCreatedExam()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not create the level exam." }
        creatingExam = false
    }
}

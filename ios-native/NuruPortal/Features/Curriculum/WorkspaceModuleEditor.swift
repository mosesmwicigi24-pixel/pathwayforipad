// The §5.2 sectioned module editor — ONE module, sections not pages:
// Overview · Content · Media · Quiz · Publishing. Evolved from the retired
// CmsCurriculumView's ModuleEditorPane + ModuleQuizView.
//
//  • Overview   — basics / objectives / scripture / tags.
//  • Content    — markdown + titled sections (page-break convention preserved
//                 byte-identical so backend pagination stays consistent).
//  • Media      — the module's PLACEMENTS (§2.2): list, add from the library,
//                 remove, required flag; level inferred, never asked. The
//                 legacy free-text video URL is an "advanced" fallback only.
//  • Quiz       — the editable question bank (QuestionBankKit) mounted with
//                 module context + the module's quiz settings.
//  • Publishing — status / visibility / required / version.
//
// Saves via PUT /admin/modules/{id} with expected_row_version (optimistic
// concurrency, web parity). The learner preview renders the CURRENT draft.
import SwiftUI

// MARK: - Editor

struct WorkspaceModuleEditor: View {
    let moduleId: String
    var accent: Color = Nuru.gold
    var levelTitle: String? = nil
    var onChanged: () -> Void = {}

    enum EditorSection: String, CaseIterable, Identifiable {
        case overview = "Overview", content = "Content", media = "Media", quiz = "Quiz", publishing = "Publishing"
        var id: String { rawValue }
        var icon: String {
            switch self {
            case .overview: return "info.circle"
            case .content: return "doc.text"
            case .media: return "play.rectangle"
            case .quiz: return "questionmark.circle"
            case .publishing: return "checkmark.seal"
            }
        }
    }

    @State private var section: EditorSection = .overview
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
    @State private var working = false
    @State private var notice: String?
    @State private var error: String?

    // Markdown editor mode + learner-preview sheet (renders the CURRENT draft).
    @State private var mdMode: MdEditorMode = .write
    @State private var showLearnerPreview = false

    // Web option sets.
    private let evalOpts: [(v: String, l: String)] = [("none", "— none —"), ("quiz", "Quiz"), ("reflection", "Reflection"), ("exit_exam", "Exit exam")]
    private let difficultyOpts: [(v: String, l: String)] = [("beginner", "Beginner"), ("intermediate", "Intermediate"), ("advanced", "Advanced")]
    private let visibilityOpts: [(v: String, l: String)] = [("members", "Members"), ("leaders", "Leaders only"), ("public", "Public")]
    private var isQuiz: Bool { evaluationKind == "quiz" }
    private var isExam: Bool { evaluationKind == "exit_exam" }

    var body: some View {
        Group {
            switch phase {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let m):
                ScrollView { ErrorBanner(message: m) { Task { await load() } }.padding(Nuru.S.screen) }
            case .ready:
                VStack(spacing: 0) {
                    headerBar
                    sectionNav
                    Divider()
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            if let notice { QbBanner(tone: .ok, text: notice) }
                            if let error { QbBanner(tone: .err, text: error) }
                            sectionBody
                        }
                        .padding(Nuru.S.screen)
                        .frame(maxWidth: 860)
                        .frame(maxWidth: .infinity)
                    }
                    .background(Nuru.paper)
                }
            }
        }
        .task(id: moduleId) { await load() }
        .sheet(isPresented: $showLearnerPreview) {
            LearnerPreviewSheet(snapshot: makeLearnerSnapshot())
        }
    }

    // MARK: Header + section nav

    private var headerBar: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text("MODULE \(loaded?.moduleSequenceNumber ?? 0)")
                        .font(.inter(9.5, .bold)).tracking(0.8).foregroundStyle(accent)
                    // Level always INFERRED from the module — shown, never asked.
                    Text("· Level \(loaded?.levelNumber ?? 0)\(levelTitle.map { " — \($0)" } ?? "")")
                        .font(.inter(9.5, .semibold)).foregroundStyle(Nuru.ink600)
                    let st = CmsStatus.from(loaded?.status ?? "draft")
                    Text(st.rawValue).font(.inter(8.5, .bold))
                        .foregroundStyle(st.style.fg)
                        .padding(.horizontal, 6).padding(.vertical, 1.5)
                        .background(st.style.bg).clipShape(Capsule())
                }
                Text(title.isEmpty ? "Untitled module" : title)
                    .font(.fraunces(19, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
            }
            Spacer(minLength: 8)
            Button { showLearnerPreview = true } label: {
                HStack(spacing: 5) {
                    Image(systemName: "eye").font(.system(size: 11, weight: .semibold))
                    Text("Preview").font(.inter(12, .semibold))
                }
                .foregroundStyle(Nuru.navy)
                .padding(.horizontal, 12).frame(height: 32)
                .background(Nuru.white)
                .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            Button { Task { await save() } } label: {
                HStack(spacing: 5) {
                    if saving { ProgressView().controlSize(.small).tint(.white) }
                    else { Image(systemName: "square.and.arrow.down").font(.system(size: 11, weight: .semibold)) }
                    Text(saving ? "Saving…" : "Save").font(.inter(12, .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14).frame(height: 32)
                .background(Nuru.navy)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, Nuru.S.screen).padding(.vertical, 10)
        .background(Nuru.white)
    }

    /// The section nav — sections, not pages (§5.2).
    private var sectionNav: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(EditorSection.allCases) { s in
                    let active = section == s
                    Button { section = s } label: {
                        HStack(spacing: 5) {
                            Image(systemName: s.icon).font(.system(size: 11, weight: .semibold))
                            Text(s.rawValue).font(.inter(12.5, .semibold))
                        }
                        .foregroundStyle(active ? .white : Nuru.ink600)
                        .padding(.horizontal, 13).frame(height: 32)
                        .background(active ? AnyShapeStyle(accent) : AnyShapeStyle(Color.clear))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Nuru.S.screen).padding(.vertical, 8)
        }
        .background(Nuru.white)
    }

    @ViewBuilder private var sectionBody: some View {
        switch section {
        case .overview:   overviewSection
        case .content:    contentSection
        case .media:      WorkspaceMediaSection(moduleId: moduleId,
                                                levelNumber: loaded?.levelNumber ?? 0,
                                                accent: accent,
                                                videoUrl: $videoUrl,
                                                onChanged: onChanged)
        case .quiz:       quizSection
        case .publishing: publishingSection
        }
    }

    // MARK: Overview — basics / objectives / scripture / tags

    private var overviewSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            editorCard("Module basics") {
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
                labeledEditor("Summary", text: $summary, minHeight: 64)
            }
            editorCard("Objectives & scripture") {
                CmsFieldPair {
                    labeledEditor("Objectives (one per line)", text: $objectives, minHeight: 80)
                } right: {
                    labeledEditor("Key scripture (one per line)", text: $keyVersesText, minHeight: 80)
                }
                CmsFieldCell(label: "Tags (comma-separated)") { TextField("grace, identity", text: $tags) }
            }
        }
    }

    // MARK: Content — markdown + titled sections

    // Titled teaching sections — a convention over lesson_content (no backend
    // change). The server splits lesson_content on <!-- page-break --> markers
    // into the mobile reader's pages; each page is a "section" whose title is
    // its leading Markdown heading. The marker written is byte-identical to the
    // web's, so backend pagination stays consistent across surfaces.
    static let pageBreakMarker = "<!-- page-break -->"
    static let sectionJoiner = "\n\n<!-- page-break -->\n\n"

    struct LessonSection: Identifiable {
        let id = UUID()
        var title: String?
        var body: String
    }

    private var contentSection: some View {
        editorCard("Lesson content · Markdown") {
            markdownToolbarRow
            if mdMode == .write {
                TextEditor(text: $lessonContent)
                    .frame(minHeight: 240)
                    .font(.system(.body, design: .monospaced)).foregroundStyle(Nuru.ink)
                    .scrollContentBackground(.hidden).padding(8).background(Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            } else {
                Group {
                    if lessonContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("Nothing to preview yet.").font(.nCaption).foregroundStyle(Nuru.ink400)
                    } else {
                        MarkdownBlocksView(content: lessonContent)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 240, alignment: .topLeading)
                .padding(14).background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            }
            HStack(alignment: .top) {
                if mdMode == .write {
                    // TextEditor exposes no cursor, so tools append at the end.
                    Text("Toolbar snippets are added at the end of the lesson — move them into place while editing.")
                        .font(.nMicro).foregroundStyle(Nuru.ink400)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Text("\(lessonContent.count) chars")
                    .font(.nMicro).foregroundStyle(Nuru.ink400)
            }

            // ── Sections outline ──
            let sections = Self.parseSections(lessonContent)
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
                            seed: sec.title ?? "Section \(i + 1)",
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
        }
    }

    // MARK: Quiz — question bank + module quiz settings

    private var quizSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            editorCard("Evaluation") {
                CmsFieldCell(label: "Evaluation kind") {
                    Picker("", selection: $evaluationKind) {
                        ForEach(evalOpts, id: \.v) { Text($0.l).tag($0.v) }
                    }
                    .labelsHidden().pickerStyle(.menu).tint(Nuru.navy)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if isQuiz {
                    CmsFieldPair {
                        CmsControlTile { Stepper("Pass mark: \(quizPassMark)%", value: $quizPassMark, in: 0...100, step: 5).tint(Nuru.gold) }
                    } right: {
                        CmsControlTile { Stepper("Attempts: \(maxAttempts)", value: $maxAttempts, in: 1...50).tint(Nuru.gold) }
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
                    Text("Quiz settings save with the module (Save above).")
                        .font(.nMicro).foregroundStyle(Nuru.ink400)
                }
            }

            if isExam {
                // §2.5 — ONE mounted editor per bank: the exit exam edits in the
                // Level → Final Assessment flow / Quiz Builder, not twice at once.
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "rosette").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                    Text("This module is the level's exit exam. Its questions are edited in the level's Final Assessment (Quiz Builder), so the bank is never mounted in two editors at once.")
                        .font(.inter(12.5)).foregroundStyle(Color(hex: 0x7A5410)).fixedSize(horizontal: false, vertical: true)
                }
                .padding(12).background(Color(hex: 0xFFFBEB))
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Color(hex: 0xF5E0A8), lineWidth: 1))
            } else {
                // The question bank, module context already known — editable
                // natively for the first time (was read-only pre-workspace).
                QuestionBankEditor(moduleId: moduleId, accent: accent)
            }
        }
    }

    // MARK: Publishing — status / visibility / required / version

    private var publishingSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            editorCard("Status") {
                HStack(spacing: 10) {
                    let st = CmsStatus.from(loaded?.status ?? "draft")
                    Text(st.rawValue).font(.inter(11, .bold))
                        .foregroundStyle(st.style.fg)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(st.style.bg).clipShape(Capsule())
                    Spacer(minLength: 0)
                    if loaded?.status == "published" {
                        pubButton("Unpublish", "arrow.uturn.backward", bg: Nuru.mutedBg, fg: Nuru.ink600) {
                            Task { await runStatusAction { try await CmsAPI.unpublish(moduleId) } }
                        }
                    } else {
                        pubButton("Publish module", "checkmark.seal", bg: Color(hex: 0x0F6B33), fg: .white) {
                            Task { await runStatusAction { try await CmsAPI.publish(moduleId) } }
                        }
                    }
                }
                Text("Members see this module only when it is published AND its level is unlocked for them (§1.9 — the server gates every fetch).")
                    .font(.nMicro).foregroundStyle(Nuru.ink400)
            }
            editorCard("Visibility & gating") {
                CmsFieldCell(label: "Visibility") {
                    Picker("", selection: $visibility) {
                        ForEach(visibilityOpts, id: \.v) { Text($0.l).tag($0.v) }
                    }
                    .labelsHidden().pickerStyle(.menu).tint(Nuru.navy)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                CmsControlTile { Toggle("Required to advance", isOn: $required).tint(Nuru.lumGreen) }
                Text("Visibility and the required flag save with the module (Save above).")
                    .font(.nMicro).foregroundStyle(Nuru.ink400)
            }
            editorCard("Version") {
                HStack(spacing: 0) {
                    versionStat("Content version", "v\(loaded?.currentVersion ?? 0)")
                    versionStat("Row version", "\(loaded?.rowVersion ?? 0)")
                    versionStat("Sequence", "#\(loaded?.moduleSequenceNumber ?? 0)")
                }
                Text("Every save snapshots an immutable module version server-side; edits are guarded by expected_row_version so concurrent editors can never clobber each other.")
                    .font(.nMicro).foregroundStyle(Nuru.ink400)
            }
        }
    }

    private func pubButton(_ label: String, _ icon: String, bg: Color, fg: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11))
                Text(label).font(.inter(12.5, .semibold))
            }
            .foregroundStyle(fg)
            .padding(.horizontal, 14).frame(height: 34)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(working)
    }

    private func versionStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.fraunces(19, .medium)).foregroundStyle(Nuru.navy)
            Text(label.uppercased()).font(.inter(9, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Shared card + field builders

    private func editorCard<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            CmsSectionHeader(text: title)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func labeledEditor(_ label: String, text: Binding<String>, minHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased()).font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
            TextEditor(text: text).frame(minHeight: minHeight).font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                .scrollContentBackground(.hidden).padding(8).background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Section parsing (byte-identical page-break convention)

    static func parseSections(_ content: String) -> [LessonSection] {
        content
            .components(separatedBy: pageBreakMarker)
            .map { piece -> LessonSection in
                let trimmed = piece.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty { return LessonSection(title: nil, body: "") }
                var lines = trimmed.components(separatedBy: "\n")
                let firstIdx = lines.firstIndex { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ?? 0
                let first = lines[firstIdx]
                if let title = headingTitle(first) {
                    lines.remove(at: firstIdx)
                    if firstIdx < lines.count, lines[firstIdx].trimmingCharacters(in: .whitespaces).isEmpty {
                        lines.remove(at: firstIdx)
                    }
                    let body = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                    return LessonSection(title: title, body: body)
                }
                return LessonSection(title: nil, body: trimmed)
            }
            .filter { !($0.title == nil && $0.body.isEmpty) }
    }

    // `^#{1,6}[ \t]+(.+?)[ \t]*$` → the captured heading text, else nil.
    static func headingTitle(_ line: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: "^#{1,6}[ \\t]+(.+?)[ \\t]*$") else { return nil }
        let range = NSRange(line.startIndex..<line.endIndex, in: line)
        guard let m = re.firstMatch(in: line, range: range),
              let capRange = Range(m.range(at: 1), in: line) else { return nil }
        return String(line[capRange])
    }

    private func rawPieces() -> [String] {
        lessonContent.components(separatedBy: Self.pageBreakMarker)
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
        lessonContent = pieces.joined(separator: Self.sectionJoiner)
    }

    private func renameSection(_ index: Int, to title: String) {
        var pieces = rawPieces()
        guard pieces.indices.contains(index) else { return }
        let clean = title.trimmingCharacters(in: .whitespaces)
        var lines = pieces[index].components(separatedBy: "\n")
        let firstIdx = lines.firstIndex { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        if let firstIdx, Self.headingTitle(lines[firstIdx]) != nil {
            lines[firstIdx] = "## \(clean)"
            pieces[index] = lines.joined(separator: "\n")
        } else {
            let existing = pieces[index].trimmingCharacters(in: .whitespacesAndNewlines)
            pieces[index] = existing.isEmpty ? "## \(clean)\n\n" : "## \(clean)\n\n\(existing)"
        }
        lessonContent = pieces.joined(separator: Self.sectionJoiner)
    }

    // MARK: Markdown toolbar

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

    private func applyTool(_ tool: MdTool) {
        if tool.isAddSection { addSection(); return }
        lessonContent += tool.snippet
    }

    // MARK: Load / reflect / save

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
            onChanged()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Save failed — the module may have changed elsewhere (reload)."
            saving = false
        }
    }

    @MainActor private func runStatusAction(_ op: () async throws -> Void) async {
        working = true; error = nil; notice = nil
        do {
            try await op()
            let m = try await CmsAPI.module(moduleId)
            reflect(m)
            onChanged()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Action failed." }
        working = false
    }

    // MARK: Learner preview snapshot

    private func makeLearnerSnapshot() -> LearnerPreviewSnapshot {
        let secs = Self.parseSections(lessonContent).map { LpSection(title: $0.title, body: $0.body) }
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
}

// MARK: - Media section (§2.2 — placements are the primary flow)

private struct WorkspaceMediaSection: View {
    let moduleId: String
    let levelNumber: Int
    let accent: Color
    @Binding var videoUrl: String
    var onChanged: () -> Void = {}

    @State private var placements: [ModulePlacementRow] = []
    @State private var loading = true
    @State private var working = false
    @State private var showPicker = false
    @State private var showAdvanced = false
    @State private var notice: String?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let notice { QbBanner(tone: .ok, text: notice) }
            if let error { QbBanner(tone: .err, text: error) }

            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    CmsSectionHeader(text: "Video placements")
                    Spacer(minLength: 0)
                    // Level is INFERRED from the module — shown, never asked.
                    HStack(spacing: 4) {
                        Image(systemName: "graduationcap").font(.system(size: 10))
                        Text("Level \(levelNumber) · inferred").font(.inter(10.5, .semibold))
                    }
                    .foregroundStyle(Nuru.ink600)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Nuru.mutedBg).clipShape(Capsule())
                }
                Text("Pick assets from the Video Library — one asset can be placed in many modules, never duplicated. Removing a placement never deletes the asset.")
                    .font(.nCaption).foregroundStyle(Nuru.ink600)

                if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                } else if placements.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "play.rectangle").font(.system(size: 22)).foregroundStyle(Nuru.ink300)
                        Text("No video placed yet").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink600)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 24)
                    .background(Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous)
                        .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                } else {
                    VStack(spacing: 8) {
                        ForEach(placements) { p in placementRow(p) }
                    }
                }

                Button { showPicker = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                        Text("Add from Video Library").font(.inter(13, .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).frame(height: 38)
                    .background(Nuru.navy)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(working)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Nuru.border, lineWidth: 1))

            // Legacy free-text URL — demoted to an advanced fallback (§5.2).
            DisclosureGroup(isExpanded: $showAdvanced) {
                VStack(alignment: .leading, spacing: 8) {
                    CmsFieldCell(label: "Lesson video URL (legacy fallback)") {
                        TextField("https://", text: $videoUrl)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    Text("Prefer placements above. This raw URL survives for old content; it saves with the module (Save above).")
                        .font(.nMicro).foregroundStyle(Nuru.ink400)
                }
                .padding(.top, 8)
            } label: {
                Text("Advanced").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink600)
            }
            .tint(Nuru.ink600)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .task(id: moduleId) { await reload() }
        .sheet(isPresented: $showPicker) {
            AssetPickerSheet(existing: Set(placements.map(\.mediaAssetId))) { asset in
                showPicker = false
                Task { await place(asset) }
            }
        }
    }

    private func placementRow(_ p: ModulePlacementRow) -> some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Nuru.navy.opacity(0.9))
                Image(systemName: "play.fill").font(.system(size: 10)).foregroundStyle(.white)
            }.frame(width: 40, height: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.title?.isEmpty == false ? p.title! : (p.caption ?? "Video asset"))
                    .font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                HStack(spacing: 6) {
                    Text(p.videoSource.isEmpty ? "hosted" : p.videoSource).font(.nMicro).foregroundStyle(Nuru.ink600)
                    if let d = p.durationSec, d > 0 {
                        Text("· \(d / 60):\(String(format: "%02d", d % 60))").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                    Text("· \(p.status)").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
            }
            Spacer(minLength: 0)
            Button { Task { await toggleRequired(p) } } label: {
                Text(p.required ? "Required" : "Optional")
                    .font(.inter(10.5, .bold))
                    .foregroundStyle(p.required ? Color(hex: 0x0F6B33) : Nuru.ink600)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(p.required ? Color(hex: 0xE8F6EE) : Nuru.mutedBg)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(working)
            Button { Task { await remove(p) } } label: {
                Image(systemName: "trash").font(.system(size: 12)).foregroundStyle(Nuru.danger)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .disabled(working)
            .accessibilityLabel("Remove placement")
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    @MainActor private func reload() async {
        loading = placements.isEmpty
        do { placements = try await PortalAPI.modulePlacements(moduleId); error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load placements." }
        loading = false
    }

    @MainActor private func place(_ asset: MediaAssetFull) async {
        working = true; notice = nil; error = nil
        do {
            _ = try await PortalAPI.addPlacement(mediaAssetId: asset.mediaAssetId, moduleId: moduleId)
            await reload()
            notice = "Video placed in this module."
            onChanged()
        } catch {
            if case APIError.http(let status, _) = error, status == 409 {
                self.error = "That asset is already placed in this module."
            } else {
                self.error = (error as? APIError)?.errorDescription ?? "Could not place the video."
            }
        }
        working = false
    }

    @MainActor private func remove(_ p: ModulePlacementRow) async {
        working = true; notice = nil; error = nil
        do {
            try await PortalAPI.removePlacement(p.placementId)
            await reload()
            notice = "Placement removed — the asset stays in the library."
            onChanged()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not remove the placement." }
        working = false
    }

    /// No PATCH endpoint exists for a placement, so the required flag flips by
    /// recreating the row with the same position (placement CRUD keeps the
    /// modules.media_asset_id mirror consistent server-side either way).
    @MainActor private func toggleRequired(_ p: ModulePlacementRow) async {
        working = true; notice = nil; error = nil
        do {
            try await PortalAPI.removePlacement(p.placementId)
            _ = try await PortalAPI.addPlacement(mediaAssetId: p.mediaAssetId, moduleId: moduleId,
                                                 position: p.position, required: !p.required)
            await reload()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not update the placement." }
        working = false
    }
}

// MARK: - Asset picker (choose from the Video Library)

private struct AssetPickerSheet: View {
    let existing: Set<String>
    let onPick: (MediaAssetFull) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var assets: [MediaAssetFull] = []
    @State private var search = ""
    @State private var loading = true
    @State private var error: String?

    private struct AssetList: Codable { let data: [MediaAssetFull] }

    private var filtered: [MediaAssetFull] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        let usable = assets.filter { $0.status != "failed" }
        guard !q.isEmpty else { return usable }
        return usable.filter { a in
            [(a.caption ?? ""), (a.attachedModuleTitle ?? ""), a.videoSource, a.mediaAssetId]
                .joined(separator: " ").lowercased().contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    ErrorBanner(message: error) { Task { await load() } }.padding(Nuru.S.screen)
                } else {
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(filtered) { a in row(a) }
                            if filtered.isEmpty {
                                Text("No assets match.").font(.nCaption).foregroundStyle(Nuru.ink600).padding(.vertical, 30)
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .background(Nuru.paper)
            .navigationTitle("Pick a video")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "Search the library")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task { await load() }
        }
        .presentationDetents([.large])
    }

    private func row(_ a: MediaAssetFull) -> some View {
        let placed = existing.contains(a.mediaAssetId)
        return Button { if !placed { onPick(a) } } label: {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Nuru.navy.opacity(0.9))
                    Image(systemName: "play.fill").font(.system(size: 10)).foregroundStyle(.white)
                }.frame(width: 46, height: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(pickerTitle(a)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    HStack(spacing: 6) {
                        Text(a.videoSource.isEmpty ? "hosted" : a.videoSource).font(.nMicro).foregroundStyle(Nuru.ink600)
                        if let d = a.durationSec, d > 0 {
                            Text("· \(d / 60):\(String(format: "%02d", d % 60))").font(.nMicro).foregroundStyle(Nuru.ink600)
                        }
                        Text("· \(a.status)").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                }
                Spacer(minLength: 0)
                if placed {
                    Text("Placed").font(.inter(10.5, .bold)).foregroundStyle(Nuru.ink400)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Nuru.mutedBg).clipShape(Capsule())
                } else {
                    Image(systemName: "plus.circle.fill").font(.system(size: 18)).foregroundStyle(Nuru.gold)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .opacity(placed ? 0.55 : 1)
        }
        .buttonStyle(.plain)
        .disabled(placed)
    }

    private func pickerTitle(_ a: MediaAssetFull) -> String {
        if let c = a.caption, !c.isEmpty { return c }
        if let m = a.attachedModuleTitle, !m.isEmpty { return m }
        return "\(a.kind.replacingOccurrences(of: "_", with: " ")) · \(String(a.mediaAssetId.prefix(8)))"
    }

    @MainActor private func load() async {
        loading = true
        do {
            assets = try await APIClient.shared.get("/admin/media", as: AssetList.self).data
            error = nil
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load the library." }
        loading = false
    }
}

// MARK: - Section outline row

/// One row in the sections outline: number + an inline rename field + delete.
/// The field carries its own local @State seeded from the parsed section title
/// so re-parses upstream don't thrash focus — it only pushes back to the model
/// on end-editing (submit / focus loss).
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

// MARK: - Markdown editing kit (toolbar + write/preview toggle)

/// Editor mode for the lesson-content pane (web `mdView`).
enum MdEditorMode: String, CaseIterable { case write = "Write", preview = "Preview" }

/// One toolbar snippet (web `tools` array). H1–H3 render as text labels; the rest
/// use SF Symbols. `newGroup` draws the thin divider the web puts between groups.
struct MdTool: Identifiable {
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

// MARK: - MarkdownBlocksView (simple block rendering with the app's fonts)

/// A lightweight block-level markdown renderer: headings, paragraphs (inline
/// **bold**/_italic_/`code` via AttributedString), bullet and numbered lists,
/// quotes, fenced code, pipe tables, and dividers. Page-break markers render
/// as rules so raw content previews cleanly too.
struct MarkdownBlocksView: View {
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

// MARK: - Learner preview (read-only learner's-eye render of the CURRENT draft)

/// One titled teaching section of the snapshot (parseSections output).
struct LpSection { let title: String?; let body: String }

/// Frozen copy of the editor's current fields at the moment Preview is tapped.
struct LearnerPreviewSnapshot {
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

// ── Question rows with the polymorphic answer_options (decode parity with QuestionBankKit) ──

private struct LpQuestion: Identifiable {
    let base: QBQuestion
    var id: String { base.questionId }

    /// Learner-side option labels: TrueFalse is fixed; legacy string[] and
    /// Figma {choices} both flatten to their texts.
    var options: [String] {
        if base.qType == "TrueFalse" { return ["True", "False"] }
        switch base.answerOptions {
        case .strings(let s): return s
        case .choices(let cs): return cs.map(\.text)
        default: return []
        }
    }
    var isChoice: Bool { ["MultipleChoice", "TrueFalse", "multiple_choice", "dropdown", "checkbox"].contains(base.qType) }
    var isMulti: Bool { base.qType == "checkbox" }
    var scale: QBScale? {
        if base.qType == "linear_scale", case .scale(let s) = base.answerOptions { return s }
        return nil
    }
}

struct LearnerPreviewSheet: View {
    let snapshot: LearnerPreviewSnapshot
    @Environment(\.dismiss) private var dismiss

    @State private var accent: Color = Nuru.gold          // level colour, resolved async
    @State private var levelTitle: String?
    @State private var questions: [LpQuestion] = []

    private var totalPoints: Int { questions.reduce(0) { $0 + $1.base.points } }

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

    // Navy strip ("Learner preview · how disciples see this module").
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

    /// "— SECTION N · TITLE —" between hairlines.
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
        // The module's active questions (same endpoint the question editor loads).
        if let list = try? await APIClient.shared.get("/admin/modules/\(snapshot.moduleId)/questions", as: QBQuestionList.self) {
            questions = list.data.filter { $0.isActive }.map { LpQuestion(base: $0) }
        }
    }
}

/// One non-interactive question card: MCQ / TrueFalse / checkbox / dropdown show
/// their options with empty radios or checkboxes; short answer, fill-blank and
/// paragraph show a disabled answer field; linear scale shows its steps. Answers
/// are never marked — the learner view hides correctness.
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
                    if q.base.questionText.isEmpty {
                        Text("Untitled question").font(.inter(14.5, .semibold)).italic().foregroundStyle(Nuru.ink400)
                    } else {
                        Text(q.base.questionText).font(.inter(14.5, .semibold)).foregroundStyle(Nuru.navy)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text("\(q.base.points) \(q.base.points == 1 ? "point" : "points")\(q.base.required ? "" : " · optional")")
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
                if q.base.qType == "short_answer" || q.base.qType == "FillInTheBlank" {
                    answerPlaceholder(minHeight: 42)
                }
                if q.base.qType == "paragraph" {
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

    private func scaleRow(_ s: QBScale) -> some View {
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

// Curriculum shared kit — the authoring write API, tolerant level/module
// models, the Level form sheet and the bright form styling shared by the
// Curriculum Dashboard (§5.1) and the Levels & Modules Workspace (§5.2).
// Extracted from the retired CmsCurriculumView during the two-workspace
// re-architecture (docs/CURRICULUM_ARCHITECTURE.md §5).
//
// ONE editor per entity (§2.5): the level pass mark + exam settings write ONLY
// through PUT /admin/levels/{n}/exam — the level PUT body here deliberately has
// no pass-mark field (the server's UpdateLevel schema is strict and rejects it).
import SwiftUI

// MARK: - Page-shared helpers

/// Parse a CSS hex string (`#C89B3C` / `C89B3C` / `#fff`) into a SwiftUI Color,
/// falling back to gold. Level rows carry their accent as a web hex string.
func cssColor(_ s: String, fallback: Color = Nuru.gold) -> Color {
    var h = s.trimmingCharacters(in: .whitespaces)
    if h.hasPrefix("#") { h.removeFirst() }
    if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
    guard h.count == 6, let v = UInt32(h, radix: 16) else { return fallback }
    return Color(hex: v)
}

/// Web Status (Published / Draft / In Review / Archived) derived from the BE token.
enum CmsStatus: String, CaseIterable {
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
enum CmsEditStatus: String, CaseIterable {
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

// MARK: - Tolerant level row (list + write responses)

/// Tolerant decode of the fuller level row — the shared AdminLevel omits the
/// exam fields the workspace's Final Assessment section needs.
struct CmsLevelDetail: Codable, Identifiable {
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
    /// "review" | "published" — the member-visibility gate of the level exam.
    let examStatus: String?
    @DefaultEmpty var publishedCount: String
    @DefaultEmpty var draftCount: String
    @DefaultEmpty var archivedCount: String
    var id: Int { levelNumber }

    var passMark: Int { Int(Double(requiredExamPassMark) ?? 80) }
    var accent: Color { cssColor(color) }
}

// MARK: - CMS write API (mirrors CurriculumApi.* in api/client.ts)

enum CmsAPI {
    private static var api: APIClient { .shared }

    // ── Levels ──

    /// POST /admin/levels — create still seeds the initial pass mark (the
    /// server's CreateLevel schema keeps it optional).
    struct LevelCreateBody: Encodable {
        let title: String
        let theme: String
        let requiredExamPassMark: Int
        let duration: String
        let status: String
        let locked: Bool
        let color: String
    }
    /// PUT /admin/levels/{n} — NO pass-mark field (§2.5: the exam endpoint owns
    /// it; the server's strict UpdateLevel schema rejects it).
    struct LevelUpdateBody: Encodable {
        let title: String
        let theme: String
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
    /// PUT /admin/levels/{n}/exam — the ONE writer of pass mark + exam config
    /// (+ the review→publish exam_status gate).
    struct ExamBody: Encodable {
        let requiredExamPassMark: Int
        let examQuestionCount: Int?
        let examShowAnswers: Bool?
        let examShowScore: Bool?
        let examShuffle: Bool?
        let examStatus: String?
    }

    static func levels() async throws -> [CmsLevelDetail] {
        try await api.get("/admin/levels", as: DataList<CmsLevelDetail>.self).data
    }
    static func createLevel(_ body: LevelCreateBody) async throws {
        _ = try await api.post("/admin/levels", body: body, as: CmsLevelDetail.self)
    }
    static func updateLevel(_ n: Int, _ body: LevelUpdateBody) async throws {
        _ = try await api.put("/admin/levels/\(n)", body: body, as: CmsLevelDetail.self)
    }
    static func patchLevel(_ n: Int, _ body: LevelPatch) async throws {
        _ = try await api.put("/admin/levels/\(n)", body: body, as: CmsLevelDetail.self)
    }
    static func updateExam(_ n: Int, _ body: ExamBody) async throws {
        _ = try await api.put("/admin/levels/\(n)/exam", body: body, as: CmsLevelDetail.self)
    }

    // ── Modules ──

    struct ModuleCreateBody: Encodable {
        let levelNumber: Int
        let title: String
        let lessonContent: String
        let evaluationKind: String
    }
    static func createModule(_ body: ModuleCreateBody) async throws {
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
struct ModuleFull: Codable {
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
struct ModuleUpdateBody: Encodable {
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

// MARK: - Bright form kit (roomy, readable editor sheets)
//
// Shared styling so the CMS editor forms read like the bright web forms: warm cream
// background behind a hidden Form chrome, white field rows with visible borders, dark
// readable labels, navy section headers, and paired fields in two columns.

/// Warm bright sheet chrome: hide the system grouped background and paint Nuru.paper,
/// constrain the content to a roomy centred column, and open the sheet large.
extension View {
    func cmsFormSheet() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(Nuru.paper)
            .tint(Nuru.gold)
            .presentationDetents([.large])
    }
}

/// Navy section header for a Form section (replaces the faint default grey caption).
struct CmsSectionHeader: View {
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
struct CmsFieldCell<Content: View>: View {
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
struct CmsFieldPair<L: View, R: View>: View {
    @ViewBuilder var left: L
    @ViewBuilder var right: R
    var body: some View {
        HStack(alignment: .top, spacing: 14) { left; right }
    }
}

/// A bright toggle/stepper tile (white surface + border) for boolean / numeric rows.
struct CmsControlTile<Content: View>: View {
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

// MARK: - Level form sheet (web LevelModal — New Level / Edit Level + exam settings)

struct LevelFormSheet: View {
    enum Mode {
        case add
        /// Edit-by-number — the sheet fetches the full row (incl. exam fields).
        case edit(Int)
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
        case .edit(let n): return n
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

    /// Seed the form for edits from the full level row (exam fields included).
    @MainActor private func prefill() async {
        guard !prefilled else { return }
        prefilled = true
        guard isEdit else { return }
        if let row = try? await fetchLevel(levelNumber) {
            title = row.title
            theme = row.theme ?? theme
            duration = row.duration ?? duration
            passMark = row.passMark
            status = CmsEditStatus.from(row.status)
            locked = row.locked
            if !row.color.isEmpty { colorHex = row.color }
            examQuestionCount = row.examQuestionCount ?? 0
            examShowAnswers = row.examShowAnswers ?? false
            examShowScore = row.examShowScore ?? true
            examShuffle = row.examShuffle ?? false
        }
    }

    private func fetchLevel(_ n: Int) async throws -> CmsLevelDetail? {
        // The list endpoint carries the exam fields per-row; find ours.
        try await CmsAPI.levels().first { $0.levelNumber == n }
    }

    @MainActor private func save() async {
        saving = true; error = nil
        do {
            if isEdit {
                // §2.5 — level PUT carries NO pass mark; exam fields (incl. the
                // pass mark) go ONLY through the dedicated exam endpoint.
                try await CmsAPI.updateLevel(levelNumber, .init(
                    title: title.trimmingCharacters(in: .whitespaces),
                    theme: theme,
                    duration: duration,
                    status: status.be,
                    locked: locked,
                    color: colorHex))
                try await CmsAPI.updateExam(levelNumber, .init(
                    requiredExamPassMark: passMark,
                    examQuestionCount: examQuestionCount > 0 ? examQuestionCount : nil,
                    examShowAnswers: examShowAnswers,
                    examShowScore: examShowScore,
                    examShuffle: examShuffle,
                    examStatus: nil))
            } else {
                try await CmsAPI.createLevel(.init(
                    title: title.trimmingCharacters(in: .whitespaces),
                    theme: theme,
                    requiredExamPassMark: passMark,
                    duration: duration,
                    status: status.be,
                    locked: locked,
                    color: colorHex))
            }
            await reload()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Save failed."
            saving = false
        }
    }
}

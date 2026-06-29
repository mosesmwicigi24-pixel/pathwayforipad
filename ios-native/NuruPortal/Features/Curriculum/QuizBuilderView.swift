// Level Quiz Builder — native SwiftUI port of the web admin page
// (packages/admin-web/src/components/pages/QuizBuilder.tsx +
//  packages/admin-web/src/components/curriculum/ModuleQuizBuilder.tsx).
//
// Server-authoritative model (§1.9): the "level quiz" is the level's exit-exam
// module's question bank plus the level's exam settings (pass mark + reveal/shuffle
// flags). This view is read/toggle UI — it loads levels, resolves each level's
// exit_exam module, loads that module's questions/options, and surfaces the exam
// settings. Mutations are out of scope here (see NEEDS), so editors render as
// display-state controls mirroring the web layout.
//
// Layout: navy hero (counts) → 3-pane on iPad (level list | editor | settings),
// stacked sections when narrow. Uses the shared kit only (NuruTheme/Components/
// Models/Networking) without editing it; exam-settings + answer-option shapes
// that the shared AdminLevel/AdminQuestion models don't carry are decoded by
// PAGE-LOCAL Codable structs fetched via APIClient.shared.get.
import SwiftUI

// MARK: - Page-local API shapes (fields the shared models don't carry)

/// Level row WITH the exam settings the shared `AdminLevel` omits. Fetched from
/// the same `/admin/levels` list (actor decoder is convertFromSnakeCase).
private struct QBLevel: Codable, Identifiable {
    var levelNumber: Int = 0
    var title: String = ""
    var theme: String?
    var duration: String?
    var status: String = "draft"
    var locked: Bool = false
    var color: String = ""
    var publishedCount: String = "0"
    var draftCount: String = "0"
    var requiredExamPassMark: String?
    var examQuestionCount: Int?
    var examShowAnswers: Bool?
    var examShowScore: Bool?
    var examShuffle: Bool?
    var id: Int { levelNumber }

    enum CodingKeys: String, CodingKey {
        case levelNumber, title, theme, duration, status, locked, color
        case publishedCount, draftCount
        case requiredExamPassMark, examQuestionCount, examShowAnswers, examShowScore, examShuffle
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        levelNumber = (try? c.decode(Int.self, forKey: .levelNumber)) ?? 0
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        theme = try? c.decodeIfPresent(String.self, forKey: .theme)
        duration = try? c.decodeIfPresent(String.self, forKey: .duration)
        status = (try? c.decode(String.self, forKey: .status)) ?? "draft"
        locked = (try? c.decode(Bool.self, forKey: .locked)) ?? false
        color = (try? c.decode(String.self, forKey: .color)) ?? ""
        publishedCount = (try? c.decode(String.self, forKey: .publishedCount)) ?? "0"
        draftCount = (try? c.decode(String.self, forKey: .draftCount)) ?? "0"
        requiredExamPassMark = try? c.decodeIfPresent(String.self, forKey: .requiredExamPassMark)
        examQuestionCount = try? c.decodeIfPresent(Int.self, forKey: .examQuestionCount)
        examShowAnswers = try? c.decodeIfPresent(Bool.self, forKey: .examShowAnswers)
        examShowScore = try? c.decodeIfPresent(Bool.self, forKey: .examShowScore)
        examShuffle = try? c.decodeIfPresent(Bool.self, forKey: .examShuffle)
    }
}
private struct QBLevelList: Codable { let data: [QBLevel] }

/// Module summary (exit_exam resolution). Mirrors AdminModuleSummary's needed fields.
private struct QBModule: Codable, Identifiable {
    var moduleId: String = ""
    var evaluationKind: String = ""
    var id: String { moduleId }
}
private struct QBModuleList: Codable { let data: [QBModule] }

/// Question row WITH the polymorphic answer_options the shared model omits.
/// answer_options JSONB is one of: string[] | {choices:[…]} | {scale:{…}} | null.
private struct QBQuestion: Codable, Identifiable {
    var questionId: String = ""
    var qType: String = "short_answer"
    var questionText: String = ""
    var correctAnswer: String = ""
    var isActive: Bool = true
    var explanation: String?
    var points: Int = 1
    var required: Bool = true
    var answerOptions: QBAnswerOptions = .none
    var id: String { questionId }

    enum CodingKeys: String, CodingKey {
        case questionId, qType, questionText, correctAnswer, isActive, explanation
        case points, required, answerOptions
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        questionId = (try? c.decode(String.self, forKey: .questionId)) ?? ""
        qType = (try? c.decode(String.self, forKey: .qType)) ?? "short_answer"
        questionText = (try? c.decode(String.self, forKey: .questionText)) ?? ""
        correctAnswer = (try? c.decode(String.self, forKey: .correctAnswer)) ?? ""
        isActive = (try? c.decode(Bool.self, forKey: .isActive)) ?? true
        explanation = try? c.decodeIfPresent(String.self, forKey: .explanation)
        points = (try? c.decode(Int.self, forKey: .points)) ?? 1
        required = (try? c.decode(Bool.self, forKey: .required)) ?? true
        answerOptions = (try? c.decode(QBAnswerOptions.self, forKey: .answerOptions)) ?? .none
    }
}
private struct QBQuestionList: Codable { let data: [QBQuestion] }

private struct QBChoice: Codable { let id: String?; let text: String; let isCorrect: Bool }
private struct QBScale: Codable { let min: Int; let max: Int; let minLabel: String?; let maxLabel: String? }

/// Polymorphic answer_options decoder. Legacy string[] vs Figma {choices} vs {scale} vs null.
private enum QBAnswerOptions: Codable {
    case strings([String])
    case choices([QBChoice])
    case scale(QBScale)
    case none

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(), single.decodeNil() {
            self = .none; return
        }
        if let arr = try? decoder.singleValueContainer().decode([String].self) {
            self = .strings(arr); return
        }
        let c = try decoder.container(keyedBy: K.self)
        if let ch = try? c.decode([QBChoice].self, forKey: .choices) {
            self = .choices(ch); return
        }
        if let sc = try? c.decode(QBScale.self, forKey: .scale) {
            self = .scale(sc); return
        }
        self = .none
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .strings(let s): try c.encode(s)
        case .none: try c.encodeNil()
        default: try c.encodeNil()
        }
    }
    enum K: String, CodingKey { case choices, scale }
}

// MARK: - Decoded option model (decode parity with ModuleQuizBuilder.decodeChoices)

private struct QOption: Identifiable {
    let id: String
    let text: String
    let isCorrect: Bool
}

private enum QType: String {
    case multipleChoice = "multiple_choice"
    case checkbox
    case dropdown
    case shortAnswer = "short_answer"
    case paragraph
    case linearScale = "linear_scale"

    /// Map a legacy q_type to the closest Figma type (decodeType parity).
    static func decode(_ raw: String) -> QType {
        switch raw {
        case "multiple_choice": return .multipleChoice
        case "checkbox": return .checkbox
        case "dropdown": return .dropdown
        case "short_answer": return .shortAnswer
        case "paragraph": return .paragraph
        case "linear_scale": return .linearScale
        case "MultipleChoice", "TrueFalse": return .multipleChoice
        case "FillInTheBlank": return .shortAnswer
        default: return .shortAnswer
        }
    }

    var isChoice: Bool { self == .multipleChoice || self == .checkbox || self == .dropdown }
    var isManual: Bool { self == .shortAnswer || self == .paragraph }
    var isMulti: Bool { self == .checkbox }

    var label: String {
        switch self {
        case .multipleChoice: return "Multiple choice"
        case .checkbox: return "Checkboxes"
        case .dropdown: return "Dropdown"
        case .shortAnswer: return "Short answer"
        case .paragraph: return "Paragraph"
        case .linearScale: return "Linear scale"
        }
    }
    var hint: String {
        switch self {
        case .multipleChoice: return "One correct answer (radio)"
        case .checkbox: return "One or more correct (multi)"
        case .dropdown: return "One correct answer (select)"
        case .shortAnswer, .paragraph: return "Reviewer scores manually"
        case .linearScale: return "Rating scale (collected)"
        }
    }
    var icon: String {
        switch self {
        case .multipleChoice: return "list.bullet"
        case .checkbox: return "checkmark.square"
        case .dropdown: return "chevron.down.square"
        case .shortAnswer: return "textformat"
        case .paragraph: return "text.alignleft"
        case .linearScale: return "slider.horizontal.3"
        }
    }
    var tint: Color {
        switch self {
        case .multipleChoice: return Color(hex: 0x7C3AED)
        case .checkbox: return Color(hex: 0x0B84E8)
        case .dropdown: return Color(hex: 0x0EA5A4)
        case .shortAnswer: return Color(hex: 0x16A34A)
        case .paragraph: return Color(hex: 0xD97706)
        case .linearScale: return Color(hex: 0xDB2777)
        }
    }
    static let all: [QType] = [.multipleChoice, .checkbox, .dropdown, .shortAnswer, .paragraph, .linearScale]
}

/// Decoded, render-ready question (fromApi parity).
private struct VModelQuestion: Identifiable {
    let id: String
    let type: QType
    let text: String
    let options: [QOption]
    let points: Int
    let required: Bool
    let explanation: String
    let active: Bool
    let minVal: Int
    let maxVal: Int
    let minLabel: String
    let maxLabel: String

    /// fromApi(a) — decode a question row into the render model.
    static func from(_ a: QBQuestion) -> VModelQuestion {
        let type = QType.decode(a.qType)
        let options = type.isChoice ? decodeChoices(a) : []
        let scale = decodeScale(a)
        return VModelQuestion(
            id: a.questionId,
            type: type,
            text: a.questionText,
            options: options,
            points: a.points,
            required: a.required,
            explanation: a.explanation ?? "",
            active: a.isActive,
            minVal: scale.min, maxVal: scale.max,
            minLabel: scale.minLabel, maxLabel: scale.maxLabel
        )
    }

    /// isValid(q) parity.
    var isValid: Bool {
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return false }
        if type.isChoice {
            let filled = options.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            if filled.isEmpty { return false }
            let correct = filled.filter { $0.isCorrect }.count
            return type.isMulti ? correct >= 1 : correct == 1
        }
        if type == .linearScale { return minVal < maxVal }
        return true
    }

    private static func decodeChoices(_ a: QBQuestion) -> [QOption] {
        switch a.answerOptions {
        case .choices(let cs):
            return cs.map { QOption(id: $0.id ?? UUID().uuidString, text: $0.text, isCorrect: $0.isCorrect) }
        case .strings(let strs):
            // Legacy string[] options + scalar/array correct_answer.
            var correct = Set<String>()
            if let data = a.correctAnswer.data(using: .utf8),
               let arr = try? JSONDecoder().decode([String].self, from: data) {
                correct = Set(arr)
            } else {
                correct = [a.correctAnswer]
            }
            return strs.map { QOption(id: UUID().uuidString, text: $0, isCorrect: correct.contains($0)) }
        default:
            return []
        }
    }
    private static func decodeScale(_ a: QBQuestion) -> (min: Int, max: Int, minLabel: String, maxLabel: String) {
        if case .scale(let s) = a.answerOptions {
            return (s.min, s.max, s.minLabel ?? "", s.maxLabel ?? "")
        }
        return (1, 5, "", "")
    }
}

/// Exam settings (QuizSettings parity). examSettings(lvl) defaults: passMark 80,
/// shuffle false, showAnswers false, showScore true, no client time limit.
private struct ExamSettings {
    let passMark: Int
    let shuffleQuestions: Bool
    let showAnswersAfterSubmit: Bool
    let showScoreAfterSubmit: Bool
    let timeLimitMinutes: Int?

    static func from(_ l: QBLevel) -> ExamSettings {
        let pm = Int((l.requiredExamPassMark.flatMap { Double($0) }) ?? 80)
        return ExamSettings(
            passMark: pm,
            shuffleQuestions: l.examShuffle ?? false,
            showAnswersAfterSubmit: l.examShowAnswers ?? false,
            showScoreAfterSubmit: l.examShowScore ?? true,
            timeLimitMinutes: nil
        )
    }
}

// MARK: - Color helper (level.color is a "#RRGGBB" string)

private extension Color {
    init(hexString s: String, fallback: Color = Nuru.gold) {
        let h = s.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).uppercased()
        guard h.count == 6, let v = UInt32(h, radix: 16) else { self = fallback; return }
        self.init(hex: v)
    }
}

private let qbStatusLabel: [String: String] = [
    "published": "Published", "draft": "Draft", "in_review": "In Review", "archived": "Archived",
]
private struct StatusStyle { let bg: Color; let fg: Color }
private func qbStatusStyle(_ s: String) -> StatusStyle {
    switch s {
    case "published": return StatusStyle(bg: Color(hex: 0xE8F6EE), fg: Color(hex: 0x0F6B33))
    case "in_review": return StatusStyle(bg: Color(hex: 0xFDF5E5), fg: Color(hex: 0x8A6B1F))
    default:          return StatusStyle(bg: Color(hex: 0xEEF1F8), fg: Color(hex: 0x1F3A6B))
    }
}

// MARK: - Root

struct QuizBuilderView: View {
    @State private var levels: [QBLevel] = []
    @State private var selNo: Int?
    @State private var examModuleId: String?
    @State private var examMissing = false
    @State private var resolving = false
    @State private var loadError: String?
    @State private var didLoad = false

    private var selLevel: QBLevel? { levels.first { $0.levelNumber == selNo } }
    private var publishedCount: Int { levels.filter { $0.status == "published" }.count }

    var body: some View {
        GeometryReader { geo in
            let wide = geo.size.width >= 880
            VStack(spacing: 0) {
                hero
                if wide {
                    HStack(spacing: 0) {
                        levelRail
                            .frame(width: 300)
                        Divider().background(Nuru.border)
                        editorPane
                            .frame(maxWidth: .infinity)
                    }
                } else {
                    ScrollView {
                        VStack(spacing: Nuru.S.base) {
                            levelRailStacked
                            editorPaneStacked
                        }
                        .padding(Nuru.S.base)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Nuru.paper)
        }
        .task {
            guard !didLoad else { return }
            didLoad = true
            await loadLevels()
        }
        .onChange(of: selNo) { _, newValue in
            if let n = newValue, !levels.isEmpty { Task { await resolveExam(n) } }
        }
    }

    // MARK: Hero

    private var hero: some View {
        PortalHero(
            breadcrumb: ["Curriculum", "Level Quiz Builder"],
            title: "Level Quiz Builder",
            subtitle: "Build the final assessment disciples take after completing a level.",
            stats: [
                HeroStat(label: "Levels", value: "\(levels.count)", hint: "Total"),
                HeroStat(label: "Published", value: "\(publishedCount)", hint: "Live"),
            ]
        )
    }

    // MARK: Left rail (level selector)

    private var levelRailHeader: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("SELECT A LEVEL").font(.inter(11, .bold)).tracking(0.7)
                .foregroundStyle(Nuru.ink600)
            Text("The exam gates level completion.").font(.inter(10.5)).foregroundStyle(Nuru.ink600)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14).padding(.vertical, 12)
    }

    private var levelRail: some View {
        VStack(spacing: 0) {
            levelRailHeader
            Divider().background(Nuru.border)
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(levels) { l in levelCard(l) }
                }
                .padding(12)
            }
        }
        .background(Nuru.white)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var levelRailStacked: some View {
        VStack(spacing: 0) {
            levelRailHeader
            Divider().background(Nuru.border)
            VStack(spacing: 8) {
                ForEach(levels) { l in levelCard(l) }
            }
            .padding(12)
        }
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func levelCard(_ l: QBLevel) -> some View {
        let sel = selNo == l.levelNumber
        let lc = Color(hexString: l.color)
        let ss = qbStatusStyle(l.status)
        let modules = (Int(l.publishedCount) ?? 0) + (Int(l.draftCount) ?? 0)
        return Button {
            if !l.locked { selNo = l.levelNumber }
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 10) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(l.locked ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(lc))
                        if l.locked {
                            Image(systemName: "lock.fill").font(.system(size: 13)).foregroundStyle(.white)
                        } else {
                            Text("\(l.levelNumber)").font(.fraunces(15, .medium)).foregroundStyle(.white)
                        }
                    }
                    .frame(width: 36, height: 36)

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text("LEVEL \(l.levelNumber)").font(.inter(10, .bold)).tracking(0.8)
                                .foregroundStyle(lc)
                            Text(qbStatusLabel[l.status] ?? l.status).font(.inter(9.5, .bold))
                                .foregroundStyle(ss.fg)
                                .padding(.horizontal, 7).padding(.vertical, 1)
                                .background(ss.bg).clipShape(Capsule())
                        }
                        Text(l.title).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                            .lineLimit(2).multilineTextAlignment(.leading)
                        if let theme = l.theme, !theme.isEmpty {
                            Text(theme).font(.inter(11)).foregroundStyle(Nuru.ink600).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    if sel {
                        ZStack {
                            Circle().fill(lc)
                            Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                        }.frame(width: 20, height: 20)
                    }
                }
                HStack(spacing: 12) {
                    Label("\(modules) modules", systemImage: "book")
                        .labelStyle(.titleAndIcon).font(.inter(10.5)).foregroundStyle(Nuru.ink600)
                    Label(l.duration ?? "—", systemImage: "clock")
                        .labelStyle(.titleAndIcon).font(.inter(10.5)).foregroundStyle(Nuru.ink600)
                }
                .padding(.leading, 46)
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(sel ? lc.opacity(0.03) : Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(sel ? lc : Nuru.border, lineWidth: sel ? 2 : 1.5))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(lc.opacity(sel ? 0.10 : 0), lineWidth: 4).blur(radius: 2))
        }
        .buttonStyle(.plain)
        .opacity(l.locked ? 0.55 : 1)
        .disabled(l.locked)
    }

    // MARK: Editor pane

    @ViewBuilder private var editorPane: some View {
        if let lvl = selLevel {
            VStack(spacing: 0) {
                levelBanner(lvl)
                if let loadError {
                    Text(loadError).font(.inter(12.5)).foregroundStyle(Color(hex: 0xA8281F))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 24).padding(.vertical, 8)
                        .background(Color(hex: 0xFDF4F4))
                }
                ScrollView { editorBody(lvl).padding(.horizontal, 24).padding(.vertical, 20) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else {
            VStack(spacing: 10) {
                Image(systemName: "square.stack.3d.up").font(.system(size: 36)).foregroundStyle(Nuru.ink300)
                Text("Select a level to build its quiz").font(.inter(14, .semibold)).foregroundStyle(Nuru.ink600)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private var editorPaneStacked: some View {
        if let lvl = selLevel {
            VStack(spacing: 0) {
                levelBanner(lvl)
                if let loadError {
                    Text(loadError).font(.inter(12.5)).foregroundStyle(Color(hex: 0xA8281F))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .background(Color(hex: 0xFDF4F4))
                }
                editorBody(lvl).padding(16)
            }
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
    }

    private func levelBanner(_ lvl: QBLevel) -> some View {
        let lc = Color(hexString: lvl.color)
        return HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(lc)
                Text("\(lvl.levelNumber)").font(.fraunces(15, .medium)).foregroundStyle(.white)
            }.frame(width: 32, height: 32)
            (Text("Level \(lvl.levelNumber) — \(lvl.title)").font(.inter(12.5, .bold)).foregroundColor(Nuru.navy)
             + Text("  \(lvl.theme ?? "")").font(.inter(11)).foregroundColor(Nuru.ink600))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                Image(systemName: "rosette").font(.system(size: 12)).foregroundStyle(lc)
                Text("Final assessment").font(.inter(11, .semibold)).foregroundStyle(lc)
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(lc.opacity(0.06))
        .overlay(Rectangle().fill(lc.opacity(0.30)).frame(height: 2), alignment: .bottom)
    }

    @ViewBuilder private func editorBody(_ lvl: QBLevel) -> some View {
        if resolving {
            Text("Loading exam…").font(.inter(13)).foregroundStyle(Nuru.ink600)
                .frame(maxWidth: .infinity).padding(40)
        } else if examMissing {
            examMissingCard
        } else if let moduleId = examModuleId {
            ModuleQuizEditor(moduleId: moduleId, accent: Color(hexString: lvl.color), settings: ExamSettings.from(lvl))
                .id(moduleId)
        }
    }

    private var examMissingCard: some View {
        HStack {
            Spacer()
            Card(padding: 32) {
                VStack(spacing: 8) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Nuru.gold.opacity(0.12))
                        Image(systemName: "rosette").font(.system(size: 22)).foregroundStyle(Nuru.gold)
                    }.frame(width: 52, height: 52)
                    Text("No exam for this level yet").font(.fraunces(18, .semibold)).foregroundStyle(Nuru.ink)
                    Text("Create the level's final assessment to start adding questions.")
                        .font(.inter(13)).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center)
                    // Creating the exam module is a mutation — out of scope here (see NEEDS).
                    HStack(spacing: 6) {
                        Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                        Text("Create level exam").font(.inter(13, .bold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18).frame(height: 40)
                    .background(Nuru.gold).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(.top, 8).opacity(0.5)
                }
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity)
            }
            .frame(maxWidth: 480)
            Spacer()
        }
        .padding(.top, 40)
    }

    // MARK: Data

    private func loadLevels() async {
        do {
            let list = try await APIClient.shared.get("/admin/levels", as: QBLevelList.self)
            await MainActor.run {
                levels = list.data
                if selNo == nil { selNo = list.data.first?.levelNumber }
            }
            // selNo set above triggers .onChange → resolveExam. But if selNo was
            // already non-nil (e.g. unchanged), drive the first resolve explicitly.
            if let n = selNo, examModuleId == nil, !examMissing, !resolving { await resolveExam(n) }
        } catch {
            await MainActor.run { loadError = (error as? APIError)?.errorDescription ?? "Load failed" }
        }
    }

    private func resolveExam(_ levelNo: Int) async {
        await MainActor.run { loadError = nil; resolving = true; examModuleId = nil; examMissing = false }
        do {
            let list = try await APIClient.shared.get("/admin/levels/\(levelNo)/modules", as: QBModuleList.self)
            let exam = list.data.first { $0.evaluationKind == "exit_exam" }
            await MainActor.run {
                if let exam { examModuleId = exam.moduleId } else { examMissing = true }
                resolving = false
            }
        } catch {
            await MainActor.run {
                loadError = (error as? APIError)?.errorDescription ?? "Could not load the level exam."
                resolving = false
            }
        }
    }
}

// MARK: - Module quiz editor (ModuleQuizBuilder parity)

private struct ModuleQuizEditor: View {
    let moduleId: String
    let accent: Color
    let settings: ExamSettings

    @State private var questions: [VModelQuestion] = []
    @State private var expanded: String?
    @State private var loading = true
    @State private var error: String?

    private var active: [VModelQuestion] { questions.filter { $0.active } }
    private var totalPoints: Int { active.reduce(0) { $0 + $1.points } }
    private var passingPoints: Int { Int(ceil(Double(totalPoints) * Double(settings.passMark) / 100)) }

    var body: some View {
        Group {
            if loading {
                Text("Loading questions…").font(.inter(13)).foregroundStyle(Nuru.ink600)
                    .frame(maxWidth: .infinity).padding(40)
            } else {
                VStack(spacing: 16) {
                    if let error { Banner(tone: .err, text: error) }
                    summaryCard
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 18) {
                            questionsColumn.frame(maxWidth: .infinity)
                            settingsPanel.frame(width: 300)
                        }
                        VStack(spacing: 18) {
                            questionsColumn
                            settingsPanel
                        }
                    }
                }
            }
        }
        .task(id: moduleId) { await load() }
    }

    // MARK: Summary card

    private var summaryCard: some View {
        Card(padding: 16) {
            HStack(alignment: .center, spacing: 18) {
                stat("Questions", "\(active.count)", "\(questions.count - active.count) draft")
                stat("Total points", "\(totalPoints)", "Pass at \(passingPoints) pts")
                stat("Pass mark", "\(settings.passMark)%",
                     settings.timeLimitMinutes.map { "\($0) min" } ?? "No time limit")
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    if settings.shuffleQuestions { chip("shuffle", "Shuffled") }
                    if settings.showAnswersAfterSubmit { chip("eye", "Answers shown") }
                    if settings.showScoreAfterSubmit { chip("chart.bar", "Score shown") }
                }
            }
        }
    }

    private func stat(_ label: String, _ value: String, _ hint: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label.uppercased()).font(.inter(10, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600)
            Text(value).font(.fraunces(22, .medium)).foregroundStyle(Nuru.navy)
            Text(hint).font(.inter(11)).foregroundStyle(Nuru.ink600)
        }
    }
    private func chip(_ icon: String, _ label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10))
            Text(label).font(.inter(11, .semibold))
        }
        .foregroundStyle(Nuru.navy)
        .padding(.horizontal, 9).frame(height: 24)
        .background(Nuru.mutedBg).clipShape(Capsule())
    }

    // MARK: Questions column

    private var questionsColumn: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Add toolbar — Add question + Save (display-only; mutations out of scope).
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                    Text("Add question").font(.inter(13, .semibold))
                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14).frame(height: 36)
                .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .opacity(0.5)
                Spacer()
                HStack(spacing: 6) {
                    Image(systemName: "square.and.arrow.down").font(.system(size: 12, weight: .bold))
                    Text("Save").font(.inter(13, .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16).frame(height: 36)
                .background(accent).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .opacity(0.5)
            }

            ForEach(Array(questions.enumerated()), id: \.element.id) { idx, q in
                QuestionCard(
                    q: q, index: idx, total: questions.count, accent: accent,
                    expanded: expanded == q.id,
                    onToggle: { expanded = (expanded == q.id) ? nil : q.id }
                )
            }

            if questions.isEmpty {
                VStack(spacing: 4) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Nuru.gold.opacity(0.10))
                        Image(systemName: "questionmark.circle").font(.system(size: 22)).foregroundStyle(Nuru.gold)
                    }.frame(width: 52, height: 52)
                    Text("No questions yet").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Text("Use \u{201C}Add question\u{201D} to build this quiz.")
                        .font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 44).padding(.horizontal, 24)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
            }
        }
    }

    // MARK: Settings panel (SettingsPanel parity)

    private var settingsPanel: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 16) {
                Text("EXAM SETTINGS").font(.inter(10.5, .heavy)).tracking(0.9)
                    .foregroundStyle(Nuru.navy)

                // pass mark
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("\(settings.passMark)%").font(.fraunces(24, .medium)).foregroundStyle(Nuru.navy)
                        Spacer()
                        Text("\(passingPoints) of \(totalPoints) pts").font(.inter(11)).foregroundStyle(Nuru.ink600)
                    }
                    Slider(value: .constant(Double(settings.passMark)), in: 0...100, step: 5).tint(Nuru.gold)
                        .disabled(true)
                    HStack {
                        Text("0%"); Spacer(); Text("Pass mark"); Spacer(); Text("100%")
                    }.font(.inter(10.5)).foregroundStyle(Nuru.ink600)
                }

                // time limit
                VStack(alignment: .leading, spacing: 6) {
                    fieldLabel("Time limit")
                    HStack(spacing: 8) {
                        HStack(spacing: 6) {
                            Image(systemName: "clock").font(.system(size: 12))
                            Text(settings.timeLimitMinutes != nil ? "On" : "Off").font(.inter(12, .semibold))
                        }
                        .foregroundStyle(settings.timeLimitMinutes != nil ? .white : Nuru.ink600)
                        .padding(.horizontal, 10).frame(height: 34)
                        .background(settings.timeLimitMinutes != nil ? AnyShapeStyle(Nuru.gold) : AnyShapeStyle(Nuru.background))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1.5))
                        if let m = settings.timeLimitMinutes {
                            Text("\(m)").font(.inter(13)).foregroundStyle(Nuru.foreground)
                                .frame(width: 64, height: 34)
                                .background(Nuru.background)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1.5))
                            Text("min").font(.inter(12)).foregroundStyle(Nuru.ink600)
                        } else {
                            Text("No limit").font(.inter(12)).foregroundStyle(Nuru.ink600)
                        }
                    }
                }

                // toggles
                VStack(spacing: 8) {
                    switchRow("shuffle", "Shuffle questions", settings.shuffleQuestions)
                    switchRow("eye", "Show answers after submit", settings.showAnswersAfterSubmit)
                    switchRow("chart.bar", "Show score after submit", settings.showScoreAfterSubmit)
                }
            }
        }
    }

    private func switchRow(_ icon: String, _ label: String, _ on: Bool) -> some View {
        HStack {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 12)).foregroundStyle(on ? Nuru.gold : Nuru.ink600)
                Text(label).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.foreground)
            }
            Spacer()
            ZStack(alignment: on ? .trailing : .leading) {
                Capsule().fill(on ? AnyShapeStyle(Nuru.gold) : AnyShapeStyle(Color(hex: 0xD1D5DB)))
                    .frame(width: 32, height: 18)
                Circle().fill(.white).frame(width: 14, height: 14).padding(2)
            }
            .frame(width: 32, height: 18)
        }
        .padding(.horizontal, 12).frame(height: 42)
        .background(Nuru.background)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1.5))
    }

    // MARK: Data

    private func load() async {
        await MainActor.run { loading = true; error = nil; expanded = nil }
        do {
            let list = try await APIClient.shared.get("/admin/modules/\(moduleId)/questions", as: QBQuestionList.self)
            let mapped = list.data.map(VModelQuestion.from)
            await MainActor.run {
                questions = mapped
                expanded = mapped.first?.id
                loading = false
            }
        } catch {
            await MainActor.run {
                self.error = (error as? APIError)?.errorDescription ?? "Could not load questions."
                loading = false
            }
        }
    }
}

// MARK: - Question card (QCard parity)

private struct QuestionCard: View {
    let q: VModelQuestion
    let index: Int
    let total: Int
    let accent: Color
    let expanded: Bool
    let onToggle: () -> Void

    var body: some View {
        ZStack(alignment: .leading) {
            VStack(alignment: .leading, spacing: 0) {
                if expanded { expandedBody } else { collapsedBody }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            if expanded {
                Rectangle().fill(accent).frame(width: 5)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
        .if(expanded) { $0.nuruShadow(0.6) }
    }

    // collapsed summary
    private var collapsedBody: some View {
        Button(action: onToggle) {
            HStack(alignment: .top, spacing: 10) {
                Text("\(index + 1).").font(.fraunces(16, .medium)).foregroundStyle(Nuru.ink600).frame(minWidth: 24, alignment: .leading)
                VStack(alignment: .leading, spacing: 8) {
                    Text(q.text.isEmpty ? "Untitled question" : q.text)
                        .font(.inter(14.5, .medium)).foregroundStyle(Nuru.navy)
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        HStack(spacing: 4) {
                            Image(systemName: q.type.icon).font(.system(size: 10)).foregroundStyle(q.type.tint)
                            Text(q.type.label).font(.inter(11.5)).foregroundStyle(Nuru.ink600)
                        }
                        Text("· \(q.points) pt\(q.points == 1 ? "" : "s")").font(.inter(11.5)).foregroundStyle(Nuru.ink600)
                        if q.required { Text("· Required").font(.inter(11.5)).foregroundStyle(Nuru.ink600) }
                        if !q.isValid {
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.triangle").font(.system(size: 9))
                                Text("Needs setup").font(.inter(11, .semibold))
                            }.foregroundStyle(Color(hex: 0xDC2626))
                        }
                        if !q.active {
                            Text("DRAFT").font(.inter(10, .bold)).foregroundStyle(Color(hex: 0x6B7280))
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                .background(Color(hex: 0xF3F4F6)).clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
    }

    // expanded editor (read-only render of the same controls)
    private var expandedBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(index + 1).").font(.fraunces(18, .medium)).foregroundStyle(Nuru.ink600)
                    .frame(minWidth: 26, alignment: .leading).padding(.top, 6)
                Text(q.text.isEmpty ? "Question text" : q.text)
                    .font(.inter(15, .medium)).foregroundStyle(q.text.isEmpty ? Nuru.ink400 : Nuru.navy)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text(q.type.label).font(.inter(12.5)).foregroundStyle(Nuru.foreground)
                    .padding(.horizontal, 12).frame(height: 38)
                    .background(Nuru.background)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            }
            .padding(.bottom, 14)

            // body by type
            Group {
                if q.type.isChoice { choiceBody }
                else if q.type.isManual { manualBody }
                else { scaleBody }
            }

            // explanation
            if !q.explanation.isEmpty {
                Text(q.explanation).font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 38).padding(.top, 16)
                    .overlay(Rectangle().fill(Nuru.border).frame(height: 1).padding(.leading, 38), alignment: .bottom)
            }

            // footer controls
            HStack {
                HStack(spacing: 14) {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles").font(.system(size: 11)).foregroundStyle(Nuru.gold)
                        Text("\(q.points)").font(.inter(13, .semibold)).foregroundStyle(Nuru.foreground)
                        Text("pts").font(.inter(11.5)).foregroundStyle(Nuru.ink600)
                    }
                    Text("Required").font(.inter(12, .semibold))
                        .foregroundStyle(q.required ? Nuru.navy : Nuru.ink600)
                    Text(q.active ? "Active" : "Draft").font(.inter(12, .semibold))
                        .foregroundStyle(q.active ? Nuru.navy : Nuru.ink600)
                }
                Spacer()
                HStack(spacing: 4) {
                    iconBtn("chevron.up", disabled: index == 0)
                    iconBtn("chevron.down", disabled: index == total - 1)
                    iconBtn("doc.on.doc")
                    iconBtn("trash", tone: Color(hex: 0xDC2626))
                    Button("Close", action: onToggle).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink600)
                }
            }
            .padding(.top, 16).padding(.leading, 38)
            .overlay(Rectangle().fill(Nuru.border).frame(height: 1).padding(.leading, 38), alignment: .top)
        }
        .padding(.init(top: 18, leading: 24, bottom: 18, trailing: 20))
    }

    private var choiceBody: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(q.options) { opt in
                HStack(spacing: 12) {
                    ZStack {
                        if opt.isCorrect {
                            (q.type.isMulti ? MarkerShape(RoundedRectangle(cornerRadius: 4)) : MarkerShape(Circle()))
                                .fill(Color(hex: 0x16A34A))
                            Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                        } else {
                            (q.type.isMulti ? MarkerShape(RoundedRectangle(cornerRadius: 4)) : MarkerShape(Circle()))
                                .stroke(Color(hex: 0xC9CFD6), lineWidth: 2)
                        }
                    }.frame(width: 20, height: 20)
                    Text(opt.text.isEmpty ? "Option text" : opt.text)
                        .font(.inter(13.5)).foregroundStyle(opt.text.isEmpty ? Nuru.ink400 : Nuru.foreground)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 8).padding(.vertical, 6)
            }
            Text("Add option").font(.inter(13)).foregroundStyle(Nuru.ink600)
                .padding(.leading, 32).padding(.vertical, 4)
        }
        .padding(.leading, 38)
    }

    private var manualBody: some View {
        HStack(spacing: 8) {
            Image(systemName: "info.circle").font(.system(size: 12)).foregroundStyle(Color(hex: 0x0F6B33))
            Text("Reviewer scores this manually — no auto-grading.")
                .font(.inter(12.5)).foregroundStyle(Color(hex: 0x0F6B33))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Color(hex: 0x16A34A).opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Color(hex: 0x16A34A).opacity(0.18), lineWidth: 1))
        .padding(.leading, 38)
    }

    private var scaleBody: some View {
        let valid = q.minVal < q.maxVal
        let steps = valid ? Array(q.minVal...q.maxVal) : []
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                scaleField("From", "\(q.minVal)", width: 72)
                scaleField("To", "\(q.maxVal)", width: 72)
                scaleField("Low label", q.minLabel.isEmpty ? "e.g. Strongly disagree" : q.minLabel)
                scaleField("High label", q.maxLabel.isEmpty ? "e.g. Strongly agree" : q.maxLabel)
            }
            if valid {
                HStack {
                    Text(q.minLabel.isEmpty ? "\(q.minVal)" : q.minLabel)
                        .font(.inter(11)).foregroundStyle(Nuru.ink600).frame(minWidth: 60, alignment: .leading)
                    Spacer()
                    HStack(spacing: 14) {
                        ForEach(steps, id: \.self) { n in
                            VStack(spacing: 4) {
                                Circle().stroke(Color(hex: 0xC9CFD6), lineWidth: 2).frame(width: 18, height: 18)
                                Text("\(n)").font(.inter(11)).foregroundStyle(Nuru.ink600)
                            }
                        }
                    }
                    Spacer()
                    Text(q.maxLabel.isEmpty ? "\(q.maxVal)" : q.maxLabel)
                        .font(.inter(11)).foregroundStyle(Nuru.ink600).frame(minWidth: 60, alignment: .trailing)
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            } else {
                Text("\u{201C}From\u{201D} must be less than \u{201C}To\u{201D}.")
                    .font(.inter(12)).foregroundStyle(Color(hex: 0xDC2626))
            }
        }
        .padding(.leading, 38)
    }

    private func scaleField(_ label: String, _ value: String, width: CGFloat? = nil) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            fieldLabel(label)
            Text(value).font(.inter(13)).foregroundStyle(Nuru.foreground)
                .frame(width: width, height: 34)
                .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
                .padding(.horizontal, width == nil ? 10 : 0)
                .multilineTextAlignment(width == nil ? .leading : .center)
                .background(Nuru.background)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }

    private func iconBtn(_ name: String, disabled: Bool = false, tone: Color = Nuru.navy) -> some View {
        Image(systemName: name).font(.system(size: 13))
            .foregroundStyle(tone).frame(width: 28, height: 28)
            .opacity(disabled ? 0.3 : 1)
    }
}

// MARK: - Small shared bits

private struct Banner: View {
    enum Tone { case ok, err }
    let tone: Tone
    let text: String
    var body: some View {
        let ok = tone == .ok
        return Text(text).font(.inter(12.5))
            .foregroundStyle(ok ? Color(hex: 0x0F6B33) : Color(hex: 0xA8281F))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(ok ? Color(hex: 0xF3FAF5) : Color(hex: 0xFDF4F4))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(ok ? Color(hex: 0xCDEBD8) : Color(hex: 0xF2D5D2), lineWidth: 1))
    }
}

private func fieldLabel(_ s: String) -> some View {
    Text(s.uppercased()).font(.inter(10.5, .bold)).tracking(0.4).foregroundStyle(Nuru.ink600)
}

// MARK: - View helpers

private extension View {
    @ViewBuilder func `if`<T: View>(_ cond: Bool, _ transform: (Self) -> T) -> some View {
        if cond { transform(self) } else { self }
    }
}

/// Type-erased Shape so a radio vs checkbox marker can switch shape inline.
private struct MarkerShape: Shape {
    private let pathFn: (CGRect) -> Path
    init<S: Shape>(_ s: S) { pathFn = { s.path(in: $0) } }
    func path(in rect: CGRect) -> Path { pathFn(rect) }
}

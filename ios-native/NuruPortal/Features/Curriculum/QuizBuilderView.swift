// Level Quiz Builder — native SwiftUI port of the web admin page
// (packages/admin-web/src/components/pages/QuizBuilder.tsx +
//  packages/admin-web/src/components/curriculum/ModuleQuizBuilder.tsx).
//
// Server-authoritative model (§1.9): the "level quiz" is the level's exit-exam
// module's question bank plus the level's exam settings (pass mark + reveal/shuffle
// flags). This view loads levels, resolves each level's exit_exam module, loads
// that module's questions/options, and surfaces the exam settings — and now
// FULLY WIRES the mutations, line-by-line from the web ModuleQuizBuilder/QuizBuilder:
//   • Add question (+ type menu), edit text/options/points/required/active,
//     mark-correct, delete/duplicate/move, then Save:
//       POST   /admin/modules/{id}/questions { questions: [toPayload…] }   (new rows)
//       PUT    /admin/questions/{qid}        { toPayload }                 (edits)
//       DELETE /admin/questions/{qid}                                      (removals)
//   • Exam settings (pass-mark slider, time limit, shuffle, show-answers,
//     show-score) → PUT /admin/levels/{n}/exam
//   • "Create level exam" → POST /admin/modules (exit_exam module)
//
// Layout: navy hero (counts) → 3-pane on iPad (level list | editor | settings),
// stacked sections when narrow. Uses the shared kit only (NuruTheme/Components/
// Models/Networking) without editing it; exam-settings + answer-option shapes
// that the shared AdminLevel/AdminQuestion models don't carry are decoded by
// PAGE-LOCAL Codable structs fetched via APIClient.shared.get, and writes go
// through the actor post/put/delete with PAGE-LOCAL Encodable bodies.
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
    var id: String
    var text: String
    var isCorrect: Bool
}

private func newOptId() -> String { "opt-\(UUID().uuidString.prefix(6))" }

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
        case .checkbox: return Nuru.navy           // was off-brand blue 0x0B84E8 → brand navy
        case .dropdown: return Color(hex: 0x0EA5A4)
        case .shortAnswer: return Color(hex: 0x16A34A)
        case .paragraph: return Color(hex: 0xD97706)
        case .linearScale: return Color(hex: 0xDB2777)
        }
    }
    static let all: [QType] = [.multipleChoice, .checkbox, .dropdown, .shortAnswer, .paragraph, .linearScale]
}

/// Decoded, EDITABLE question (fromApi parity + stable local key like the web `key`).
/// `questionId` is nil for rows created in this session (POST), set for edits (PUT).
private struct VModelQuestion: Identifiable {
    let key: String          // stable local identity for ForEach/expanded
    var questionId: String?  // nil ⇒ new (POST); set ⇒ existing (PUT/DELETE)
    var type: QType
    var text: String
    var options: [QOption]
    var points: Int
    var required: Bool
    var explanation: String
    var active: Bool
    var minVal: Int
    var maxVal: Int
    var minLabel: String
    var maxLabel: String
    var id: String { key }

    /// fromApi(a) — decode a question row into the editable model.
    static func from(_ a: QBQuestion) -> VModelQuestion {
        let type = QType.decode(a.qType)
        let options = type.isChoice ? decodeChoices(a) : []
        let scale = decodeScale(a)
        return VModelQuestion(
            key: a.questionId,
            questionId: a.questionId,
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

    /// blank(type) parity — a fresh local question of the given type.
    static func blank(_ type: QType) -> VModelQuestion {
        VModelQuestion(
            key: "local-\(UUID().uuidString)",
            questionId: nil,
            type: type,
            text: "",
            options: type.isChoice
                ? [QOption(id: newOptId(), text: "Option 1", isCorrect: type != .checkbox),
                   QOption(id: newOptId(), text: "Option 2", isCorrect: false)]
                : [],
            points: 1, required: true, explanation: "", active: true,
            minVal: 1, maxVal: 5, minLabel: "", maxLabel: ""
        )
    }

    /// toPayload(q) parity — the create/update body for one question.
    func toPayload() -> [String: JSONValue] {
        let trimmedExplanation = explanation.trimmingCharacters(in: .whitespacesAndNewlines)
        var base: [String: JSONValue] = [
            "qType": .string(type.rawValue),
            "questionText": .string(text.trimmingCharacters(in: .whitespacesAndNewlines)),
            "points": .int(points),
            "required": .bool(required),
            "explanation": trimmedExplanation.isEmpty ? .null : .string(trimmedExplanation),
            "isActive": .bool(active),
        ]
        if type.isChoice {
            let opts = options
                .filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                .map { o -> JSONValue in
                    .object([
                        "id": .string(o.id),
                        "text": .string(o.text.trimmingCharacters(in: .whitespacesAndNewlines)),
                        "isCorrect": .bool(o.isCorrect),
                    ])
                }
            base["options"] = .array(opts)
        } else if type == .linearScale {
            base["scaleMin"] = .int(minVal)
            base["scaleMax"] = .int(maxVal)
            base["scaleMinLabel"] = minLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .null : .string(minLabel.trimmingCharacters(in: .whitespacesAndNewlines))
            base["scaleMaxLabel"] = maxLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .null : .string(maxLabel.trimmingCharacters(in: .whitespacesAndNewlines))
        } else if type == .shortAnswer {
            base["correctAnswer"] = .string("") // reviewer-scored; no key from this UI
        }
        return base
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
    var passMark: Int
    var shuffleQuestions: Bool
    var showAnswersAfterSubmit: Bool
    var showScoreAfterSubmit: Bool
    var timeLimitMinutes: Int?

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

// MARK: - JSON write body (nested; encoder is convertToSnakeCase ⇒ camelCase keys snake)

/// Page-local JSON value supporting nested objects/arrays for question payloads.
/// The actor encoder applies `.convertToSnakeCase`, so dictionary keys are written
/// camelCase here (qType → q_type, isCorrect → is_correct, scaleMin → scale_min…).
private indirect enum JSONValue: Encodable {
    case string(String), int(Int), bool(Bool), null
    case array([JSONValue]), object([String: JSONValue])
    func encode(to encoder: Encoder) throws {
        switch self {
        case .string(let v): var c = encoder.singleValueContainer(); try c.encode(v)
        case .int(let v):    var c = encoder.singleValueContainer(); try c.encode(v)
        case .bool(let v):   var c = encoder.singleValueContainer(); try c.encode(v)
        case .null:          var c = encoder.singleValueContainer(); try c.encodeNil()
        case .array(let a):  var c = encoder.unkeyedContainer(); for v in a { try c.encode(v) }
        case .object(let o):
            var c = encoder.container(keyedBy: DynKey.self)
            for (k, v) in o { try c.encode(v, forKey: DynKey(k)) }
        }
    }
    private struct DynKey: CodingKey {
        var stringValue: String; var intValue: Int? { nil }
        init(_ s: String) { stringValue = s }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }
}

/// Body for the bulk add: POST /admin/modules/{id}/questions { questions: [...] }.
private struct AddQuestionsBody: Encodable {
    let questions: [[String: JSONValue]]
    enum CodingKeys: String, CodingKey { case questions }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(questions.map { JSONValue.object($0) }, forKey: .questions)
    }
}

/// Body for PUT /admin/levels/{n}/exam (updateExam parity).
private struct UpdateExamBody: Encodable {
    let requiredExamPassMark: Int
    let examQuestionCount: Int
    let examShuffle: Bool
    let examShowAnswers: Bool
    let examShowScore: Bool
}

/// Body for POST /admin/modules (createModule parity — the exit_exam module).
private struct CreateExamModuleBody: Encodable {
    let levelNumber: Int
    let title: String
    let lessonContent: String
    let evaluationKind: String
}

/// Tolerant response decode for writes we don't read back (never plain defaults).
private struct WriteAck: Codable {
    var added: Int?
    var deleted: Bool?
    var moduleId: String?
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
    // draft/archived — was off-brand blue tint (0xEEF1F8 / 0x1F3A6B); now brand navy pair (Nuru.brandTint(2))
    default:          return StatusStyle(bg: Nuru.brandTint(2).bg, fg: Nuru.brandTint(2).fg)
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
    @State private var creatingExam = false

    private var selLevel: QBLevel? { levels.first { $0.levelNumber == selNo } }
    private var publishedCount: Int { levels.filter { $0.status == "published" }.count }

    var body: some View {
        GeometryReader { geo in
            let wide = geo.size.width >= 880
            VStack(spacing: 0) {
                hero
                statStrip
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
        // Compact hero — no half-screen stat strip; the two counts live in the
        // tight `statStrip` below so the 3-pane editor sits high on the canvas.
        PortalHero(
            breadcrumb: ["Curriculum", "Level Quiz Builder"],
            title: "Level Quiz Builder",
            subtitle: "Build the final assessment disciples take after completing a level."
        )
    }

    /// Compact two-tile stat strip (~90pt) — replaces the two half-screen
    /// near-empty hero cards. Small tiles in an HStack, sized to content.
    private var statStrip: some View {
        HStack(spacing: Nuru.S.md) {
            statTile("LEVELS", "\(levels.count)", "Total", "square.stack.3d.up.fill", Nuru.navy)
            statTile("PUBLISHED", "\(publishedCount)", "Live", "checkmark.seal.fill", Nuru.gold)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Nuru.S.lg)
        .padding(.vertical, Nuru.S.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .overlay(Rectangle().fill(Nuru.border).frame(height: 1), alignment: .bottom)
    }

    private func statTile(_ label: String, _ value: String, _ hint: String, _ icon: String, _ tint: Color) -> some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(tint.opacity(0.12))
                Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(tint)
            }.frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 0) {
                Text(label).font(.inter(9.5, .bold)).tracking(0.8).foregroundStyle(Nuru.ink600)
                Text(value).font(.fraunces(22, .medium)).foregroundStyle(Nuru.navy)
                Text(hint).font(.inter(10)).foregroundStyle(Nuru.ink600)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .frame(minWidth: 150, alignment: .leading)
        .background(Nuru.mutedBg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
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
                VStack(spacing: 6) {
                    ForEach(levels) { l in levelCard(l) }
                }
                .padding(10)
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
            HStack(alignment: .top, spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(l.locked ? AnyShapeStyle(Nuru.mutedBg) : AnyShapeStyle(lc))
                    if l.locked {
                        Image(systemName: "lock.fill").font(.system(size: 12)).foregroundStyle(.white)
                    } else {
                        Text("\(l.levelNumber)").font(.fraunces(14, .medium)).foregroundStyle(.white)
                    }
                }
                .frame(width: 32, height: 32)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text("LEVEL \(l.levelNumber)").font(.inter(9.5, .bold)).tracking(0.8)
                            .foregroundStyle(lc)
                        Text(qbStatusLabel[l.status] ?? l.status).font(.inter(9, .bold))
                            .foregroundStyle(ss.fg)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(ss.bg).clipShape(Capsule())
                        Spacer(minLength: 0)
                        if sel {
                            ZStack {
                                Circle().fill(lc)
                                Image(systemName: "checkmark").font(.system(size: 8, weight: .heavy)).foregroundStyle(.white)
                            }.frame(width: 18, height: 18)
                        }
                    }
                    Text(l.title).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                        .lineLimit(2).multilineTextAlignment(.leading)
                    HStack(spacing: 10) {
                        Label("\(modules) modules", systemImage: "book")
                            .labelStyle(.titleAndIcon).font(.inter(10)).foregroundStyle(Nuru.ink600)
                        Label(l.duration ?? "—", systemImage: "clock")
                            .labelStyle(.titleAndIcon).font(.inter(10)).foregroundStyle(Nuru.ink600)
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
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
            ModuleQuizEditor(
                moduleId: moduleId,
                levelNo: lvl.levelNumber,
                accent: Color(hexString: lvl.color),
                initialSettings: ExamSettings.from(lvl),
                onSavedSettings: { s in applySavedSettings(lvl.levelNumber, s) }
            )
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
                    // createExam() — POST /admin/modules to create the exit_exam module.
                    Button { Task { await createExam() } } label: {
                        HStack(spacing: 6) {
                            if creatingExam {
                                ProgressView().controlSize(.small).tint(.white)
                            } else {
                                Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                            }
                            Text(creatingExam ? "Creating…" : "Create level exam").font(.inter(13, .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18).frame(height: 40)
                        .background(Nuru.gold).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(creatingExam)
                    .padding(.top, 8)
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

    /// createExam() — POST /admin/modules { level_number, title, lesson_content,
    /// evaluation_kind: "exit_exam" }, then re-resolve so the editor mounts.
    private func createExam() async {
        guard let n = selNo else { return }
        await MainActor.run { creatingExam = true; loadError = nil }
        do {
            _ = try await APIClient.shared.post(
                "/admin/modules",
                body: CreateExamModuleBody(
                    levelNumber: n,
                    title: "Level \(n) — Final Assessment",
                    lessonContent: "Level exit exam.",
                    evaluationKind: "exit_exam"
                ),
                as: WriteAck.self
            )
            await MainActor.run { creatingExam = false }
            await resolveExam(n)
        } catch {
            await MainActor.run {
                loadError = (error as? APIError)?.errorDescription ?? "Could not create the level exam."
                creatingExam = false
            }
        }
    }

    /// Reflect saved exam settings on the level row (setLevels parity) so
    /// re-selecting the level shows the persisted pass mark / flags.
    private func applySavedSettings(_ levelNo: Int, _ s: ExamSettings) {
        guard let i = levels.firstIndex(where: { $0.levelNumber == levelNo }) else { return }
        levels[i].requiredExamPassMark = String(s.passMark)
        levels[i].examShuffle = s.shuffleQuestions
        levels[i].examShowAnswers = s.showAnswersAfterSubmit
        levels[i].examShowScore = s.showScoreAfterSubmit
    }
}

// MARK: - Module quiz editor (ModuleQuizBuilder parity)

private struct ModuleQuizEditor: View {
    let moduleId: String
    let levelNo: Int
    let accent: Color
    let initialSettings: ExamSettings
    let onSavedSettings: (ExamSettings) -> Void

    @State private var questions: [VModelQuestion] = []
    @State private var settings: ExamSettings
    @State private var deleted: [String] = []      // questionIds removed this session
    @State private var expanded: String?
    @State private var loading = true
    @State private var saving = false
    @State private var notice: String?
    @State private var error: String?

    init(moduleId: String, levelNo: Int, accent: Color, initialSettings: ExamSettings, onSavedSettings: @escaping (ExamSettings) -> Void) {
        self.moduleId = moduleId
        self.levelNo = levelNo
        self.accent = accent
        self.initialSettings = initialSettings
        self.onSavedSettings = onSavedSettings
        _settings = State(initialValue: initialSettings)
    }

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
                    if let notice { Banner(tone: .ok, text: notice) }
                    if let error { Banner(tone: .err, text: error) }
                    summaryCard
                    // Exam Settings relocated to the TOP — a row of small setting
                    // cards (columns) instead of a stacked side panel. Same bindings.
                    examSettingsBar
                    questionsColumn
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
            // Add toolbar — Add question (+type menu) + Save.
            HStack {
                Menu {
                    ForEach(QType.all, id: \.self) { t in
                        Button { add(t) } label: {
                            Label("\(t.label) — \(t.hint)", systemImage: t.icon)
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                        Text("Add question").font(.inter(13, .semibold))
                        Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).frame(height: 36)
                    .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                Spacer()
                Button { Task { await save() } } label: {
                    HStack(spacing: 6) {
                        if saving {
                            ProgressView().controlSize(.small).tint(.white)
                        } else {
                            Image(systemName: "square.and.arrow.down").font(.system(size: 12, weight: .bold))
                        }
                        Text(saving ? "Saving…" : "Save").font(.inter(13, .bold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).frame(height: 36)
                    .background(accent).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .opacity(saving ? 0.6 : 1)
                }
                .buttonStyle(.plain)
                .disabled(saving)
            }

            ForEach($questions) { $q in
                let idx = questions.firstIndex(where: { $0.key == q.key }) ?? 0
                QuestionCard(
                    q: $q, index: idx, total: questions.count, accent: accent,
                    expanded: expanded == q.key,
                    onToggle: { expanded = (expanded == q.key) ? nil : q.key },
                    onRemove: { remove(q) },
                    onDuplicate: { duplicate(q.key) },
                    onMove: { dir in move(q.key, dir) }
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

    // MARK: Exam settings bar (relocated to TOP; small setting CARDS in columns)

    /// Exam Settings as a row of compact column tiles (was a stacked side panel).
    /// Same bound `settings` state and same Save call — only the layout changed:
    /// Pass mark · Time limit · Shuffle · Show answers · Show score, each its own
    /// small card. A LazyVGrid lays them as 3–4 columns at portrait width (~740pt).
    private var examSettingsBar: some View {
        Card(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                Text("EXAM SETTINGS").font(.inter(10.5, .heavy)).tracking(0.9)
                    .foregroundStyle(Nuru.navy)
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 168), spacing: 12)],
                    alignment: .leading, spacing: 12
                ) {
                    passMarkTile
                    timeLimitTile
                    toggleTile("shuffle", "Shuffle questions", $settings.shuffleQuestions)
                    toggleTile("eye", "Show answers after submit", $settings.showAnswersAfterSubmit)
                    toggleTile("chart.bar", "Show score after submit", $settings.showScoreAfterSubmit)
                }
            }
        }
    }

    /// Wrapper that gives each setting tile the same card chrome + fixed height.
    private func settingTile<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            content()
        }
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
        .padding(.horizontal, 12).padding(.vertical, 11)
        .background(Nuru.background)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1.5))
    }

    // Pass-mark tile — keeps the bound slider (load-bearing for Save).
    private var passMarkTile: some View {
        settingTile {
            fieldLabel("Pass mark")
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(settings.passMark)%").font(.fraunces(22, .medium)).foregroundStyle(Nuru.navy)
                Spacer(minLength: 0)
                Text("\(passingPoints)/\(totalPoints) pts").font(.inter(10)).foregroundStyle(Nuru.ink600)
                    .lineLimit(1).minimumScaleFactor(0.85)
            }
            Slider(
                value: Binding(
                    get: { Double(settings.passMark) },
                    set: { settings.passMark = Int($0) }
                ),
                in: 0...100, step: 5
            ).tint(Nuru.gold)
        }
    }

    // Time-limit tile — on/off toggle + minutes field.
    private var timeLimitTile: some View {
        settingTile {
            fieldLabel("Time limit")
            HStack(spacing: 8) {
                Button {
                    settings.timeLimitMinutes = settings.timeLimitMinutes == nil ? 15 : nil
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "clock").font(.system(size: 12))
                        Text(settings.timeLimitMinutes != nil ? "On" : "Off").font(.inter(12, .semibold))
                    }
                    .foregroundStyle(settings.timeLimitMinutes != nil ? .white : Nuru.ink600)
                    .padding(.horizontal, 10).frame(height: 32)
                    .background(settings.timeLimitMinutes != nil ? AnyShapeStyle(Nuru.gold) : AnyShapeStyle(Nuru.white))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
                if settings.timeLimitMinutes != nil {
                    TextField("15", value: Binding(
                        get: { settings.timeLimitMinutes ?? 15 },
                        set: { settings.timeLimitMinutes = max(1, min(120, $0)) }
                    ), format: .number)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.center)
                        .font(.inter(13)).foregroundStyle(Nuru.foreground)
                        .frame(width: 52, height: 32)
                        .background(Nuru.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1.5))
                    Text("min").font(.inter(11)).foregroundStyle(Nuru.ink600)
                } else {
                    Text("No limit").font(.inter(11)).foregroundStyle(Nuru.ink600)
                }
                Spacer(minLength: 0)
            }
        }
    }

    /// One boolean setting as its own small column tile (label + Toggle-style switch).
    private func toggleTile(_ icon: String, _ label: String, _ on: Binding<Bool>) -> some View {
        Button { on.wrappedValue.toggle() } label: {
            settingTile {
                HStack(spacing: 6) {
                    Image(systemName: icon).font(.system(size: 12))
                        .foregroundStyle(on.wrappedValue ? Nuru.gold : Nuru.ink600)
                    Spacer(minLength: 0)
                    ZStack(alignment: on.wrappedValue ? .trailing : .leading) {
                        Capsule().fill(on.wrappedValue ? AnyShapeStyle(Nuru.gold) : AnyShapeStyle(Color(hex: 0xD1D5DB)))
                            .frame(width: 32, height: 18)
                        Circle().fill(.white).frame(width: 14, height: 14).padding(2)
                    }
                    .frame(width: 32, height: 18)
                }
                Spacer(minLength: 0)
                Text(label).font(.inter(12, .semibold)).foregroundStyle(Nuru.foreground)
                    .lineLimit(2).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: Mutations (local; persisted on Save — ModuleQuizBuilder parity)

    private func add(_ type: QType) {
        let q = VModelQuestion.blank(type)
        questions.append(q)
        expanded = q.key
    }
    private func duplicate(_ key: String) {
        guard let idx = questions.firstIndex(where: { $0.key == key }) else { return }
        var copy = questions[idx]
        copy = VModelQuestion(
            key: "local-\(UUID().uuidString)",
            questionId: nil,
            type: copy.type,
            text: copy.text.isEmpty ? "" : "\(copy.text) (copy)",
            options: copy.options.map { QOption(id: newOptId(), text: $0.text, isCorrect: $0.isCorrect) },
            points: copy.points, required: copy.required, explanation: copy.explanation,
            active: copy.active, minVal: copy.minVal, maxVal: copy.maxVal,
            minLabel: copy.minLabel, maxLabel: copy.maxLabel
        )
        questions.insert(copy, at: idx + 1)
    }
    private func move(_ key: String, _ dir: Int) {
        guard let idx = questions.firstIndex(where: { $0.key == key }) else { return }
        let swap = idx + dir
        guard swap >= 0, swap < questions.count else { return }
        questions.swapAt(idx, swap)
    }
    private func remove(_ q: VModelQuestion) {
        if let qid = q.questionId { deleted.append(qid) }
        questions.removeAll { $0.key == q.key }
        if expanded == q.key { expanded = nil }
    }

    // MARK: Data

    private func load() async {
        await MainActor.run { loading = true; error = nil; notice = nil; deleted = []; expanded = nil }
        do {
            let list = try await APIClient.shared.get("/admin/modules/\(moduleId)/questions", as: QBQuestionList.self)
            let mapped = list.data.map(VModelQuestion.from)
            await MainActor.run {
                questions = mapped
                expanded = mapped.first?.key
                loading = false
            }
        } catch {
            await MainActor.run {
                self.error = (error as? APIError)?.errorDescription ?? "Could not load questions."
                loading = false
            }
        }
    }

    /// save() — ModuleQuizBuilder.save parity:
    ///   1. PUT /admin/levels/{n}/exam (settings + active count)
    ///   2. DELETE /admin/questions/{qid} for each removed row
    ///   3. POST /admin/modules/{id}/questions { questions:[…] } for new rows
    ///   4. PUT /admin/questions/{qid} for each edited row
    ///   then reload, and surface a skipped-count notice.
    private func save() async {
        await MainActor.run { saving = true; error = nil; notice = nil }
        let snapshotSettings = settings
        let activeCount = active.count
        let valid = questions.filter { $0.isValid }
        let fresh = valid.filter { $0.questionId == nil }
        let edits = valid.filter { $0.questionId != nil }
        let toDelete = deleted
        let skipped = questions.count - valid.count
        do {
            // 1. settings → updateExam
            _ = try await APIClient.shared.put(
                "/admin/levels/\(levelNo)/exam",
                body: UpdateExamBody(
                    requiredExamPassMark: snapshotSettings.passMark,
                    examQuestionCount: activeCount,
                    examShuffle: snapshotSettings.shuffleQuestions,
                    examShowAnswers: snapshotSettings.showAnswersAfterSubmit,
                    examShowScore: snapshotSettings.showScoreAfterSubmit
                ),
                as: WriteAck.self
            )
            // 2. deletions
            for qid in toDelete {
                _ = try await APIClient.shared.delete("/admin/questions/\(qid)", as: WriteAck.self)
            }
            // 3. new rows (bulk)
            if !fresh.isEmpty {
                _ = try await APIClient.shared.post(
                    "/admin/modules/\(moduleId)/questions",
                    body: AddQuestionsBody(questions: fresh.map { $0.toPayload() }),
                    as: WriteAck.self
                )
            }
            // 4. edits
            for q in edits {
                guard let qid = q.questionId else { continue }
                _ = try await APIClient.shared.put("/admin/questions/\(qid)", body: q.toPayload(), as: WriteAck.self)
            }
            await MainActor.run { onSavedSettings(snapshotSettings) }
            await load()
            await MainActor.run {
                notice = skipped > 0
                    ? "Saved. \(skipped) question(s) still need a valid answer and were skipped."
                    : "Saved."
                saving = false
            }
        } catch {
            await MainActor.run {
                self.error = (error as? APIError)?.errorDescription ?? "Save failed."
                saving = false
            }
        }
    }
}

// MARK: - Question card (QCard parity)

private struct QuestionCard: View {
    @Binding var q: VModelQuestion
    let index: Int
    let total: Int
    let accent: Color
    let expanded: Bool
    let onToggle: () -> Void
    let onRemove: () -> Void
    let onDuplicate: () -> Void
    let onMove: (Int) -> Void

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

    // expanded editor (fully editable controls)
    private var expandedBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(index + 1).").font(.fraunces(18, .medium)).foregroundStyle(Nuru.ink600)
                    .frame(minWidth: 26, alignment: .leading).padding(.top, 6)
                TextField("Question text", text: $q.text, axis: .vertical)
                    .lineLimit(2...4)
                    .font(.inter(15, .medium)).foregroundStyle(Nuru.navy)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                Menu {
                    ForEach(QType.all, id: \.self) { t in
                        Button(t.label) { setType(t) }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(q.type.label).font(.inter(12.5)).foregroundStyle(Nuru.foreground)
                        Image(systemName: "chevron.down").font(.system(size: 9)).foregroundStyle(Nuru.ink600)
                    }
                    .padding(.horizontal, 12).frame(height: 38)
                    .background(Nuru.background)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }
            }
            .padding(.bottom, 14)

            // body by type
            Group {
                if q.type.isChoice { choiceBody }
                else if q.type.isManual { manualBody }
                else { scaleBody }
            }

            // explanation
            TextField("Explanation (shown after submit)", text: $q.explanation, axis: .vertical)
                .lineLimit(1...3)
                .font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 38).padding(.top, 16)
                .overlay(Rectangle().fill(Nuru.border).frame(height: 1).padding(.leading, 38), alignment: .bottom)

            // footer controls
            HStack {
                HStack(spacing: 14) {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles").font(.system(size: 11)).foregroundStyle(Nuru.gold)
                        Stepper(value: $q.points, in: 1...100) {
                            Text("\(q.points)").font(.inter(13, .semibold)).foregroundStyle(Nuru.foreground)
                        }
                        .labelsHidden()
                        Text("\(q.points)").font(.inter(13, .semibold)).foregroundStyle(Nuru.foreground)
                        Text("pts").font(.inter(11.5)).foregroundStyle(Nuru.ink600)
                    }
                    Button { q.required.toggle() } label: {
                        Text("Required").font(.inter(12, .semibold))
                            .foregroundStyle(q.required ? Nuru.navy : Nuru.ink600)
                    }.buttonStyle(.plain)
                    Button { q.active.toggle() } label: {
                        Text(q.active ? "Active" : "Draft").font(.inter(12, .semibold))
                            .foregroundStyle(q.active ? Nuru.navy : Nuru.ink600)
                    }.buttonStyle(.plain)
                }
                Spacer()
                HStack(spacing: 4) {
                    iconBtn("chevron.up", disabled: index == 0) { onMove(-1) }
                    iconBtn("chevron.down", disabled: index == total - 1) { onMove(1) }
                    iconBtn("doc.on.doc") { onDuplicate() }
                    iconBtn("trash", tone: Color(hex: 0xDC2626)) { onRemove() }
                    Button("Close", action: onToggle).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink600)
                }
            }
            .padding(.top, 16).padding(.leading, 38)
            .overlay(Rectangle().fill(Nuru.border).frame(height: 1).padding(.leading, 38), alignment: .top)
        }
        .padding(.init(top: 18, leading: 24, bottom: 18, trailing: 20))
    }

    // setType(type) parity — switch type, seeding options for choice types.
    private func setType(_ type: QType) {
        q.type = type
        if type.isChoice {
            if q.options.isEmpty {
                q.options = [
                    QOption(id: newOptId(), text: "Option 1", isCorrect: type != .checkbox),
                    QOption(id: newOptId(), text: "Option 2", isCorrect: false),
                ]
            }
        } else {
            q.options = []
        }
    }
    // toggleCorrect(id) parity — radio (single) vs checkbox (multi).
    private func toggleCorrect(_ id: String) {
        q.options = q.options.map { o in
            if q.type.isMulti {
                return o.id == id ? QOption(id: o.id, text: o.text, isCorrect: !o.isCorrect) : o
            } else {
                return QOption(id: o.id, text: o.text, isCorrect: o.id == id)
            }
        }
    }

    private var choiceBody: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach($q.options) { $opt in
                HStack(spacing: 12) {
                    Button { toggleCorrect(opt.id) } label: {
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
                    }.buttonStyle(.plain)
                    TextField("Option text", text: $opt.text)
                        .font(.inter(13.5)).foregroundStyle(Nuru.foreground)
                    Spacer(minLength: 0)
                    if q.options.count > 1 {
                        Button { q.options.removeAll { $0.id == opt.id } } label: {
                            Image(systemName: "trash").font(.system(size: 12)).foregroundStyle(Nuru.ink600)
                        }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 8).padding(.vertical, 6)
            }
            Button {
                q.options.append(QOption(id: newOptId(), text: "Option \(q.options.count + 1)", isCorrect: false))
            } label: {
                Text("Add option").font(.inter(13)).foregroundStyle(Nuru.ink600)
                    .padding(.leading, 32).padding(.vertical, 4)
            }.buttonStyle(.plain)
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
                scaleNum("From", value: $q.minVal)
                scaleNum("To", value: $q.maxVal)
                scaleText("Low label", value: $q.minLabel, placeholder: "e.g. Strongly disagree")
                scaleText("High label", value: $q.maxLabel, placeholder: "e.g. Strongly agree")
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

    private func scaleNum(_ label: String, value: Binding<Int>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            fieldLabel(label)
            TextField("", value: value, format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.center)
                .font(.inter(13)).foregroundStyle(Nuru.foreground)
                .frame(width: 72, height: 34)
                .background(Nuru.background)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
    }
    private func scaleText(_ label: String, value: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            fieldLabel(label)
            TextField(placeholder, text: value)
                .font(.inter(13)).foregroundStyle(Nuru.foreground)
                .frame(height: 34)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .background(Nuru.background)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func iconBtn(_ name: String, disabled: Bool = false, tone: Color = Nuru.navy, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name).font(.system(size: 13))
                .foregroundStyle(tone).frame(width: 28, height: 28)
                .opacity(disabled ? 0.3 : 1)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
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

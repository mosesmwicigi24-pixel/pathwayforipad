// Level Quiz Builder — the SPECIALIZED exam editor (docs/CURRICULUM_ARCHITECTURE.md
// §5.2): the level's exit-exam question bank + exam settings + the review→publish
// gate. Since the two-workspace re-architecture it is CONTEXT-AWARE — launched
// from the workspace (NavRouter.openQuizBuilder(level:)) with the level already
// selected, so it never asks the admin to re-select what the click already knew.
// It no longer has a sidebar entry; the level rail remains for switching levels
// mid-session.
//
// Server-authoritative model (§1.9): the "level quiz" is the level's exit-exam
// module's question bank plus the level's exam settings. The question editing UI
// lives in QuestionBankKit (ONE question editor per surface, §2.5) mounted here
// in exam mode; this file owns level resolution + exam creation + the publish gate.
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
    var examStatus: String?   // "review" | "published" — the member-visibility gate
    var id: Int { levelNumber }

    enum CodingKeys: String, CodingKey {
        case levelNumber, title, theme, duration, status, locked, color
        case publishedCount, draftCount
        case requiredExamPassMark, examQuestionCount, examShowAnswers, examShowScore, examShuffle, examStatus
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
        examStatus = try? c.decodeIfPresent(String.self, forKey: .examStatus)
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

/// examSettings(lvl) defaults: passMark 80, shuffle false, showAnswers false,
/// showScore true, no client time limit.
private func examSettings(_ l: QBLevel) -> ExamSettings {
    ExamSettings(
        passMark: Int((l.requiredExamPassMark.flatMap { Double($0) }) ?? 80),
        shuffleQuestions: l.examShuffle ?? false,
        showAnswersAfterSubmit: l.examShowAnswers ?? false,
        showScoreAfterSubmit: l.examShowScore ?? true,
        timeLimitMinutes: nil
    )
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
    default:          return StatusStyle(bg: Color(hex: 0xF1EEE7), fg: Color(hex: 0x6B5E45))
    }
}

// MARK: - Root

struct QuizBuilderView: View {
    @EnvironmentObject private var router: NavRouter

    @State private var levels: [QBLevel] = []
    @State private var selNo: Int?
    @State private var examModuleId: String?
    @State private var examMissing = false
    @State private var resolving = false
    @State private var loadError: String?
    @State private var didLoad = false
    @State private var creatingExam = false
    @State private var togglingPublish = false

    private var selLevel: QBLevel? { levels.first { $0.levelNumber == selNo } }
    private var publishedCount: Int { levels.filter { $0.status == "published" }.count }

    var body: some View {
        GeometryReader { geo in
            let wide = geo.size.width >= 880
            VStack(spacing: 0) {
                hero
                statStrip
                if wide {
                    // The builder is form-like: on the Mac it must NOT stretch to
                    // the full window. The rail + editor pair becomes a centered
                    // card at the readable column width; iPad keeps the full-bleed
                    // split, byte-identical.
                    let builder = HStack(spacing: 0) {
                        levelRail
                            .frame(width: 300)
                        Divider().background(Nuru.border)
                        editorPane
                            .frame(maxWidth: .infinity)
                    }
                    if MacDesign.isMac {
                        builder
                            .background(Nuru.white)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                            .padding(.vertical, MacDesign.gutter)
                            .macContentColumn()
                    } else {
                        builder
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
        // Context-aware launches: the workspace hands the level over via the
        // router so this editor never re-asks for it.
        .onChange(of: router.pendingQuizLevel) { _, _ in applyPendingLevel() }
    }

    /// Consume router.pendingQuizLevel (workspace/dashboard deep link).
    private func applyPendingLevel() {
        guard let n = router.pendingQuizLevel, !levels.isEmpty else { return }
        router.pendingQuizLevel = nil
        if levels.contains(where: { $0.levelNumber == n && !$0.locked }) {
            if selNo == n {
                Task { await resolveExam(n) }
            } else {
                selNo = n
            }
        }
    }

    // MARK: Hero

    private var hero: some View {
        PortalHero(
            breadcrumb: ["Curriculum", "Level Quiz Builder"],
            title: "Level Quiz Builder",
            subtitle: "Build the final assessment disciples take after completing a level."
        )
    }

    /// Compact two-tile stat strip (~90pt).
    private var statStrip: some View {
        HStack(spacing: Nuru.S.md) {
            statTile("LEVELS", "\(levels.count)", "Total", "square.stack.3d.up.fill", Nuru.gold)
            statTile("PUBLISHED", "\(publishedCount)", "Live", "checkmark.seal.fill", Nuru.lumGreen)
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
                RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).fill(tint.opacity(0.12))
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

    // MARK: Left rail (level selector — for switching levels mid-session)

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
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous)
                .stroke(sel ? lc : Nuru.border, lineWidth: sel ? 2 : 1.5))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous)
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
            HStack(spacing: 12) {
                HStack(spacing: 6) {
                    Image(systemName: "rosette").font(.system(size: 12)).foregroundStyle(lc)
                    Text("Final assessment").font(.inter(11, .semibold)).foregroundStyle(lc)
                }
                examPublishToggle(lvl)
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(lc.opacity(0.06))
        .overlay(Rectangle().fill(lc.opacity(0.30)).frame(height: 2), alignment: .bottom)
    }

    /// Review → Publish gate. Members see and take the level exam only once it is
    /// published; before that it sits "In Review". Carries the current pass mark.
    @ViewBuilder private func examPublishToggle(_ lvl: QBLevel) -> some View {
        let published = (lvl.examStatus ?? "review") == "published"
        let s = qbStatusStyle(published ? "published" : "in_review")
        HStack(spacing: 8) {
            HStack(spacing: 4) {
                Image(systemName: published ? "checkmark.seal.fill" : "clock").font(.system(size: 10, weight: .bold))
                Text(published ? "Published" : "In Review").font(.inter(10, .bold))
            }
            .foregroundStyle(s.fg)
            .padding(.horizontal, 9).padding(.vertical, 3)
            .background(Capsule().fill(s.bg))

            Button {
                Task { await setExamStatus(lvl, to: published ? "review" : "published") }
            } label: {
                Text(togglingPublish ? "Saving…" : (published ? "Move to review" : "Publish exam"))
                    .font(.inter(11.5, .bold))
                    .foregroundStyle(published ? Color(hex: 0x6B5E45) : .white)
                    .padding(.horizontal, 14).frame(height: 30)
                    .background(Capsule().fill(published ? Color(hex: 0xF1EEE7) : Nuru.gold))
            }
            .buttonStyle(.plain)
            .disabled(togglingPublish || examModuleId == nil)
            .opacity(togglingPublish || examModuleId == nil ? 0.55 : 1)
        }
    }

    private func setExamStatus(_ lvl: QBLevel, to next: String) async {
        await MainActor.run { togglingPublish = true; loadError = nil }
        let mark = Int(Double(lvl.requiredExamPassMark ?? "80") ?? 80)
        do {
            try await CmsAPI.updateExam(lvl.levelNumber, .init(
                requiredExamPassMark: mark,
                examQuestionCount: nil,
                examShowAnswers: nil,
                examShowScore: nil,
                examShuffle: nil,
                examStatus: next))
            await MainActor.run {
                if let i = levels.firstIndex(where: { $0.levelNumber == lvl.levelNumber }) {
                    levels[i].examStatus = next
                }
            }
        } catch {
            await MainActor.run { loadError = (error as? APIError)?.errorDescription ?? "Could not update publish state." }
        }
        await MainActor.run { togglingPublish = false }
    }

    @ViewBuilder private func editorBody(_ lvl: QBLevel) -> some View {
        if resolving {
            Text("Loading exam…").font(.inter(13)).foregroundStyle(Nuru.ink600)
                .frame(maxWidth: .infinity).padding(40)
        } else if examMissing {
            examMissingCard
        } else if let moduleId = examModuleId {
            // The shared question editor in EXAM mode (QuestionBankKit).
            QuestionBankEditor(
                moduleId: moduleId,
                accent: Color(hexString: lvl.color),
                exam: .init(
                    levelNo: lvl.levelNumber,
                    initialSettings: examSettings(lvl),
                    onSavedSettings: { s in applySavedSettings(lvl.levelNumber, s) }
                )
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
                        RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).fill(Nuru.gold.opacity(0.12))
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
                        .background(Nuru.gold).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
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
                // Router context first (workspace launch), else the first level.
                if let pending = router.pendingQuizLevel,
                   list.data.contains(where: { $0.levelNumber == pending && !$0.locked }) {
                    router.pendingQuizLevel = nil
                    selNo = pending
                } else if selNo == nil {
                    selNo = list.data.first?.levelNumber
                }
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
            try await CmsAPI.createModule(.init(
                levelNumber: n,
                title: "Level \(n) Review",
                lessonContent: "Level exit exam.",
                evaluationKind: "exit_exam"
            ))
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

// CMS Curriculum browser — Levels → Modules → Questions, all native. Reached by
// the CMS, Level Detail and Quiz Builder sidebar items (shared drill-down).
import SwiftUI

struct CmsCurriculumView: View {
    var title = "CMS — Curriculum"
    var body: some View {
        AsyncView(PortalAPI.curriculumLevels) { levels in
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(levels) { level in
                        NavigationLink {
                            LevelDetailView(level: level)
                        } label: {
                            Card {
                                HStack(spacing: 14) {
                                    ZStack {
                                        Circle().fill(Nuru.gold.opacity(0.15)).frame(width: 44, height: 44)
                                        Text("\(level.levelNumber)").font(.headline).foregroundStyle(Nuru.gold)
                                    }
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(level.title).font(.subheadline.weight(.semibold)).foregroundStyle(Nuru.navy)
                                        if let theme = level.theme { Text(theme).font(.caption).foregroundStyle(Nuru.muted) }
                                        HStack(spacing: 6) {
                                            Pill(text: "\(level.publishedCount) live", color: Nuru.success)
                                            Pill(text: "\(level.draftCount) draft", color: Nuru.warning)
                                        }
                                    }
                                    Spacer()
                                    if level.locked { Image(systemName: "lock.fill").foregroundStyle(Nuru.muted) }
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Nuru.muted)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(20)
            }
        }
        .portalPage(title)
    }
}

struct LevelDetailView: View {
    let level: AdminLevel
    var body: some View {
        AsyncView({ try await PortalAPI.modules(level: level.levelNumber) }) { modules in
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(modules.sorted { $0.moduleSequenceNumber < $1.moduleSequenceNumber }) { m in
                        NavigationLink {
                            ModuleQuizView(module: m)
                        } label: {
                            Card {
                                HStack(spacing: 12) {
                                    Text("\(m.moduleSequenceNumber)").font(.subheadline.weight(.bold))
                                        .foregroundStyle(Nuru.muted).frame(width: 26)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(m.title).font(.subheadline.weight(.semibold)).foregroundStyle(Nuru.navy)
                                        if let s = m.summary { Text(s).font(.caption).foregroundStyle(Nuru.muted).lineLimit(2) }
                                        HStack(spacing: 6) {
                                            Pill(text: m.status.capitalized,
                                                 color: m.status == "published" ? Nuru.success : Nuru.warning)
                                            Pill(text: "\(m.activeQuestionCount) Q", color: Nuru.navy)
                                        }
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Nuru.muted)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(20)
            }
        }
        .portalPage(level.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

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
                                        Text("Q\(idx + 1)").font(.caption.weight(.bold)).foregroundStyle(Nuru.gold)
                                        Text(q.questionText).font(.subheadline.weight(.medium)).foregroundStyle(Nuru.navy)
                                        Spacer()
                                        if !q.isActive { Pill(text: "Inactive", color: Nuru.muted) }
                                    }
                                    if !q.correctAnswer.isEmpty {
                                        Label(q.correctAnswer, systemImage: "checkmark.circle.fill")
                                            .font(.caption).foregroundStyle(Nuru.success)
                                    }
                                    if let e = q.explanation, !e.isEmpty {
                                        Text(e).font(.caption).foregroundStyle(Nuru.muted)
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

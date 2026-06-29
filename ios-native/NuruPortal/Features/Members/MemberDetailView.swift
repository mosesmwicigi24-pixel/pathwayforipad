// Member Profile — native SwiftUI port of the web MemberProfile page
// (MemberProfile.tsx). Matches the make: navy hero (breadcrumb, graduated/cell tags,
// Message / Mark-graduated / Pastoral-note chips, avatar + name + contact line, and
// a 9-up info strip), an optional minor/guardian banner, a 4-up KPI row (Habits /
// Curriculum / Attendance / Badges), three progress rings (Habits/Curriculum/
// Attendance), and the Activity / Milestones / Certificates+Badges columns. Plus a
// "Results" section (levels → module scores, exams, badges, certificates) from
// /admin/members/{id}/results.
//
// The shared MemberDetail (Models.swift) is a slim subset, so this screen fetches a
// page-local rich model that mirrors the full web MemberDetail via
// APIClient.shared.get (decoder does convertFromSnakeCase). PortalAPI.memberDetail
// remains the canonical slim accessor and is left untouched.
import SwiftUI

// MARK: - Page-local rich wire models (full web MemberDetail / MemberResults shape)
//
// Decoding is fully resilient: every scalar uses a @Default* wrapper (tolerates
// null AND missing keys), nested objects use @MPObj (default to .mpEmpty when
// absent), and arrays use @MPList (default to []). Swift's *synthesised* Codable
// ignores plain `= default` values and throws on missing/null — these wrappers are
// what make the screen survive partial backend payloads.

private protocol MPEmpty { static var mpEmpty: Self { get } }

/// Build an all-defaults instance by decoding `{}` — the @Default*/optional fields
/// make every key tolerant, so this never throws.
private func mpEmptyDecode<T: Decodable>(_ t: T.Type) -> T {
    (try? JSONDecoder().decode(T.self, from: Data("{}".utf8))) ?? (try! JSONDecoder().decode(T.self, from: Data("{}".utf8)))
}

@propertyWrapper private struct MPObj<T: Codable & MPEmpty>: Codable {
    var wrappedValue: T
    init() { wrappedValue = .mpEmpty }
    init(from decoder: Decoder) throws { wrappedValue = (try? T(from: decoder)) ?? .mpEmpty }
    func encode(to encoder: Encoder) throws { try wrappedValue.encode(to: encoder) }
}
@propertyWrapper private struct MPList<E: Codable>: Codable {
    var wrappedValue: [E]
    init() { wrappedValue = [] }
    init(from decoder: Decoder) throws { wrappedValue = (try? [E](from: decoder)) ?? [] }
    func encode(to encoder: Encoder) throws { try wrappedValue.encode(to: encoder) }
}
extension KeyedDecodingContainer {
    fileprivate func decode<T>(_ t: MPObj<T>.Type, forKey k: Key) throws -> MPObj<T> { (try? decodeIfPresent(t, forKey: k) ?? MPObj()) ?? MPObj() }
    fileprivate func decode<E>(_ t: MPList<E>.Type, forKey k: Key) throws -> MPList<E> { (try? decodeIfPresent(t, forKey: k) ?? MPList()) ?? MPList() }
}

private struct MemberFull: Codable, Identifiable {
    struct Enrollment: Codable, MPEmpty {
        @DefaultZero var currentLevel: Int
        let levelTitle: String?
        let startLevel: Int?
        let state: String?
        let startedAt: String?
        let completedAt: String?
        let graduatedAt: String?
        static let mpEmpty = mpEmptyDecode(Enrollment.self)
    }
    struct Engagement: Codable, MPEmpty {
        let eScore: Double?; let band: String?
        static let mpEmpty = mpEmptyDecode(Engagement.self)
    }
    struct Metrics: Codable, MPEmpty {
        @DefaultZero var habitsPct: Int
        @DefaultZero var activeDays30: Int
        @DefaultZero var curriculumPct: Int
        @DefaultZero var modulesDone: Int
        @DefaultZero var modulesTotal: Int
        @DefaultZero var attendancePct: Int
        @DefaultZero var attended: Int
        @DefaultZero var eventsHeld: Int
        @DefaultZero var currentStreakDays: Int
        @DefaultZero var longestStreakDays: Int
        static let mpEmpty = mpEmptyDecode(Metrics.self)
    }
    struct Guardian: Codable {
        @DefaultEmpty var name: String
        @DefaultEmpty var relationship: String
        @DefaultEmpty var consent: String
        let grantedAt: String?
        let revokedAt: String?
        let consentVersion: String?
    }
    struct Certificate: Codable, Identifiable {
        @DefaultEmpty var certificateId: String
        let levelNumber: Int?
        @DefaultEmpty var verificationCode: String
        @DefaultEmpty var issuedAt: String
        @DefaultEmpty var levelTitle: String
        var id: String { certificateId }
    }
    struct Badge: Codable, Identifiable {
        @DefaultEmpty var code: String
        @DefaultEmpty var name: String
        @DefaultEmpty var description: String
        @DefaultEmpty var category: String
        let iconKey: String?
        let awardedAt: String?
        var id: String { code }
    }
    struct TimelineEntry: Codable, Identifiable {
        @DefaultEmpty var kind: String
        @DefaultEmpty var label: String
        let moduleTitle: String?
        @DefaultEmpty var occurredAt: String
        var id: String { kind + occurredAt + label }
    }

    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    let email: String?
    @DefaultEmpty var phoneNumber: String
    @DefaultFalse var isMinor: Bool
    @DefaultFalse var isBaptized: Bool
    let gender: String?
    let city: String?
    let programme: String?
    let countryCode: String?
    let dateOfBirth: String?
    let age: Int?
    let status: String?
    @DefaultFalse var graduated: Bool
    let graduatedAt: String?
    let cellGroupId: String?
    let cellName: String?
    let language: String?
    @DefaultEmpty var createdAt: String
    let lastActivity: String?
    @MPObj var enrollment: Enrollment
    @MPObj var engagement: Engagement
    @MPObj var metrics: Metrics
    let guardian: Guardian?
    @MPList var certificates: [Certificate]
    @MPList var badges: [Badge]
    @MPList var timeline: [TimelineEntry]
    var id: String { userId }
}

private struct MemberResultsFull: Codable {
    struct User: Codable, MPEmpty {
        @DefaultEmpty var userId: String
        @DefaultEmpty var fullName: String
        static let mpEmpty = mpEmptyDecode(User.self)
    }
    struct Summary: Codable, MPEmpty {
        @DefaultZero var currentLevel: Int
        @DefaultZero var modulesTotal: Int
        @DefaultZero var modulesCompleted: Int
        @DefaultZero var modulesPassed: Int
        let avgModuleScore: Double?
        let overallScore: Double?
        @DefaultZero var levelsCompleted: Int
        @DefaultZero var badges: Int
        @DefaultZero var certificates: Int
        static let mpEmpty = mpEmptyDecode(Summary.self)
    }
    struct ModuleRow: Codable, Identifiable {
        @DefaultEmpty var moduleId: String
        @DefaultZero var sequence: Int
        @DefaultEmpty var title: String
        @DefaultFalse var completed: Bool
        let bestScore: Double?
        @DefaultFalse var passed: Bool
        @DefaultZero var attempts: Int
        var id: String { moduleId }
    }
    struct Exam: Codable { let score: Double?; @DefaultFalse var passed: Bool; @DefaultZero var attempts: Int }
    struct LevelRow: Codable, Identifiable {
        @DefaultZero var levelNumber: Int
        @DefaultEmpty var title: String
        @DefaultZero var moduleCount: Int
        @DefaultZero var modulesCompleted: Int
        let moduleAverage: Double?
        let levelScore: Double?
        @DefaultFalse var completed: Bool
        let exam: Exam?
        @MPList var modules: [ModuleRow]
        var id: Int { levelNumber }
    }
    struct Badge: Codable, Identifiable {
        @DefaultEmpty var code: String
        @DefaultEmpty var name: String
        @DefaultEmpty var category: String
        let description: String?
        @DefaultEmpty var awardedAt: String
        var id: String { code }
    }
    struct Cert: Codable, Identifiable {
        let levelNumber: Int?
        let levelTitle: String?
        @DefaultEmpty var verificationCode: String
        @DefaultEmpty var issuedAt: String
        var id: String { verificationCode }
    }
    @MPObj var user: User
    @MPObj var summary: Summary
    @MPList var levels: [LevelRow]
    @MPList var badges: [Badge]
    @MPList var certificates: [Cert]
}

private let mpProgrammeLabels: [String: String] = [
    "new_believer": "New Believer", "foundations": "Foundations",
    "serving_track": "Serving Track", "leadership_prep": "Leadership Prep",
]

/// Band → pastel chip (web bandStyle).
private func bandChip(_ band: String?) -> (bg: Color, fg: Color) {
    switch band {
    case "Thriving": (Color(hex: 0xE8F6EC), Color(hex: 0x16A34A))
    case "Watch":    (Color(hex: 0xFDF0E6), Color(hex: 0xE07B28))
    case "At-risk":  (Color(hex: 0xFDECEC), Color(hex: 0xDC2626))
    default:         (Color(hex: 0xFFF6E0), Color(hex: 0xA87616))   // Steady
    }
}

// MARK: - Screen

struct MemberDetailView: View {
    let userId: String
    let name: String

    // Graduation write state (the only mutation on this screen). `reloadToken`
    // forces AsyncView to refetch after a successful PATCH; `graduatedOverride`
    // optimistically flips the chips/tag until the refetch lands.
    @State private var reloadToken = 0
    @State private var graduatedOverride: Bool?
    @State private var graduating = false
    @State private var graduationError: String?

    var body: some View {
        AsyncView({ try await APIClient.shared.get("/admin/members/\(userId)", as: MemberFull.self) }) { m in
            ScrollView {
                VStack(spacing: 0) {
                    hero(m)
                    if m.isMinor { minorBanner(m) }
                    body(m)
                }
            }
            .background(Nuru.background)
        }
        .id(reloadToken)
        .portalPage(name)
        .navigationBarTitleDisplayMode(.inline)
    }

    // PATCH /admin/members/{id}/graduation { graduated }, then refresh (web setGraduation).
    private func toggleGraduation(current: Bool) async {
        guard !graduating else { return }
        graduating = true
        graduationError = nil
        let next = !current
        struct Body: Encodable { let graduated: Bool }
        struct Result: Decodable { @DefaultFalse var graduated: Bool }
        do {
            let r = try await APIClient.shared.patch("/admin/members/\(userId)/graduation", body: Body(graduated: next), as: Result.self)
            graduatedOverride = r.graduated
            reloadToken += 1     // refetch the full member so all derived fields update
        } catch {
            graduationError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        graduating = false
    }

    // MARK: Hero

    private func hero(_ m: MemberFull) -> some View {
        let lvl = m.enrollment
        let band = bandChip(m.engagement.band)
        let country = m.countryCode
        let genderLabel = m.gender.map { $0.prefix(1).uppercased() + $0.dropFirst() }
        let location = [country, m.city].compactMap { $0 }.joined(separator: " · ")
        let ageGender = [m.age.map(String.init), genderLabel].compactMap { $0 }.joined(separator: " · ")

        let items: [(String, String, Bool)] = [
            ("Cell", m.cellName ?? "Unassigned", false),
            ("Current level", "L\(lvl.currentLevel)\(lvl.levelTitle.map { " · \($0)" } ?? "")", false),
            ("Engagement band", m.engagement.band ?? "—", m.engagement.band != nil),
            ("Programme", m.programme.flatMap { mpProgrammeLabels[$0] } ?? "—", false),
            ("Location", location.isEmpty ? "—" : location, false),
            ("Age · Gender", ageGender.isEmpty ? "—" : ageGender, false),
            ("Language", m.language ?? "—", false),
            ("Joined", Fmt.date(m.createdAt), false),
            ("Last activity", Fmt.date(m.lastActivity, style: .dateTime.month().day().hour().minute()), false),
        ]

        let graduated = graduatedOverride ?? m.graduated
        return VStack(alignment: .leading, spacing: 14) {
            // Breadcrumb
            HStack(spacing: 6) {
                Text("Nuru Pathway").font(.nMicro).foregroundStyle(Nuru.onNavyDim)
                Image(systemName: "chevron.right").font(.system(size: 8)).foregroundStyle(Nuru.onNavyFaint)
                Text("Members").font(.nMicro).foregroundStyle(Nuru.onNavyDim)
                Image(systemName: "chevron.right").font(.system(size: 8)).foregroundStyle(Nuru.onNavyFaint)
                Text(m.fullName).font(.nMicro).foregroundStyle(.white).lineLimit(1)
                Spacer(minLength: 0)
            }

            // Avatar + name + contact sit directly under the breadcrumb (no dead gap).
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(hex: 0xF5C77E, alpha: 0.16))
                    .frame(width: 50, height: 50)
                    .overlay(Text(initials(m.fullName)).font(.fraunces(20, .medium)).foregroundStyle(Color(hex: 0xF5C77E)))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color(hex: 0xF5C77E, alpha: 0.3), lineWidth: 1))
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.fullName).font(.fraunces(24, .regular)).foregroundStyle(.white).lineLimit(2)
                    Text(m.phoneNumber + (m.email.map { " · \($0)" } ?? "")).font(.inter(12.5)).foregroundStyle(Nuru.onNavyDim).lineLimit(1)
                }
                Spacer(minLength: 0)
            }

            // Action chips
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if graduated {
                        HeroChip(label: "Graduated", icon: "graduationcap.fill", style: .tag)
                    }
                    HeroChip(label: "\(m.cellName ?? "Unassigned") · L\(lvl.currentLevel)", icon: "sparkles", style: .tag)
                    // "Message" has no messaging endpoint — left as a styled affordance.
                    if m.email != nil { HeroChip(label: "Message", icon: "envelope", style: .ghost) }
                    // Mark graduated / Un-graduate → PATCH /admin/members/{id}/graduation.
                    HeroChip(label: graduating ? "Saving…" : (graduated ? "Un-graduate" : "Mark graduated"),
                             icon: "graduationcap", style: .ghost) {
                        Task { await toggleGraduation(current: graduated) }
                    }
                    // "Pastoral note" has no endpoint — left as a styled affordance.
                    HeroChip(label: "Pastoral note", icon: "heart.fill", style: .gold)
                }
            }
            if let graduationError {
                Text(graduationError).font(.inter(11.5)).foregroundStyle(Color(hex: 0xFCA5A5))
            }

            // 9-up info strip — adaptive cols (dense rows, no tall gaps).
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 0)], spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.0.uppercased()).font(.nOverline).tracking(1.2).foregroundStyle(Nuru.onNavyDim)
                        if item.2 {
                            Text("● \(item.1)").font(.inter(12, .bold)).foregroundStyle(band.fg)
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(band.bg).clipShape(Capsule())
                        } else {
                            Text(item.1).font(.inter(14, .semibold)).foregroundStyle(.white).lineLimit(2)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 56, alignment: .topLeading)
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .overlay(Rectangle().fill(.white.opacity(0.07)).frame(height: 1), alignment: .bottom)
                }
            }
            .background(.white.opacity(0.04))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 1))
        }
        .padding(.horizontal, Nuru.S.base).padding(.top, Nuru.S.base).padding(.bottom, Nuru.S.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navyCeremony)
    }

    // MARK: Minor / guardian banner

    private func minorBanner(_ m: MemberFull) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.shield.fill").font(.system(size: 15)).foregroundStyle(Color(hex: 0xA87616))
                Text("Minor — Guardian consent required").font(.inter(13, .bold)).foregroundStyle(Color(hex: 0x7A5410))
                Spacer(minLength: 0)
                let granted = m.guardian?.consent == "Granted"
                Text(granted ? "✓ Consent on file" : "⚠ Action needed")
                    .font(.inter(11, .bold)).foregroundStyle(granted ? Color(hex: 0x16A34A) : Color(hex: 0xDC2626))
                    .padding(.horizontal, 10).padding(.vertical, 3)
                    .background(granted ? Color(hex: 0xE8F6EC) : Color(hex: 0xFDECEC)).clipShape(Capsule())
            }
            if let g = m.guardian {
                Text("Consent \(g.consent.lowercased()) by \(g.name) (\(g.relationship)) on \(Fmt.date(g.grantedAt)).")
                    .font(.inter(12)).foregroundStyle(Color(hex: 0x7A5410))
            } else {
                Text("No consent on file.").font(.inter(12)).foregroundStyle(Color(hex: 0x7A5410))
            }
        }
        .padding(.horizontal, Nuru.S.base).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [Color(hex: 0xFFFBEB), Color(hex: 0xFEF3C7)], startPoint: .leading, endPoint: .trailing))
        .overlay(Rectangle().fill(Color(hex: 0xF5E0A8)).frame(height: 1), alignment: .bottom)
    }

    // MARK: Body

    private func body(_ m: MemberFull) -> some View {
        VStack(spacing: 16) {
            // ONE consolidated row of 5 compact KPI tiles (no duplicate Habits/
            // Curriculum/Attendance strip). 5-up at ~740pt via adaptive minimum 132.
            kpiRow(m)

            // Two-column layout so content spreads sideways instead of marching down.
            // Left column: progress detail + recent activity. Right column: milestones,
            // certificates, badges. Falls back to a single stack when narrow.
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 16, alignment: .top)], spacing: 16) {
                VStack(spacing: 16) {
                    progressCard(m)
                    activityCard(m)
                }
                VStack(spacing: 16) {
                    milestonesCard(m)
                    certificatesCard(m)
                    badgesCard(m)
                }
            }

            // Results dossier (levels/modules/exams/badges/certs) — full width table.
            ResultsSection(userId: userId)
        }
        .padding(.horizontal, Nuru.S.base)
        .padding(.top, Nuru.S.lg)
        .padding(.bottom, Nuru.S.xxl)
    }

    // ONE row of 5 compact tiles: Habits · Curriculum · Attendance · Badges · Engagement.
    private func kpiRow(_ m: MemberFull) -> some View {
        let met = m.metrics
        let eng = m.engagement.eScore.map { "\(Int($0.rounded()))" } ?? "—"
        // (label, value, icon, tintFg, bg, border, hint)
        let kpis: [(String, String, String, Color, Color, Color, String)] = [
            ("Habits", "\(met.habitsPct)%", "sunrise.fill", Color(hex: 0x16A34A), Color(hex: 0xF3FAF5), Color(hex: 0xD6ECDF), "\(met.activeDays30)/30 days"),
            ("Curriculum", "\(met.curriculumPct)%", "book.fill", Color(hex: 0xC89B3C), Color(hex: 0xFDF9EF), Color(hex: 0xF0E2BD), "Level \(m.enrollment.currentLevel)"),
            ("Attendance", "\(met.attendancePct)%", "calendar", Color(hex: 0x2563EB), Color(hex: 0xF4F6FB), Color(hex: 0xDBE2EF), "\(met.attended) · 90d"),
            ("Badges", String(m.badges.count), "rosette", Color(hex: 0x7C3AED), Color(hex: 0xF7F3FC), Color(hex: 0xE2D7F2), "\(m.certificates.count) certs"),
            ("Engagement", eng, "waveform.path.ecg", Color(hex: 0xA87616), Color(hex: 0xFFF6E0), Color(hex: 0xF5E0A8), m.engagement.band ?? "—"),
        ]
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 12)], spacing: 12) {
            ForEach(Array(kpis.enumerated()), id: \.offset) { _, k in
                VStack(alignment: .leading, spacing: 6) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 9, style: .continuous).fill(k.3.opacity(0.14))
                        Image(systemName: k.2).font(.system(size: 14, weight: .medium)).foregroundStyle(k.3)
                    }.frame(width: 32, height: 32)
                    Text(k.1).font(.fraunces(22, .medium)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.7)
                    Text(k.0.uppercased()).font(.nOverline).tracking(0.8).foregroundStyle(Nuru.muted).lineLimit(1).minimumScaleFactor(0.85)
                    Text(k.6).font(.inter(10)).foregroundStyle(Nuru.muted).lineLimit(1).minimumScaleFactor(0.85)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                .background(k.4)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(k.5, lineWidth: 1))
            }
        }
    }

    // Progress detail (rings) — kept once, inside the left column, not duplicating KPIs.
    private func progressCard(_ m: MemberFull) -> some View {
        let met = m.metrics
        let rings: [(String, String, Int, String, Color)] = [
            ("Habits", "sunrise.fill", met.habitsPct, "\(met.activeDays30)/30 active · \(met.currentStreakDays)-day streak", Color(hex: 0x16A34A)),
            ("Curriculum", "book.fill", met.curriculumPct, "\(met.modulesDone)/\(met.modulesTotal) modules complete", Color(hex: 0xC89B3C)),
            ("Attendance", "calendar", met.attendancePct, "\(met.attended) present days · 90d", Color(hex: 0x0B1F33)),
        ]
        return sectionCard(bg: Nuru.white, border: Nuru.border, icon: "chart.bar.fill", title: "Progress") {
            VStack(spacing: 0) {
                ForEach(Array(rings.enumerated()), id: \.offset) { i, c in
                    HStack(spacing: 14) {
                        ProgressRing(value: c.2, color: c.4, size: 56)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Image(systemName: c.1).font(.system(size: 12)).foregroundStyle(c.4)
                                Text(c.0.uppercased()).font(.inter(11.5, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink)
                            }
                            Text(c.3).font(.inter(11)).foregroundStyle(Nuru.muted).fixedSize(horizontal: false, vertical: true)
                            ProgressBar(pct: Double(c.2), fill: c.4, height: 4).padding(.top, 2)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 10)
                    if i < rings.count - 1 { Rectangle().fill(Nuru.border).frame(height: 1) }
                }
            }
        }
    }

    private func activityCard(_ m: MemberFull) -> some View {
        sectionCard(bg: Color(hex: 0xFDF9EF), border: Color(hex: 0xF0E2BD), icon: "bubble.left.fill", title: "Recent activity") {
            if m.timeline.isEmpty {
                Text("No recorded activity yet.").font(.inter(13)).foregroundStyle(Nuru.muted)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(m.timeline.enumerated()), id: \.offset) { i, t in
                        HStack(alignment: .top, spacing: 12) {
                            VStack(spacing: 0) {
                                Circle().fill(dotColor(t.kind)).frame(width: 12, height: 12)
                                    .overlay(Circle().stroke(Nuru.white, lineWidth: 3))
                                if i < m.timeline.count - 1 {
                                    Rectangle().fill(Nuru.border).frame(width: 2).frame(maxHeight: .infinity)
                                }
                            }
                            .frame(width: 12)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.label).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                                Text((t.moduleTitle.map { "\($0) · " } ?? "") + Fmt.date(t.occurredAt, style: .dateTime.month().day().hour().minute()))
                                    .font(.inter(11.5)).foregroundStyle(Nuru.muted)
                            }
                            .padding(.bottom, i < m.timeline.count - 1 ? 16 : 0)
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
        }
    }

    private func milestonesCard(_ m: MemberFull) -> some View {
        let lvl = m.enrollment
        let met = m.metrics
        struct Milestone { let title, date, note, icon: String; let color: Color; let complete: Bool }
        let milestones: [Milestone] = [
            Milestone(title: "Baptism", date: m.isBaptized ? "Recorded" : "Not yet recorded", note: "Water baptism", icon: "drop.fill", color: Color(hex: 0x0B1F33), complete: m.isBaptized),
            Milestone(title: "Level \(lvl.currentLevel) Completion", date: lvl.levelTitle ?? "Level \(lvl.currentLevel)", note: "\(met.modulesDone) of \(met.modulesTotal) modules", icon: "flag.fill", color: Color(hex: 0xC89B3C), complete: met.modulesTotal > 0 && met.modulesDone >= met.modulesTotal),
            Milestone(title: "Pathway Completion", date: lvl.completedAt != nil ? Fmt.date(lvl.completedAt) : "In progress", note: lvl.state == "completed" ? "All levels complete" : "\(6 - lvl.currentLevel) levels to go", icon: "sparkles", color: Color(hex: 0x6B7280), complete: lvl.state == "completed"),
        ]
        return sectionCard(bg: Color(hex: 0xF4F6FB), border: Color(hex: 0xDBE2EF), icon: "flag.fill", title: "Milestones",
                           trailing: "\(milestones.filter { $0.complete }.count) of \(milestones.count)") {
            VStack(spacing: 0) {
                ForEach(Array(milestones.enumerated()), id: \.offset) { i, ms in
                    HStack(alignment: .top, spacing: 12) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .fill(ms.complete ? Color(hex: 0xE8F6EC) : Color(hex: 0xF3F4F6))
                            Image(systemName: ms.complete ? "checkmark.circle.fill" : ms.icon)
                                .font(.system(size: 17)).foregroundStyle(ms.complete ? Color(hex: 0x16A34A) : ms.color)
                        }.frame(width: 38, height: 38)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(ms.title).font(.inter(13, .bold)).foregroundStyle(Nuru.ink)
                                if ms.complete {
                                    Text("COMPLETE").font(.inter(10, .bold)).tracking(0.5).foregroundStyle(Color(hex: 0x16A34A))
                                        .padding(.horizontal, 8).padding(.vertical, 2)
                                        .background(Color(hex: 0xE8F6EC)).clipShape(Capsule())
                                }
                            }
                            Text(ms.date).font(.inter(12)).foregroundStyle(Nuru.muted)
                            Text(ms.note).font(.inter(11.5)).foregroundStyle(Nuru.muted)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 12)
                    if i < milestones.count - 1 {
                        Rectangle().fill(Nuru.border).frame(height: 1)
                    }
                }
            }
        }
    }

    private func certificatesCard(_ m: MemberFull) -> some View {
        sectionCard(bg: Color(hex: 0xF3FAF5), border: Color(hex: 0xD6ECDF), icon: "rosette", title: "Certificates",
                    trailing: "\(m.certificates.count) earned") {
            if m.certificates.isEmpty {
                Text("None issued yet.").font(.inter(12.5)).foregroundStyle(Nuru.muted)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(m.certificates.enumerated()), id: \.element.id) { i, c in
                        HStack(spacing: 12) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color(hex: 0xFFF6E0))
                                Image(systemName: "rosette").font(.system(size: 17)).foregroundStyle(Color(hex: 0xA87616))
                            }.frame(width: 36, height: 36)
                            VStack(alignment: .leading, spacing: 1) {
                                Text((c.levelNumber.map { "Level \($0) — " } ?? "") + c.levelTitle)
                                    .font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                                Text("Issued \(Fmt.date(c.issuedAt))").font(.inter(11)).foregroundStyle(Nuru.muted)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 10)
                        if i < m.certificates.count - 1 { Rectangle().fill(Nuru.border).frame(height: 1) }
                    }
                }
            }
        }
    }

    private func badgesCard(_ m: MemberFull) -> some View {
        sectionCard(bg: Color(hex: 0xF7F3FC), border: Color(hex: 0xE2D7F2), icon: "sparkles", title: "Badges",
                    trailing: "\(m.badges.count) earned") {
            if m.badges.isEmpty {
                Text("No badges yet.").font(.inter(12.5)).foregroundStyle(Nuru.muted)
            } else {
                VStack(spacing: 8) {
                    ForEach(m.badges) { b in
                        HStack(spacing: 12) {
                            ZStack {
                                Circle().fill(Nuru.white)
                                Image(systemName: "flame.fill").font(.system(size: 17)).foregroundStyle(Color(hex: 0xA87616))
                            }.frame(width: 36, height: 36)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(b.name).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                                Text(b.description).font(.inter(11)).foregroundStyle(Nuru.muted)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(10)
                        .background(Nuru.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                    }
                }
            }
        }
    }

    // Generic pastel section card with header.
    private func sectionCard<Content: View>(
        bg: Color, border: Color, icon: String, title: String, trailing: String? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                HStack(spacing: 8) {
                    Image(systemName: icon).font(.system(size: 15)).foregroundStyle(Nuru.gold)
                    Text(title).font(.inter(14, .bold)).foregroundStyle(Nuru.ink)
                }
                Spacer()
                if let trailing { Text(trailing).font(.inter(11)).foregroundStyle(Nuru.muted) }
            }
            content()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(border, lineWidth: 1))
    }

    private func dotColor(_ kind: String) -> Color {
        if kind.contains("quiz") || kind.contains("completed") { return Color(hex: 0x16A34A) }
        if kind.contains("badge") { return Color(hex: 0xC89B3C) }
        return Color(hex: 0x9CA3AF)
    }

    private func initials(_ n: String) -> String {
        let p = n.split(separator: " ").prefix(2).compactMap { $0.first }
        return p.isEmpty ? "?" : String(p).uppercased()
    }
}

// MARK: - Progress ring (web Ring)

private struct ProgressRing: View {
    let value: Int
    let color: Color
    var size: CGFloat = 84
    var body: some View {
        let lw: CGFloat = size > 64 ? 8 : 6
        return ZStack {
            Circle().stroke(Color(hex: 0xEEF0F3), lineWidth: lw)
            Circle()
                .trim(from: 0, to: min(max(Double(value) / 100, 0), 1))
                .stroke(color, style: StrokeStyle(lineWidth: lw, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(value)%").font(.fraunces(size > 64 ? 21 : 15, .medium)).foregroundStyle(Nuru.ink)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Results dossier (member results endpoint)

private struct ResultsSection: View {
    let userId: String
    @State private var state: Loadable<MemberResultsFull> = .idle

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                Image(systemName: "chart.bar.fill").font(.system(size: 15)).foregroundStyle(Nuru.gold)
                Text("Results").font(.inter(14, .bold)).foregroundStyle(Nuru.ink)
            }
            switch state {
            case .idle, .loading:
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 12)
            case .failed(let m):
                Text(m).font(.inter(13)).foregroundStyle(Nuru.danger)
            case .loaded(let r):
                results(r)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .task {
            if case .idle = state {
                state = .loading
                do { state = .loaded(try await APIClient.shared.get("/admin/members/\(userId)/results", as: MemberResultsFull.self)) }
                catch { state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription) }
            }
        }
    }

    private func results(_ r: MemberResultsFull) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            // Summary strip (navy mini-tiles, web drawer header)
            let stats: [(String, String)] = [
                ("Overall", pctLabel(r.summary.overallScore)),
                ("Modules", "\(r.summary.modulesCompleted)/\(r.summary.modulesTotal)"),
                ("Levels", String(r.summary.levelsCompleted)),
                ("Badges·Certs", "\(r.summary.badges)·\(r.summary.certificates)"),
            ]
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(Array(stats.enumerated()), id: \.offset) { _, s in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.1).font(.inter(16, .bold)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
                        Text(s.0.uppercased()).font(.inter(9, .semibold)).tracking(0.4).foregroundStyle(.white.opacity(0.6))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(12)
            .background(Nuru.navy)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))

            ForEach(r.levels) { lv in LevelResultCard(lv: lv) }

            // Badges attained
            sub("Badges attained")
            if r.badges.isEmpty {
                Text("No badges yet.").font(.inter(12.5)).foregroundStyle(Nuru.muted)
            } else {
                FlowChips(items: r.badges.map { $0.name })
            }

            // Certificates earned
            sub("Certificates earned")
            if r.certificates.isEmpty {
                Text("No certificates yet.").font(.inter(12.5)).foregroundStyle(Nuru.muted)
            } else {
                VStack(spacing: 8) {
                    ForEach(r.certificates) { c in
                        HStack(spacing: 12) {
                            Image(systemName: "rosette").font(.system(size: 18)).foregroundStyle(Color(hex: 0x7C3AED))
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Level \(c.levelNumber.map(String.init) ?? "")" + (c.levelTitle.map { " — \($0)" } ?? ""))
                                    .font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                                Text("Issued \(Fmt.date(c.issuedAt)) · \(c.verificationCode)").font(.inter(11)).foregroundStyle(Nuru.muted)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(Nuru.white)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                }
            }
        }
    }

    private func sub(_ t: String) -> some View {
        HStack(spacing: 8) {
            Text(t.uppercased()).font(.inter(11, .bold)).tracking(0.8).foregroundStyle(Nuru.navy)
            Rectangle().fill(Nuru.border).frame(height: 1)
        }
    }
}

// Level result card (web LevelResultCard).
private struct LevelResultCard: View {
    let lv: MemberResultsFull.LevelRow
    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Image(systemName: "book.fill").font(.system(size: 14)).foregroundStyle(Nuru.gold)
                        Text("Level \(lv.levelNumber) — \(lv.title)").font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        if lv.completed {
                            Text("Complete").font(.inter(10, .bold)).foregroundStyle(Color(hex: 0x16A34A))
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(Color(hex: 0xE8F6EC)).clipShape(Capsule())
                        }
                    }
                    Text("Modules avg \(pctLabel(lv.moduleAverage))" + (lv.exam.map { " · Exam \(pctLabel($0.score))" } ?? " · Exam —"))
                        .font(.inter(10.5)).foregroundStyle(Nuru.muted).padding(.leading, 23)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(pctLabel(lv.levelScore)).font(.inter(17, .heavy)).foregroundStyle(scoreColor(lv.levelScore))
                    Text("LEVEL OVERALL").font(.inter(9, .regular)).tracking(0.4).foregroundStyle(Nuru.muted)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Rectangle().fill(Nuru.border).frame(height: 1)
            VStack(spacing: 0) {
                if lv.modules.isEmpty {
                    Text("No published modules.").font(.inter(12)).foregroundStyle(Nuru.muted)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 8)
                } else {
                    ForEach(Array(lv.modules.enumerated()), id: \.element.id) { i, m in
                        if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1).padding(.horizontal, 16) }
                        HStack(spacing: 12) {
                            Circle().fill(m.completed ? Color(hex: 0x16A34A) : (m.attempts > 0 ? Color(hex: 0xA87616) : Color(hex: 0xD1D5DB)))
                                .frame(width: 8, height: 8)
                            Text("M\(m.sequence)").font(.inter(11)).foregroundStyle(Nuru.muted).frame(width: 26, alignment: .leading)
                            Text(m.title).font(.inter(12.5)).foregroundStyle(Nuru.navy).lineLimit(1)
                            Spacer(minLength: 0)
                            if m.attempts > 0 {
                                Text("\(m.attempts) tr\(m.attempts > 1 ? "ies" : "y")").font(.inter(10.5)).foregroundStyle(Nuru.muted)
                            }
                            Text(pctLabel(m.bestScore)).font(.inter(13, .bold)).foregroundStyle(scoreColor(m.bestScore))
                                .frame(width: 46, alignment: .trailing)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 8)
                    }
                }
                if let exam = lv.exam {
                    Rectangle().fill(Nuru.border).frame(height: 2).padding(.horizontal, 16)
                    HStack(spacing: 12) {
                        Image(systemName: "rosette").font(.system(size: 14)).foregroundStyle(Color(hex: 0x7C3AED))
                        Text("Level exam" + (exam.passed ? " · passed" : "")).font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy)
                        Spacer(minLength: 0)
                        Text(pctLabel(exam.score)).font(.inter(13, .bold)).foregroundStyle(scoreColor(exam.score))
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                }
            }
        }
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}

// Simple wrapping chip row for badges.
private struct FlowChips: View {
    let items: [String]
    var body: some View {
        // Vertical stack of horizontal rows; SwiftUI lacks a native flow, so wrap manually.
        FlexibleWrap(items: items) { name in
            HStack(spacing: 6) {
                Image(systemName: "star.fill").font(.system(size: 11)).foregroundStyle(Color(hex: 0xA87616))
                Text(name).font(.inter(12, .bold)).foregroundStyle(Color(hex: 0xA87616))
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Color(hex: 0xFFF6E0))
            .overlay(Capsule().stroke(Color(hex: 0xF5E0A8), lineWidth: 1))
            .clipShape(Capsule())
        }
    }
}

/// Minimal flow layout (wraps chips to available width).
private struct FlexibleWrap<Data: RandomAccessCollection, Content: View>: View where Data.Element: Hashable {
    let items: Data
    let content: (Data.Element) -> Content
    init(items: Data, @ViewBuilder content: @escaping (Data.Element) -> Content) {
        self.items = items; self.content = content
    }
    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(Array(items), id: \.self) { content($0) }
        }
    }
}

/// iOS 16+ Layout that flows children left-to-right, wrapping rows.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > maxW, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
        return CGSize(width: maxW == .infinity ? x : maxW, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxW = bounds.width
        var x: CGFloat = bounds.minX, y: CGFloat = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > bounds.minX + maxW, x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
    }
}

// MARK: - Result score helpers (web pctLabel / scoreColor)

private func pctLabel(_ n: Double?) -> String { n == nil ? "—" : "\(Int(n!.rounded()))%" }
private func scoreColor(_ n: Double?) -> Color {
    guard let n else { return Nuru.muted }
    if n >= 70 { return Color(hex: 0x16A34A) }
    if n > 0 { return Color(hex: 0xA87616) }
    return Color(hex: 0xDC2626)
}

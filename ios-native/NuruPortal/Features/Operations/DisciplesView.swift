// Discipleship Hub — a native port of the web portal's DiscipleshipHub.tsx
// (closes PARITY drift D-11). The discipler's console: "where is each of my
// disciples, and what are they waiting on?" wired straight to action.
//   • Roster (GET /disciples, server-scoped §5.4) sorted needs-action-first,
//     with search; each row = avatar/name/band, cell · level · streak, and
//     needs-action badges (level to usher, pending reflections).
//   • Dossier (GET /disciples/{id}) — progression, six growth scores,
//     engagement, reflection bodies, recent activity, matched section-for-
//     section with the web panel.
//   • Three inline actions reuse existing write surfaces: DM composer
//     (POST /chat/dms + /chat/conversations/{id}/messages), usher to the next
//     level (POST /reviews/levels/{advancementId}/usher — the advancement id is
//     resolved from GET /reviews/levels), and reflection decisions
//     (POST /admin/reflections/{id}/decision). All gating/scoring/scoping is
//     server-authoritative (§1.1, §5.4); errors surface inline from APIError.
import SwiftUI

// MARK: - Visual language (web bandMeta / scoreTone / reflStatePill)

private struct HubBandMeta { let label: String; let dot: Color; let bg: Color; let fg: Color }
private func hubBand(_ band: String?) -> HubBandMeta? {
    switch band {
    case "thriving": HubBandMeta(label: "Thriving", dot: Color(hex: 0x16A34A), bg: Color(hex: 0xF0FDF4), fg: Color(hex: 0x15803D))
    case "steady":   HubBandMeta(label: "Steady", dot: Color(hex: 0x0EA5E9), bg: Color(hex: 0xE0F2FE), fg: Color(hex: 0x0369A1))
    case "watch":    HubBandMeta(label: "Watch", dot: Color(hex: 0xF59E0B), bg: Color(hex: 0xFFFBEB), fg: Color(hex: 0xB45309))
    case "at_risk":  HubBandMeta(label: "At risk", dot: Color(hex: 0xDC2626), bg: Color(hex: 0xFEF2F2), fg: Color(hex: 0xB91C1C))
    default: nil
    }
}

/// Score chip color scales with the value (band-like), not the member's band.
private func scoreTone(_ v: Double?) -> (bg: Color, fg: Color) {
    guard let v else { return (Color(hex: 0xF1F3F6), Color(hex: 0x6B7280)) }
    if v >= 75 { return (Color(hex: 0xF0FDF4), Color(hex: 0x15803D)) }
    if v >= 55 { return (Color(hex: 0xE0F2FE), Color(hex: 0x0369A1)) }
    if v >= 35 { return (Color(hex: 0xFFFBEB), Color(hex: 0xB45309)) }
    return (Color(hex: 0xFEF2F2), Color(hex: 0xB91C1C))
}

private func reflStatePill(_ s: String) -> (label: String, bg: Color, fg: Color) {
    switch s {
    case "pending":  ("Pending", Color(hex: 0xFFFBEB), Color(hex: 0xB45309))
    case "approved": ("Approved", Color(hex: 0xF0FDF4), Color(hex: 0x15803D))
    case "returned": ("Returned", Color(hex: 0xFEF2F2), Color(hex: 0xB91C1C))
    case "deferred": ("Deferred", Color(hex: 0xEEF2FF), Color(hex: 0x4338CA))
    case "rejected": ("Rejected", Color(hex: 0xFEF2F2), Color(hex: 0xB91C1C))
    default:         (s.capitalized, Color(hex: 0xF1F3F6), Color(hex: 0x6B7280))
    }
}

// Sort: awaiting_level first, then most pending reflections, then band risk
// (mirrors the web's needsActionRank).
private let hubBandRank: [String: Int] = ["at_risk": 0, "watch": 1, "steady": 2, "thriving": 3]
private func needsActionRank(_ r: DiscipleRow) -> Int {
    (r.awaitingLevel != nil ? 0 : 1) * 1000 - r.pendingReflections * 10 + (hubBandRank[r.band ?? "steady"] ?? 2)
}

private func firstName(_ n: String) -> String {
    n.split(separator: " ").first.map(String.init) ?? n
}
private func fmtTimeOnly(_ iso: String) -> String {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
    return d.formatted(date: .omitted, time: .shortened)
}

/// Rounded-rect avatar with the navy-gradient initials fallback (web Avatar).
private struct DiscipleAvatar: View {
    let url: String?
    let name: String
    var size: CGFloat = 42
    var body: some View {
        CachedAsyncImage(url: url.flatMap(URL.init(string:))) { img in
            img.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                LinearGradient(colors: [Nuru.navy, Color(hex: 0x16324F)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                Text(initials(name)).font(.inter(size * 0.34, .semibold)).foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
    }
    private func initials(_ n: String) -> String {
        let p = n.split(separator: " ").prefix(2).compactMap { $0.first }
        return p.isEmpty ? "?" : String(p).uppercased()
    }
}

private struct BandPill: View {
    let band: String?
    var body: some View {
        if let m = hubBand(band) {
            HStack(spacing: 5) {
                Circle().fill(m.dot).frame(width: 6, height: 6)
                Text(m.label).font(.inter(10.5, .bold)).foregroundStyle(m.fg)
            }
            .padding(.horizontal, 9).padding(.vertical, 3.5)
            .background(m.bg).clipShape(Capsule())
        }
    }
}

// MARK: - View model

@MainActor
private final class HubVM: ObservableObject {
    @Published var rows: [DiscipleRow] = []
    @Published var summary: DiscipleRosterSummary?
    @Published var loading = true
    @Published var error: String?
    @Published var selectedId: String?

    var awaiting: Int {
        summary?.awaitingAction ?? rows.filter(\.needsAction).count
    }
    func bandCount(_ band: String) -> Int { rows.filter { $0.band == band }.count }

    /// Load (or refresh) the roster; keeps the current selection when it's still
    /// in the roster, else picks the top needs-action-first row (web behavior).
    func load() async {
        loading = true; error = nil
        do {
            let r = try await PortalAPI.disciplesRoster()
            let sorted = r.data.sorted { needsActionRank($0) < needsActionRank($1) }
            rows = sorted
            summary = r.summary
            if !(selectedId.map { cur in sorted.contains { $0.userId == cur } } ?? false) {
                selectedId = sorted.first?.userId
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not load your disciples."
        }
        loading = false
    }
}

// MARK: - Page

struct DisciplesView: View {
    @StateObject private var vm = HubVM()
    @State private var search = ""
    @State private var toast: ToastData?

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                hero
                VStack(spacing: 18) {
                    statStrip
                    if let error = vm.error { errorBanner(error) }
                    content
                }
                .padding(.horizontal, 20)
                .macContentColumn()   // Mac: readable centered column; iPhone/iPad unchanged
            }
            .padding(.bottom, 40)
        }
        .background(Nuru.paper)
        .portalPage("Discipleship Hub")
        .toast($toast)
        .task { if vm.rows.isEmpty { await vm.load() } }
        .refreshable { await vm.load() }
    }

    // Hero — navy banner (web hero: breadcrumb, "N need attention", Refresh).
    private var hero: some View {
        PortalHero(breadcrumb: ["Operations", "Discipleship Hub"],
                   title: "Discipleship Hub",
                   subtitle: "Your disciples and their journey — progress, engagement and what they're waiting on, all in one place.") {
            HStack(spacing: 8) {
                if vm.awaiting > 0 {
                    HeroChip(label: "\(vm.awaiting) need attention", icon: "sparkles", style: .tag)
                }
                HeroChip(label: "Refresh", icon: "arrow.clockwise", style: .ghost) {
                    Task { await vm.load() }
                }
                .opacity(vm.loading ? 0.6 : 1)
            }
        }
    }

    // Stat cards — Disciples / Awaiting action / On watch / At risk (web tints).
    private var statStrip: some View {
        let cards: [(String, String, String, Color)] = [
            ("Disciples", "\(vm.summary?.totalStudents ?? vm.rows.count)", "person.2.fill", Color(hex: 0x1E4E8C)),
            ("Awaiting action", "\(vm.awaiting)", "hands.and.sparkles.fill", Color(hex: 0x8A6B1F)),
            ("On watch", "\(vm.bandCount("watch"))", "clock.fill", Color(hex: 0xB45309)),
            ("At risk", "\(vm.bandCount("at_risk"))", "exclamationmark.circle.fill", Color(hex: 0xB91C1C)),
        ]
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 12)], spacing: 12) {
            ForEach(cards, id: \.0) { c in
                Card(padding: 14) {
                    HStack(spacing: 12) {
                        TintedIcon(systemName: c.2, color: c.3, size: 42)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.0).font(.nCaption).foregroundStyle(Nuru.ink600)
                                .lineLimit(1).minimumScaleFactor(0.85)
                            Text(c.1).font(.fraunces(22, .medium)).foregroundStyle(Nuru.navy)
                                .contentTransition(.numericText())
                                .animation(.default, value: c.1)
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }

    private func errorBanner(_ text: String) -> some View {
        HStack(spacing: 10) {
            Text(text).font(.inter(13, .semibold)).foregroundStyle(Color(hex: 0xA8281F))
            Spacer(minLength: 0)
            Button("Try again") { Task { await vm.load() } }
                .font(.inter(12, .bold)).tint(Color(hex: 0xA8281F))
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color(hex: 0xFDECEC))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
    }

    // Master–detail (roster | dossier), stacking on narrow widths.
    @ViewBuilder
    private var content: some View {
        if vm.loading && vm.rows.isEmpty {
            SkeletonList(rows: 5)
        } else if vm.rows.isEmpty {
            // Error case: the banner above already carries the message + retry.
            if vm.error == nil { emptyRoster }
        } else {
            let roster = rosterList
            let detail = Group {
                if let sel = vm.selectedId {
                    DossierPanel(studentId: sel,
                                 onNotice: { toast = .success($0) },
                                 onMutated: { Task { await vm.load() } })
                        .id(sel)
                } else {
                    Card(padding: 40) {
                        Text("Select a disciple to see their journey.")
                            .font(.nBody).foregroundStyle(Nuru.ink600)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    roster.frame(width: 390)
                    detail.frame(maxWidth: .infinity)
                }
                VStack(spacing: 18) {
                    roster
                    detail
                }
            }
        }
    }

    // Empty state — the web's "no disciples assigned yet" card.
    private var emptyRoster: some View {
        Card(padding: 48) {
            VStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color(hex: 0xF5E7C5)).frame(width: 72, height: 72)
                    Image(systemName: "figure.2.arms.open").font(.system(size: 30))
                        .foregroundStyle(Color(hex: 0x92651B))
                }
                Text("You don't have any disciples assigned yet.")
                    .font(.nTitle).foregroundStyle(Nuru.navy).multilineTextAlignment(.center)
                Text("When members are added to a cell you lead — or paired with you directly — they'll appear here for you to walk with on their journey.")
                    .font(.nBody).foregroundStyle(Nuru.ink600)
                    .multilineTextAlignment(.center).frame(maxWidth: 440)
            }
            .frame(maxWidth: .infinity)
        }
    }

    // Roster — search + triaged rows (needs-action first).
    private var rosterList: some View {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        let filtered = q.isEmpty ? vm.rows : vm.rows.filter {
            $0.fullName.lowercased().contains(q) || ($0.cellName ?? "").lowercased().contains(q)
        }
        return VStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Nuru.ink600)
                TextField("Search disciples", text: $search)
                    .font(.nCaption).textFieldStyle(.plain)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                if !search.isEmpty {
                    Button { search = "" } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 13)).foregroundStyle(Nuru.ink400)
                    }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))

            if filtered.isEmpty {
                Card(padding: 24) {
                    Text("No disciples match “\(search)”.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600).frame(maxWidth: .infinity)
                }
            } else {
                ForEach(filtered) { r in
                    rosterRow(r, active: r.userId == vm.selectedId)
                }
            }
        }
    }

    private func rosterRow(_ r: DiscipleRow, active: Bool) -> some View {
        Button { vm.selectedId = r.userId } label: {
            HStack(alignment: .top, spacing: 12) {
                DiscipleAvatar(url: r.avatarUrl, name: r.fullName, size: 42)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(r.fullName).font(.inter(14, .bold))
                            .foregroundStyle(active ? .white : Nuru.foreground).lineLimit(1)
                        BandPill(band: r.band)
                    }
                    HStack(spacing: 6) {
                        Text(r.cellName ?? "No cell").lineLimit(1)
                        Text("·")
                        Text("Level \(r.currentLevel)")
                        HStack(spacing: 3) {
                            Image(systemName: "flame.fill").font(.system(size: 10))
                                .foregroundStyle(r.streakDays > 0 ? Color(hex: 0xE0913A) : (active ? Color.white.opacity(0.7) : Nuru.ink400))
                            Text("\(r.streakDays)d")
                        }
                    }
                    .font(.nMicro)
                    .foregroundStyle(active ? Color.white.opacity(0.7) : Nuru.ink600)
                    if r.needsAction { needsActionBadges(r, active: active) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(active ? Nuru.navy : Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous)
                .stroke(active ? Nuru.navy : Color(hex: 0x0A2540, alpha: 0.14), lineWidth: 1))
            .nuruShadow(active ? 1.2 : 0.6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(r.fullName), level \(r.currentLevel)\(r.needsAction ? ", needs action" : "")")
    }

    private func needsActionBadges(_ r: DiscipleRow, active: Bool) -> some View {
        HStack(spacing: 6) {
            if let lvl = r.awaitingLevel {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.up.right").font(.system(size: 8, weight: .bold))
                    Text("Level \(lvl) to usher").font(.inter(10, .bold))
                }
                .foregroundStyle(active ? Color(hex: 0xF5C77E) : Color(hex: 0x8A6B1F))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Nuru.gold.opacity(0.18))
                .overlay(Capsule().stroke(Nuru.gold.opacity(0.35), lineWidth: 1))
                .clipShape(Capsule())
            }
            if r.pendingReflections > 0 {
                HStack(spacing: 4) {
                    Image(systemName: "book").font(.system(size: 8, weight: .bold))
                    Text("\(r.pendingReflections) reflection\(r.pendingReflections == 1 ? "" : "s")")
                        .font(.inter(10, .bold))
                }
                .foregroundStyle(active ? Color(hex: 0xDCE9F7) : Color(hex: 0x1E4E8C))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(active ? Color.white.opacity(0.14) : Color(hex: 0xEEF4FB))
                .clipShape(Capsule())
            }
        }
        .padding(.top, 2)
    }
}

// MARK: - Dossier panel (the full journey + the three inline actions)

private struct DossierPanel: View {
    let studentId: String
    let onNotice: (String) -> Void
    let onMutated: () -> Void

    @State private var d: DiscipleDossier?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        Group {
            if loading && d == nil {
                Card(padding: 24) {
                    VStack(alignment: .leading, spacing: 12) {
                        Skeleton(height: 18, width: 220)
                        Skeleton(height: 12, width: 140)
                        SkeletonGrid(tiles: 6, columns: 3).padding(.top, 10)
                    }
                }
            } else if let error, d == nil {
                Card(padding: 16) {
                    HStack(spacing: 10) {
                        Text(error).font(.inter(13, .semibold)).foregroundStyle(Color(hex: 0xA8281F))
                        Spacer(minLength: 0)
                        Button("Try again") { Task { await load() } }
                            .font(.inter(12, .bold)).tint(Color(hex: 0xA8281F))
                    }
                }
            } else if let d {
                VStack(spacing: 14) {
                    headerCard(d)
                    scoresCard(d)
                    if let lvl = d.progression.awaitingLevel {
                        UsherCard(studentId: studentId, awaitingLevel: lvl, name: d.member.fullName) {
                            onNotice("\(firstName(d.member.fullName)) ushered into Level \($0).")
                            Task { await load() }
                            onMutated()
                        }
                    }
                    reflectionsCard(d)
                    if !d.recentActivity.isEmpty { activityCard(d) }
                    MessengerCard(studentId: d.member.userId,
                                  studentName: d.member.fullName,
                                  conversationId: d.dmConversationId,
                                  onConversationCreated: { Task { await load() } })
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        loading = true; error = nil
        do { d = try await PortalAPI.discipleDossier(studentId) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load this disciple's journey." }
        loading = false
    }

    // Header — avatar, name, band, cell · with-you-since/joined + progression tile.
    private func headerCard(_ d: DiscipleDossier) -> some View {
        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 14) {
                    DiscipleAvatar(url: d.member.avatarUrl, name: d.member.fullName, size: 56)
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 8) {
                            Text(d.member.fullName).font(.fraunces(21, .medium)).foregroundStyle(Nuru.navy)
                                .lineLimit(1).minimumScaleFactor(0.8)
                            BandPill(band: d.engagement.band)
                        }
                        Text(subtitleLine(d)).font(.nCaption).foregroundStyle(Nuru.ink600)
                    }
                    Spacer(minLength: 0)
                }
                progressionTile(d)
            }
        }
    }

    private func subtitleLine(_ d: DiscipleDossier) -> String {
        var s = d.member.cellName ?? "No cell"
        if let est = d.member.establishedAt { s += " · with you since \(Fmt.date(est))" }
        else if let joined = d.member.joinedAt { s += " · joined \(Fmt.date(joined))" }
        return s
    }

    private func progressionTile(_ d: DiscipleDossier) -> some View {
        let p = d.progression
        let pct = p.modulesTotal > 0 ? Double(p.modulesCompleted) / Double(p.modulesTotal) * 100 : 0
        return SurfaceTile(padding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    HStack(spacing: 8) {
                        Text("Level \(p.currentLevel)").font(.inter(11.5, .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Nuru.navy).clipShape(Capsule())
                        Text(p.levelTitle).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.foreground)
                            .lineLimit(1).minimumScaleFactor(0.85)
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Image(systemName: "flame.fill").font(.system(size: 11))
                            .foregroundStyle(p.streakDays > 0 ? Color(hex: 0xE0913A) : Nuru.ink400)
                        Text("\(p.streakDays)-day streak").font(.inter(12, .semibold)).foregroundStyle(Nuru.ink600)
                    }
                }
                HStack {
                    Text("Modules").font(.nMicro).foregroundStyle(Nuru.ink600)
                    Spacer()
                    Text("\(p.modulesCompleted)/\(p.modulesTotal)").font(.inter(11.5, .bold)).foregroundStyle(Nuru.foreground)
                }
                ProgressBar(pct: pct, fill: Nuru.gold, height: 8)
            }
        }
    }

    // Growth scores — six tone-scaled tiles + the engagement line (web grid).
    private func scoresCard(_ d: DiscipleDossier) -> some View {
        let rows: [(String, Double?)] = [
            ("Overall", d.scores.overall), ("Word", d.scores.word), ("Prayer", d.scores.prayer),
            ("Habits", d.scores.habits), ("Curriculum", d.scores.curriculum), ("Attendance", d.scores.attendance),
        ]
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                sectionLabel("Growth scores", icon: "waveform.path.ecg")
                // Mac: score tiles flow to as many ≥200pt columns as fit; elsewhere the
                // fixed 3-up grid the iPad ships with.
                if MacDesign.isMac {
                    MacGrid(minWidth: 200, spacing: 10) { scoreTiles(rows) }
                } else {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                        scoreTiles(rows)
                    }
                }
                HStack(spacing: 16) {
                    HStack(spacing: 6) {
                        Circle().fill(hubBand(d.engagement.band)?.dot ?? Nuru.ink400).frame(width: 7, height: 7)
                        Text("Engagement \(d.engagement.eScore.map { "\(Int($0.rounded()))" } ?? "—")")
                    }
                    HStack(spacing: 5) {
                        Image(systemName: "clock").font(.system(size: 11))
                        Text(activityLine(d.engagement.daysSinceLastActivity))
                    }
                    Spacer(minLength: 0)
                }
                .font(.nMicro).foregroundStyle(Nuru.ink600)
            }
        }
    }

    /// The six tone-scaled score tiles (shared by the Mac flow grid and the iPad 3-up grid).
    private func scoreTiles(_ rows: [(String, Double?)]) -> some View {
        ForEach(rows, id: \.0) { row in
            let t = scoreTone(row.1)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.0).font(.inter(11, .semibold)).foregroundStyle(t.fg.opacity(0.85))
                Text(row.1.map { "\(Int($0.rounded()))" } ?? "—")
                    .font(.fraunces(23, .medium)).foregroundStyle(t.fg)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(t.bg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        }
    }

    private func activityLine(_ days: Int?) -> String {
        guard let days else { return "No activity yet" }
        return days == 0 ? "Active today" : "\(days)d since active"
    }

    // Reflections — the discipler sees the pastoral body + decides inline.
    private func reflectionsCard(_ d: DiscipleDossier) -> some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                sectionLabel("Reflections", icon: "book")
                if d.reflections.isEmpty {
                    Text("No reflections submitted yet.").font(.nCaption).foregroundStyle(Nuru.ink600)
                } else {
                    VStack(spacing: 12) {
                        ForEach(d.reflections) { r in
                            ReflectionDecisionCard(r: r) { verb in
                                onNotice("Reflection \(verb).")
                                Task { await load() }
                                onMutated()
                            }
                        }
                    }
                }
            }
        }
    }

    // Recent activity — kind + timestamp rows, cap 20 (web list).
    private func activityCard(_ d: DiscipleDossier) -> some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                sectionLabel("Recent activity", icon: "sparkles")
                VStack(spacing: 9) {
                    ForEach(Array(d.recentActivity.prefix(20).enumerated()), id: \.offset) { _, a in
                        HStack(spacing: 10) {
                            Circle().fill(Nuru.gold).frame(width: 7, height: 7)
                            Text(a.kind.replacingOccurrences(of: "_", with: " ").capitalized)
                                .font(.inter(12.5, .medium)).foregroundStyle(Nuru.foreground)
                            Spacer(minLength: 8)
                            Text("\(Fmt.date(a.occurredAt)) · \(fmtTimeOnly(a.occurredAt))")
                                .font(.nMicro).foregroundStyle(Nuru.ink600)
                        }
                    }
                }
            }
        }
    }

    private func sectionLabel(_ title: String, icon: String) -> some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(Nuru.gold)
            Text(title).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
        }
    }
}

// MARK: - Usher-to-next-level card (gold, with an optional blessing note)

private struct UsherCard: View {
    let studentId: String
    let awaitingLevel: Int
    let name: String
    let onDone: (Int) -> Void

    @State private var note = ""
    @State private var busy = false
    @State private var err: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 7) {
                Image(systemName: "arrow.up.right").font(.system(size: 14, weight: .bold)).foregroundStyle(Color(hex: 0x8A6B1F))
                Text("Ready to advance to Level \(awaitingLevel)")
                    .font(.fraunces(15.5, .medium)).foregroundStyle(Color(hex: 0x7A5A15))
            }
            Text("\(firstName(name)) passed the level exam. Usher them into Level \(awaitingLevel) — add a blessing to send along.")
                .font(.nCaption).foregroundStyle(Color(hex: 0x8A6B1F))
                .fixedSize(horizontal: false, vertical: true)
            noteEditor
            if let err {
                Text(err).font(.inter(12, .semibold)).foregroundStyle(Color(hex: 0xA8281F))
                    .padding(.horizontal, 11).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: 0xFDECEC))
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
            }
            Button { Task { await usher() } } label: {
                HStack(spacing: 8) {
                    if busy { ProgressView().tint(.white) }
                    else { Image(systemName: "checkmark.circle.fill").font(.system(size: 14)).foregroundStyle(Nuru.goldHi) }
                    Text(busy ? "Ushering…" : "Usher to Level \(awaitingLevel)")
                        .font(.inter(13, .bold)).foregroundStyle(.white)
                }
                .padding(.horizontal, 18).frame(height: 40)
                .background(Nuru.navy)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            }
            .pressable()
            .disabled(busy)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [Color(hex: 0xFBF3DF), Color(hex: 0xF7E8C4)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
            .stroke(Nuru.gold.opacity(0.4), lineWidth: 1))
    }

    private var noteEditor: some View {
        ZStack(alignment: .topLeading) {
            if note.isEmpty {
                Text("Blessing note (optional)…").font(.nCaption).foregroundStyle(Nuru.ink400)
                    .padding(.horizontal, 14).padding(.vertical, 11)
            }
            TextEditor(text: $note)
                .font(.nCaption).foregroundStyle(Nuru.foreground)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 10).padding(.vertical, 4)
                .frame(minHeight: 58)
        }
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous)
            .stroke(Nuru.gold.opacity(0.4), lineWidth: 1))
    }

    /// The usher route takes the ADVANCEMENT id, so resolve it from the pending
    /// level-review queue first (the dossier only carries the awaiting level).
    private func usher() async {
        busy = true; err = nil
        do {
            let reviews = try await PortalAPI.levelReviews()
            let adv = reviews.first { $0.userId == studentId && $0.levelNumber == awaitingLevel }
                ?? reviews.first { $0.userId == studentId }
            guard let adv else {
                err = "Couldn't find the pending advancement — it may already be ushered, or this member is outside your assigned cells."
                busy = false
                return
            }
            try await PortalAPI.usherLevel(advancementId: adv.id, note: note)
            onDone(awaitingLevel)
        } catch {
            err = (error as? APIError)?.errorDescription ?? "Could not usher this disciple. Please try again."
        }
        busy = false
    }
}

// MARK: - One reflection with an inline approve / return / defer decision

private struct ReflectionDecisionCard: View {
    let r: DiscipleReflection
    let onDone: (String) -> Void

    @State private var returnMode = false
    @State private var feedback = ""
    @State private var busy = false
    @State private var err: String?

    private var pending: Bool { r.state == "pending" || r.state == "deferred" }

    var body: some View {
        let pill = reflStatePill(r.state)
        VStack(alignment: .leading, spacing: 9) {
            // Title row: module · level pill · state pill · date
            HStack(spacing: 8) {
                Text(r.moduleTitle).font(.inter(13, .bold)).foregroundStyle(Nuru.foreground)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Text("Level \(r.levelNumber)").font(.inter(10, .bold)).foregroundStyle(Color(hex: 0x1E4E8C))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color(hex: 0xEEF4FB)).clipShape(Capsule())
                Text(pill.label).font(.inter(10, .bold)).foregroundStyle(pill.fg)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(pill.bg).clipShape(Capsule())
                Spacer(minLength: 6)
                Text(Fmt.date(r.submittedAt)).font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            // The pastoral body — the discipler DOES see it here (unlike /me).
            Text(r.body).font(.nCaption).foregroundStyle(Nuru.foreground)
                .lineSpacing(4).fixedSize(horizontal: false, vertical: true)
            if let fb = r.feedbackNotes, !fb.isEmpty {
                (Text("Your feedback: ").bold() + Text(fb))
                    .font(.nMicro).foregroundStyle(Color(hex: 0x1E4E8C))
                    .padding(.horizontal, 11).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: 0xEEF4FB))
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
            }
            if pending { decisionRow }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    @ViewBuilder
    private var decisionRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            if returnMode {
                ZStack(alignment: .topLeading) {
                    if feedback.isEmpty {
                        Text("What should they revisit? (required to return)")
                            .font(.nMicro).foregroundStyle(Nuru.ink400)
                            .padding(.horizontal, 12).padding(.vertical, 9)
                    }
                    TextEditor(text: $feedback)
                        .font(.nCaption).foregroundStyle(Nuru.foreground)
                        .scrollContentBackground(.hidden)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .frame(minHeight: 52)
                }
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            }
            if let err {
                Text(err).font(.inter(11.5, .semibold)).foregroundStyle(Color(hex: 0xA8281F))
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: 0xFDECEC))
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
            }
            HStack(spacing: 8) {
                actionButton("Approve", icon: "checkmark.circle", fg: .white, bg: Color(hex: 0x0F6B33), border: .clear) {
                    Task { await decide("approve") }
                }
                actionButton(returnMode ? "Send return" : "Return", icon: "arrow.uturn.backward",
                             fg: returnMode ? .white : Color(hex: 0xB91C1C),
                             bg: returnMode ? Color(hex: 0xB91C1C) : Nuru.white,
                             border: Color(hex: 0xE7B7B2)) {
                    if returnMode { Task { await decide("return") } }
                    else { returnMode = true; err = nil }
                }
                actionButton("Defer", icon: "pause.circle", fg: Color(hex: 0x4338CA), bg: Nuru.white, border: Color(hex: 0xC7CBF0)) {
                    Task { await decide("defer") }
                }
                if returnMode {
                    Button("Cancel") { returnMode = false; feedback = ""; err = nil }
                        .font(.inter(12, .medium)).tint(Nuru.ink600)
                        .disabled(busy)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.top, 3)
    }

    private func actionButton(_ title: String, icon: String, fg: Color, bg: Color, border: Color,
                              action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11, weight: .semibold))
                Text(title).font(.inter(12.5, .bold))
            }
            .foregroundStyle(fg)
            .padding(.horizontal, 12).frame(height: 34)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(border, lineWidth: 1))
        }
        .pressable()
        .disabled(busy)
        .opacity(busy ? 0.6 : 1)
    }

    private func decide(_ decision: String) async {
        if decision == "return", feedback.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            err = "Add feedback so they know what to revisit."
            return
        }
        busy = true; err = nil
        do {
            try await PortalAPI.decideReflection(r.reflectionId, decision: decision, feedback: feedback)
            onDone(decision == "approve" ? "approved" : decision == "return" ? "returned" : "deferred")
        } catch {
            err = (error as? APIError)?.errorDescription ?? "Could not record this decision."
        }
        busy = false
    }
}

// MARK: - Messenger (read + send text over the 1:1 DM, creating it on demand)

private struct MessengerCard: View {
    let studentId: String
    let studentName: String
    let conversationId: String?
    let onConversationCreated: () -> Void

    @State private var convId: String?
    @State private var messages: [ChatMessageRow] = []
    @State private var loading = false
    @State private var starting = false
    @State private var sending = false
    @State private var error: String?
    @State private var draft = ""

    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 7) {
                    Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Nuru.gold)
                    Text("Message \(firstName(studentName))").font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                }
                if let error {
                    Text(error).font(.inter(12, .semibold)).foregroundStyle(Color(hex: 0xA8281F))
                        .padding(.horizontal, 11).padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(hex: 0xFDECEC))
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
                }
                if convId == nil { startPrompt } else { thread }
            }
        }
        .task(id: conversationId) {
            convId = conversationId
            if let convId { await loadThread(convId) } else { messages = [] }
        }
    }

    private var startPrompt: some View {
        VStack(spacing: 12) {
            Text("Reach out directly to walk with \(firstName(studentName)) — start a private conversation.")
                .font(.nCaption).foregroundStyle(Nuru.ink600)
                .multilineTextAlignment(.center).frame(maxWidth: 340)
            Button { Task { await start() } } label: {
                HStack(spacing: 8) {
                    if starting { ProgressView().tint(.white) }
                    else { Image(systemName: "bubble.left.fill").font(.system(size: 13)).foregroundStyle(Nuru.goldHi) }
                    Text(starting ? "Starting…" : "Start conversation").font(.inter(13, .bold)).foregroundStyle(.white)
                }
                .padding(.horizontal, 18).frame(height: 40)
                .background(Nuru.navy)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            }
            .pressable()
            .disabled(starting)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
    }

    @ViewBuilder
    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 8) {
                    if loading && messages.isEmpty {
                        Text("Loading conversation…").font(.nMicro).foregroundStyle(Nuru.ink600)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 10)
                    } else if messages.isEmpty {
                        Text("No messages yet — say hello.").font(.nMicro).foregroundStyle(Nuru.ink600)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 10)
                    } else {
                        ForEach(messages) { m in bubble(m).id(m.messageId) }
                    }
                }
                .padding(.vertical, 2)
            }
            .frame(maxHeight: 280)
            .onChange(of: messages.count) { _, _ in
                if let last = messages.last { withAnimation { proxy.scrollTo(last.messageId, anchor: .bottom) } }
            }
            .onAppear {
                if let last = messages.last { proxy.scrollTo(last.messageId, anchor: .bottom) }
            }
        }
        composer
    }

    private func bubble(_ m: ChatMessageRow) -> some View {
        VStack(alignment: m.mine ? .trailing : .leading, spacing: 3) {
            Group {
                if m.msgType.isEmpty || m.msgType == "text" {
                    Text(m.body)
                } else {
                    Text("[\(m.msgType)]").italic().opacity(0.8)
                }
            }
            .font(.nCaption).lineSpacing(3)
            .foregroundStyle(m.mine ? .white : Nuru.foreground)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(m.mine ? Nuru.navy : Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(m.mine ? .clear : Nuru.border, lineWidth: 1))
            .frame(maxWidth: 420, alignment: m.mine ? .trailing : .leading)
            Text(fmtTimeOnly(m.createdAt)).font(.system(size: 10)).foregroundStyle(Nuru.ink400)
        }
        .frame(maxWidth: .infinity, alignment: m.mine ? .trailing : .leading)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Write a message…", text: $draft, axis: .vertical)
                .font(.nCaption).lineLimit(1...4)
                .padding(.horizontal, 13).padding(.vertical, 11)
                .background(Nuru.surface)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                .onSubmit { Task { await send() } }
            Button { Task { await send() } } label: {
                Group {
                    if sending { ProgressView().tint(Nuru.goldHi) }
                    else { Image(systemName: "paperplane.fill").font(.system(size: 15)).foregroundStyle(Nuru.goldHi) }
                }
                .frame(width: 42, height: 42)
                .background(Nuru.navy)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            }
            .pressable()
            .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .opacity(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1)
            .accessibilityLabel("Send")
        }
    }

    private func loadThread(_ id: String) async {
        loading = true; error = nil
        do { messages = try await PortalAPI.chatConversation(id).messages }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load the conversation." }
        loading = false
    }

    private func start() async {
        starting = true; error = nil
        do {
            let id = try await PortalAPI.createDm(userId: studentId)
            convId = id
            await loadThread(id)
            onConversationCreated()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not start a conversation."
        }
        starting = false
    }

    private func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, let convId, !sending else { return }
        sending = true; error = nil
        do {
            try await PortalAPI.sendChatMessage(convId, text: body)
            draft = ""
            await loadThread(convId)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not send your message."
        }
        sending = false
    }
}

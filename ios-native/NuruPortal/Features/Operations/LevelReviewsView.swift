// Level Reviews — the native port of the web portal's LevelReviews.tsx: the
// discipler's "usher members to the next level" triage queue. Lists members
// who passed a level exam and await their discipler advancing them (server-
// scoped to the signed-in leader's cells, §5.4). Each row opens a confirm
// sheet with an optional blessing note, then advances the member and drops
// the row on success. The usher call is server-authoritative and idempotent
// (§1.1, §3.6) — the path param is the ADVANCEMENT id from /reviews/levels,
// exactly the semantics DisciplesView already uses.
// Wire: GET /reviews/levels · POST /reviews/levels/{advancementId}/usher
// (PortalAPI.levelReviews / PortalAPI.usherLevel — reused, not re-declared).
import SwiftUI

// MARK: - Time-waiting helpers (the web's waitingLabel / waitDays)

private enum LR {
    static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    static let isoPlain = ISO8601DateFormatter()
    static func date(_ s: String) -> Date? { isoFrac.date(from: s) ?? isoPlain.date(from: s) }

    static func waitDays(_ s: String) -> Int {
        guard let d = date(s) else { return 0 }
        return max(0, Int(Date().timeIntervalSince(d) / 86400))
    }
    static func waitingLabel(_ s: String) -> String {
        guard let d = date(s) else { return "—" }
        let mins = max(0, Int(Date().timeIntervalSince(d) / 60))
        if mins < 1 { return "Just now" }
        if mins < 60 { return "\(mins)m waiting" }
        let hrs = mins / 60
        if hrs < 24 { return "\(hrs)h waiting" }
        return "\(hrs / 24)d waiting"
    }
    static func score(_ v: Double?) -> Int? { v.map { Int($0.rounded()) } }
    static let slowInk = Color(hex: 0xC2410C)   // ≥4 days waiting reads warm
}

// MARK: - View

struct LevelReviewsView: View {
    @State private var rows: [LevelReviewItem] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var confirmItem: LevelReviewItem?
    @State private var toast: ToastData?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                heroBlock
                VStack(spacing: 18) {
                    if let error, rows.isEmpty, loaded {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else if !loaded {
                        SkeletonGrid(tiles: 3, columns: 3)
                        SkeletonList(rows: 4)
                    } else {
                        statStrip
                        if rows.isEmpty {
                            EmptyState(
                                icon: "person.2",
                                title: "No one is waiting to be ushered right now.",
                                message: "When a member in your cells passes a level exam, they'll appear here for you to advance into the next level.")
                        } else {
                            VStack(spacing: 10) {
                                ForEach(rows) { r in reviewRow(r) }
                            }
                        }
                    }
                }
                .padding(.horizontal, MacDesign.isMac ? 0 : Nuru.S.lg)
                .padding(.top, Nuru.S.lg)
                .padding(.bottom, 48)
            }
            // A triage list reads best in a readable desktop column (not lanes).
            .macContentColumn(MacDesign.contentMaxWidth)
        }
        .background(Nuru.paper)
        .navigationBarTitleDisplayMode(.inline)
        .task { if !loaded { await load() } }
        .refreshable { await load() }
        .toast($toast)
        .sheet(item: $confirmItem) { item in
            UsherConfirmSheet(item: item) { ushered in
                withAnimation(.easeOut(duration: 0.2)) {
                    rows.removeAll { $0.id == ushered.id }
                }
                toast = .success("\(ushered.memberName) ushered into Level \(ushered.levelNumber + 1).")
                confirmItem = nil
            } onCancel: {
                confirmItem = nil
            }
        }
    }

    private func load() async {
        do {
            rows = try await PortalAPI.levelReviews()
            error = nil
        } catch {
            let msg = (error as? APIError)?.errorDescription ?? "Could not load members awaiting ushering."
            if rows.isEmpty { self.error = msg } else { toast = .error(msg) }   // keep content on a failed refresh
        }
        loaded = true
    }

    // MARK: hero

    @ViewBuilder private var heroBlock: some View {
        if MacDesign.isMac {
            hero
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
                .padding(.top, MacDesign.gutter)
        } else {
            hero
        }
    }

    private var hero: some View {
        PortalHero(
            breadcrumb: ["Operations", "Level Reviews"],
            eyebrow: "Discipleship",
            title: "Level Reviews",
            subtitle: "Members who passed their level exam and are ready for you to usher them into the next level of the pathway."
        ) {
            HStack(spacing: 8) {
                if loaded { HeroChip(label: "\(rows.count) awaiting", icon: "sparkles", style: .tag) }
                HeroChip(label: "Refresh", icon: "arrow.clockwise", style: .ghost) {
                    Task { await load() }
                }
            }
        }
    }

    // MARK: stat cards — awaiting / oldest waiting / avg exam score

    private var statStrip: some View {
        let oldest = rows.map { LR.waitDays($0.createdAt) }.max() ?? 0
        let scored = rows.compactMap { LR.score($0.examScore) }
        let avg = scored.isEmpty ? nil : scored.reduce(0, +) / scored.count
        let cards: [(label: String, value: String, icon: String, tint: Color)] = [
            ("Awaiting ushering", "\(rows.count)", "person.fill.checkmark", Color(hex: 0x8A6B1F)),
            ("Oldest waiting", rows.isEmpty ? "—" : "\(oldest)d", "clock.fill", LR.slowInk),
            ("Avg exam score", avg.map { "\($0)%" } ?? "—", "rosette", Color(hex: 0x0F6B33)),
        ]
        // Mac: exactly three flexible columns so the strip fills the row;
        // iPhone/iPad keep the adaptive wrap.
        let columns = MacDesign.isMac
            ? Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
            : [GridItem(.adaptive(minimum: 200), spacing: 12)]
        return LazyVGrid(columns: columns, spacing: 12) {
            ForEach(cards, id: \.label) { c in
                Card(padding: 14) {
                    HStack(spacing: 12) {
                        TintedIcon(systemName: c.icon, color: c.tint, size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.label).font(.nCaption).foregroundStyle(Nuru.ink600)
                                .lineLimit(1).minimumScaleFactor(0.85)
                            Text(c.value).font(.fraunces(22, .medium)).foregroundStyle(Nuru.navy)
                                .contentTransition(.numericText())
                                .animation(.default, value: c.value)
                        }
                        Spacer(minLength: 0)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(c.label): \(c.value)")
            }
        }
    }

    // MARK: queue rows

    private func reviewRow(_ r: LevelReviewItem) -> some View {
        let slow = LR.waitDays(r.createdAt) >= 4
        let identity = HStack(spacing: 12) {
            Monogram(name: r.memberName, size: 44)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(r.memberName).font(.inter(14.5, .bold)).foregroundStyle(Nuru.foreground)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    Pill(text: "Completed Level \(r.levelNumber)", color: Color(hex: 0x92651B))
                }
                HStack(spacing: 8) {
                    if let score = LR.score(r.examScore) {
                        HStack(spacing: 4) {
                            Image(systemName: "rosette").font(.system(size: 10, weight: .semibold))
                            Text("\(score)%").font(.inter(11, .bold))
                        }
                        .foregroundStyle(Color(hex: 0x8A6B1F))
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(Nuru.gold.opacity(0.16))
                        .overlay(Capsule().stroke(Nuru.gold.opacity(0.35), lineWidth: 1))
                        .clipShape(Capsule())
                    }
                    HStack(spacing: 4) {
                        Image(systemName: "clock").font(.system(size: 10))
                        Text("\(LR.waitingLabel(r.createdAt)) · since \(Fmt.date(r.createdAt))")
                            .font(.nMicro)
                    }
                    .foregroundStyle(slow ? LR.slowInk : Nuru.ink600)
                }
            }
            Spacer(minLength: 0)
        }
        let usherButton = Button { confirmItem = r } label: {
            HStack(spacing: 7) {
                Text("Usher to Level \(r.levelNumber + 1)").font(.inter(13, .bold))
                    .lineLimit(1).minimumScaleFactor(0.85)
                Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Nuru.goldGlow)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16).frame(height: 40)
            .background(Nuru.navy)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        }
        .pressable()
        .hoverEffect(.lift)
        .accessibilityLabel("Usher \(r.memberName) to Level \(r.levelNumber + 1)")

        return Card(padding: 16) {
            // Wide: identity + action on one line. Narrow (or large Dynamic
            // Type): the action drops below the identity, full-width.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    identity
                    usherButton
                }
                VStack(alignment: .leading, spacing: 12) {
                    identity
                    usherButton.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

// MARK: - Usher confirm sheet (blessing note)

private struct UsherConfirmSheet: View {
    let item: LevelReviewItem
    let onUshered: (LevelReviewItem) -> Void
    let onCancel: () -> Void

    @State private var note = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    memberRow
                    Text("This advances \(firstName) to Level \(item.levelNumber + 1) and notifies them.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                        .fixedSize(horizontal: false, vertical: true)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 4) {
                            Text("Blessing note").font(.inter(12, .bold)).foregroundStyle(Nuru.foreground)
                            Text("(optional)").font(.inter(12, .medium)).foregroundStyle(Nuru.ink600)
                        }
                        noteEditor
                    }
                    if let error {
                        Text(error)
                            .font(.inter(12.5, .semibold)).foregroundStyle(Color(hex: 0xA8281F))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(Color(hex: 0xFDECEC))
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                    }
                }
                .padding(20)
            }
            footer
        }
        .background(Nuru.paper)
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy)
    }

    private var firstName: String {
        item.memberName.split(separator: " ").first.map(String.init) ?? item.memberName
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.fill.checkmark")
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(Nuru.goldGlow)
            Text("Usher to Level \(item.levelNumber + 1)")
                .font(.fraunces(18, .medium)).foregroundStyle(.white)
                .lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 8)
            Button(action: onCancel) {
                Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(.white.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            .pressable()
            .disabled(busy)
            .opacity(busy ? 0.5 : 1)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 20).padding(.vertical, 16)
        .background(Nuru.navy)
    }

    private var memberRow: some View {
        HStack(spacing: 12) {
            Monogram(name: item.memberName, size: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.memberName).font(.inter(14.5, .bold)).foregroundStyle(Nuru.foreground)
                    .lineLimit(1).minimumScaleFactor(0.85)
                Text("Completed Level \(item.levelNumber)"
                     + (LR.score(item.examScore).map { " · \($0)% exam" } ?? ""))
                    .font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            Spacer(minLength: 0)
        }
    }

    private var noteEditor: some View {
        ZStack(alignment: .topLeading) {
            if note.isEmpty {
                Text("Add an encouraging word to send along with their advancement…")
                    .font(.nBody).foregroundStyle(Nuru.ink400)
                    .padding(.horizontal, 16).padding(.vertical, 12)
            }
            TextEditor(text: $note)
                .font(.nBody).foregroundStyle(Nuru.foreground)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .frame(minHeight: 84)
        }
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Spacer(minLength: 0)
            Button(action: onCancel) {
                Text("Cancel").font(.inter(13, .semibold)).foregroundStyle(Nuru.foreground)
                    .padding(.horizontal, 16).frame(height: 40)
                    .background(Nuru.white)
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous)
                        .stroke(Color(hex: 0x0A2540, alpha: 0.22), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            }
            .pressable()
            .disabled(busy)
            .opacity(busy ? 0.5 : 1)

            Button(action: usher) {
                HStack(spacing: 7) {
                    if busy {
                        ProgressView().controlSize(.small).tint(.white)
                    } else {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(Nuru.goldGlow)
                    }
                    Text(busy ? "Ushering…" : "Usher to Level \(item.levelNumber + 1)")
                        .font(.inter(13, .bold))
                        .lineLimit(1).minimumScaleFactor(0.85)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16).frame(height: 40)
                .background(Nuru.navy)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            }
            .pressable()
            .hoverEffect(.lift)
            .disabled(busy)
            .opacity(busy ? 0.7 : 1)
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
        .background(Nuru.white)
    }

    private func usher() {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                // Path param is the ADVANCEMENT id; idempotent server-side (§3.6).
                try await PortalAPI.usherLevel(advancementId: item.id, note: note)
                onUshered(item)
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Could not usher this member. Please try again."
            }
            busy = false
        }
    }
}

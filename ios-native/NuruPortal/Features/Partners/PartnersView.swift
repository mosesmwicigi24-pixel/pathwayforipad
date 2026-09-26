// Partners — the Partners programme console, a native port of the web
// portal's Partners.tsx (pathway #482; docs/PARTNERS_PROGRAMME.md §1, §3,
// §5–§6). Who has joined, what each partner committed, whether they are
// behind, and — per partner — pledges with server-computed progress, the
// schedules charging them, the payments attributed to each pledge and the
// reminder log. The office's actions: "Send reminder" for one partner
// (optionally one pledge, optional note), "Remind everyone behind", and the
// Claims queue where "I paid another way" claims are confirmed (the server
// records a manual gift and posts the ledger) or rejected.
//
// Layout follows DisciplesView (list rail + detail panel that stacks when
// narrow) under FinanceView's hero + gold-underline tab bar. Every number on
// this page comes from a real endpoint and every "behind" flag from the server
// (§1.1); the 12-hour reminder spacing is enforced server-side — this page
// only reports it. finance:manage gates the actions (server-enforced too).
import SwiftUI

// MARK: - Visual language (web rowChip / progressChip / pledgeStatusChip)

private struct Tone {
    let bg: Color; let fg: Color
    static let green  = Tone(bg: Color(hex: 0xE8F6EC), fg: Color(hex: 0x0F6B33))
    static let amber  = Tone(bg: Color(hex: 0xFFF4DA), fg: Color(hex: 0xA87616))
    static let grey   = Tone(bg: Color(hex: 0xEEF0F3), fg: Color(hex: 0x6B7280))
    static let violet = Tone(bg: Color(hex: 0xF3EAFE), fg: Color(hex: 0x7C3AED))
    static let rose   = Tone(bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xB42318))
    static let navy   = Tone(bg: Color(hex: 0xE6EDF5), fg: Color(hex: 0x1E4068))
    static let gold   = Tone(bg: Color(hex: 0xFDF5E5), fg: Color(hex: 0x8A6B1F))
}
private struct Chip { let label: String; let tone: Tone }

// Row standing: "behind" (server flag) wins in the warning tone; otherwise the
// membership status. A partner who has left is shown, not hidden — the office
// still needs their statement.
private func rowChip(_ r: PartnerRow) -> Chip {
    if r.behind { return Chip(label: "Behind", tone: .amber) }
    switch r.membership?.status {
    case "active": return Chip(label: "Active", tone: .green)
    case "paused": return Chip(label: "Paused", tone: .grey)
    case "left":   return Chip(label: "Left", tone: .rose)
    default:       return Chip(label: "—", tone: .grey)
    }
}

// Server progress labels (§1): on track · behind · fulfilled · paused.
private func progressChip(_ label: String) -> Chip {
    switch label.trimmingCharacters(in: .whitespaces).lowercased() {
    case "behind":              return Chip(label: "Behind", tone: .amber)
    case "fulfilled":           return Chip(label: "Fulfilled", tone: .violet)
    case "paused":              return Chip(label: "Paused", tone: .grey)
    case "on_track", "on track": return Chip(label: "On track", tone: .green)
    default:                    return Chip(label: titleCase(label), tone: .grey)
    }
}

private func pledgeStatusChip(_ s: String) -> Chip {
    switch s {
    case "active":    return Chip(label: "Active", tone: .green)
    case "paused":    return Chip(label: "Paused", tone: .grey)
    case "fulfilled": return Chip(label: "Fulfilled", tone: .violet)
    case "cancelled": return Chip(label: "Cancelled", tone: .rose)
    default:          return Chip(label: titleCase(s), tone: .grey)
    }
}

private func scheduleStatusChip(_ s: String) -> Chip {
    switch s {
    case "active":    return Chip(label: "Active", tone: .green)
    case "paused":    return Chip(label: "Paused", tone: .amber)
    case "cancelled": return Chip(label: "Cancelled", tone: .grey)
    default:          return Chip(label: titleCase(s), tone: .grey)
    }
}

private func titleCase(_ s: String) -> String {
    s.isEmpty ? "—" : s.prefix(1).uppercased() + s.dropFirst().replacingOccurrences(of: "_", with: " ")
}
private func shortRef(_ id: String) -> String {
    id.count > 12 ? "\(id.prefix(8))…\(id.suffix(4))" : id
}
/// The programme's money format, as FinanceView does it: integer minor units →
/// `Fmt.money`; the programme default currency is KES when a row carries none.
private func money(_ minor: Int, _ currency: String?) -> String {
    Fmt.money(minor: minor, currency: (currency?.isEmpty == false) ? currency : "KES")
}

private func pledgeTarget(_ p: PartnerPledge) -> String {
    if let name = p.fund?.name, !name.isEmpty { return name }
    if let title = p.campaign?.title, !title.isEmpty { return title }
    if p.needId != nil { return "A department need" }
    return "General partnership"
}
private func pledgeShortLabel(_ p: PartnerPledge) -> String {
    "\(p.isMonthly ? "Monthly" : "Total") · \(pledgeTarget(p))"
}
// The pledge's terms in one line (§1): monthly amount + due day, or target + due date.
private func pledgeTerms(_ p: PartnerPledge) -> String {
    if p.isMonthly {
        return "\(money(p.amountMinor, p.currency)) every month" + (p.dueDay.map { " · due day \($0)" } ?? "")
    }
    return "\(money(p.targetMinor, p.currency)) by \(PgDate.day(p.dueOn))"
}

/// An inline notice in one of three tones (web Notice / Result).
private struct Notice: Equatable {
    enum Kind { case ok, warn, error }
    let kind: Kind
    let text: String
    var fg: Color { switch kind { case .ok: Color(hex: 0x0F6B33); case .warn: Color(hex: 0xA87616); case .error: Color(hex: 0xB42318) } }
    var bg: Color { switch kind { case .ok: Color(hex: 0xE8F6EC); case .warn: Color(hex: 0xFFF4DA); case .error: Color(hex: 0xFDECEC) } }
    var border: Color { switch kind { case .ok: Color(hex: 0xBFE3CB); case .warn: Color(hex: 0xF3DFA6); case .error: Color(hex: 0xF5C2C0) } }
}

// The office's reading of a remind response (§3): a skip means a reminder —
// automatic or manual — already went out in the last 12 hours.
private func describeRemind(_ r: RemindResult) -> Notice {
    let h = PartnersAPI.reminderSpacingHours
    if r.reminded == 0 && r.skipped > 0 { return Notice(kind: .warn, text: "Skipped — reminded within the last \(h) hours") }
    if r.reminded > 0 && r.skipped > 0 { return Notice(kind: .ok, text: "Reminded \(r.reminded) · skipped \(r.skipped)") }
    if r.reminded > 0 { return Notice(kind: .ok, text: "Reminded \(r.reminded)") }
    return Notice(kind: .warn, text: "Nothing to remind")
}

private func plural(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n == 1 ? one : many)" }

private struct FilterOption: Identifiable { let label: String; let value: String; var id: String { value } }
private let statusFilters: [FilterOption] = [
    .init(label: "All", value: "all"), .init(label: "Active", value: "active"), .init(label: "Paused", value: "paused"),
    .init(label: "Behind", value: "behind"), .init(label: "Left", value: "left"),
]
private let sortOptions: [FilterOption] = [
    .init(label: "Recent", value: "recent"), .init(label: "Committed", value: "committed"), .init(label: "Behind first", value: "behind"),
]

private enum PartnersTab: String, CaseIterable {
    case partners, claims
    var label: String { self == .partners ? "Partners" : "Claims" }
}

// MARK: - Small pieces (local copies — every page keeps its own)

private struct ChipPill: View {
    let chip: Chip
    var body: some View {
        Text(chip.label).font(.inter(11, .bold)).tracking(0.2)
            .foregroundStyle(chip.tone.fg)
            .padding(.horizontal, 9).padding(.vertical, 3)
            .background(chip.tone.bg)
            .clipShape(Capsule())
            .lineLimit(1).fixedSize()
    }
}

private struct NoticeBar: View {
    let notice: Notice
    var onDismiss: (() -> Void)? = nil
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: notice.kind == .ok ? "checkmark" : "exclamationmark.triangle")
                .font(.system(size: 12, weight: .bold))
            Text(notice.text).font(.inter(12.5, .semibold)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let onDismiss {
                Button(action: onDismiss) { Image(systemName: "xmark").font(.system(size: 11, weight: .bold)) }
                    .buttonStyle(.plain).accessibilityLabel("Dismiss")
            }
        }
        .foregroundStyle(notice.fg)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(notice.bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(notice.border, lineWidth: 1))
    }
}

/// Rounded-rect avatar with a gradient-initials fallback (web Avatar, seeded).
private struct PersonAvatar: View {
    let url: String?
    let name: String
    var seed = 0
    var size: CGFloat = 40
    private static let gradients: [[Color]] = [
        [Nuru.navy, Color(hex: 0x1E4068)], [Nuru.gold, Color(hex: 0x8B6914)],
        [Color(hex: 0x16A34A), Color(hex: 0x065F46)], [Color(hex: 0x7C3AED), Color(hex: 0x4C1D95)],
        [Color(hex: 0xDC2626), Color(hex: 0x7F1D1D)], [Color(hex: 0x0EA5E9), Color(hex: 0x075985)],
    ]
    var body: some View {
        CachedAsyncImage(url: url.flatMap(URL.init(string:))) { img in
            img.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                LinearGradient(colors: Self.gradients[((seed % 6) + 6) % 6], startPoint: .topLeading, endPoint: .bottomTrailing)
                Text(initials(name)).font(.inter(size * 0.34, .semibold)).foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }
    private func initials(_ n: String) -> String {
        let p = n.split(separator: " ").prefix(2).compactMap { $0.first }
        return p.isEmpty ? "?" : String(p).uppercased()
    }
}

/// Table header cell (FinanceView `Th`).
private struct Th: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Count badge for tabs / hero chips (web's mono pill).
private struct CountBadge: View {
    let count: Int
    var lit = true
    var body: some View {
        Text("\(count)").font(.nMono(11))
            .foregroundStyle(lit ? Color(hex: 0xA87616) : Nuru.ink600)
            .padding(.horizontal, 6).frame(minWidth: 18, minHeight: 18)
            .background(lit ? Color(hex: 0xFFF4DA) : Nuru.mutedBg)
            .clipShape(Capsule())
    }
}

private struct FilterChips: View {
    let options: [FilterOption]
    @Binding var selection: String
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(options) { o in
                    let on = selection == o.value
                    Button { selection = o.value } label: {
                        Text(o.label).font(.inter(12.5, .semibold))
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(on ? Nuru.navy : Nuru.white)
                            .foregroundStyle(on ? .white : Nuru.navy)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(on ? Nuru.navy : Nuru.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                }
            }
        }
    }
}

/// An action button: navy (primary), rose (danger) or white (default); `busy`
/// swaps the icon for a spinner and disables it.
private struct ActionButton: View {
    enum Style { case primary, danger, plain }
    let title: String
    let icon: String
    var style: Style = .plain
    var busy = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy { ProgressView().tint(fg).scaleEffect(0.8) }
                else { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
                Text(title).font(.inter(12.5, .bold))
            }
            .foregroundStyle(fg)
            .padding(.horizontal, 12).frame(height: 34)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(border, lineWidth: 1))
        }
        .pressable()
        .hoverEffect(.lift)
        .disabled(busy)
        .opacity(busy ? 0.6 : 1)
    }
    private var fg: Color { switch style { case .primary: .white; case .danger: Color(hex: 0xB42318); case .plain: Nuru.navy } }
    private var bg: Color { switch style { case .primary: Nuru.navy; case .danger: Color(hex: 0xFDECEC); case .plain: Nuru.white } }
    private var border: Color { switch style { case .primary: Nuru.navy; case .danger: Color(hex: 0xF5C2C0); case .plain: Nuru.border } }
}

// MARK: - View model

@MainActor
private final class PartnersVM: ObservableObject {
    @Published var rows: [PartnerRow] = []
    @Published var summary: PartnersSummary?
    @Published var loading = true
    @Published var error: String?
    // filters — all three are server-side (§5: ?q=&status=&sort=)
    @Published var search = ""
    @Published var status = "all"
    @Published var sort = "recent"
    @Published var selectedId: String?
    // claims queue (§1 d) — loaded up front so the hero badge is right on any tab
    @Published var claims: [PledgeClaimRow] = []
    @Published var claimsLoading = true
    @Published var claimsError: String?
    /// The one claim decision in flight (its id) — the others wait.
    @Published var deciding: String?
    @Published var remindingAll = false
    @Published var heroNotice: Notice?
    /// Bumped after an action the open detail should re-read (a claim
    /// confirmed is a payment now; "remind everyone" adds a reminders row).
    @Published var detailNonce = 0

    // Out-of-order guards: only the latest request of each kind may land.
    private var listSeq = 0
    private var claimsSeq = 0
    private var reloadTask: Task<Void, Never>?

    var filtersActive: Bool { !search.trimmingCharacters(in: .whitespaces).isEmpty || status != "all" }

    func loadAll() async {
        async let a: Void = loadList()
        async let b: Void = loadClaims()
        _ = await (a, b)
    }

    /// Debounced list reload for the search box (250 ms, like the web).
    func scheduleReload() {
        reloadTask?.cancel()
        reloadTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            await self?.loadList()
        }
    }

    /// Load (or refresh) the list; keeps the current selection when it is
    /// still listed, else picks the top row (DisciplesView behavior).
    func loadList() async {
        listSeq += 1
        let seq = listSeq
        loading = true
        do {
            let page = try await PartnersAPI.list(q: search.trimmingCharacters(in: .whitespaces), status: status, sort: sort)
            guard seq == listSeq else { return }
            rows = page.data
            if let s = page.summary { summary = s }
            error = nil
            if !(selectedId.map { cur in rows.contains { $0.userId == cur } } ?? false) {
                selectedId = rows.first?.userId
            }
        } catch {
            guard seq == listSeq else { return }
            self.error = (error as? APIError)?.errorDescription ?? "Could not load partners."
        }
        if seq == listSeq { loading = false }
    }

    func loadClaims() async {
        claimsSeq += 1
        let seq = claimsSeq
        claimsLoading = true
        do {
            let data = try await PartnersAPI.claims()
            guard seq == claimsSeq else { return }
            claims = data
            claimsError = nil
        } catch {
            guard seq == claimsSeq else { return }
            claimsError = (error as? APIError)?.errorDescription ?? "Could not load claims."
        }
        if seq == claimsSeq { claimsLoading = false }
    }

    // "Remind everyone behind" (§3): the server walks every partner with a
    // pledge behind and applies the 12-hour spacing itself; the page states the
    // blast radius first (the alert) and reports the counts it gets back.
    func remindBehind() async {
        remindingAll = true
        heroNotice = nil
        do {
            let r = try await PartnersAPI.remindBehind()
            let nobody = (r.partners ?? 1) == 0 ? " — nobody is behind" : ""
            heroNotice = Notice(kind: r.reminded > 0 ? .ok : .warn, text: "Reminded \(r.reminded) · skipped \(r.skipped)\(nobody)")
            detailNonce += 1                      // an open detail's reminders log gains its row
        } catch {
            heroNotice = Notice(kind: .error, text: (error as? APIError)?.errorDescription ?? "Could not send reminders.")
        }
        remindingAll = false
    }

    // Confirm / reject a claim (§1 d). Confirming is a money write on the
    // server (a succeeded manual transaction + ledger + receipt) with no undo
    // endpoint, so the page asks first. A 422 (or 404) means the claim was
    // decided elsewhere — the row is stale, so the queue is reloaded rather
    // than retried. Returns the toast text on success.
    func decideClaim(_ c: PledgeClaimRow, decision: String) async -> String? {
        deciding = c.claimId
        defer { deciding = nil }
        do {
            try await PartnersAPI.decideClaim(c.claimId, decision: decision)
            claims.removeAll { $0.claimId == c.claimId }
            claimsError = nil
            if decision == "confirm" {
                await loadList()                  // given-this-year / behind may have moved
                if selectedId == c.userId { detailNonce += 1 }   // it is a payment now
            }
            return decision == "confirm" ? "Recorded as a manual gift" : "Rejected"
        } catch {
            if case let APIError.http(status, message, _) = error, status == 422 || status == 404 {
                claimsError = "\(message) — this claim was decided elsewhere, so the queue was reloaded."
                await loadClaims()
            } else {
                claimsError = (error as? APIError)?.errorDescription
                    ?? (decision == "confirm" ? "Could not confirm the claim." : "Could not reject the claim.")
            }
            return nil
        }
    }
}

/// A claim decision waiting for the office's confirmation.
private struct ClaimPrompt: Identifiable {
    let claim: PledgeClaimRow
    let decision: String                          // confirm | reject
    var id: String { "\(claim.claimId):\(decision)" }
}

// MARK: - Page

struct PartnersView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var vm = PartnersVM()
    @State private var tab: PartnersTab = .partners
    @State private var toast: ToastData?
    @State private var confirmRemindAll = false
    @State private var pendingClaim: ClaimPrompt?

    /// finance:manage gates the actions. A profile still loading fails OPEN
    /// (RootView's isSectionVisible doctrine) — the server enforces the
    /// permission regardless, and its 403 surfaces inline.
    private var canManage: Bool {
        auth.profile.map { $0.permissions.contains("finance:manage") } ?? true
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                tabBar
                content
                    .padding(.horizontal, Nuru.S.lg)
                    .padding(.top, Nuru.S.lg)
                    .padding(.bottom, 48)
                    .macContentColumn(MacDesign.workspaceMaxWidth)
            }
        }
        .background(Nuru.paper)
        .navigationBarTitleDisplayMode(.inline)
        .toast($toast)
        .task { if vm.rows.isEmpty && vm.summary == nil { await vm.loadAll() } }
        .refreshable { await vm.loadAll() }
        .onChange(of: vm.search) { _, _ in vm.scheduleReload() }
        .onChange(of: vm.status) { _, _ in Task { await vm.loadList() } }
        .onChange(of: vm.sort) { _, _ in Task { await vm.loadList() } }
        // Reload the queue whenever it is opened — another admin may have decided meanwhile.
        .onChange(of: tab) { _, new in if new == .claims { Task { await vm.loadClaims() } } }
        .alert("Remind everyone behind?", isPresented: $confirmRemindAll) {
            Button("Cancel", role: .cancel) {}
            Button("Send reminders") { Task { await vm.remindBehind() } }
        } message: {
            Text(remindAllQuestion)
        }
        .alert(pendingClaim?.decision == "confirm" ? "Record as a manual gift?" : "Reject this claim?",
               isPresented: Binding(get: { pendingClaim != nil }, set: { if !$0 { pendingClaim = nil } }),
               presenting: pendingClaim) { p in
            Button("Cancel", role: .cancel) { pendingClaim = nil }
            if p.decision == "confirm" {
                Button("Confirm") { decide(p) }
            } else {
                Button("Reject", role: .destructive) { decide(p) }
            }
        } message: { p in
            Text(claimQuestion(p))
        }
    }

    private var remindAllQuestion: String {
        let n = vm.summary?.behind ?? 0
        let who = n == 1 ? "the 1 partner who is behind" : "the \(n) partners who are behind"
        return "Remind \(who)?\n\nAnyone reminded in the last \(PartnersAPI.reminderSpacingHours) hours — automatically or by the office — is skipped, so nobody is nagged twice."
    }

    private func claimQuestion(_ p: ClaimPrompt) -> String {
        let amount = money(p.claim.amountMinor, p.claim.currency)
        return p.decision == "confirm"
            ? "Record \(amount) from \(p.claim.fullName) as a manual gift toward “\(p.claim.pledgeTitle)”?\n\nThis posts to the ledger and sends them a receipt. It cannot be undone here."
            : "Reject \(p.claim.fullName)'s claim of \(amount)?\n\nThey will be told."
    }

    private func decide(_ p: ClaimPrompt) {
        pendingClaim = nil
        Task { if let text = await vm.decideClaim(p.claim, decision: p.decision) { toast = .success(text) } }
    }

    // MARK: hero — shared PortalHero (breadcrumb · title · stat strip · trailing chips)

    private var hero: some View {
        let s = vm.summary
        let behind = s?.behind ?? 0
        return PortalHero(
            breadcrumb: ["Finance", "Partners"],
            title: "Partners",
            stats: [
                HeroStat(label: "Partners", value: s.map { String($0.partners) } ?? "—", hint: "in the programme"),
                HeroStat(label: "Active pledges", value: s.map { String($0.activePledges) } ?? "—", hint: "monthly + total"),
                HeroStat(label: "Committed / month", value: s.map { money($0.committedMonthlyMinor, nil) } ?? "—", hint: "across monthly pledges"),
                HeroStat(label: "Behind", value: s.map { String($0.behind) } ?? "—", hint: "partners past due",
                         tint: behind > 0 ? Color(hex: 0xF5C77E) : nil),
                HeroStat(label: "Given this year", value: s.map { money($0.givenYearMinor, nil) } ?? "—", hint: "attributed to pledges"),
            ]
        ) {
            HStack(spacing: 8) {
                HeroChip(label: s.map { plural($0.partners, "partner", "partners") } ?? "Partners programme",
                         icon: "heart.fill", style: .tag)
                HeroChip(label: vm.claimsLoading && vm.claims.isEmpty ? "Claims · …" : "Claims · \(vm.claims.count)",
                         icon: "list.clipboard", style: .ghost) { tab = .claims }
                if canManage {
                    HeroChip(label: vm.remindingAll ? "Reminding…" : "Remind everyone behind",
                             icon: "paperplane", style: .gold) { confirmRemindAll = true }
                        .disabled(vm.remindingAll || s == nil || behind == 0)
                        .opacity(vm.remindingAll || s == nil || behind == 0 ? 0.55 : 1)
                        .help(behind == 0 ? "No partner is behind" : "Remind everyone behind")
                }
            }
        }
    }

    // MARK: tab bar (FinanceView idiom + count badge)

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(PartnersTab.allCases, id: \.self) { t in
                    let active = tab == t
                    let count = t == .claims ? vm.claims.count : 0
                    Button { tab = t } label: {
                        HStack(spacing: 7) {
                            Text(t.label).font(.inter(14, active ? .bold : .medium))
                            if count > 0 { CountBadge(count: count) }
                        }
                        .foregroundStyle(active ? Nuru.navy : Nuru.ink600)
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(active ? Nuru.gold : .clear).frame(height: 2)
                        }
                    }
                    .pressable()
                    .hoverEffect(.highlight)
                }
            }
            .padding(.horizontal, Nuru.S.lg)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }
        .background(Nuru.paper)
    }

    // MARK: content switch

    @ViewBuilder private var content: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let n = vm.heroNotice { NoticeBar(notice: n) { vm.heroNotice = nil } }
            switch tab {
            case .partners:
                partnersTab
            case .claims:
                ClaimsPanel(claims: vm.claims, loading: vm.claimsLoading, error: vm.claimsError,
                            canManage: canManage, deciding: vm.deciding) { c, d in
                    pendingClaim = ClaimPrompt(claim: c, decision: d)
                }
            }
        }
    }

    // MARK: Partners tab — filters + master–detail (rail | detail), stacking when narrow

    private var partnersTab: some View {
        VStack(alignment: .leading, spacing: 14) {
            toolbar
            if let error = vm.error { errorBanner(error) }
            let rail = railList
            let detail = detailPanel
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    rail.frame(width: 420)
                    detail.frame(maxWidth: .infinity)
                }
                VStack(spacing: 18) {
                    rail
                    detail
                }
            }
        }
    }

    private var toolbar: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Nuru.ink600)
                    TextField("Search name, email", text: $vm.search)
                        .font(.nCaption).textFieldStyle(.plain)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    if !vm.search.isEmpty {
                        Button { vm.search = "" } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 13)).foregroundStyle(Nuru.ink400)
                        }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                .frame(maxWidth: 420)

                Menu {
                    ForEach(sortOptions) { o in Button(o.label) { vm.sort = o.value } }
                } label: {
                    HStack(spacing: 6) {
                        Text("Sort: \(sortOptions.first { $0.value == vm.sort }?.label ?? "Recent")").font(.inter(13)).foregroundStyle(Nuru.navy)
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Nuru.ink400)
                    }
                    .padding(.horizontal, 12).frame(height: 38)
                    .background(Nuru.white)
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                }
                Spacer(minLength: 0)
            }
            FilterChips(options: statusFilters, selection: $vm.status)
        }
    }

    private func errorBanner(_ text: String) -> some View {
        HStack(spacing: 10) {
            Text(text).font(.inter(13, .semibold)).foregroundStyle(Color(hex: 0xA8281F))
            Spacer(minLength: 0)
            Button("Try again") { Task { await vm.loadList() } }
                .font(.inter(12, .bold)).tint(Color(hex: 0xA8281F))
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color(hex: 0xFDECEC))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
    }

    // Rail — one row per partner (name · cell · tier · pledges · next due · given this year · standing).
    private var railList: some View {
        VStack(spacing: 10) {
            if vm.loading && vm.rows.isEmpty {
                SkeletonList(rows: 6)
            } else if vm.rows.isEmpty {
                Card(padding: 24) {
                    Text(vm.filtersActive ? "No partners match those filters." : "No partners yet — members join from Give → Partners in the app.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                        .multilineTextAlignment(.center).frame(maxWidth: .infinity)
                }
            } else {
                ForEach(Array(vm.rows.enumerated()), id: \.element.id) { i, r in
                    partnerRow(r, seed: i, active: r.userId == vm.selectedId)
                }
            }
        }
    }

    private func partnerRow(_ r: PartnerRow, seed: Int, active: Bool) -> some View {
        let chip = rowChip(r)
        let dim = active ? Color.white.opacity(0.7) : Nuru.ink600
        return Button { vm.selectedId = r.userId } label: {
            HStack(alignment: .top, spacing: 12) {
                PersonAvatar(url: r.avatarUrl, name: r.fullName, seed: seed, size: 42)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(r.fullName).font(.inter(14, .bold))
                            .foregroundStyle(active ? .white : Nuru.foreground).lineLimit(1)
                        ChipPill(chip: chip)
                    }
                    Text([r.cellName ?? "No cell yet", r.tier.map { "\($0.name) · \(money($0.monthlyMinor, nil))/mo" }].compactMap { $0 }.joined(separator: " · "))
                        .font(.nMicro).foregroundStyle(dim).lineLimit(1)
                    HStack(spacing: 6) {
                        Text(plural(r.pledgesActive, "pledge", "pledges"))
                        Text("·")
                        Text("Next due \(PgDate.day(r.nextDueOn))")
                            .foregroundStyle(r.behind ? (active ? Color(hex: 0xF5C77E) : Color(hex: 0xA87616)) : dim)
                    }
                    .font(.nMicro).foregroundStyle(dim)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(money(r.givenYearMinor, nil)).font(.nMono(12.5, .medium))
                        .foregroundStyle(active ? .white : Nuru.navy).lineLimit(1)
                    Text("this year").font(.nMicro).foregroundStyle(dim)
                }
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
        .accessibilityLabel("\(r.fullName), \(chip.label)")
    }

    @ViewBuilder private var detailPanel: some View {
        if let sel = vm.selectedId {
            PartnerDetailPanel(userId: sel, canManage: canManage, nonce: vm.detailNonce,
                               onNotice: { toast = .success($0) })
                .id(sel)
        } else {
            Card(padding: 40) {
                Text("Select a partner to see their pledges, payments and reminders.")
                    .font(.nBody).foregroundStyle(Nuru.ink600).frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Detail panel (the web drawer: member header · pledges · schedules · payments · reminders)

private struct PartnerDetailPanel: View {
    let userId: String
    let canManage: Bool
    /// Bumped by the page after an action this panel should re-read.
    let nonce: Int
    let onNotice: (String) -> Void

    @State private var d: PartnerDetail?
    @State private var loading = true
    @State private var error: String?
    @State private var remindOpen = false
    @State private var remindResult: Notice?

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
                    pledgesCard(d)
                    schedulesCard(d)
                    paymentsCard(d)
                    remindersCard(d)
                }
            }
        }
        // First mount loads; a nonce bump is a silent refresh that keeps the
        // panel — and the result it is showing — on screen while the log,
        // payments and progress catch up.
        .task(id: nonce) { await load() }
        .sheet(isPresented: $remindOpen) {
            if let d {
                RemindSheet(userId: userId, pledges: openPledges(d)) { result in
                    remindResult = result
                    if result.kind == .ok { onNotice(result.text) }
                    Task { await load() }              // the reminders log gains its row
                }
            }
        }
    }

    /// Only active pledges can be reminded about (the server 404s otherwise).
    private func openPledges(_ d: PartnerDetail) -> [PartnerPledge] { d.pledges.filter { $0.status == "active" } }

    private func load() async {
        if d == nil { loading = true }
        do {
            d = try await PartnersAPI.detail(userId)
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription
                ?? (d == nil ? "Could not load this partner." : "Could not refresh this partner.")
        }
        loading = false
    }

    // Dominant currency for the row-level minor amounts (they carry none).
    private func currency(_ d: PartnerDetail) -> String? {
        d.pledges.first?.currency ?? d.payments.first?.currency
    }

    // Header — avatar, name, standing, tier, contact line + the six stat cells.
    private func headerCard(_ d: PartnerDetail) -> some View {
        let m = d.member
        let cur = currency(d)
        let open = openPledges(d)
        return Card(padding: 20) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 14) {
                    PersonAvatar(url: m.avatarUrl, name: m.fullName, seed: 0, size: 56)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Text(m.fullName).font(.fraunces(21, .medium)).foregroundStyle(Nuru.navy)
                                .lineLimit(1).minimumScaleFactor(0.8)
                            ChipPill(chip: rowChip(m))
                        }
                        if let t = m.tier {
                            ChipPill(chip: Chip(label: "\(t.name) · \(money(t.monthlyMinor, cur))/mo", tone: .gold))
                        }
                        Text([m.cellName ?? "No cell yet", m.phone, m.email].compactMap { $0 }.joined(separator: " · "))
                            .font(.nCaption).foregroundStyle(Nuru.ink600)
                    }
                    Spacer(minLength: 0)
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                    statCell("Partner since", PgDate.day(m.membership?.joinedAt))
                    statCell("Committed / month", money(m.committedMonthlyMinor, cur), bold: true)
                    statCell("Given this year", money(m.givenYearMinor, cur), bold: true)
                    statCell("Active pledges", "\(m.pledgesActive)")
                    statCell("Last gift", PgDate.day(m.lastGiftAt))
                    statCell("Next due", PgDate.day(m.nextDueOn), tint: m.behind ? Color(hex: 0xA87616) : nil)
                }
                if let error { NoticeBar(notice: Notice(kind: .error, text: error)) { self.error = nil } }
                if canManage {
                    HStack(spacing: 10) {
                        ActionButton(title: "Send reminder", icon: "paperplane.fill", style: .primary) { remindOpen = true }
                            .disabled(open.isEmpty)
                            .opacity(open.isEmpty ? 0.5 : 1)
                        if open.isEmpty {
                            Text("No open pledge to remind about").font(.nMicro).foregroundStyle(Nuru.ink600)
                        }
                        Spacer(minLength: 0)
                    }
                }
                if let remindResult { NoticeBar(notice: remindResult) { self.remindResult = nil } }
            }
        }
    }

    private func statCell(_ label: String, _ value: String, bold: Bool = false, tint: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                .lineLimit(1).minimumScaleFactor(0.8)
            Text(value).font(.nMono(12, bold ? .medium : .regular)).foregroundStyle(tint ?? Nuru.navy)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
    }

    private func sectionLabel(_ title: String, icon: String, caption: String? = nil) -> some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(Nuru.gold)
            Text(title).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
            Spacer(minLength: 8)
            if let caption { Text(caption).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1) }
        }
    }

    private func dashedEmpty(_ text: String) -> some View {
        Text(text).font(.nCaption).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity).padding(.vertical, 22)
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous)
                .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1, dash: [6, 4])))
    }

    // Pledges — one card per pledge with server-computed progress.
    private func pledgesCard(_ d: PartnerDetail) -> some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                sectionLabel("Pledges", icon: "target", caption: plural(d.pledges.count, "pledge", "pledges"))
                if d.pledges.isEmpty {
                    dashedEmpty("Joined the programme without a pledge yet.")
                } else {
                    VStack(spacing: 10) { ForEach(d.pledges) { p in pledgeCard(p) } }
                }
            }
        }
    }

    // Progress (§1): monthly = paid this period vs amount; total = paid vs
    // target. Both numbers come from the server; the bar only draws the ratio.
    private func pledgeCard(_ p: PartnerPledge) -> some View {
        let denom = p.isMonthly ? p.amountMinor : p.targetMinor
        let paid = p.isMonthly ? (p.progress?.periodPaidMinor ?? 0) : (p.progress?.paidMinor ?? 0)
        let ratio = denom > 0 ? min(max(Double(paid) / Double(denom), 0), 1) : 0
        let prog = progressChip(p.progress?.label ?? "")
        let bar: Color = prog.label == "Behind" ? Nuru.gold : prog.label == "Fulfilled" ? Color(hex: 0x7C3AED) : Color(hex: 0x16A34A)
        let nextDue = p.progress?.nextDue ?? (p.isMonthly ? nil : p.dueOn)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Image(systemName: p.isMonthly ? "repeat" : "target").font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.navy)
                        Text(p.isMonthly ? "Monthly pledge" : "Total pledge").font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                        ChipPill(chip: pledgeStatusChip(p.status))
                        ChipPill(chip: prog)
                    }
                    Text(pledgeTerms(p)).font(.nCaption).foregroundStyle(Nuru.foreground)
                    Text(pledgeTarget(p)).font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 3) {
                    Label(p.remindersEnabled ? "Reminders on" : "Reminders off", systemImage: p.remindersEnabled ? "bell" : "bell.slash")
                        .font(.nMicro).foregroundStyle(p.remindersEnabled ? Nuru.navy : Nuru.ink600)
                    if p.scheduleId != nil {
                        Label("Auto-charged", systemImage: "repeat").font(.nMicro).foregroundStyle(Color(hex: 0x0F6B33))
                    }
                }
                .lineLimit(1)
            }
            VStack(spacing: 5) {
                HStack(spacing: 4) {
                    Text(money(paid, p.currency)).font(.nMono(12)).foregroundStyle(Nuru.navy)
                    Text("of \(money(denom, p.currency))\(p.isMonthly ? " this month" : "")").font(.nMono(12)).foregroundStyle(Nuru.ink600)
                    Spacer(minLength: 0)
                    Text("\(Int((ratio * 100).rounded()))%").font(.nMono(12)).foregroundStyle(Nuru.ink600)
                }
                ProgressBar(pct: ratio * 100, fill: bar, height: 8)
            }
            HStack(spacing: 16) {
                HStack(spacing: 4) {
                    Image(systemName: "calendar.badge.clock").font(.system(size: 11))
                    Text("Next due")
                    Text(PgDate.day(nextDue)).font(.nMono(11.5)).foregroundStyle(prog.label == "Behind" ? Color(hex: 0xA87616) : Nuru.navy)
                }
                HStack(spacing: 4) { Text("All time"); Text(money(p.progress?.paidMinor ?? 0, p.currency)).font(.nMono(11.5)).foregroundStyle(Nuru.navy) }
                HStack(spacing: 4) { Text("Since"); Text(PgDate.day(p.createdAt)).font(.nMono(11.5)).foregroundStyle(Nuru.navy) }
                Spacer(minLength: 0)
            }
            .font(.nMicro).foregroundStyle(Nuru.ink600)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // Schedules — the giving_schedules charging this partner.
    private func schedulesCard(_ d: PartnerDetail) -> some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                sectionLabel("Schedules", icon: "repeat", caption: "giving_schedules")
                if d.schedules.isEmpty {
                    dashedEmpty("No recurring schedule — gifts are made by hand.")
                } else {
                    table {
                        HStack(spacing: 12) {
                            Th(text: "Fund").frame(width: 110, alignment: .leading)
                            Th(text: "Amount").frame(width: 120, alignment: .leading)
                            Th(text: "Frequency").frame(width: 90, alignment: .leading)
                            Th(text: "Method").frame(width: 80, alignment: .leading)
                            Th(text: "Status").frame(width: 90, alignment: .leading)
                            Th(text: "Next run").frame(width: 160, alignment: .leading)
                            Th(text: "Failures").frame(width: 64, alignment: .leading)
                        }
                    } rows: {
                        ForEach(d.schedules) { s in
                            let chip = scheduleStatusChip(s.status)
                            HStack(spacing: 12) {
                                Text(s.fund ?? "—").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).frame(width: 110, alignment: .leading).lineLimit(1)
                                Text(money(s.amountMinor, s.currency)).font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 120, alignment: .leading).lineLimit(1)
                                Text(titleCase(s.frequency)).font(.inter(12)).foregroundStyle(Nuru.navy).frame(width: 90, alignment: .leading)
                                Text(s.method.map(titleCase) ?? "—").font(.inter(12)).foregroundStyle(Nuru.navy).frame(width: 80, alignment: .leading)
                                ChipPill(chip: chip).frame(width: 90, alignment: .leading)
                                Text(PgDate.stamp(s.nextRunAt)).font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 160, alignment: .leading).lineLimit(1)
                                Text("\(s.consecutiveFailures)").font(.nMono(12))
                                    .foregroundStyle(s.consecutiveFailures > 0 ? Color(hex: 0xB42318) : Nuru.navy).frame(width: 64, alignment: .leading)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(s.consecutiveFailures > 0 ? Color(hex: 0xFFF4DA).opacity(0.45) : .clear)
                            .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
                        }
                    }
                }
            }
        }
    }

    // Payments — every succeeded / processing / failed transaction, newest first.
    private func paymentsCard(_ d: PartnerDetail) -> some View {
        let label = Dictionary(d.pledges.map { ($0.pledgeId, pledgeShortLabel($0)) }, uniquingKeysWith: { a, _ in a })
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                sectionLabel("Payments", icon: "receipt", caption: plural(d.payments.count, "payment", "payments"))
                if d.payments.isEmpty {
                    dashedEmpty("No payments attributed to a pledge yet.")
                } else {
                    table {
                        HStack(spacing: 12) {
                            Th(text: "Date").frame(width: 110, alignment: .leading)
                            Th(text: "Fund").frame(width: 100, alignment: .leading)
                            Th(text: "Amount").frame(width: 120, alignment: .trailing)
                            Th(text: "Pledge").frame(width: 200, alignment: .leading)
                            Th(text: "Receipt").frame(width: 120, alignment: .leading)
                        }
                    } rows: {
                        ForEach(d.payments) { t in
                            HStack(spacing: 12) {
                                Text(PgDate.day(t.at)).font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 110, alignment: .leading).lineLimit(1)
                                Text(t.fund ?? "—").font(.inter(12.5)).foregroundStyle(Nuru.navy).frame(width: 100, alignment: .leading).lineLimit(1)
                                Text(money(t.amountMinor, t.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy).frame(width: 120, alignment: .trailing).lineLimit(1)
                                Text(t.pledgeId.map { label[$0] ?? shortRef($0) } ?? "Unattributed").font(.inter(12))
                                    .foregroundStyle(t.pledgeId == nil ? Nuru.ink600 : Nuru.navy).frame(width: 200, alignment: .leading).lineLimit(1)
                                Text(t.receiptCode ?? "—").font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 120, alignment: .leading).lineLimit(1)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
                        }
                    }
                }
            }
        }
    }

    // Reminders sent — §3: 3 days before, then 12 h apart; office reminders keep the spacing.
    private func remindersCard(_ d: PartnerDetail) -> some View {
        let label = Dictionary(d.pledges.map { ($0.pledgeId, pledgeShortLabel($0)) }, uniquingKeysWith: { a, _ in a })
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                sectionLabel("Reminders sent", icon: "bell", caption: "3 days before, then 12 h apart · office reminders keep the spacing")
                if d.reminders.isEmpty {
                    dashedEmpty("No reminders sent.")
                } else {
                    table {
                        HStack(spacing: 12) {
                            Th(text: "Due").frame(width: 110, alignment: .leading)
                            Th(text: "Pledge").frame(width: 180, alignment: .leading)
                            Th(text: "#").frame(width: 30, alignment: .leading)
                            Th(text: "Channel").frame(width: 90, alignment: .leading)
                            Th(text: "Sent").frame(width: 160, alignment: .leading)
                            Th(text: "Kind").frame(width: 90, alignment: .leading)
                            Th(text: "By").frame(width: 140, alignment: .leading)
                        }
                    } rows: {
                        ForEach(d.reminders) { r in
                            HStack(spacing: 12) {
                                Text(PgDate.day(r.dueOn)).font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 110, alignment: .leading).lineLimit(1)
                                Text(label[r.pledgeId] ?? shortRef(r.pledgeId)).font(.inter(12)).foregroundStyle(Nuru.navy).frame(width: 180, alignment: .leading).lineLimit(1)
                                Text("\(r.sequence)").font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 30, alignment: .leading)
                                Text(titleCase(r.channel)).font(.inter(12)).foregroundStyle(Nuru.navy).frame(width: 90, alignment: .leading).lineLimit(1)
                                Text(PgDate.stamp(r.sentAt)).font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 160, alignment: .leading).lineLimit(1)
                                ChipPill(chip: r.isManual ? Chip(label: "Office", tone: .navy) : Chip(label: "Automatic", tone: .grey)).frame(width: 90, alignment: .leading)
                                // Who sent it: the resolved name, else the sender id, else just "Office".
                                Text(r.isManual ? (r.sentByName ?? r.sentBy.map(shortRef) ?? "Office") : "—").font(.inter(12))
                                    .foregroundStyle(r.isManual ? Nuru.navy : Nuru.ink600).frame(width: 140, alignment: .leading).lineLimit(1)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
                        }
                    }
                }
            }
        }
    }

    /// A card-inset, horizontally scrolling table (FinanceView's ledger idiom).
    private func table<H: View, R: View>(@ViewBuilder header: () -> H, @ViewBuilder rows: () -> R) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(spacing: 0) {
                header()
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Nuru.mutedBg)
                rows()
            }
        }
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
    }
}

// MARK: - Send-reminder sheet (web RemindPopover)
// "" = all open pledges (the server reminds each one, applying the 12 h
// spacing per pledge). The server's own refusal — 404 "No open pledge to
// remind about", or any 4xx message — is shown plainly inside the sheet.

private struct RemindSheet: View {
    let userId: String
    let pledges: [PartnerPledge]
    let onResult: (Notice) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pledgeId = ""
    @State private var message = ""
    @State private var sending = false
    @State private var error: String?

    private var trimmed: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let error {
                        Text(error).font(.inter(13, .semibold)).foregroundStyle(Nuru.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12).background(Nuru.danger.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                    }
                    formSection("Pledge") {
                        Picker("Pledge", selection: $pledgeId) {
                            Text("All open pledges").tag("")
                            ForEach(pledges) { p in
                                Text("\(pledgeShortLabel(p)) — \(pledgeTerms(p))").tag(p.pledgeId)
                            }
                        }
                        .pickerStyle(.menu).tint(Nuru.navy)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8).frame(height: 44)
                        .background(Nuru.white)
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                    }
                    formSection("Message (optional)") {
                        TextField("A short note from the office, sent with the reminder.", text: $message, axis: .vertical)
                            .font(.inter(15)).foregroundStyle(Nuru.ink).lineLimit(3...6)
                            .padding(.horizontal, 14).padding(.vertical, 11)
                            .background(Nuru.white)
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                            .onChange(of: message) { _, new in
                                if new.count > PartnersAPI.reminderMessageMax { message = String(new.prefix(PartnersAPI.reminderMessageMax)) }
                            }
                        HStack {
                            Text("Skipped if reminded in the last \(PartnersAPI.reminderSpacingHours) hours.").font(.nMicro).foregroundStyle(Nuru.ink600)
                            Spacer()
                            Text("\(message.count)/\(PartnersAPI.reminderMessageMax)").font(.nMono(11))
                                .foregroundStyle(message.count >= PartnersAPI.reminderMessageMax ? Color(hex: 0xA87616) : Nuru.ink600)
                        }
                    }
                }
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24).padding(.vertical, 22)
            }
            .scrollContentBackground(.hidden)
            .background(Nuru.paper)
            .navigationTitle("Send a reminder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.tint(Nuru.ink600).disabled(sending) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "Sending…" : "Send") { Task { await send() } }
                        .font(.inter(14, .bold)).tint(Nuru.gold)
                        .disabled(sending)
                }
            }
        }
    }

    private func formSection<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased()).font(.inter(12, .bold)).tracking(1.2).foregroundStyle(Nuru.navy)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .nuruShadow(0.5)
    }

    private func send() async {
        sending = true
        error = nil
        do {
            let r = try await PartnersAPI.remind(userId, pledgeId: pledgeId.isEmpty ? nil : pledgeId,
                                                 message: trimmed.isEmpty ? nil : trimmed)
            onResult(describeRemind(r))
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not send the reminder."
        }
        sending = false
    }
}

// MARK: - Claims (§1 d) — pending "I paid another way" claims, oldest first

private struct ClaimsPanel: View {
    let claims: [PledgeClaimRow]
    let loading: Bool
    let error: String?
    let canManage: Bool
    let deciding: String?
    let onDecide: (PledgeClaimRow, String) -> Void

    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Claims to review").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                        Text("“I paid another way” — confirming records a manual gift toward the pledge, posts the ledger and sends a receipt; rejecting tells the member.")
                            .font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    Text(loading && claims.isEmpty ? "…" : "\(claims.count) pending").font(.nMono(12)).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 18).padding(.vertical, 16)
                .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }

                if let error {
                    Text(error).font(.inter(12.5, .semibold)).foregroundStyle(Color(hex: 0xA8281F))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 18).padding(.top, 12)
                }

                if loading && claims.isEmpty {
                    SkeletonList(rows: 3).padding(16)
                } else if claims.isEmpty {
                    if error == nil {
                        EmptyState.compact(icon: "checkmark.seal", message: "Nothing to review — every “I paid another way” claim has been decided.")
                    }
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(claims.enumerated()), id: \.element.id) { i, c in
                            claimRow(c, seed: i)
                                .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                        }
                    }
                    .padding(.top, 4)
                }
            }
        }
    }

    private func claimRow(_ c: PledgeClaimRow, seed: Int) -> some View {
        let mine = deciding == c.claimId
        let otherBusy = deciding != nil && !mine
        return HStack(alignment: .top, spacing: 12) {
            PersonAvatar(url: nil, name: c.fullName, seed: seed, size: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text(c.fullName).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                Text(c.pledgeTitle).font(.nCaption).foregroundStyle(Nuru.foreground).lineLimit(1)
                if let note = c.note, !note.isEmpty {
                    Text(note).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(3)
                }
                Text("Paid \(PgDate.day(c.paidOn)) · submitted \(PgDate.stamp(c.createdAt))").font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 8) {
                Text(money(c.amountMinor, c.currency)).font(.nMono(13, .medium)).foregroundStyle(Nuru.navy).lineLimit(1)
                if canManage {
                    HStack(spacing: 8) {
                        ActionButton(title: "Confirm", icon: "checkmark", style: .primary, busy: mine) { onDecide(c, "confirm") }
                        ActionButton(title: "Reject", icon: "nosign", style: .danger, busy: mine) { onDecide(c, "reject") }
                    }
                    .disabled(otherBusy)
                }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .opacity(otherBusy ? 0.6 : 1)
    }
}

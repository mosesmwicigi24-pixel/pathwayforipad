// Finance → Partners — the Partners programme console, a native port of the
// web portal's Partners page (pathway #482; docs/PARTNERS_PROGRAMME.md §1, §3,
// §5–§6; docs/FINANCE_ERP.md §5). Who has joined, what each partner committed,
// whether they are behind, and — per partner — the faithfulness strip (kept of
// due this year, standing, "overdue since"), pledges with server-computed
// progress, the schedules charging them, the payments attributed to each
// pledge, the reminder log, and the member's Partner / Giving statement PDFs
// for a chosen year. The office's actions: "Send reminder" for one partner
// (optionally one pledge, optional note) and "Remind everyone behind". The
// "I paid another way" claims queue is its own page now (Finance → Claims);
// the hero's Claims pill opens it.
//
// Layout follows DisciplesView (list rail + detail panel that stacks when
// narrow) under the Finance hero. Every number on this page comes from a real
// endpoint and every "behind" flag from the server (§1.1); the 12-hour
// reminder spacing is enforced server-side — this page only reports it.
// finance:manage gates the actions (FinanceCaps — hidden while /me loads; the
// server enforces it too). Deep links: member=<user_id> opens that partner;
// status=<all|active|paused|behind|left> sets the list filter.
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
/// Exact integer formatting, as on every Finance page ("KES 1,234.50"); the
/// programme default currency is KES when a row carries none.
private func money(_ minor: Int, _ currency: String?) -> String {
    FinanceMoney.format(minor, (currency?.isEmpty == false) ? (currency ?? "KES") : "KES")
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
    return "\(money(p.targetMinor, p.currency)) by \(FinBTime.day(p.dueOn))"
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
    /// The partner a deep link opened (member=<user_id>): stays selected while
    /// the list reloads, even before (or without) appearing in the rail.
    @Published var pinnedId: String?
    /// Pending "I paid another way" claims — the hero pill's number (the queue
    /// itself is Finance → Claims). Nil until read, or when it could not be.
    @Published var claimsCount: Int?
    @Published var remindingAll = false
    @Published var heroNotice: Notice?
    /// Bumped after an action the open detail should re-read ("remind
    /// everyone" adds a reminders row).
    @Published var detailNonce = 0
    /// Bumped to bring the detail panel into view (a deep link, stacked layout).
    @Published var revealDetail = 0

    // Out-of-order guard: only the latest list request may land.
    private var listSeq = 0
    private var reloadTask: Task<Void, Never>?

    var filtersActive: Bool { !search.trimmingCharacters(in: .whitespaces).isEmpty || status != "all" }

    func loadAll() async {
        async let a: Void = loadList()
        async let b: Void = loadClaimsCount()
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
    /// still listed (or is the deep-linked partner), else picks the top row.
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
            let keep = selectedId.map { cur in cur == pinnedId || rows.contains { $0.userId == cur } } ?? false
            if !keep { selectedId = rows.first?.userId }
        } catch {
            guard seq == listSeq else { return }
            self.error = (error as? APIError)?.errorDescription ?? "Could not load partners."
        }
        if seq == listSeq { loading = false }
    }

    /// The pill's number. A failure leaves the pill reading "Claims" with no
    /// count — the Claims page shows the real error when opened.
    func loadClaimsCount() async {
        do { claimsCount = try await PartnersAPI.claims().count } catch { claimsCount = nil }
    }

    /// Open one partner from a deep link: clear the filters that could hide
    /// them, select and pin them, and bring the detail into view.
    func open(member userId: String) {
        pinnedId = userId
        selectedId = userId
        if !search.isEmpty { search = "" }
        if status != "all" { status = "all" }
        revealDetail += 1
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
}

// MARK: - Page

struct PartnersView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = PartnersVM()
    @State private var toast: ToastData?
    @State private var confirmRemindAll = false

    private static let detailAnchor = "partners.detail"

    /// What this person may do (spec §6). finance:manage gates the actions and
    /// is FALSE while /me loads — writes fail closed (web parity); the server
    /// enforces the permission regardless.
    private var caps: FinanceCaps { auth.financeCaps }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    hero
                    content
                        .padding(.horizontal, Nuru.S.lg)
                        .padding(.top, Nuru.S.lg)
                        .padding(.bottom, 48)
                        .macContentColumn(MacDesign.workspaceMaxWidth)
                }
            }
            .onChange(of: vm.revealDetail) { _, _ in
                // After the layout settles, scroll the detail to the top — in
                // the stacked (narrow) layout it sits below the whole rail.
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo(Self.detailAnchor, anchor: .top) }
                }
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
        .onFinanceLink(.partners) { params in
            if let s = params["status"], statusFilters.contains(where: { $0.value == s }) { vm.status = s }
            if let member = params["member"]?.trimmingCharacters(in: .whitespaces), !member.isEmpty { vm.open(member: member) }
        }
        .alert("Remind everyone behind?", isPresented: $confirmRemindAll) {
            Button("Cancel", role: .cancel) {}
            Button("Send reminders") { Task { await vm.remindBehind() } }
        } message: {
            Text(remindAllQuestion)
        }
    }

    private var remindAllQuestion: String {
        let n = vm.summary?.behind ?? 0
        let who = n == 1 ? "the 1 partner who is behind" : "the \(n) partners who are behind"
        return "Remind \(who)?\n\nAnyone reminded in the last \(PartnersAPI.reminderSpacingHours) hours — automatically or by the office — is skipped, so nobody is nagged twice."
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
                // The claims queue is its own page now (Finance → Claims).
                HeroChip(label: vm.claimsCount.map { "Claims · \($0)" } ?? "Claims",
                         icon: "list.clipboard", trailingIcon: "arrow.up.right", style: .ghost) { router.openFinance(.financeClaims) }
                    .accessibilityHint("Opens Finance → Claims")
                if caps.manage {
                    HeroChip(label: vm.remindingAll ? "Reminding…" : "Remind everyone behind",
                             icon: "paperplane", style: .gold) { confirmRemindAll = true }
                        .disabled(vm.remindingAll || s == nil || behind == 0)
                        .opacity(vm.remindingAll || s == nil || behind == 0 ? 0.55 : 1)
                        .help(behind == 0 ? "No partner is behind" : "Remind everyone behind")
                }
            }
        }
    }

    // MARK: content

    @ViewBuilder private var content: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let n = vm.heroNotice { NoticeBar(notice: n) { vm.heroNotice = nil } }
            partnersBody
        }
    }

    // MARK: filters + master–detail (rail | detail), stacking when narrow

    private var partnersBody: some View {
        VStack(alignment: .leading, spacing: 14) {
            toolbar
            if let error = vm.error { errorBanner(error) }
            let rail = railList
            let detail = detailPanel.id(Self.detailAnchor)
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
                        Text("Next due \(FinBTime.day(r.nextDueOn))")
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
            PartnerDetailPanel(userId: sel, caps: caps, nonce: vm.detailNonce,
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

// MARK: - Detail panel (the web drawer: member header · faithfulness · statements ·
// pledges · schedules · payments · reminders)

private struct PartnerDetailPanel: View {
    let userId: String
    let caps: FinanceCaps
    /// Bumped by the page after an action this panel should re-read.
    let nonce: Int
    let onNotice: (String) -> Void

    @State private var d: PartnerDetail?
    @State private var loading = true
    @State private var error: String?
    @State private var remindOpen = false
    @State private var remindResult: Notice?

    private var canManage: Bool { caps.manage }

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
                    PartnerFaithfulnessCard(userId: userId, fullName: d.member.fullName, caps: caps)
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
                    statCell("Partner since", FinBTime.day(m.membership?.joinedAt))
                    statCell("Committed / month", money(m.committedMonthlyMinor, cur), bold: true)
                    statCell("Given this year", money(m.givenYearMinor, cur), bold: true)
                    statCell("Active pledges", "\(m.pledgesActive)")
                    statCell("Last gift", FinBTime.day(m.lastGiftAt))
                    statCell("Next due", FinBTime.day(m.nextDueOn), tint: m.behind ? Color(hex: 0xA87616) : nil)
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
                    // The target, then where its money is booked (PledgePaysTo —
                    // the contract says clients show this for pledge money).
                    Text(pledgeTarget(p) + (p.paysTo.map { " · pays to \($0.name.isEmpty ? $0.code : $0.name)" } ?? ""))
                        .font(.nMicro).foregroundStyle(Nuru.ink600)
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
            FinanceFlowLayout(spacing: 16, rowSpacing: 4) {
                HStack(spacing: 4) {
                    Image(systemName: "calendar.badge.clock").font(.system(size: 11))
                    Text("Next due")
                    Text(FinBTime.day(nextDue)).font(.nMono(11.5)).foregroundStyle(prog.label == "Behind" ? Color(hex: 0xA87616) : Nuru.navy)
                }
                HStack(spacing: 4) { Text("All time"); Text(money(p.progress?.paidMinor ?? 0, p.currency)).font(.nMono(11.5)).foregroundStyle(Nuru.navy) }
                HStack(spacing: 4) { Text("Since"); Text(FinBTime.day(p.createdAt)).font(.nMono(11.5)).foregroundStyle(Nuru.navy) }
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
                                Text(FinBTime.stamp(s.nextRunAt)).font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 160, alignment: .leading).lineLimit(1)
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
                                Text(FinBTime.day(t.at)).font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 110, alignment: .leading).lineLimit(1)
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
                                Text(FinBTime.day(r.dueOn)).font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 110, alignment: .leading).lineLimit(1)
                                Text(label[r.pledgeId] ?? shortRef(r.pledgeId)).font(.inter(12)).foregroundStyle(Nuru.navy).frame(width: 180, alignment: .leading).lineLimit(1)
                                Text("\(r.sequence)").font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 30, alignment: .leading)
                                Text(titleCase(r.channel)).font(.inter(12)).foregroundStyle(Nuru.navy).frame(width: 90, alignment: .leading).lineLimit(1)
                                Text(FinBTime.stamp(r.sentAt)).font(.nMono(12)).foregroundStyle(Nuru.navy).frame(width: 160, alignment: .leading).lineLimit(1)
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

// MARK: - Faithfulness (web PartnerFaithfulness)

/// For a chosen year: the member's standing, instalments kept of those due,
/// the date they have been overdue since, and pledged / paid / remaining per
/// currency — each pledge's figures straight from the pledge register (GET
/// /admin/finance/pledges, the member statement's own rule) — plus that
/// year's Partner and Giving statement PDFs (finance:view).
private struct PartnerFaithfulnessCard: View {
    let userId: String
    let fullName: String
    let caps: FinanceCaps

    @State private var year = FinanceDates.currentYear()
    @State private var rows: [FinPledgeRow]?
    @State private var error: String?

    private var thisYear: Int { FinanceDates.currentYear() }
    private var inYear: String { year == thisYear ? "this year" : "in \(String(year))" }

    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 7) {
                    Image(systemName: "checkmark.seal").font(.system(size: 13, weight: .semibold)).foregroundStyle(Nuru.gold)
                    Text("Faithfulness").font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 8)
                    Text("From the pledge register — the member statement's own rule").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                }
                FinanceFlowLayout(spacing: 8, rowSpacing: 8) {
                    FinanceYearMenu(year: $year, years: Array(((thisYear - 5)...thisYear).reversed()))
                    let y = String(year)
                    FinBDownloadButton(caps: caps, path: FinanceERPAPI.partnersStatementPath(userId), query: ["year": y],
                                       title: "Partner statement PDF", icon: "doc.richtext", notFound: "No partner statement for \(y)")
                    FinBDownloadButton(caps: caps, path: FinanceERPAPI.givingStatementPath(userId), query: ["year": y],
                                       title: "Giving statement PDF", icon: "doc.text", notFound: "No giving statement for \(y)")
                }
                content
            }
        }
        .task(id: year) { await load() }
    }

    @ViewBuilder private var content: some View {
        if let error {
            ErrorBanner(message: error) { Task { await load() } }
        } else if let rows {
            if rows.isEmpty {
                Text("No pledge on the register \(inYear).").font(.nCaption).foregroundStyle(Nuru.ink600)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous)
                        .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1, dash: [6, 4])))
            } else {
                summary(FinBMath.faithfulness(rows))
                pledgeTable(rows)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) { Skeleton(height: 14, width: 280); Skeleton(height: 14, width: 200) }
        }
    }

    private func summary(_ s: FinBMath.Faithfulness) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            FinanceFlowLayout(spacing: 14, rowSpacing: 6) {
                if s.standing != "none" { FinanceStatusChip(status: s.standing) }
                if s.monthly > 0 {
                    (Text("Kept ") + Text("\(s.kept) of \(s.due)").font(.nMono(13, .semibold)) + Text(" \(s.due == 1 ? "instalment" : "instalments") due \(inYear)"))
                        .font(.inter(13)).foregroundStyle(Nuru.navy)
                } else {
                    Text("No monthly instalments — total pledges only.").font(.inter(13)).foregroundStyle(Nuru.ink600)
                }
                if let since = s.overdueSince {
                    Text("Overdue since \(FinanceDates.display(since))").font(.inter(12.5, .bold)).foregroundStyle(FinanceStatus.amber.fg)
                }
            }
            ForEach(s.totals, id: \.currency) { t in
                VStack(alignment: .leading, spacing: 3) {
                    FinanceFlowLayout(spacing: 14, rowSpacing: 4) {
                        figure("Pledged", t.pledgedMinor, t.currency, nil)
                        figure("Paid toward it", t.towardMinor, t.currency, Nuru.success)
                        figure("Remaining", t.remainingMinor, t.currency, t.remainingMinor > 0 ? FinanceStatus.amber.fg : nil)
                    }
                    if t.beyondMinor > 0 {
                        Text("Also paid \(FinanceMoney.format(t.beyondMinor, t.currency)) beyond this year's promises (a cancelled pledge, or paid ahead).")
                            .font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(s.standing == "behind" ? Color(hex: 0xFFFBF0) : Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func figure(_ label: String, _ minor: Int, _ currency: String, _ tint: Color?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(label).font(.nCaption).foregroundStyle(Nuru.ink600)
            Text(FinanceMoney.format(minor, currency)).font(.inter(12.5, .semibold)).foregroundStyle(tint ?? Nuru.navy).monospacedDigit()
        }
        .fixedSize()
    }

    private func pledgeTable(_ rows: [FinPledgeRow]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Th(text: "Pledge").frame(width: 200, alignment: .leading)
                    Th(text: "Standing").frame(width: 150, alignment: .leading)
                    Th(text: "Kept / due").frame(width: 76, alignment: .center)
                    Th(text: "Next due").frame(width: 100, alignment: .leading)
                    Th(text: "Paid \(inYear)").frame(width: 120, alignment: .trailing)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Nuru.mutedBg)
                ForEach(rows) { r in
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.title).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                            Text(r.paysTo.map { "Pays to \($0.name)" } ?? (r.shape == "monthly" ? "Monthly" : "Total"))
                                .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                        }
                        .frame(width: 200, alignment: .leading)
                        VStack(alignment: .leading, spacing: 3) {
                            FinanceStatusChip(status: r.status == "cancelled" ? "cancelled" : r.standing)
                            if let since = r.overdueSince, r.status != "cancelled" {
                                Text("Overdue since \(FinanceDates.display(since))").font(.inter(11, .semibold)).foregroundStyle(FinanceStatus.amber.fg)
                                    .lineLimit(1)
                            }
                        }
                        .frame(width: 150, alignment: .leading)
                        Text(r.shape == "monthly" ? "\(r.kept) of \(r.dueCount)" : "—").font(.nMono(12)).foregroundStyle(Nuru.navy)
                            .frame(width: 76, alignment: .center)
                        Text(FinanceDates.display(r.nextDue)).font(.nMono(12)).foregroundStyle(Nuru.navy)
                            .frame(width: 100, alignment: .leading)
                        Text(FinanceMoney.format(r.paidYearMinor, r.currency)).font(.nMono(12)).foregroundStyle(Nuru.navy)
                            .frame(width: 120, alignment: .trailing)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
                }
            }
        }
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
    }

    /// Every register row for this member in `year`. The register has no
    /// member filter, so it is searched by the member's name (≤ 80
    /// characters) and rows are kept by user id — a namesake's pledges never
    /// leak in. At most five pages of 200 (web memberPledgeRows).
    private func load() async {
        let wanted = year
        error = nil
        rows = nil
        guard let term = FinanceERPAPI.searchTerm(fullName) else { rows = []; return }
        do {
            var out: [FinPledgeRow] = []
            var cursor: String? = nil
            for _ in 0..<5 {
                let page = try await FinanceERPAPI.pledges(FinPledgeFilter(year: wanted, q: term), cursor: cursor, limit: 200)
                out += page.data.filter { $0.userId == userId }
                guard let next = page.nextCursor else { break }
                cursor = next
            }
            if wanted == year { rows = out }
        } catch {
            if wanted == year { self.error = FinBError.message(error, fallback: "Could not load this partner's pledge register.") }
        }
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

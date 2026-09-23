// Departments — the office's console for where members serve, a native port
// of the web portal's Departments.tsx (pathway #483; docs/PARTNERS_PROGRAMME.md
// §4). Every department with its leader and counts, a create/edit form
// (leader, meets, fund, gift keys, open to join), and per department: posts
// on the office's behalf, its needs across every status, and its requests to
// serve. Two queues sit beside the list — "Requests" (every pending request to
// serve) and "Needs" (needs awaiting approval, and open needs that can be
// closed). Approving a need OPENS GIVING toward it: the need becomes its own
// giving target, so the "raised" figure shown here is exact and
// server-computed — this page derives nothing about money (§1.1). Archiving
// and approving a need ask first; a 422 on a decision means another admin got
// there first, so the queue is reloaded rather than retried.
//
// Layout follows PartnersView / DisciplesView (list rail + detail panel that
// stacks when narrow) under FinanceView's hero + gold-underline tab bar.
// departments:manage gates the actions (server-enforced too).
import SwiftUI

// MARK: - Visual language (web departmentStatusChip / needStatusChip)

private struct Tone {
    let bg: Color; let fg: Color
    static let green  = Tone(bg: Color(hex: 0xE8F6EC), fg: Color(hex: 0x0F6B33))
    static let amber  = Tone(bg: Color(hex: 0xFFF4DA), fg: Color(hex: 0xA87616))
    static let grey   = Tone(bg: Color(hex: 0xEEF0F3), fg: Color(hex: 0x6B7280))
    static let violet = Tone(bg: Color(hex: 0xF3EAFE), fg: Color(hex: 0x7C3AED))
    static let rose   = Tone(bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xB42318))
    static let navy   = Tone(bg: Color(hex: 0xE6EDF5), fg: Color(hex: 0x1E4068))
}
private struct Chip { let label: String; let tone: Tone }

private func departmentStatusChip(_ s: String) -> Chip {
    s == "archived" ? Chip(label: "Archived", tone: .grey) : Chip(label: "Active", tone: .green)
}
private func needStatusChip(_ s: String) -> Chip {
    switch s {
    case "pending":  return Chip(label: "Awaiting approval", tone: .amber)
    case "approved": return Chip(label: "Open — giving", tone: .green)
    case "rejected": return Chip(label: "Rejected", tone: .rose)
    case "closed":   return Chip(label: "Closed", tone: .grey)
    default:         return Chip(label: titleCase(s), tone: .grey)
    }
}

private func titleCase(_ s: String) -> String {
    s.isEmpty ? "—" : s.prefix(1).uppercased() + s.dropFirst().replacingOccurrences(of: "_", with: " ")
}
private func plural(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n == 1 ? one : many)" }
/// The programme's money format, as FinanceView does it: integer minor units →
/// `Fmt.money`; KES when a row carries no currency.
private func money(_ minor: Int, _ currency: String?) -> String {
    Fmt.money(minor: minor, currency: (currency?.isEmpty == false) ? currency : "KES")
}
private func isHttpUrl(_ s: String) -> Bool {
    guard let u = URL(string: s), let scheme = u.scheme?.lowercased(), u.host != nil else { return false }
    return scheme == "http" || scheme == "https"
}
private let ymdFormatter: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = .current
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

/// An inline notice in one of three tones (web Notice / Result).
private struct Notice: Equatable {
    enum Kind { case ok, warn, error }
    let kind: Kind
    let text: String
    var fg: Color { switch kind { case .ok: Color(hex: 0x0F6B33); case .warn: Color(hex: 0xA87616); case .error: Color(hex: 0xB42318) } }
    var bg: Color { switch kind { case .ok: Color(hex: 0xE8F6EC); case .warn: Color(hex: 0xFFF4DA); case .error: Color(hex: 0xFDECEC) } }
    var border: Color { switch kind { case .ok: Color(hex: 0xBFE3CB); case .warn: Color(hex: 0xF3DFA6); case .error: Color(hex: 0xF5C2C0) } }
}

private struct FilterOption: Identifiable { let label: String; let value: String; var id: String { value } }
private let statusFilters: [FilterOption] = [
    .init(label: "Active", value: "active"), .init(label: "Archived", value: "archived"), .init(label: "All", value: "all"),
]

private enum DepartmentsTab: String, CaseIterable {
    case departments, requests, needs
    var label: String {
        switch self { case .departments: "Departments"; case .requests: "Requests"; case .needs: "Needs" }
    }
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

/// Count badge for tabs / hero chips (web's mono pill).
private struct CountBadge: View {
    let count: Int
    var body: some View {
        Text("\(count)").font(.nMono(11))
            .foregroundStyle(Color(hex: 0xA87616))
            .padding(.horizontal, 6).frame(minWidth: 18, minHeight: 18)
            .background(Color(hex: 0xFFF4DA))
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

private struct SectionLabel: View {
    let title: String
    let icon: String
    var caption: String? = nil
    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(Nuru.gold)
            Text(title).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
            Spacer(minLength: 8)
            if let caption { Text(caption).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1) }
        }
    }
}

private struct DashedEmpty: View {
    let text: String
    var body: some View {
        Text(text).font(.nCaption).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity).padding(.vertical, 22).padding(.horizontal, 12)
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous)
                .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1, dash: [6, 4])))
    }
}

/// Form chrome (local copies of MembersView's MFormSection / MField / mFieldStyle).
private struct FormSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    init(_ title: String, @ViewBuilder content: @escaping () -> Content) { self.title = title; self.content = content }
    var body: some View {
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
}

private struct FormField<Content: View>: View {
    let label: String
    let required: Bool
    @ViewBuilder let content: () -> Content
    init(_ label: String, required: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        self.label = label; self.required = required; self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 3) {
                Text(label.uppercased()).font(.inter(11.5, .semibold)).tracking(0.8).foregroundStyle(Nuru.ink600)
                if required { Text("*").font(.inter(11.5, .bold)).foregroundStyle(Nuru.danger) }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FieldChrome: ViewModifier {
    var minHeight: CGFloat = 44
    func body(content: Content) -> some View {
        content
            .font(.inter(15))
            .foregroundStyle(Nuru.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: minHeight)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.white)
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
    }
}
extension View {
    fileprivate func fieldChrome(minHeight: CGFloat = 44) -> some View { modifier(FieldChrome(minHeight: minHeight)) }
    fileprivate func fieldStyle() -> some View { self.textFieldStyle(.plain).fieldChrome() }
    fileprivate func multilineFieldStyle() -> some View {
        self.textFieldStyle(.plain).padding(.vertical, 11).fieldChrome(minHeight: 44)
    }
    fileprivate func fieldPickerStyle() -> some View {
        self.pickerStyle(.menu).tint(Nuru.navy)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8).frame(height: 44)
            .background(Nuru.white)
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
    }
}

private struct FieldHint: View {
    let text: String
    var body: some View {
        Text(text).font(.nMicro).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
    }
}

private struct Counter: View {
    let count: Int
    let max: Int
    var body: some View {
        Text("\(count)/\(max)").font(.nMono(11))
            .foregroundStyle(count >= max ? Color(hex: 0xA87616) : Nuru.ink600)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

// MARK: - View model

/// A need decision waiting for the office's confirmation (approve / reject / close).
private struct NeedPrompt: Identifiable {
    let need: DepartmentNeedRow
    let decision: String
    var id: String { "\(need.needId):\(decision)" }
}

@MainActor
private final class DepartmentsVM: ObservableObject {
    @Published var rows: [DepartmentRow] = []
    @Published var loading = true
    @Published var error: String?
    @Published var search = ""
    @Published var statusFilter = "active"
    @Published var selectedId: String?

    // The two queues — loaded up front so the tab badges are right on any tab.
    @Published var requests: [ServeRequestRow] = []
    @Published var requestsLoading = true
    @Published var requestsError: String?
    @Published var pendingNeeds: [DepartmentNeedRow] = []
    @Published var openNeeds: [DepartmentNeedRow] = []
    @Published var needsLoading = true
    @Published var needsError: String?

    /// Funds for the fund picker: nil + !fundsLoaded = loading; nil + loaded =
    /// unavailable (the caller lacks finance:view, or the call failed) → the
    /// form falls back to a typed fund code, which the server validates.
    @Published var funds: [FundOption]?
    @Published var fundsLoaded = false

    /// One decision in flight at a time — "<key>#<action>".
    @Published var deciding: String?
    /// Bumped after any change the open detail should re-read (posts, needs, requests).
    @Published var detailNonce = 0
    @Published var toast: ToastData?
    /// Prompts the page's alerts present (set from the queues or the detail panel).
    @Published var pendingDecline: ServeRequestRow?
    @Published var pendingNeed: NeedPrompt?

    // Out-of-order guards: only the latest request of each kind may land.
    private var listSeq = 0
    private var requestsSeq = 0
    private var needsSeq = 0

    var filtered: [DepartmentRow] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return rows.filter { r in
            if statusFilter != "all", r.status != statusFilter { return false }
            if q.isEmpty { return true }
            return r.name.lowercased().contains(q) || (r.leaderName ?? "").lowercased().contains(q) || r.purpose.lowercased().contains(q)
        }
    }
    var filtersActive: Bool { !search.trimmingCharacters(in: .whitespaces).isEmpty || statusFilter != "active" }
    var loaded: Bool { !loading || !rows.isEmpty }
    var selected: DepartmentRow? { selectedId.flatMap { id in rows.first { $0.departmentId == id } } }

    // Tiles: the server's per-department counts, summed. Requests/needs sum over
    // every department (archived ones can still hold a pending row) so they
    // foot with the queues; "Departments" counts active ones only.
    struct Totals { var departments = 0, serving = 0, requests = 0, pendingNeeds = 0, openNeeds = 0 }
    var totals: Totals {
        var t = Totals()
        for r in rows {
            if !r.isArchived { t.departments += 1; t.serving += r.memberCount }
            t.requests += r.pendingRequests
            t.pendingNeeds += r.pendingNeeds
            t.openNeeds += r.openNeeds
        }
        return t
    }

    func loadAll() async {
        async let a: Void = loadList()
        async let b: Void = loadRequests()
        async let c: Void = loadNeeds()
        async let d: Void = loadFunds()
        _ = await (a, b, c, d)
    }

    /// Everything a decision can move: the list's counts, both queues, the detail.
    func reloadAll() async {
        async let a: Void = loadList()
        async let b: Void = loadRequests()
        async let c: Void = loadNeeds()
        _ = await (a, b, c)
        detailNonce += 1
    }

    func loadList() async {
        listSeq += 1
        let seq = listSeq
        loading = true
        do {
            let data = try await DepartmentsAPI.list()
            guard seq == listSeq else { return }
            rows = data
            error = nil
            if selected == nil { selectedId = filtered.first?.departmentId }
        } catch {
            guard seq == listSeq else { return }
            self.error = (error as? APIError)?.errorDescription ?? "Could not load departments."
        }
        if seq == listSeq { loading = false }
    }

    func loadRequests() async {
        requestsSeq += 1
        let seq = requestsSeq
        requestsLoading = true
        do {
            let data = try await DepartmentsAPI.serveRequests(status: "requested")
            guard seq == requestsSeq else { return }
            requests = data
            requestsError = nil
        } catch {
            guard seq == requestsSeq else { return }
            requestsError = (error as? APIError)?.errorDescription ?? "Could not load requests to serve."
        }
        if seq == requestsSeq { requestsLoading = false }
    }

    func loadNeeds() async {
        needsSeq += 1
        let seq = needsSeq
        needsLoading = true
        do {
            async let p = DepartmentsAPI.needs(status: "pending")
            async let o = DepartmentsAPI.needs(status: "approved")
            let (pending, open) = try await (p, o)
            guard seq == needsSeq else { return }
            pendingNeeds = pending
            openNeeds = open
            needsError = nil
        } catch {
            guard seq == needsSeq else { return }
            needsError = (error as? APIError)?.errorDescription ?? "Could not load needs."
        }
        if seq == needsSeq { needsLoading = false }
    }

    func loadFunds() async {
        funds = try? await DepartmentsAPI.funds()
        fundsLoaded = true
    }

    // Approve / decline a request to serve. Declining tells the member (they
    // may ask again), so it asks first; approving is the expected outcome.
    func requestServe(_ r: ServeRequestRow, decision: String) {
        if decision == "decline" { pendingDecline = r } else { Task { await decideServe(r, decision: "approve") } }
    }

    /// A 404 means the request was decided elsewhere — the row is stale, reload.
    func decideServe(_ r: ServeRequestRow, decision: String) async {
        deciding = "serve:\(r.departmentId):\(r.userId)#\(decision)"
        defer { deciding = nil }
        do {
            try await DepartmentsAPI.decideServe(r.departmentId, userId: r.userId, decision: decision)
            requests.removeAll { $0.departmentId == r.departmentId && $0.userId == r.userId }
            requestsError = nil
            toast = .success(decision == "approve" ? "\(r.fullName) now serves in \(r.department)" : "Request declined")
            await loadList()                      // member_count / pending_requests moved
            detailNonce += 1
        } catch {
            if case let APIError.http(status, _) = error, status == 404 {
                requestsError = "That request was already decided elsewhere — the queue was reloaded."
                await loadRequests()
            } else {
                requestsError = (error as? APIError)?.errorDescription
                    ?? (decision == "approve" ? "Could not approve the request." : "Could not decline the request.")
            }
        }
    }

    // Approve / reject / close a need. Approving OPENS GIVING toward the need
    // and tells the department, and there is no undo (an approved need can
    // only be closed) — so it asks first, stating the target. Rejecting takes
    // an optional note for the submitter; closing asks because it stops giving.
    func requestNeed(_ n: DepartmentNeedRow, decision: String) {
        pendingNeed = NeedPrompt(need: n, decision: decision)
    }

    /// A 422 means the need was already decided — reload rather than retry.
    func decideNeed(_ n: DepartmentNeedRow, decision: String, note: String?) async {
        deciding = "need:\(n.needId)#\(decision)"
        defer { deciding = nil }
        do {
            try await DepartmentsAPI.decideNeed(n.needId, decision: decision, note: note)
            needsError = nil
            toast = .success(decision == "approve" ? "Approved — giving is open" : decision == "reject" ? "Need rejected" : "Need closed")
            await reloadAll()
        } catch {
            if case let APIError.http(status, message) = error, status == 422 || status == 404 {
                needsError = "\(message) — this need was decided elsewhere, so the queue was reloaded."
                await loadNeeds()
                detailNonce += 1
            } else {
                needsError = (error as? APIError)?.errorDescription ?? "Could not \(decision) the need."
            }
        }
    }

    /// Whether `key#action` is the decision in flight, and whether some OTHER decision is.
    func isMine(_ key: String, _ action: String) -> Bool { deciding == "\(key)#\(action)" }
    func otherBusy(_ key: String) -> Bool {
        guard let deciding else { return false }
        return !deciding.hasPrefix("\(key)#")
    }
}

// MARK: - Page

struct DepartmentsView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var vm = DepartmentsVM()
    @State private var tab: DepartmentsTab = .departments
    @State private var createOpen = false
    @State private var rejectNote = ""

    /// departments:manage gates the actions. A profile still loading fails OPEN
    /// (RootView's isSectionVisible doctrine) — the server enforces the
    /// permission regardless, and its 403 surfaces inline.
    private var canManage: Bool {
        auth.profile.map { $0.permissions.contains("departments:manage") } ?? true
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
        .toast($vm.toast)
        .task { if vm.rows.isEmpty { await vm.loadAll() } }
        .refreshable { await vm.loadAll() }
        // Reload a queue whenever it is opened — another admin may have decided meanwhile.
        .onChange(of: tab) { _, new in
            if new == .requests { Task { await vm.loadRequests() } }
            if new == .needs { Task { await vm.loadNeeds() } }
        }
        .onChange(of: vm.pendingNeed?.id) { _, _ in rejectNote = "" }
        .sheet(isPresented: $createOpen) {
            DepartmentFormSheet(mode: .create, funds: vm.funds, fundsLoaded: vm.fundsLoaded) { ack in
                vm.toast = .success("Department created")
                Task {
                    await vm.loadList()
                    if let id = ack.departmentId { vm.selectedId = id; tab = .departments }
                }
            }
        }
        .alert("Decline request?",
               isPresented: Binding(get: { vm.pendingDecline != nil }, set: { if !$0 { vm.pendingDecline = nil } }),
               presenting: vm.pendingDecline) { r in
            Button("Cancel", role: .cancel) { vm.pendingDecline = nil }
            Button("Decline", role: .destructive) {
                vm.pendingDecline = nil
                Task { await vm.decideServe(r, decision: "decline") }
            }
        } message: { r in
            Text("Decline \(r.fullName)'s request to serve in \(r.department)?\n\nThey will be told, and may ask again.")
        }
        .alert(needPromptTitle,
               isPresented: Binding(get: { vm.pendingNeed != nil }, set: { if !$0 { vm.pendingNeed = nil } }),
               presenting: vm.pendingNeed) { p in
            if p.decision == "reject" {
                TextField("Reason (optional)", text: $rejectNote)
            }
            Button("Cancel", role: .cancel) { vm.pendingNeed = nil }
            if p.decision == "approve" {
                Button("Approve") { decideNeed(p, note: nil) }
            } else if p.decision == "reject" {
                Button("Reject", role: .destructive) {
                    let n = rejectNote.trimmingCharacters(in: .whitespacesAndNewlines)
                    decideNeed(p, note: n.isEmpty ? nil : String(n.prefix(DepartmentsAPI.Limits.noteMax)))
                }
            } else {
                Button("Close need") { decideNeed(p, note: nil) }
            }
        } message: { p in
            Text(needQuestion(p))
        }
    }

    private var needPromptTitle: String {
        switch vm.pendingNeed?.decision {
        case "approve": return "Approve need?"
        case "reject": return "Reject need"
        default: return "Close need?"
        }
    }

    private func needQuestion(_ p: NeedPrompt) -> String {
        let n = p.need
        let target = money(n.targetMinor, n.currency)
        switch p.decision {
        case "approve":
            let by = n.deadline.map { " by \(PgDate.day($0))" } ?? ""
            return "Approve “\(n.title)” for \(n.department)?\n\nThis opens giving toward it — \(target)\(by). The department will be told. It cannot be undone here; an open need can only be closed."
        case "reject":
            return "Reject “\(n.title)” (\(target)) from \(n.department)?\n\n\(n.submittedName) will be told. Add a short reason if you like."
        default:
            return "Close “\(n.title)”?\n\nGiving toward it stops. Raised so far: \(money(n.raisedMinor, n.currency)) of \(target)."
        }
    }

    private func decideNeed(_ p: NeedPrompt, note: String?) {
        vm.pendingNeed = nil
        Task { await vm.decideNeed(p.need, decision: p.decision, note: note) }
    }

    // MARK: hero — shared PortalHero (breadcrumb · title · stat strip · trailing chips)

    private var hero: some View {
        let t = vm.totals
        let loaded = vm.loaded
        return PortalHero(
            breadcrumb: ["Operations", "Departments"],
            title: "Departments",
            stats: [
                HeroStat(label: "Departments", value: loaded ? String(t.departments) : "—", hint: "active"),
                HeroStat(label: "Serving", value: loaded ? String(t.serving) : "—", hint: "active members across departments"),
                HeroStat(label: "Requests", value: loaded ? String(t.requests) : "—", hint: "waiting to serve",
                         tint: t.requests > 0 ? Color(hex: 0xF5C77E) : nil),
                HeroStat(label: "Pending needs", value: loaded ? String(t.pendingNeeds) : "—", hint: "awaiting approval",
                         tint: t.pendingNeeds > 0 ? Color(hex: 0xF5C77E) : nil),
                HeroStat(label: "Open needs", value: loaded ? String(t.openNeeds) : "—", hint: "giving is open"),
            ]
        ) {
            HStack(spacing: 8) {
                HeroChip(label: loaded ? plural(t.departments, "department", "departments") : "Departments",
                         icon: "person.3.fill", style: .tag)
                HeroChip(label: vm.requestsLoading && vm.requests.isEmpty ? "Requests · …" : "Requests · \(vm.requests.count)",
                         icon: "person.badge.plus", style: .ghost) { tab = .requests }
                HeroChip(label: vm.needsLoading && vm.pendingNeeds.isEmpty ? "Needs · …" : "Needs · \(vm.pendingNeeds.count)",
                         icon: "list.clipboard", style: .ghost) { tab = .needs }
                if canManage {
                    HeroChip(label: "New department", icon: "plus", style: .gold) { createOpen = true }
                }
            }
        }
    }

    // MARK: tab bar (FinanceView idiom + count badges)

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(DepartmentsTab.allCases, id: \.self) { t in
                    let active = tab == t
                    let count = t == .requests ? vm.requests.count : t == .needs ? vm.pendingNeeds.count : 0
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
        switch tab {
        case .departments:
            departmentsTab
        case .requests:
            RequestsPanel(vm: vm, canManage: canManage)
        case .needs:
            NeedsPanel(vm: vm, canManage: canManage)
        }
    }

    // MARK: Departments tab — filters + master–detail (rail | detail), stacking when narrow

    private var departmentsTab: some View {
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
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Nuru.ink600)
                TextField("Search name, leader, purpose", text: $vm.search)
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
            FilterChips(options: statusFilters, selection: $vm.statusFilter)
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

    // Rail — one row per department (name · purpose · leader · counts · open · status).
    private var railList: some View {
        let list = vm.filtered
        return VStack(spacing: 10) {
            if vm.loading && vm.rows.isEmpty {
                SkeletonList(rows: 6)
            } else if list.isEmpty {
                Card(padding: 24) {
                    Text(vm.rows.isEmpty
                         ? (canManage ? "No departments yet — create the first one and members can ask to serve in it from the app." : "No departments yet.")
                         : (vm.filtersActive ? "No departments match those filters." : "No departments."))
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                        .multilineTextAlignment(.center).frame(maxWidth: .infinity)
                }
            } else {
                ForEach(Array(list.enumerated()), id: \.element.id) { i, r in
                    departmentRow(r, seed: i, active: r.departmentId == vm.selectedId)
                }
            }
        }
    }

    private func departmentRow(_ r: DepartmentRow, seed: Int, active: Bool) -> some View {
        let dim = active ? Color.white.opacity(0.7) : Nuru.ink600
        let warn = active ? Color(hex: 0xF5C77E) : Color(hex: 0xA87616)
        return Button { vm.selectedId = r.departmentId } label: {
            HStack(alignment: .top, spacing: 12) {
                PersonAvatar(url: r.imageUrl, name: r.name, seed: seed, size: 42)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(r.name).font(.inter(14, .bold))
                            .foregroundStyle(active ? .white : Nuru.foreground).lineLimit(1)
                        if r.isArchived { ChipPill(chip: departmentStatusChip(r.status)) }
                    }
                    Text(r.purpose.isEmpty ? (r.meets.map { "Meets \($0)" } ?? "No purpose written yet") : r.purpose)
                        .font(.nMicro).foregroundStyle(dim).lineLimit(1)
                    Text(r.leaderName.map { "Led by \($0)" } ?? "No leader yet")
                        .font(.nMicro).foregroundStyle(dim).lineLimit(1)
                    HStack(spacing: 5) {
                        Text("\(r.memberCount) serving")
                        Text("·")
                        Text("\(r.pendingRequests) requests").foregroundStyle(r.pendingRequests > 0 ? warn : dim)
                        Text("·")
                        Text("\(r.pendingNeeds) pending").foregroundStyle(r.pendingNeeds > 0 ? warn : dim)
                        Text("·")
                        Text("\(r.openNeeds) open").foregroundStyle(r.openNeeds > 0 ? (active ? Color(hex: 0x9BE3B4) : Color(hex: 0x0F6B33)) : dim)
                    }
                    .font(.nMicro).foregroundStyle(dim).lineLimit(1).minimumScaleFactor(0.85)
                }
                Spacer(minLength: 6)
                ChipPill(chip: r.isOpenToJoin ? Chip(label: "Open", tone: .green) : Chip(label: "Closed", tone: .grey))
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(active ? Nuru.navy : Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous)
                .stroke(active ? Nuru.navy : Color(hex: 0x0A2540, alpha: 0.14), lineWidth: 1))
            .nuruShadow(active ? 1.2 : 0.6)
            .opacity(r.isArchived && !active ? 0.75 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(r.name), \(r.isArchived ? "archived" : "active")")
    }

    @ViewBuilder private var detailPanel: some View {
        if let row = vm.selected {
            DepartmentDetailPanel(vm: vm, row: row, canManage: canManage)
                .id(row.departmentId)
        } else if vm.selectedId != nil, !vm.loading {
            Card(padding: 40) {
                Text(vm.error ?? "Department not found — it may belong to another congregation.")
                    .font(.nBody).foregroundStyle(Nuru.ink600).frame(maxWidth: .infinity)
            }
        } else {
            Card(padding: 40) {
                Text("Select a department to see its posts, members, needs and requests.")
                    .font(.nBody).foregroundStyle(Nuru.ink600).frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Detail panel (the web drawer: header · details/edit · posts · members · needs · requests)

private struct DepartmentDetailPanel: View {
    @ObservedObject var vm: DepartmentsVM
    let row: DepartmentRow
    let canManage: Bool

    // Posts + active members come from the member-facing page (the only route
    // that returns posts); needs across every status come from the admin
    // queue, filtered to this department.
    @State private var page: DepartmentPage?
    @State private var pageGone = false                   // 404: archived (or not visible)
    @State private var pageError: String?
    @State private var needs: [DepartmentNeedRow] = []
    @State private var needsError: String?
    @State private var detailLoading = true
    @State private var editOpen = false
    @State private var needOpen = false
    @State private var confirmArchive = false
    @State private var archiving = false
    @State private var notice: Notice?
    // posts
    @State private var postBody = ""
    @State private var postImage = ""
    @State private var posting = false
    @State private var removing: String?
    @State private var pendingRemove: String?

    private var archived: Bool { row.isArchived }
    private var requests: [ServeRequestRow] { vm.requests.filter { $0.departmentId == row.departmentId } }

    var body: some View {
        VStack(spacing: 14) {
            headerCard
            detailsCard
            postsCard
            if let page, !page.members.isEmpty { membersCard(page.members) }
            needsCard
            requestsCard
        }
        // First mount loads; a nonce bump is a silent refresh that keeps the
        // panel on screen while posts, needs and counts catch up.
        .task(id: vm.detailNonce) { await loadDetail() }
        .sheet(isPresented: $editOpen) {
            DepartmentFormSheet(mode: .edit(row), funds: vm.funds, fundsLoaded: vm.fundsLoaded) { _ in
                vm.toast = .success("Department saved")
                Task { await vm.loadList(); await loadDetail() }   // a new leader is now an active member
            }
        }
        .sheet(isPresented: $needOpen) {
            NeedComposerSheet(departmentId: row.departmentId) {
                vm.toast = .success("Need submitted — it is in the queue")
                Task { await vm.reloadAll() }
            }
        }
        // Archive hides the department from the app (members keep their history
        // and it can be restored here) — asks first. Restore does not.
        .alert("Archive \(row.name)?", isPresented: $confirmArchive) {
            Button("Cancel", role: .cancel) {}
            Button("Archive", role: .destructive) { Task { await setStatus("archived") } }
        } message: {
            Text("It disappears from the app — members can no longer ask to serve, and nobody can post or submit needs. \(plural(row.memberCount, "member keeps", "members keep")) their history. You can restore it here.")
        }
        .alert("Remove this post?", isPresented: Binding(get: { pendingRemove != nil }, set: { if !$0 { pendingRemove = nil } })) {
            Button("Cancel", role: .cancel) { pendingRemove = nil }
            Button("Remove", role: .destructive) {
                if let id = pendingRemove { Task { await removePost(id) } }
                pendingRemove = nil
            }
        } message: {
            Text("It disappears from the app for everyone.")
        }
    }

    private func loadDetail() async {
        if page == nil && needs.isEmpty { detailLoading = true }
        do {
            page = try await DepartmentsAPI.page(row.departmentId)
            pageGone = false
            pageError = nil
        } catch {
            page = nil
            if case let APIError.http(status, _) = error, status == 404 {
                pageGone = true
                pageError = nil
            } else {
                pageGone = false
                pageError = (error as? APIError)?.errorDescription ?? "Could not load posts."
            }
        }
        do {
            needs = try await DepartmentsAPI.needsAllStatuses().filter { $0.departmentId == row.departmentId }
            needsError = nil
        } catch {
            needsError = (error as? APIError)?.errorDescription ?? "Could not load this department's needs."
        }
        detailLoading = false
    }

    private func setStatus(_ status: String) async {
        archiving = true
        notice = nil
        do {
            _ = try await DepartmentsAPI.update(row.departmentId, ["status": .string(status)])
            vm.toast = .success(status == "archived" ? "Department archived" : "Department restored")
            await vm.loadList()
            await loadDetail()
        } catch {
            notice = Notice(kind: .error, text: (error as? APIError)?.errorDescription
                            ?? (status == "archived" ? "Could not archive the department." : "Could not restore the department."))
        }
        archiving = false
    }

    // Compose (office post → members are nudged). An archived department cannot
    // be posted to (server 404s), and its posts cannot be read (the member page
    // is active-only).
    private func post() async {
        let text = postBody.trimmingCharacters(in: .whitespacesAndNewlines)
        let img = postImage.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { notice = Notice(kind: .warn, text: "Write something first."); return }
        if !img.isEmpty && !isHttpUrl(img) { notice = Notice(kind: .warn, text: "Image must be a full http(s) URL."); return }
        posting = true
        notice = nil
        do {
            try await DepartmentsAPI.createPost(row.departmentId, body: text, imageUrl: img.isEmpty ? nil : img)
            postBody = ""
            postImage = ""
            vm.toast = .success("Posted — members will hear about it")
            await loadDetail()
        } catch {
            notice = Notice(kind: .error, text: (error as? APIError)?.errorDescription ?? "Could not post.")
        }
        posting = false
    }

    private func removePost(_ postId: String) async {
        removing = postId
        notice = nil
        do {
            try await DepartmentsAPI.deletePost(row.departmentId, postId: postId)
            vm.toast = .success("Post removed")
            await loadDetail()
        } catch {
            notice = Notice(kind: .error, text: (error as? APIError)?.errorDescription ?? "Could not remove the post.")
        }
        removing = nil
    }

    // Header — avatar, name, status, open-to-join, led by · meets · fund, purpose, gifts, four stat cells, actions.
    private var headerCard: some View {
        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 14) {
                    PersonAvatar(url: row.imageUrl, name: row.name, seed: 0, size: 56)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Text(row.name).font(.fraunces(21, .medium)).foregroundStyle(Nuru.navy)
                                .lineLimit(1).minimumScaleFactor(0.8)
                            ChipPill(chip: departmentStatusChip(row.status))
                        }
                        ChipPill(chip: row.isOpenToJoin ? Chip(label: "Open to join", tone: .green) : Chip(label: "Not taking members", tone: .grey))
                        Text([row.leaderName.map { "Led by \($0)" } ?? "No leader yet", row.meets.map { "Meets \($0)" }, row.fundCode.map { "Fund \($0)" }]
                                .compactMap { $0 }.joined(separator: " · "))
                            .font(.nCaption).foregroundStyle(Nuru.ink600)
                        if !row.purpose.isEmpty {
                            Text(row.purpose).font(.nCaption).foregroundStyle(Nuru.foreground)
                                .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                        }
                        if !row.giftKeys.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(row.giftKeys, id: \.self) { k in ChipPill(chip: Chip(label: titleCase(k), tone: .navy)) }
                                }
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
                    statCell("Serving", "\(row.memberCount)")
                    statCell("Requests", "\(row.pendingRequests)", tint: row.pendingRequests > 0 ? Color(hex: 0xA87616) : nil)
                    statCell("Pending needs", "\(row.pendingNeeds)", tint: row.pendingNeeds > 0 ? Color(hex: 0xA87616) : nil)
                    statCell("Open needs", "\(row.openNeeds)")
                }
                if let notice { NoticeBar(notice: notice) { self.notice = nil } }
                if canManage {
                    HStack(spacing: 10) {
                        ActionButton(title: "Edit", icon: "pencil") { editOpen = true }
                        if archived {
                            ActionButton(title: "Restore", icon: "arrow.uturn.backward", busy: archiving) { Task { await setStatus("active") } }
                        } else {
                            ActionButton(title: "Archive", icon: "archivebox", style: .danger, busy: archiving) { confirmArchive = true }
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }

    private func statCell(_ label: String, _ value: String, tint: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                .lineLimit(1).minimumScaleFactor(0.8)
            Text(value).font(.nMono(12, .medium)).foregroundStyle(tint ?? Nuru.navy)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
    }

    // Details — the editable fields, read-only (Edit opens the form sheet).
    private var detailsCard: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(title: "Details", icon: "info.circle", caption: "created \(PgDate.day(row.createdAt))")
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16, alignment: .top), count: 2), alignment: .leading, spacing: 10) {
                    detailLine("Leader", row.leaderName ?? "—")
                    detailLine("Meets", row.meets ?? "—")
                    detailLine("Fund", row.fundCode ?? "—", mono: true)
                    detailLine("Open to join", row.isOpenToJoin ? "Yes" : "No")
                    detailLine("Photo", row.imageUrl ?? "—", mono: true)
                    detailLine("Gifts", row.giftKeys.isEmpty ? "—" : row.giftKeys.map(titleCase).joined(separator: ", "))
                }
            }
        }
    }

    private func detailLine(_ label: String, _ value: String, mono: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
            Text(value).font(mono ? .nMono(12) : .inter(12.5)).foregroundStyle(Nuru.navy).lineLimit(1).truncationMode(.middle)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // Posts — compose (office) + the department's posts, newest first, each removable.
    private var postsCard: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(title: "Posts", icon: "text.bubble", caption: page.map { plural($0.posts.count, "post", "posts") })
                if canManage && !archived { composer }
                if pageGone {
                    DashedEmpty(text: archived ? "Posts are not shown for an archived department — restore it to read them." : "Posts are not available for this department.")
                } else if let pageError {
                    NoticeBar(notice: Notice(kind: .error, text: pageError))
                } else if detailLoading && page == nil {
                    Text("Loading posts…").font(.nCaption).foregroundStyle(Nuru.ink600)
                } else if let page, !page.posts.isEmpty {
                    VStack(spacing: 8) {
                        ForEach(Array(page.posts.enumerated()), id: \.element.id) { i, p in postRow(p, seed: i) }
                    }
                } else {
                    DashedEmpty(text: "Nothing posted yet.")
                }
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("A word from the office to this department — members read it in the app and get a nudge.", text: $postBody, axis: .vertical)
                .lineLimit(3...8)
                .multilineFieldStyle()
                .onChange(of: postBody) { _, new in
                    if new.count > DepartmentsAPI.Limits.postMax { postBody = String(new.prefix(DepartmentsAPI.Limits.postMax)) }
                }
            HStack(spacing: 8) {
                TextField("Image URL (optional)", text: $postImage)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .fieldStyle()
                Counter(count: postBody.count, max: DepartmentsAPI.Limits.postMax).frame(width: 80)
                ActionButton(title: "Post", icon: "paperplane.fill", style: .primary, busy: posting) { Task { await post() } }
                    .disabled(postBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .opacity(postBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1)
            }
        }
        .padding(12)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func postRow(_ p: DepartmentPost, seed: Int) -> some View {
        HStack(alignment: .top, spacing: 10) {
            PersonAvatar(url: p.authorAvatar, name: p.authorName ?? "Office", seed: seed, size: 30)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(p.authorName ?? "Office").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    Text(PgDate.stamp(p.createdAt)).font(.nMono(11.5)).foregroundStyle(Nuru.ink600).lineLimit(1)
                    Spacer(minLength: 0)
                    if canManage {
                        ActionButton(title: "Remove", icon: "trash", busy: removing == p.postId) { pendingRemove = p.postId }
                            .disabled(removing != nil && removing != p.postId)
                    }
                }
                Text(p.body).font(.nCaption).foregroundStyle(Nuru.foreground)
                    .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                if let img = p.imageUrl, let url = URL(string: img) {
                    CachedAsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                            .frame(maxHeight: 260).clipped()
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                    } placeholder: {
                        Skeleton(height: 120, radius: Nuru.R.chip)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // Members — active members, leader first (the member page's order).
    private func membersCard(_ members: [DepartmentMemberRow]) -> some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(title: "Members", icon: "person.2", caption: "\(members.count) serving")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                    ForEach(Array(members.enumerated()), id: \.element.id) { i, m in
                        HStack(spacing: 8) {
                            PersonAvatar(url: m.avatarUrl, name: m.fullName, seed: i, size: 24)
                            Text(m.fullName).font(.inter(12.5)).foregroundStyle(Nuru.navy).lineLimit(1)
                            if m.role == "leader" { ChipPill(chip: Chip(label: "Leader", tone: .violet)) }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 5).padding(.leading, 6).padding(.trailing, 10)
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                }
            }
        }
    }

    // Needs — this department's needs across every status; the office can submit one.
    private var needsCard: some View {
        let pendingHere = needs.filter { $0.status == "pending" }.count
        let caption = needs.isEmpty ? nil : plural(needs.count, "need", "needs") + (pendingHere > 0 ? " · \(pendingHere) awaiting approval" : "")
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(title: "Needs", icon: "target", caption: caption)
                if let needsError { NoticeBar(notice: Notice(kind: .error, text: needsError)) }
                if let queueError = vm.needsError { NoticeBar(notice: Notice(kind: .error, text: queueError)) { vm.needsError = nil } }
                if canManage && !archived {
                    HStack {
                        ActionButton(title: "Submit a need", icon: "plus") { needOpen = true }
                        Spacer(minLength: 0)
                    }
                }
                if detailLoading && needs.isEmpty && needsError == nil {
                    Text("Loading needs…").font(.nCaption).foregroundStyle(Nuru.ink600)
                } else if needs.isEmpty && needsError == nil {
                    DashedEmpty(text: "No needs yet — the leader submits one from the app\(canManage && !archived ? ", or the office can above" : "").")
                } else {
                    VStack(spacing: 10) {
                        ForEach(needs) { n in
                            NeedCard(need: n, canManage: canManage, vm: vm) { d in vm.requestNeed(n, decision: d) }
                        }
                    }
                }
            }
        }
    }

    // Requests to serve — this department's pending requests (from the page-level queue).
    private var requestsCard: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(title: "Requests to serve", icon: "person.badge.plus", caption: requests.isEmpty ? nil : "\(requests.count) pending")
                if let e = vm.requestsError { NoticeBar(notice: Notice(kind: .error, text: e)) { vm.requestsError = nil } }
                if requests.isEmpty {
                    DashedEmpty(text: "Nobody is waiting to serve here.")
                } else {
                    VStack(spacing: 8) {
                        ForEach(Array(requests.enumerated()), id: \.element.id) { i, r in
                            RequestRow(request: r, seed: i, canManage: canManage, vm: vm) { d in vm.requestServe(r, decision: d) }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Need card (shared by the queues and the detail panel)
// One need with its server-computed progress. Actions follow the state
// machine: pending → approve | reject; approved → close; rejected/closed: none.

private struct NeedCard: View {
    let need: DepartmentNeedRow
    var showDepartment = false
    let canManage: Bool
    @ObservedObject var vm: DepartmentsVM
    let onDecide: (String) -> Void

    var body: some View {
        let n = need
        let key = "need:\(n.needId)"
        let otherBusy = vm.otherBusy(key)
        let ratio = n.targetMinor > 0 ? min(max(Double(n.raisedMinor) / Double(n.targetMinor), 0), 1) : 0
        let reached = n.raisedMinor >= n.targetMinor && n.targetMinor > 0
        let bar: Color = (n.status == "closed" || n.status == "rejected") ? Nuru.ink400 : reached ? Color(hex: 0x7C3AED) : Color(hex: 0x16A34A)
        let meta = [showDepartment ? n.department : nil, "Submitted by \(n.submittedName)", PgDate.day(n.createdAt),
                    n.deadline.map { "by \(PgDate.day($0))" }].compactMap { $0 }.joined(separator: " · ")
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: "target").font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.navy)
                    Text(n.title).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy).lineLimit(2)
                    ChipPill(chip: needStatusChip(n.status))
                    if reached && n.status == "approved" { ChipPill(chip: Chip(label: "Target reached", tone: .violet)) }
                }
                Text(meta).font(.nMicro).foregroundStyle(Nuru.ink600)
                Text(n.why).font(.nCaption).foregroundStyle(Nuru.foreground)
                    .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
            }
            VStack(spacing: 5) {
                HStack(spacing: 4) {
                    Text(money(n.raisedMinor, n.currency)).font(.nMono(12)).foregroundStyle(Nuru.navy)
                    Text("of \(money(n.targetMinor, n.currency))").font(.nMono(12)).foregroundStyle(Nuru.ink600)
                    Spacer(minLength: 0)
                    Text("\(Int((ratio * 100).rounded()))%").font(.nMono(12)).foregroundStyle(Nuru.ink600)
                }
                ProgressBar(pct: ratio * 100, fill: bar, height: 8)
            }
            if canManage && (n.status == "pending" || n.status == "approved") {
                HStack(spacing: 8) {
                    if n.status == "pending" {
                        ActionButton(title: "Approve", icon: "checkmark", style: .primary, busy: vm.isMine(key, "approve")) { onDecide("approve") }
                        ActionButton(title: "Reject", icon: "nosign", style: .danger, busy: vm.isMine(key, "reject")) { onDecide("reject") }
                    } else {
                        ActionButton(title: "Close", icon: "archivebox", busy: vm.isMine(key, "close")) { onDecide("close") }
                    }
                    Spacer(minLength: 0)
                }
                .disabled(otherBusy)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .opacity(otherBusy ? 0.7 : 1)
    }
}

// MARK: - Request row (shared by the queue and the detail panel)

private struct RequestRow: View {
    let request: ServeRequestRow
    var seed = 0
    var showDepartment = false
    let canManage: Bool
    @ObservedObject var vm: DepartmentsVM
    let onDecide: (String) -> Void

    var body: some View {
        let r = request
        let key = "serve:\(r.departmentId):\(r.userId)"
        let otherBusy = vm.otherBusy(key)
        let meta = [showDepartment ? r.department : nil, r.phoneNumber, "asked \(PgDate.stamp(r.requestedAt))"].compactMap { $0 }.joined(separator: " · ")
        HStack(alignment: .center, spacing: 12) {
            PersonAvatar(url: r.avatarUrl, name: r.fullName, seed: seed, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.fullName).font(.inter(13, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                Text(meta).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(2)
            }
            Spacer(minLength: 8)
            if canManage {
                HStack(spacing: 8) {
                    ActionButton(title: "Approve", icon: "checkmark", style: .primary, busy: vm.isMine(key, "approve")) { onDecide("approve") }
                    ActionButton(title: "Decline", icon: "nosign", style: .danger, busy: vm.isMine(key, "decline")) { onDecide("decline") }
                }
                .disabled(otherBusy)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .opacity(otherBusy ? 0.7 : 1)
    }
}

// MARK: - Requests tab — every pending request to serve, oldest first

private struct RequestsPanel: View {
    @ObservedObject var vm: DepartmentsVM
    let canManage: Bool

    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Requests to serve").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                        Text("“I'd like to serve here” — approving adds the member to the department; either way they are told.")
                            .font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    Text(vm.requestsLoading && vm.requests.isEmpty ? "…" : "\(vm.requests.count) pending").font(.nMono(12)).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 18).padding(.vertical, 16)
                .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }

                VStack(spacing: 8) {
                    if let e = vm.requestsError { NoticeBar(notice: Notice(kind: .error, text: e)) { vm.requestsError = nil } }
                    if vm.requestsLoading && vm.requests.isEmpty {
                        SkeletonList(rows: 3)
                    } else if vm.requests.isEmpty {
                        if vm.requestsError == nil {
                            EmptyState.compact(icon: "person.badge.plus", message: "Nobody is waiting — every request to serve has been decided.")
                        }
                    } else {
                        ForEach(Array(vm.requests.enumerated()), id: \.element.id) { i, r in
                            RequestRow(request: r, seed: i, showDepartment: true, canManage: canManage, vm: vm) { d in vm.requestServe(r, decision: d) }
                        }
                    }
                }
                .padding(16)
            }
        }
    }
}

// MARK: - Needs tab — awaiting approval (approve opens giving) + open needs (closable)

private struct NeedsPanel: View {
    @ObservedObject var vm: DepartmentsVM
    let canManage: Bool

    var body: some View {
        VStack(spacing: 16) {
            if let e = vm.needsError { NoticeBar(notice: Notice(kind: .error, text: e)) { vm.needsError = nil } }
            queueCard(title: "Awaiting approval",
                      blurb: "Approving opens giving toward the need — it becomes its own giving target and the department is told. Rejecting tells the submitter.",
                      count: "\(vm.pendingNeeds.count) pending", rows: vm.pendingNeeds,
                      empty: "Nothing to approve — every need has been decided.")
            queueCard(title: "Open — giving is on",
                      blurb: "Raised is exact: gifts made to the need and gifts under pledges to it, nothing else. Close a need once it is met or no longer applies.",
                      count: "\(vm.openNeeds.count) open", rows: vm.openNeeds,
                      empty: "No open needs — approve one above to open giving.")
        }
    }

    private func queueCard(title: String, blurb: String, count: String, rows: [DepartmentNeedRow], empty: String) -> some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                        Text(blurb).font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    Text(vm.needsLoading && rows.isEmpty ? "…" : count).font(.nMono(12)).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 18).padding(.vertical, 16)
                .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }

                VStack(spacing: 10) {
                    if vm.needsLoading && rows.isEmpty {
                        SkeletonList(rows: 2)
                    } else if rows.isEmpty {
                        DashedEmpty(text: empty)
                    } else {
                        ForEach(rows) { n in
                            NeedCard(need: n, showDepartment: true, canManage: canManage, vm: vm) { d in vm.requestNeed(n, decision: d) }
                        }
                    }
                }
                .padding(16)
            }
        }
    }
}

// MARK: - Department form (create + edit)
// Validates against the server's zod limits so the first submit is the one
// that lands; the server still owns the final word (unknown fund → 404, shown
// as the form's error).

private struct LeaderRef: Equatable { let userId: String; let name: String }

private struct DepartmentFormSheet: View {
    enum Mode { case create, edit(DepartmentRow) }
    let mode: Mode
    let funds: [FundOption]?
    let fundsLoaded: Bool
    let onSaved: (DepartmentAck) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var purpose: String
    @State private var leader: LeaderRef?
    @State private var meets: String
    @State private var imageUrl: String
    @State private var fundCode: String
    @State private var giftKeys: [String]
    @State private var openToJoin: Bool
    @State private var saving = false
    @State private var error: String?

    init(mode: Mode, funds: [FundOption]?, fundsLoaded: Bool, onSaved: @escaping (DepartmentAck) -> Void) {
        self.mode = mode
        self.funds = funds
        self.fundsLoaded = fundsLoaded
        self.onSaved = onSaved
        var row: DepartmentRow?
        if case .edit(let r) = mode { row = r }
        _name = State(initialValue: row?.name ?? "")
        _purpose = State(initialValue: row?.purpose ?? "")
        _leader = State(initialValue: row?.leaderUserId.map { LeaderRef(userId: $0, name: row?.leaderName ?? $0) })
        _meets = State(initialValue: row?.meets ?? "")
        _imageUrl = State(initialValue: row?.imageUrl ?? "")
        _fundCode = State(initialValue: row?.fundCode ?? "")
        _giftKeys = State(initialValue: row?.giftKeys ?? [])
        _openToJoin = State(initialValue: row?.isOpenToJoin ?? true)
    }

    private var isEdit: Bool { if case .edit = mode { return true }; return false }
    private var editingId: String? { if case .edit(let r) = mode { return r.departmentId }; return nil }

    // Fund picker: the active funds (plus the current code if it is no longer
    // active, so editing never silently drops it); a typed code when the list
    // is unavailable.
    private var fundOptions: [FundOption]? {
        guard let funds else { return nil }
        var active = funds.filter { $0.isActive }
        if !fundCode.isEmpty, !active.contains(where: { $0.code == fundCode }) {
            if let known = funds.first(where: { $0.code == fundCode }) { active.append(known) }
            else { active.append(FundOption(code: fundCode, name: fundCode, isActive: false)) }
        }
        return active
    }

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
                    departmentSection
                    leaderSection
                    giftsSection
                    photoSection
                }
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24).padding(.vertical, 22)
            }
            .scrollContentBackground(.hidden)
            .background(Nuru.paper)
            .navigationTitle(isEdit ? "Edit department" : "New department")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.tint(Nuru.ink600).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : (isEdit ? "Save changes" : "Create")) { Task { await submit() } }
                        .font(.inter(14, .bold)).tint(Nuru.gold)
                        .disabled(saving)
                }
            }
        }
    }

    private var departmentSection: some View {
        FormSection("Department") {
            FormField("Name", required: true) {
                TextField("Worship, Ushering, Media…", text: $name).fieldStyle()
                    .onChange(of: name) { _, new in if new.count > DepartmentsAPI.Limits.nameMax { name = String(new.prefix(DepartmentsAPI.Limits.nameMax)) } }
            }
            FormField("Purpose") {
                TextField("What this department does, in a sentence or two — members read this in the app.", text: $purpose, axis: .vertical)
                    .lineLimit(3...8).multilineFieldStyle()
                    .onChange(of: purpose) { _, new in if new.count > DepartmentsAPI.Limits.purposeMax { purpose = String(new.prefix(DepartmentsAPI.Limits.purposeMax)) } }
                Counter(count: purpose.count, max: DepartmentsAPI.Limits.purposeMax)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 16)], alignment: .leading, spacing: 14) {
                FormField("Meets") {
                    TextField("Saturdays 2pm, main hall", text: $meets).fieldStyle()
                        .onChange(of: meets) { _, new in if new.count > DepartmentsAPI.Limits.meetsMax { meets = String(new.prefix(DepartmentsAPI.Limits.meetsMax)) } }
                }
                FormField("Fund") {
                    if let options = fundOptions {
                        Picker("Fund", selection: $fundCode) {
                            Text("No fund").tag("")
                            ForEach(options) { f in Text(f.isActive ? f.name : "\(f.name) (inactive)").tag(f.code) }
                        }
                        .fieldPickerStyle()
                    } else {
                        TextField(fundsLoaded ? "Fund code, e.g. GENERAL" : "Loading funds…", text: $fundCode)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .fieldStyle()
                            .disabled(!fundsLoaded)
                            .onChange(of: fundCode) { _, new in
                                let up = new.uppercased()
                                if up != new || up.count > DepartmentsAPI.Limits.fundCodeMax { fundCode = String(up.prefix(DepartmentsAPI.Limits.fundCodeMax)) }
                            }
                    }
                }
            }
            FieldHint(text: "Gifts to this department's needs land in this fund."
                      + (fundsLoaded && funds == nil ? " The fund list needs finance:view — type the fund's code; the server checks it." : ""))
        }
    }

    private var leaderSection: some View {
        FormSection("Leader") {
            LeaderPicker(leader: $leader)
            FieldHint(text: "The leader posts, submits needs and approves requests to serve from the app. Saving makes them an active member with the leader role.")
        }
    }

    private var giftsSection: some View {
        FormSection("Gifts & joining") {
            FormField("Gifts this department fits") { GiftKeysInput(keys: $giftKeys) }
            FieldHint(text: "Members whose top gifts match see “a good fit for you” in the app.")
            Toggle(isOn: $openToJoin) {
                Text("Open to join — members can ask to serve here").font(.inter(14)).foregroundStyle(Nuru.navy)
            }
            .tint(Nuru.lumGreen)
            .padding(.top, 4)
        }
    }

    private var photoSection: some View {
        FormSection("Photo") {
            FormField("Photo URL") {
                TextField("https://…", text: $imageUrl)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .fieldStyle()
            }
        }
    }

    private func submit() async {
        let n = name.trimmingCharacters(in: .whitespaces)
        let p = purpose.trimmingCharacters(in: .whitespacesAndNewlines)
        let m = meets.trimmingCharacters(in: .whitespaces)
        let img = imageUrl.trimmingCharacters(in: .whitespaces)
        let fund = fundCode.trimmingCharacters(in: .whitespaces)
        let L = DepartmentsAPI.Limits.self
        if n.count < L.nameMin || n.count > L.nameMax { error = "Name must be \(L.nameMin)–\(L.nameMax) characters."; return }
        if p.count > L.purposeMax { error = "Purpose must be at most \(L.purposeMax) characters."; return }
        if m.count > L.meetsMax { error = "“Meets” must be at most \(L.meetsMax) characters."; return }
        if !img.isEmpty && !isHttpUrl(img) { error = "Photo must be a full http(s) URL."; return }
        if !fund.isEmpty && (fund.count < L.fundCodeMin || fund.count > L.fundCodeMax) { error = "Fund code must be \(L.fundCodeMin)–\(L.fundCodeMax) characters."; return }
        let body: [String: DepartmentJSON] = [
            "name": .string(n),
            "purpose": .string(p),
            "leader_user_id": leader.map { DepartmentJSON.string($0.userId) } ?? DepartmentJSON.null,
            "meets": m.isEmpty ? .null : .string(m),
            "image_url": img.isEmpty ? .null : .string(img),
            "fund_code": fund.isEmpty ? .null : .string(fund),
            "gift_keys": .strings(giftKeys),
            "is_open_to_join": .bool(openToJoin),
        ]
        saving = true
        error = nil
        do {
            let ack: DepartmentAck
            if let id = editingId { ack = try await DepartmentsAPI.update(id, body) }
            else { ack = try await DepartmentsAPI.create(body) }
            onSaved(ack)
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription
                ?? (isEdit ? "Could not save the department." : "Could not create the department.")
        }
        saving = false
    }
}

// MARK: - Leader picker
// Member search (GET /admin/members?search=, members:view). When the search
// is refused or fails, a pasted member id still works — the server only needs
// leader_user_id.

private struct LeaderPicker: View {
    @Binding var leader: LeaderRef?
    @State private var query = ""
    @State private var hits: [MemberRow] = []
    @State private var searching = false
    @State private var failed = false
    @State private var manualId = ""
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        if let leader {
            HStack(spacing: 10) {
                PersonAvatar(url: nil, name: leader.name, seed: 0, size: 26)
                Text(leader.name).font(.inter(14, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                Spacer(minLength: 0)
                Button("Change") { self.leader = nil }.font(.inter(12.5, .semibold)).tint(Nuru.navy)
            }
            .fieldChrome()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Nuru.ink600)
                    TextField("Search members by name, email or phone", text: $query)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    if searching { ProgressView().scaleEffect(0.8) }
                }
                .fieldStyle()
                .onChange(of: query) { _, q in schedule(q) }
                let q = query.trimmingCharacters(in: .whitespaces)
                if !q.isEmpty && !searching && !failed {
                    VStack(spacing: 0) {
                        if hits.isEmpty {
                            Text("No member matches “\(q)”.").font(.nCaption).foregroundStyle(Nuru.ink600)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 10)
                        } else {
                            ForEach(Array(hits.prefix(8).enumerated()), id: \.element.id) { i, m in
                                Button {
                                    leader = LeaderRef(userId: m.userId, name: m.fullName)
                                    query = ""
                                    hits = []
                                } label: {
                                    HStack(spacing: 10) {
                                        PersonAvatar(url: nil, name: m.fullName, seed: i, size: 28)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(m.fullName).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                                            Text([m.phoneNumber.isEmpty ? nil : m.phoneNumber, m.cellName ?? "No cell yet"].compactMap { $0 }.joined(separator: " · "))
                                                .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                                        }
                                        Spacer(minLength: 0)
                                    }
                                    .padding(.horizontal, 10).padding(.vertical, 8)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .hoverEffect(.highlight)
                                .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                            }
                        }
                    }
                    .background(Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }
                if failed {
                    NoticeBar(notice: Notice(kind: .warn, text: "Member search is not available to you (it needs members:view). Paste the member's id instead."))
                    HStack(spacing: 8) {
                        TextField("Member id (UUID)", text: $manualId)
                            .font(.nMono(12)).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .fieldStyle()
                        ActionButton(title: "Use id", icon: "checkmark") {
                            let id = manualId.trimmingCharacters(in: .whitespaces).lowercased()
                            leader = LeaderRef(userId: id, name: id)
                            manualId = ""
                        }
                        .disabled(UUID(uuidString: manualId.trimmingCharacters(in: .whitespaces)) == nil)
                    }
                }
            }
        }
    }

    private func schedule(_ raw: String) {
        searchTask?.cancel()
        let q = raw.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { hits = []; searching = false; return }
        searching = true
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            do {
                let page = try await PortalAPI.members(search: q)
                guard !Task.isCancelled else { return }
                hits = page.data
                failed = false
            } catch {
                guard !Task.isCancelled else { return }
                hits = []
                failed = true
            }
            searching = false
        }
    }
}

// MARK: - Gift keys
// The seven assessment gifts as toggles, plus any key the department wants
// (the server accepts free-form keys, ≤ 12 of ≤ 40 chars). Lower-cased so a
// typed "Music" and the app's "music" match.

private struct GiftKeysInput: View {
    @Binding var keys: [String]
    @State private var draft = ""

    private var custom: [String] { keys.filter { !DepartmentsAPI.giftKeys.contains($0) } }
    private var full: Bool { keys.count >= DepartmentsAPI.Limits.giftKeysMax }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 118), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                ForEach(DepartmentsAPI.giftKeys, id: \.self) { k in
                    let on = keys.contains(k)
                    Button { toggle(k) } label: {
                        Text(titleCase(k)).font(.inter(12.5, .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 10).padding(.vertical, 8)
                            .background(on ? Nuru.navy : Nuru.white)
                            .foregroundStyle(on ? .white : Nuru.navy)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(on ? Nuru.navy : Nuru.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
                ForEach(custom, id: \.self) { k in
                    HStack(spacing: 4) {
                        Text(titleCase(k)).font(.inter(12.5, .semibold)).lineLimit(1)
                        Button { toggle(k) } label: { Image(systemName: "xmark").font(.system(size: 10, weight: .bold)) }
                            .buttonStyle(.plain).accessibilityLabel("Remove \(k)")
                    }
                    .foregroundStyle(Color(hex: 0x1E4068))
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .background(Color(hex: 0xE6EDF5))
                    .clipShape(Capsule())
                }
            }
            HStack(spacing: 8) {
                TextField(full ? "Up to \(DepartmentsAPI.Limits.giftKeysMax) gifts" : "Add another, e.g. music", text: $draft)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .fieldStyle()
                    .disabled(full)
                    .onSubmit { add() }
                ActionButton(title: "Add", icon: "plus") { add() }
                    .disabled(full || draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func toggle(_ k: String) {
        if keys.contains(k) { keys.removeAll { $0 == k } }
        else if !full { keys.append(k) }
    }
    private func add() {
        let k = String(draft.trimmingCharacters(in: .whitespaces).lowercased().prefix(DepartmentsAPI.Limits.giftKeyMax))
        guard !k.isEmpty else { return }
        if !keys.contains(k), !full { keys.append(k) }
        draft = ""
    }
}

// MARK: - Need composer (the office submits on the department's behalf)

private struct NeedComposerSheet: View {
    let departmentId: String
    let onCreated: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var why = ""
    @State private var amount = ""
    @State private var currency = "KES"
    @State private var hasDeadline = false
    @State private var deadline = Date()
    @State private var submitting = false
    @State private var error: String?

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
                    FormSection("Need") {
                        FormField("Title", required: true) {
                            TextField("A new sound desk", text: $title).fieldStyle()
                                .onChange(of: title) { _, new in if new.count > DepartmentsAPI.Limits.needTitleMax { title = String(new.prefix(DepartmentsAPI.Limits.needTitleMax)) } }
                        }
                        FormField("Why", required: true) {
                            TextField("What it is for and what changes when it is met — members read this before they give.", text: $why, axis: .vertical)
                                .lineLimit(3...10).multilineFieldStyle()
                                .onChange(of: why) { _, new in if new.count > DepartmentsAPI.Limits.needWhyMax { why = String(new.prefix(DepartmentsAPI.Limits.needWhyMax)) } }
                            Counter(count: why.count, max: DepartmentsAPI.Limits.needWhyMax)
                        }
                    }
                    FormSection("Target") {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 16)], alignment: .leading, spacing: 14) {
                            FormField("Target (major units)", required: true) {
                                TextField("120,000", text: $amount).keyboardType(.decimalPad).font(.nMono(15)).fieldStyle()
                            }
                            FormField("Currency", required: true) {
                                TextField("KES", text: $currency).font(.nMono(15))
                                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                                    .fieldStyle()
                                    .onChange(of: currency) { _, new in
                                        let up = String(new.uppercased().filter { $0.isLetter }.prefix(3))
                                        if up != new { currency = up }
                                    }
                            }
                        }
                        FormField("Deadline (optional)") {
                            HStack(spacing: 10) {
                                Toggle("", isOn: $hasDeadline).labelsHidden().tint(Nuru.lumGreen)
                                if hasDeadline {
                                    DatePicker("", selection: $deadline, displayedComponents: .date).labelsHidden().tint(Nuru.gold)
                                } else {
                                    Text("No deadline").font(.inter(15)).foregroundStyle(Nuru.ink400)
                                }
                                Spacer(minLength: 0)
                            }
                            .fieldChrome()
                        }
                        FieldHint(text: "It enters the queue as pending; approving it (on the department, or on the Needs tab) opens giving toward it.")
                    }
                }
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24).padding(.vertical, 22)
            }
            .scrollContentBackground(.hidden)
            .background(Nuru.paper)
            .navigationTitle("Submit a need")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.tint(Nuru.ink600).disabled(submitting) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(submitting ? "Submitting…" : "Submit") { Task { await submit() } }
                        .font(.inter(14, .bold)).tint(Nuru.gold)
                        .disabled(submitting)
                }
            }
        }
    }

    private func submit() async {
        let t = title.trimmingCharacters(in: .whitespaces)
        let w = why.trimmingCharacters(in: .whitespacesAndNewlines)
        let cur = currency.trimmingCharacters(in: .whitespaces).uppercased()
        let L = DepartmentsAPI.Limits.self
        // Major units typed → integer minor units, converted ONCE (Math.round
        // equivalent); never a float past this line.
        let major = Double(amount.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)) ?? 0
        let targetMinor = (major.isFinite && major > 0 && major < 1e13) ? Int((major * 100).rounded()) : 0
        if t.count < L.needTitleMin || t.count > L.needTitleMax { error = "Title must be \(L.needTitleMin)–\(L.needTitleMax) characters."; return }
        if w.count < L.needWhyMin || w.count > L.needWhyMax { error = "“Why” must be \(L.needWhyMin)–\(L.needWhyMax) characters."; return }
        if targetMinor <= 0 { error = "Target must be more than zero."; return }
        if cur.count != 3 || !cur.allSatisfy({ $0.isLetter }) { error = "Currency is a 3-letter code, e.g. KES."; return }
        submitting = true
        error = nil
        do {
            try await DepartmentsAPI.createNeed(departmentId, title: t, why: w, targetMinor: targetMinor, currency: cur,
                                                deadline: hasDeadline ? ymdFormatter.string(from: deadline) : nil)
            onCreated()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not submit the need."
        }
        submitting = false
    }
}

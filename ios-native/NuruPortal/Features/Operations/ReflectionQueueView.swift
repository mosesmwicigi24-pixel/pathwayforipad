// Reflection Queue — a native port of the web portal's ReflectionQueue.tsx: navy
// hero with live stats, a 4-up stat strip, state tabs (Pending / Returned /
// Deferred / Approved), a searchable + filterable queue list, and a review
// workspace (member header, growth strip, the reflection text, and the decision
// panel with Approve & Advance / Return for Revision / Defer). Wired to
// PortalAPI.reflections(state:) and PortalAPI.memberDetail for reads, and to the
// pastoral-review write surface (POST /admin/reflections/{id}/decision +
// GET /admin/reflections/{id}/history) via APIClient.shared — mirroring the web's
// OpsApi.decideReflection / OpsApi.reflectionHistory. After a decision the queue
// refetches and the item drops out of the active tab.
import SwiftUI

// MARK: - Pastoral-review write surface (page-local, mirrors OpsApi)

/// Conditional JSON body so absent keys are omitted (the web spreads in
/// feedback_notes / pastoral_note only when present).
private enum JSONValue: Encodable {
    case string(String), int(Int), bool(Bool), null
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}

private struct DecisionResponse: Decodable { let state: String? }

/// One audit row in the review-history drawer (GET …/history).
struct ReflectionHistoryItem: Decodable, Identifiable {
    @DefaultZero var auditId: Int
    let actorName: String?
    @DefaultEmpty var action: String
    @DefaultEmpty var occurredAt: String
    var id: Int { auditId }
}
private struct ReflectionHistoryPage: Decodable { let data: [ReflectionHistoryItem] }

private enum RQApi {
    /// POST /admin/reflections/{id}/decision { decision, feedback_notes?, pastoral_note? }.
    static func decide(_ id: String, decision: String, feedback: String, note: String) async throws {
        var body: [String: JSONValue] = ["decision": .string(decision)]
        let fb = feedback.trimmingCharacters(in: .whitespacesAndNewlines)
        let pn = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !fb.isEmpty { body["feedback_notes"] = .string(fb) }
        if !pn.isEmpty { body["pastoral_note"] = .string(pn) }
        _ = try await APIClient.shared.post("/admin/reflections/\(id)/decision", body: body, as: DecisionResponse.self)
    }
    /// GET /admin/reflections/{id}/history.
    static func history(_ id: String) async throws -> [ReflectionHistoryItem] {
        try await APIClient.shared.get("/admin/reflections/\(id)/history", as: ReflectionHistoryPage.self).data
    }
}

// MARK: - Tabs & filters

private enum RQ {
    static let stateTabs: [(key: String, label: String)] = [
        ("pending", "Pending"), ("returned", "Returned"),
        ("deferred", "Deferred"), ("approved", "Approved"),
    ]
    static let statusFilters = ["All", "Oldest", "New", "Needs attention"]

    static func initials(_ n: String) -> String {
        let p = n.split(separator: " ").prefix(2).compactMap { $0.first }
        return p.isEmpty ? "?" : String(p).uppercased()
    }
    static func ageDays(_ iso: String) -> Int {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return 0 }
        return max(0, Int(Date().timeIntervalSince(d) / 86400))
    }
    static func priority(_ r: ReflectionRow) -> String {
        r.overdue ? "Needs attention" : ageDays(r.submittedAt) >= 4 ? "Oldest" : "New"
    }
    static func priColor(_ p: String) -> Color {
        switch p {
        case "Oldest": return Color(hex: 0xC89B3C)
        case "New": return Color(hex: 0x1F3A6B)
        case "Needs attention": return Color(hex: 0xDC2626)
        default: return Nuru.ink600
        }
    }
    static func stateColor(_ s: String) -> Color {
        switch s {
        case "pending": return Color(hex: 0xA87616)
        case "returned": return Color(hex: 0x1F3A6B)
        case "deferred": return Color(hex: 0x7E22CE)
        case "approved": return Color(hex: 0x0F6B33)
        case "rejected": return Color(hex: 0xA8281F)
        default: return Nuru.ink600
        }
    }
}

// MARK: - View

struct ReflectionQueueView: View {
    @EnvironmentObject private var router: NavRouter
    @State private var tab = "pending"
    @State private var search = ""
    @State private var statusFilter = "All"
    @State private var sortOldestFirst = true
    @State private var selId: String?
    @State private var feedback = ""
    @State private var reviewerNote = ""

    // Decision / history state (parent-owned so the workspace stays presentational).
    @State private var busy = false
    @State private var notice: String?
    @State private var actionError: String?
    @State private var reloadToken = 0
    @State private var historyOpen = false
    @State private var history: [ReflectionHistoryItem] = []
    @State private var historyLoading = false

    var body: some View {
        AsyncView({ try await PortalAPI.reflections(state: tab) }) { rows in
            content(rows)
        }
        // Re-fetch whenever the tab OR the reload token changes by keying the AsyncView.
        .id("\(tab)-\(reloadToken)")
        .portalPage("Reflection Queue")
        .sheet(isPresented: $historyOpen) { historySheet }
    }

    @ViewBuilder
    private func content(_ rows: [ReflectionRow]) -> some View {
        let filtered = filter(rows)
        let current = filtered.first { $0.reflectionId == selId } ?? filtered.first

        ScrollView {
            VStack(spacing: 18) {
                hero(rows, current: current)

                VStack(spacing: 18) {
                    if let notice {
                        banner(notice, fg: Color(hex: 0x0F6B33), bg: Color(hex: 0xE8F6EE))
                    }
                    statStrip(rows)
                    stateTabs
                    if let actionError {
                        banner(actionError, fg: Color(hex: 0xA8281F), bg: Color(hex: 0xFDECEC))
                    }
                    QueueList(rows: filtered, tab: tab,
                              search: $search, statusFilter: $statusFilter,
                              sortOldestFirst: $sortOldestFirst, selId: $selId,
                              current: current)
                    if let current {
                        Workspace(current: current,
                                  feedback: $feedback, reviewerNote: $reviewerNote,
                                  busy: busy,
                                  onApprove: { decide(current, "approve") },
                                  onReturn: { decide(current, "return") },
                                  onDefer: { decide(current, "defer") },
                                  onHistory: { openHistory(current) },
                                  onProfile: { router.go(.members) })
                            .id(current.reflectionId)
                    } else {
                        emptyWorkspace
                    }
                }
                .padding(.horizontal, 20)
            }
            .padding(.bottom, 40)
        }
        .background(Nuru.paper)
        .onChange(of: tab) { _ in selId = nil; feedback = ""; reviewerNote = ""; actionError = nil }
        .onChange(of: selId) { _ in feedback = ""; reviewerNote = ""; actionError = nil }
    }

    // Inline notice / error banner (matches the web's toast + error rows).
    private func banner(_ text: String, fg: Color, bg: Color) -> some View {
        Text(text)
            .font(.inter(13, .semibold)).foregroundStyle(fg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // POST a decision, then refetch the queue (the item drops out of the tab).
    private func decide(_ row: ReflectionRow, _ decision: String) {
        // Feedback required to return (mirrors the web's ≥10-char guard).
        if decision == "return", feedback.trimmingCharacters(in: .whitespacesAndNewlines).count < 10 {
            actionError = "Feedback is required to return a reflection (at least 10 characters)."
            return
        }
        busy = true; actionError = nil
        Task {
            do {
                try await RQApi.decide(row.reflectionId, decision: decision,
                                       feedback: feedback, note: reviewerNote)
                let name = row.fullName
                notice = decision == "approve" ? "\(name) approved & advanced."
                    : decision == "return" ? "Returned to \(name) with feedback."
                    : "Deferred \(name)'s review."
                selId = nil; feedback = ""; reviewerNote = ""
                reloadToken &+= 1   // re-key AsyncView → refetch the active tab
                scheduleNoticeDismiss()
            } catch {
                actionError = (error as? APIError)?.errorDescription ?? "Decision failed."
            }
            busy = false
        }
    }

    // Load + present the review-history drawer for the current reflection.
    private func openHistory(_ row: ReflectionRow) {
        historyOpen = true; historyLoading = true; history = []
        Task {
            history = (try? await RQApi.history(row.reflectionId)) ?? []
            historyLoading = false
        }
    }

    private func scheduleNoticeDismiss() {
        Task {
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            notice = nil
        }
    }

    // History drawer — audit rows for the selected reflection.
    private var historySheet: some View {
        NavigationStack {
            Group {
                if historyLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if history.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "clock.arrow.circlepath").font(.system(size: 28)).foregroundStyle(Nuru.ink400)
                        Text("No recorded decisions yet.").font(.nBody).foregroundStyle(Nuru.ink600)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(history) { h in
                                HStack(alignment: .top, spacing: 12) {
                                    Circle().fill(historyDot(h.action)).frame(width: 8, height: 8).padding(.top, 5)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(historyLabel(h.action)).font(.inter(13, .semibold)).foregroundStyle(Nuru.foreground)
                                        Text("\(h.actorName ?? "System") · \(Fmt.date(h.occurredAt))")
                                            .font(.nMicro).foregroundStyle(Nuru.ink600)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 12)
                                Divider().overlay(Nuru.border)
                            }
                        }
                        .padding(.horizontal, 20).padding(.top, 8)
                    }
                }
            }
            .background(Nuru.paper)
            .navigationTitle("Review history")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { historyOpen = false }
                }
            }
        }
    }

    private func historyDot(_ action: String) -> Color {
        action.contains("approve") ? Color(hex: 0x16A34A)
            : action.contains("return") ? Nuru.gold : Nuru.navy
    }
    private func historyLabel(_ action: String) -> String {
        action
            .replacingOccurrences(of: "reflection.", with: "Reflection ")
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: ".", with: " ")
    }

    // Filtering (search → status → sort), matching the web's useMemo.
    private func filter(_ rows: [ReflectionRow]) -> [ReflectionRow] {
        var list = rows
        if !search.trimmingCharacters(in: .whitespaces).isEmpty {
            list = list.filter { $0.fullName.lowercased().contains(search.lowercased()) }
        }
        if statusFilter != "All" {
            list = list.filter { RQ.priority($0) == statusFilter }
        }
        list.sort {
            sortOldestFirst
                ? RQ.ageDays($0.submittedAt) > RQ.ageDays($1.submittedAt)
                : RQ.ageDays($0.submittedAt) < RQ.ageDays($1.submittedAt)
        }
        return list
    }

    // Hero — navy banner with breadcrumb + sort/history action chips.
    private func hero(_ rows: [ReflectionRow], current: ReflectionRow?) -> some View {
        let pending = rows.filter { $0.state == "pending" }
        return PortalHero(breadcrumb: ["Operations", "Reflection Queue"],
                          title: "Reflection Queue",
                          subtitle: "Review member reflections, encourage growth, and advance disciples through the pathway.") {
            HStack(spacing: 8) {
                HeroChip(label: "\(pending.count) pending", icon: "sparkles", style: .tag)
                HeroChip(label: sortOldestFirst ? "Oldest first" : "Newest first",
                         icon: "line.3.horizontal.decrease", style: .ghost) {
                    sortOldestFirst.toggle()
                }
                HeroChip(label: "History", icon: "clock.arrow.circlepath", style: .gold) {
                    if let current { openHistory(current) }
                }
                .opacity(current == nil ? 0.5 : 1)
            }
        }
    }

    // Stat strip — 4 cards (pending / oldest / needs attention / in view).
    private func statStrip(_ rows: [ReflectionRow]) -> some View {
        let pending = rows.filter { $0.state == "pending" }
        let oldest = pending.reduce(0) { max($0, RQ.ageDays($1.submittedAt)) }
        let overdue = rows.filter { $0.overdue }.count
        let avgAge = pending.isEmpty ? "0"
            : String(format: "%.1f", pending.reduce(0.0) { $0 + Double(RQ.ageDays($1.submittedAt)) } / Double(pending.count))
        let cards: [(String, String, String?, String, Color, Color)] = [
            ("Pending review", "\(pending.count)", nil, "bubble.left.fill", Color(hex: 0xFDECEC), Color(hex: 0xA8281F)),
            ("Oldest waiting", "\(oldest)d", "avg \(avgAge)d", "clock.fill", Color(hex: 0xFDF5E5), Color(hex: 0x8A6B1F)),
            ("Needs attention", "\(overdue)", nil, "exclamationmark.shield.fill", Color(hex: 0xFDF0E6), Color(hex: 0xC2410C)),
            ("In view", "\(rows.count)", nil, "checkmark.circle.fill", Color(hex: 0xE8F6EE), Color(hex: 0x0F6B33)),
        ]
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 14)], spacing: 14) {
            ForEach(cards, id: \.0) { c in
                Card(padding: 16) {
                    HStack(spacing: 12) {
                        TintedIcon(systemName: c.3, color: c.5, size: 42)
                            .background(c.4).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.0).font(.nCaption).foregroundStyle(Nuru.ink600)
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(c.1).font(.fraunces(22, .semibold)).foregroundStyle(Nuru.navy)
                                if let sub = c.2 { Text(sub).font(.nMicro).foregroundStyle(Nuru.ink600) }
                            }
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }

    // State tabs — segmented navy pill.
    private var stateTabs: some View {
        HStack(spacing: 4) {
            ForEach(RQ.stateTabs, id: \.key) { t in
                Button { tab = t.key } label: {
                    Text(t.label).font(.inter(12.5, .semibold))
                        .foregroundStyle(tab == t.key ? .white : Nuru.ink600)
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(tab == t.key ? AnyShapeStyle(Nuru.navy) : AnyShapeStyle(.clear))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }.buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(4)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var emptyWorkspace: some View {
        Card(padding: 40) {
            VStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(hex: 0xF5E7C5)).frame(width: 72, height: 72)
                    Image(systemName: "book.closed.fill").font(.system(size: 30)).foregroundStyle(Color(hex: 0x92651B))
                }
                Text("Queue is clear — well shepherded").font(.nTitle).foregroundStyle(Nuru.navy)
                    .multilineTextAlignment(.center)
                Text("No \(tab) reflections to review right now.")
                    .font(.nBody).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Queue list

private struct QueueList: View {
    let rows: [ReflectionRow]
    let tab: String
    @Binding var search: String
    @Binding var statusFilter: String
    @Binding var sortOldestFirst: Bool
    @Binding var selId: String?
    let current: ReflectionRow?

    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                header
                Divider().overlay(Nuru.border)
                if rows.isEmpty {
                    emptyState
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                            row(r, selected: current?.reflectionId == r.reflectionId)
                            if i < rows.count - 1 { Divider().overlay(Nuru.border) }
                        }
                    }
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("\(tab.capitalized) reflections").font(.fraunces(16, .semibold)).foregroundStyle(Nuru.navy)
                Spacer()
                Text("\(rows.count)").font(.inter(11, .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 8).padding(.vertical, 3).background(Nuru.navy).clipShape(Capsule())
            }
            Text(sortOldestFirst ? "Oldest submissions appear first" : "Newest submissions appear first")
                .font(.nMicro).foregroundStyle(Nuru.ink600)
            // Search field
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Nuru.ink600)
                TextField("Search member", text: $search)
                    .font(.nCaption).textFieldStyle(.plain)
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            // Status filter
            Picker("Status", selection: $statusFilter) {
                ForEach(RQ.statusFilters, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        .padding(16)
    }

    private func row(_ r: ReflectionRow, selected: Bool) -> some View {
        let days = RQ.ageDays(r.submittedAt)
        let pri = RQ.priority(r)
        return Button { selId = r.reflectionId } label: {
            HStack(alignment: .top, spacing: 12) {
                Monogram(name: r.fullName, size: 40)
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(r.fullName).font(.inter(13, .bold)).foregroundStyle(Nuru.foreground)
                        Spacer()
                        if tab == "pending" {
                            HStack(spacing: 4) {
                                Circle().fill(RQ.priColor(pri)).frame(width: 5, height: 5)
                                Text(pri).font(.inter(10, .bold)).foregroundStyle(RQ.priColor(pri))
                            }
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(RQ.priColor(pri).opacity(0.12)).clipShape(Capsule())
                        }
                    }
                    HStack(spacing: 0) {
                        Text("L\(r.levelNumber - 1) → ").font(.nMicro).foregroundStyle(Nuru.ink600)
                        Text("L\(r.levelNumber)").font(.inter(11.5, .bold)).foregroundStyle(Nuru.gold)
                        Text(" · \(r.moduleTitle)").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                    Text(r.body.split(separator: "\n").first.map(String.init) ?? r.body)
                        .font(.nCaption).foregroundStyle(Nuru.foreground).lineLimit(2)
                        .padding(.top, 2)
                    HStack(spacing: 5) {
                        Image(systemName: "clock").font(.system(size: 10))
                        Text(days == 0 ? "Today" : "\(days)d ago").font(.nMicro)
                    }
                    .foregroundStyle(days >= 4 ? Nuru.danger : Nuru.ink600)
                    .padding(.top, 2)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Color(hex: 0xFFFBEB) : .clear)
            .overlay(alignment: .leading) {
                Rectangle().fill(selected ? Nuru.gold : .clear).frame(width: 3)
            }
        }.buttonStyle(.plain)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(hex: 0xF5E7C5)).frame(width: 56, height: 56)
                Image(systemName: "book.closed.fill").font(.system(size: 22)).foregroundStyle(Color(hex: 0x92651B))
            }
            Text("Queue is clear — well shepherded").font(.fraunces(16, .semibold)).foregroundStyle(Nuru.navy)
                .multilineTextAlignment(.center)
            Text("No \(tab) reflections match these filters.").font(.nCaption).foregroundStyle(Nuru.ink600)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(32)
    }
}

// MARK: - Workspace

private struct Workspace: View {
    let current: ReflectionRow
    @Binding var feedback: String
    @Binding var reviewerNote: String
    let busy: Bool
    let onApprove: () -> Void
    let onReturn: () -> Void
    let onDefer: () -> Void
    let onHistory: () -> Void
    let onProfile: () -> Void
    @State private var member: MemberDetail?

    var body: some View {
        VStack(spacing: 14) {
            memberHeader
            growthStrip
            reflectionContent
            if current.state == "pending" {
                decisionPanel
            } else {
                reviewedBanner
            }
        }
        .task(id: current.userId) {
            member = try? await PortalAPI.memberDetail(current.userId)
        }
    }

    // Member header
    private var memberHeader: some View {
        Card(padding: 16) {
            HStack(spacing: 12) {
                Monogram(name: current.fullName, size: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Button(action: onProfile) {
                        Text(current.fullName).font(.fraunces(18, .semibold)).foregroundStyle(Nuru.navy)
                    }.buttonStyle(.plain)
                    Text("\(current.moduleTitle) · \(Fmt.date(current.submittedAt))" +
                         (member?.cellName.map { " · \($0)" } ?? ""))
                        .font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 6) {
                    Pill(text: "L\(current.levelNumber - 1) → L\(current.levelNumber)", color: Color(hex: 0x92651B))
                    Pill(text: current.state.capitalized, color: RQ.stateColor(current.state))
                    Button(action: onHistory) {
                        Text("History →").font(.inter(11, .semibold)).foregroundStyle(Nuru.gold)
                    }.buttonStyle(.plain)
                }
            }
        }
    }

    // Member growth strip (real, from member-detail)
    private var growthStrip: some View {
        Card(padding: 14) {
            if let m = member {
                HStack(spacing: 16) {
                    if let band = m.engagement.band {
                        Pill(text: band.replacingOccurrences(of: "_", with: " ").capitalized,
                             color: Nuru.bandColor(band))
                    }
                    if let e = m.engagement.eScore {
                        inlineMetric("Engagement", "\(Int((e * 100).rounded()))%", e * 100, Nuru.gold)
                    }
                    inlineMetric("Level", "L\(m.enrollment.currentLevel)",
                                 min(100, Double(m.enrollment.currentLevel) / 7 * 100), Nuru.navy)
                    Spacer(minLength: 0)
                    Button(action: onProfile) {
                        HStack(spacing: 4) {
                            Text("Full profile").font(.inter(11, .bold)).foregroundStyle(Nuru.gold)
                            Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Nuru.gold)
                        }
                    }.buttonStyle(.plain)
                }
            } else {
                Text("Loading member growth…").font(.nCaption).foregroundStyle(Nuru.ink600)
            }
        }
    }

    private func inlineMetric(_ label: String, _ value: String, _ pct: Double, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(label.uppercased()).font(.nMicro).tracking(0.4).foregroundStyle(Nuru.ink600)
                Text(value).font(.inter(12, .bold)).foregroundStyle(Nuru.foreground)
            }
            ProgressBar(pct: pct, fill: color, height: 4)
        }
        .frame(width: 100)
    }

    // Reflection content
    private var reflectionContent: some View {
        let paras = current.body.split(separator: "\n").map(String.init).filter { !$0.isEmpty }
        let words = current.body.split(whereSeparator: { $0 == " " || $0 == "\n" }).count
        return Card(padding: 0) {
            VStack(spacing: 0) {
                HStack {
                    HStack(spacing: 8) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Nuru.navy).frame(width: 24, height: 24)
                            Image(systemName: "quote.opening").font(.system(size: 11)).foregroundStyle(.white)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Member reflection").font(.fraunces(15, .semibold)).foregroundStyle(Nuru.navy)
                            Text("Submitted response for review").font(.nMicro).foregroundStyle(Nuru.ink600)
                        }
                    }
                    Spacer()
                    Text("\(words) words").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 18).padding(.vertical, 14)
                Divider().overlay(Nuru.border)
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(paras.enumerated()), id: \.offset) { _, p in
                        Text(p).font(.fraunces(15.5, .regular)).foregroundStyle(Nuru.foreground)
                            .lineSpacing(6).fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 10) {
                        Rectangle().fill(Nuru.border).frame(height: 1)
                        Text("— \(current.fullName)").font(.nMicro).foregroundStyle(Nuru.ink600).fixedSize()
                        Rectangle().fill(Nuru.border).frame(height: 1)
                    }
                }
                .padding(.horizontal, 22).padding(.top, 22).padding(.bottom, 26)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // Decision panel (pending only)
    private var decisionPanel: some View {
        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Decision").font(.fraunces(17, .semibold)).foregroundStyle(Nuru.navy)
                    Text("Choose whether this reflection shows readiness to advance.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                }
                // Feedback
                VStack(alignment: .leading, spacing: 6) {
                    Text("Feedback to member").font(.inter(12, .bold)).foregroundStyle(Nuru.foreground)
                    Text("Required when returning a reflection. Optional when approving.")
                        .font(.nMicro).foregroundStyle(Nuru.ink600)
                    editor($feedback, placeholder: "Write clear, kind feedback. Mention what was strong and what needs more reflection.", minHeight: 84)
                }
                // Reviewer note
                VStack(alignment: .leading, spacing: 6) {
                    Text("Reviewer note").font(.inter(12, .bold)).foregroundStyle(Nuru.foreground)
                    Text("Private to authorized leaders — never sent to the member (§5.4).")
                        .font(.nMicro).foregroundStyle(Nuru.ink600)
                    editor($reviewerNote, placeholder: "Add a private note for the review record…", minHeight: 60)
                }
                // Approve / Return
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 14)], spacing: 14) {
                    decisionCard(title: "Approve & Advance", icon: "checkmark.circle.fill",
                                 desc: "Advance the member to the next level and notify them.",
                                 bg: Color(hex: 0xE8F6EC), border: Color(hex: 0xBBE5C5),
                                 iconBg: Color(hex: 0x16A34A), titleColor: Color(hex: 0x15803D),
                                 action: onApprove)
                    decisionCard(title: "Return for Revision", icon: "bubble.left.fill",
                                 desc: "Send kind feedback and allow the member to revise and resubmit.",
                                 bg: Color(hex: 0xFFFBEB), border: Color(hex: 0xF5E0A8),
                                 iconBg: Color(hex: 0xC89B3C), titleColor: Color(hex: 0x92651B),
                                 action: onReturn)
                }
                Divider().overlay(Nuru.border)
                HStack {
                    Button(action: onDefer) {
                        HStack(spacing: 8) {
                            Image(systemName: "calendar").font(.system(size: 13))
                            Text("Defer review").font(.inter(13, .semibold))
                        }
                        .foregroundStyle(Nuru.foreground)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                    Spacer()
                    Text("“Shepherd the flock of God that is among you…” — 1 Peter 5:2")
                        .font(.nMicro).italic().foregroundStyle(Nuru.ink600)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }

    private func decisionCard(title: String, icon: String, desc: String,
                              bg: Color, border: Color, iconBg: Color, titleColor: Color,
                              action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 9, style: .continuous).fill(iconBg).frame(width: 32, height: 32)
                        Image(systemName: icon).font(.system(size: 15)).foregroundStyle(.white)
                    }
                    Text(title).font(.fraunces(18, .semibold)).foregroundStyle(titleColor)
                }
                Text(desc).font(.nCaption).foregroundStyle(titleColor).fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .opacity(busy ? 0.6 : 1)
    }

    private func editor(_ text: Binding<String>, placeholder: String, minHeight: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            if text.wrappedValue.isEmpty {
                Text(placeholder).font(.nBody).foregroundStyle(Nuru.ink400)
                    .padding(.horizontal, 16).padding(.vertical, 12)
            }
            TextEditor(text: text)
                .font(.nBody).foregroundStyle(Nuru.foreground)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .frame(minHeight: minHeight)
        }
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // Reviewed banner (non-pending)
    private var reviewedBanner: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "rosette").font(.system(size: 14)).foregroundStyle(Nuru.gold)
                    Text(current.state.capitalized).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                }
                Text("This reflection has been reviewed. Switch to the Pending tab to action new submissions.")
                    .font(.nCaption).foregroundStyle(Nuru.ink600)
            }
        }
    }
}

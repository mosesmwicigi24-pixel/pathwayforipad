// Notifications — full feed page, ported line-by-line from the web make
// (admin-web/src/components/pages/Notifications.tsx). Real feed from
// GET /admin/notifications; read / unread / dismiss are server-persisted per
// admin via POST /admin/notifications/{action} { ids }. Recent (last 7 days) vs
// Archive paging, type filters, search and an empty state mirror the web.
import SwiftUI

// MARK: - Page-local model (adds `href`, not on the shared NotificationFeedItem)

private struct NotifItem: Codable, Identifiable {
    var id: String = ""
    var title: String = ""
    var message: String?
    var category: String = "info"      // success | info | warning | security
    var at: String = ""                // ISO timestamp
    var href: String?
    var read: Bool = false

    private enum CodingKeys: String, CodingKey { case id, title, message, category, at, href, read }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        message = try? c.decodeIfPresent(String.self, forKey: .message)
        category = (try? c.decode(String.self, forKey: .category)) ?? "info"
        at = (try? c.decode(String.self, forKey: .at)) ?? ""
        href = try? c.decodeIfPresent(String.self, forKey: .href)
        read = (try? c.decode(Bool.self, forKey: .read)) ?? false
    }
}
private struct NotifFeedResponse: Codable { let data: [NotifItem] }

// CATEGORY_META — colour + label per category (web NotificationsProvider).
private struct CatMeta { let label: String; let icon: String; let color: Color }
private func catMeta(_ c: String) -> CatMeta {
    switch c {
    case "success":  return CatMeta(label: "Success",  icon: "checkmark.circle.fill",      color: Color(hex: 0x16A34A))
    case "warning":  return CatMeta(label: "Alerts",   icon: "exclamationmark.triangle.fill", color: Color(hex: 0xD97706))
    case "security": return CatMeta(label: "Security", icon: "checkmark.shield.fill",       color: Nuru.gold)
    default:         return CatMeta(label: "Updates",  icon: "info.circle.fill",            color: Color(hex: 0x2563EB))
    }
}

// MARK: - Store

@MainActor
private final class NotificationsStore: ObservableObject {
    @Published var items: [NotifItem] = []
    @Published var loaded = false
    @Published var error: String?

    private let api = APIClient.shared

    func load() async {
        do {
            let res = try await api.get("/admin/notifications", as: NotifFeedResponse.self)
            items = res.data.sorted { epoch($0.at) > epoch($1.at) }
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        loaded = true
    }

    var unreadCount: Int { items.reduce(0) { $0 + ($1.read ? 0 : 1) } }

    private func mutate(_ action: String, ids: [String]) {
        guard !ids.isEmpty else { return }
        Task { _ = try? await api.post("/admin/notifications/\(action)", body: ["ids": ids], as: MutationResult.self) }
    }
    private struct MutationResult: Codable { let updated: Int? }

    func setRead(_ id: String, _ read: Bool) {
        if let i = items.firstIndex(where: { $0.id == id }) { items[i].read = read }
        mutate(read ? "read" : "unread", ids: [id])
    }
    func markAllRead() {
        let ids = items.filter { !$0.read }.map(\.id)
        for i in items.indices { items[i].read = true }
        mutate("read", ids: ids)
    }
    func remove(_ id: String) {
        items.removeAll { $0.id == id }
        mutate("dismiss", ids: [id])
    }
}

// MARK: - Time helpers (port of notifTimeAgo / notifDayLabel)

private func epoch(_ iso: String) -> Double {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: iso) { return d.timeIntervalSince1970 }
    let g = ISO8601DateFormatter()
    return g.date(from: iso)?.timeIntervalSince1970 ?? 0
}
private func timeAgo(_ iso: String) -> String {
    let at = epoch(iso); if at == 0 { return "—" }
    let s = Int(Date().timeIntervalSince1970 - at)
    if s < 45 { return "Just now" }
    if s < 90 { return "1 min ago" }
    let m = s / 60; if m < 60 { return "\(m) min ago" }
    let h = m / 60; if h < 24 { return "\(h)h ago" }
    let d = h / 24; if d < 7 { return "\(d)d ago" }
    return Date(timeIntervalSince1970: at).formatted(.dateTime.month().day().year())
}
private func dayLabel(_ iso: String) -> String {
    let at = epoch(iso); let cal = Calendar.current
    let d = Date(timeIntervalSince1970: at)
    let days = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: Date())).day ?? 0
    if days <= 0 { return "Today" }
    if days == 1 { return "Yesterday" }
    return d.formatted(.dateTime.day().month(.wide).year())
}

// MARK: - View

struct NotificationsView: View {
    @StateObject private var store = NotificationsStore()
    @EnvironmentObject private var router: NavRouter
    @Environment(\.openURL) private var openURL

    // Map a web-route href (e.g. "/members", "/reflection-queue") to a sidebar
    // Section so a tapped notification cross-navigates in-app — the native
    // equivalent of the web's navigate(n.href). Query/hash is stripped; unknown
    // or external hrefs fall through to opening the URL.
    private func section(for href: String) -> Section? {
        var path = href
        if let h = path.firstIndex(where: { $0 == "?" || $0 == "#" }) { path = String(path[..<h]) }
        path = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let first = path.split(separator: "/").first.map(String.init) ?? path
        switch first {
        case "", "dashboard":         return .dashboard
        case "notifications":         return .notifications
        case "curriculum-levels":     return .curriculumLevels
        case "cms":                   return .cms
        case "level-detail":          return .levelDetail
        case "quiz-builder":          return .quizBuilder
        case "video-library":         return .videoLibrary
        case "content-studio":        return .contentStudio
        case "cell-engagement":       return .cellEngagement
        case "members", "member-profile": return .members
        case "reflection-queue":      return .reflectionQueue
        case "chat":                  return .chat
        case "events":                return .events
        case "finance":               return .finance
        case "certificates":          return .certificates
        case "badges":                return .badges
        case "users":                 return .users
        case "roles":                 return .roles
        case "congregations":         return .congregations
        case "countries":             return .countries
        case "languages":             return .languages
        case "profile":               return .profile
        default:                      return nil
        }
    }

    // Port of web openNotif: mark read, then follow the href (cross-nav or URL).
    private func open(_ n: NotifItem) {
        if !n.read { store.setRead(n.id, true) }
        guard let href = n.href, !href.isEmpty else { return }
        if let sec = section(for: href) {
            router.go(sec)
        } else if let url = URL(string: href), url.scheme != nil {
            openURL(url)
        }
    }

    private enum Tab { case all, unread }
    private enum CatFilter: String, CaseIterable { case all, info, success, warning, security
        var label: String { switch self { case .all: "All types"; case .info: "Updates"; case .success: "Success"; case .warning: "Alerts"; case .security: "Security" } }
    }
    @State private var tab: Tab = .all
    @State private var catFilter: CatFilter = .all
    @State private var query = ""
    @State private var showArchive = false

    private let week: Double = 7 * 24 * 60 * 60

    private var filtered: [NotifItem] {
        store.items.filter { n in
            if tab == .unread && n.read { return false }
            if catFilter != .all && n.category != catFilter.rawValue { return false }
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                let hay = "\(n.title) \(n.message ?? "")".lowercased()
                if !hay.contains(query.lowercased()) { return false }
            }
            return true
        }
    }
    private var recent: [NotifItem] {
        let now = Date().timeIntervalSince1970
        return filtered.filter { now - epoch($0.at) <= week }
    }
    private var archived: [NotifItem] {
        let ids = Set(recent.map(\.id))
        return filtered.filter { !ids.contains($0.id) }
    }
    private var pageItems: [NotifItem] { showArchive ? archived : recent }
    private var groups: [(String, [NotifItem])] {
        var order: [String] = []; var map: [String: [NotifItem]] = [:]
        for n in pageItems { let l = dayLabel(n.at); if map[l] == nil { order.append(l) }; map[l, default: []].append(n) }
        return order.map { ($0, map[$0] ?? []) }
    }

    var body: some View {
        Group {
            if !store.loaded {
                ScrollView { SkeletonList(rows: 6).padding(Nuru.S.screen) }
            } else if let e = store.error, store.items.isEmpty {
                ScrollView { ErrorBanner(message: e) { Task { await store.load() } }.padding(Nuru.S.screen) }
            } else {
                content
            }
        }
        .background(Nuru.paper)
        .portalPage("Notifications")
        .task { if !store.loaded { await store.load() } }
        .refreshable { await store.load() }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                VStack(alignment: .leading, spacing: 16) {
                    filterBar
                    sectionHeading
                    listCard
                    if !archived.isEmpty || showArchive { pager }
                }
                .padding(.horizontal, Nuru.S.lg)
                .padding(.top, 18)
                .padding(.bottom, 36)
                .frame(maxWidth: 1040, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // Navy hero — breadcrumb, title, totals, segmented + mark-all.
    private var hero: some View {
        PortalHero(
            breadcrumb: ["Workspace", "Notifications"],
            title: "Notifications",
            subtitle: "\(store.items.count) total · \(store.unreadCount) unread · \(archived.count) archived"
        ) {
            HStack(spacing: 8) {
                HStack(spacing: 3) {
                    segBtn("All", active: tab == .all) { tab = .all }
                    segBtn(unreadLabel, active: tab == .unread) { tab = .unread }
                }
                .padding(3)
                .background(.white.opacity(0.08))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(.white.opacity(0.15), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                HeroChip(label: "Mark all read", icon: "checkmark.circle", style: .ghost) {
                    if store.unreadCount > 0 { store.markAllRead() }
                }
                .opacity(store.unreadCount == 0 ? 0.45 : 1)
            }
        }
    }
    private var unreadLabel: String { store.unreadCount > 0 ? "Unread \(store.unreadCount)" : "Unread" }

    private func segBtn(_ title: String, active: Bool, _ tapped: @escaping () -> Void) -> some View {
        Button(action: tapped) {
            Text(title).font(.inter(12.5, .semibold))
                .foregroundStyle(active ? .white : Nuru.onNavyDim)
                .padding(.horizontal, 14).padding(.vertical, 6)
                .background(active ? AnyShapeStyle(Nuru.gold) : AnyShapeStyle(Color.clear))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // Search + type chips.
    private var filterBar: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Nuru.muted)
                TextField("Search notifications…", text: $query)
                    .font(.inter(14)).foregroundStyle(Nuru.foreground)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark").font(.system(size: 12)).foregroundStyle(Nuru.muted) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14).frame(height: 40)
            .background(Nuru.white)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(CatFilter.allCases, id: \.self) { c in
                        let active = catFilter == c
                        Button { catFilter = c } label: {
                            Text(c.label).font(.inter(12.5, .semibold))
                                .foregroundStyle(active ? Nuru.gold : Nuru.muted)
                                .padding(.horizontal, 14).padding(.vertical, 7)
                                .background(active ? AnyShapeStyle(Nuru.gold.opacity(0.12)) : AnyShapeStyle(Nuru.white))
                                .overlay(Capsule().stroke(active ? Nuru.gold : Nuru.border, lineWidth: 1))
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var sectionHeading: some View {
        HStack(spacing: 8) {
            Image(systemName: showArchive ? "archivebox" : "bell").font(.system(size: 13)).foregroundStyle(Nuru.gold)
            Text(showArchive ? "Archive" : "Recent · last 7 days").font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
            Text(showArchive ? "Older notifications kept on record" : "Latest activity").font(.inter(12)).foregroundStyle(Nuru.muted)
            Spacer()
        }
    }

    private var listCard: some View {
        VStack(spacing: 0) {
            if pageItems.isEmpty {
                emptyState
            } else {
                ForEach(Array(groups.enumerated()), id: \.element.0) { _, group in
                    HStack {
                        Text(group.0.uppercased()).font(.inter(10.5, .bold)).tracking(1.2).foregroundStyle(Nuru.muted)
                        Spacer()
                    }
                    .padding(.horizontal, 18).padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Nuru.inputBg)
                    .overlay(Rectangle().fill(Nuru.border).frame(height: 1), alignment: .bottom)
                    ForEach(group.1) { n in
                        row(n)
                        Rectangle().fill(Nuru.border).frame(height: 1)
                    }
                }
            }
        }
        .background(Nuru.white)
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .nuruShadow()
    }

    private func row(_ n: NotifItem) -> some View {
        let meta = catMeta(n.category)
        return HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(meta.color.opacity(0.12))
                Image(systemName: meta.icon).font(.system(size: 16)).foregroundStyle(meta.color)
            }.frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(n.title).font(.inter(13.5, n.read ? .semibold : .bold)).foregroundStyle(Nuru.navy)
                    Text(meta.label.uppercased()).font(.inter(9.5, .bold)).tracking(0.4)
                        .foregroundStyle(meta.color)
                        .padding(.horizontal, 8).padding(.vertical, 1.5)
                        .background(meta.color.opacity(0.12)).clipShape(Capsule())
                }
                if let m = n.message {
                    Text(m).font(.inter(12.5)).foregroundStyle(Nuru.muted).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 4) {
                    if n.href != nil {
                        Text("Tap to view").font(.inter(11.5, .semibold)).foregroundStyle(Nuru.gold)
                        Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Nuru.gold)
                    } else {
                        Text("No linked page").font(.inter(11.5)).foregroundStyle(Nuru.muted)
                    }
                }
                .padding(.top, 1)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 8) {
                Text(timeAgo(n.at)).font(.inter(11)).foregroundStyle(Nuru.muted).lineLimit(1)
                HStack(spacing: 10) {
                    Button { store.setRead(n.id, !n.read) } label: {
                        Image(systemName: n.read ? "circle" : "checkmark").font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Nuru.muted)
                    }.buttonStyle(.plain)
                    Button { store.remove(n.id) } label: {
                        Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.muted)
                    }.buttonStyle(.plain)
                    if !n.read { Circle().fill(Nuru.gold).frame(width: 8, height: 8) }
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(n.read ? Nuru.white : Nuru.gold.opacity(0.045))
        .contentShape(Rectangle())
        .onTapGesture { open(n) }
    }

    private var emptyState: some View {
        let unreadEmpty = !store.items.isEmpty && tab == .unread
        return VStack(spacing: 0) {
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Nuru.inputBg)
                Image(systemName: unreadEmpty ? "bell" : "tray").font(.system(size: 26)).foregroundStyle(Nuru.muted)
            }.frame(width: 56, height: 56).padding(.bottom, 16)
            Text(unreadEmpty ? "You're all caught up" : "Nothing in the last 7 days")
                .font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
            Text(unreadEmpty ? "Every notification has been read. New activity will show up here."
                             : "No recent activity. Older notifications are kept in the archive.")
                .font(.inter(13)).foregroundStyle(Nuru.muted).multilineTextAlignment(.center)
                .frame(maxWidth: 340).padding(.top, 4)
            if !archived.isEmpty && !showArchive {
                Button { showArchive = true } label: {
                    HStack(spacing: 6) { Image(systemName: "archivebox"); Text("Browse archive") }
                        .font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                        .padding(.horizontal, 16).frame(height: 36)
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }.buttonStyle(.plain).padding(.top, 16)
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 64).padding(.horizontal, 24)
    }

    private var pager: some View {
        HStack {
            Text(showArchive ? "Archive" : "Showing recent activity").font(.inter(12)).foregroundStyle(Nuru.muted)
            Spacer()
            Button { showArchive = false } label: {
                HStack(spacing: 4) { Image(systemName: "chevron.left"); Text("Recent") }
                    .font(.inter(12.5, .semibold))
                    .foregroundStyle(showArchive ? Nuru.navy : Nuru.muted)
                    .padding(.horizontal, 14).frame(height: 36)
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            }.buttonStyle(.plain).disabled(!showArchive)
            Button { showArchive = true } label: {
                HStack(spacing: 4) { Text("Archive"); Image(systemName: "chevron.right") }
                    .font(.inter(12.5, .semibold))
                    .foregroundStyle(showArchive ? .white : Nuru.navy)
                    .padding(.horizontal, 14).frame(height: 36)
                    .background(showArchive ? AnyShapeStyle(Nuru.gold) : AnyShapeStyle(Nuru.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(showArchive ? Color.clear : Nuru.border, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }.buttonStyle(.plain).disabled(archived.isEmpty)
        }
    }
}

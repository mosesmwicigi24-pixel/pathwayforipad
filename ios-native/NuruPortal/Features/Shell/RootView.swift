// App shell — an iPad-native NavigationSplitView (collapsible sidebar + detail),
// the native analogue of the web portal's navy sidebar Layout. Adapts to Split
// View / Slide Over and a Magic Keyboard automatically. Sidebar mirrors nav.tsx.
import SwiftUI

enum Section: String, CaseIterable, Identifiable {
    // Portal
    case dashboard, notifications
    // Curriculum
    case curriculumLevels, cms, levelDetail, quizBuilder, videoLibrary, contentStudio
    // Operations
    case cellEngagement, members, reflectionQueue, chat, events, finance, certificates, badges
    // System
    case users, roles, congregations, countries, languages, peopleIntelligence
    // Reachable from the profile menu (not listed in the sidebar)
    case profile
    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .notifications: "Notifications"
        case .curriculumLevels: "Curriculum Levels"
        case .cms: "CMS — Curriculum"
        case .levelDetail: "Level Detail"
        case .quizBuilder: "Quiz Builder"
        case .videoLibrary: "Video Library"
        case .contentStudio: "Content Studio"
        case .cellEngagement: "Cell Engagement"
        case .members: "Members"
        case .reflectionQueue: "Reflection Queue"
        case .chat: "Chat"
        case .events: "Events"
        case .finance: "Finance"
        case .certificates: "Certificates"
        case .badges: "Badges"
        case .users: "Users"
        case .roles: "Roles & Permissions"
        case .congregations: "Congregations"
        case .countries: "Countries"
        case .languages: "Languages"
        case .peopleIntelligence: "People Intelligence"
        case .profile: "My Profile"
        }
    }

    var icon: String {
        switch self {
        case .dashboard: "square.grid.2x2"
        case .notifications: "bell"
        case .curriculumLevels: "list.bullet.indent"
        case .cms: "book"
        case .levelDetail: "square.stack.3d.up"
        case .quizBuilder: "questionmark.circle"
        case .videoLibrary: "play.rectangle"
        case .contentStudio: "sparkles"
        case .cellEngagement: "chart.line.uptrend.xyaxis"
        case .members: "person.2"
        case .reflectionQueue: "text.bubble"
        case .chat: "bubble.left.and.bubble.right"
        case .events: "calendar"
        case .finance: "creditcard"
        case .certificates: "rosette"
        case .badges: "star"
        case .users: "person.badge.key"
        case .roles: "lock.shield"
        case .congregations: "building.columns"
        case .countries: "globe"
        case .languages: "character.bubble"
        case .peopleIntelligence: "brain.head.profile"
        case .profile: "person.crop.circle"
        }
    }
}

private struct NavGroup: Identifiable {
    let label: String
    let items: [Section]
    var id: String { label }
}

private let navGroups: [NavGroup] = [
    .init(label: "Portal", items: [.dashboard, .notifications]),
    .init(label: "Operations", items: [.cellEngagement, .members, .reflectionQueue, .chat, .events, .finance, .certificates, .badges]),
    .init(label: "Curriculum", items: [.curriculumLevels, .cms, .levelDetail, .quizBuilder, .videoLibrary, .contentStudio]),
    .init(label: "System", items: [.users, .roles, .congregations, .countries, .languages, .peopleIntelligence]),
]

/// App-wide navigation router — lets any detail screen jump to another top-level
/// sidebar section (the iPad equivalent of the web portal's cross-page links).
struct MemberRef: Identifiable, Equatable { let id: String; let name: String }

@MainActor final class NavRouter: ObservableObject {
    @Published var section: Section? = .dashboard
    /// Global-search hand-off: set then route to Members, which applies it.
    @Published var memberSearch: String?
    /// Deep-link: open a specific member's profile from anywhere (param route).
    @Published var openMember: MemberRef?
    /// Deep-link: open CMS Curriculum focused on a specific level number.
    @Published var pendingLevel: Int?
    // Instant — no transition animation, for maximum tap reactivity.
    func go(_ s: Section) { section = s }
    func search(_ q: String) { memberSearch = q; section = .members }
    func member(_ id: String, _ name: String) { openMember = MemberRef(id: id, name: name) }
    func openLevel(_ n: Int) { pendingLevel = n; section = .cms }
}

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var router = NavRouter()
    @State private var collapsed = false

    var body: some View {
        // Fixed navy sidebar flush against the content (web-portal layout), not a
        // NavigationSplitView column — so there's no gap/seam and switching is instant.
        HStack(spacing: 0) {
            sidebar
            VStack(spacing: 0) {
                PortalTopBar(title: (router.section ?? .dashboard).title)
                NavigationStack {
                    detail(for: router.section ?? .dashboard)
                        // The global top bar carries the page title; hide the root
                        // nav bar so it isn't doubled. Pushed pages keep their own
                        // bar (and back button).
                        .toolbar(.hidden, for: .navigationBar)
                }
                .id(router.section)   // clean, immediate swap when the section changes
            }
        }
        .environmentObject(router)
        .background(Nuru.paper.ignoresSafeArea())
        .sheet(item: $router.openMember) { ref in
            NavigationStack { MemberDetailView(userId: ref.id, name: ref.name) }
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            brandHeader
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: collapsed ? 6 : 18) {
                    ForEach(navGroups) { group in
                        VStack(alignment: .leading, spacing: 4) {
                            if !collapsed {
                                Text(group.label.uppercased())
                                    .font(.inter(11.5, .bold)).tracking(1.2)
                                    .foregroundStyle(.white.opacity(0.34))
                                    .padding(.horizontal, 14).padding(.bottom, 2)
                            } else {
                                Rectangle().fill(.white.opacity(0.07)).frame(height: 1).padding(.horizontal, 14).padding(.vertical, 4)
                            }
                            ForEach(group.items) { item in
                                NavRow(item: item, selected: router.section == item, collapsed: collapsed) {
                                    router.go(item)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 16)
            }
            collapseToggle
            profileFooter
        }
        .frame(width: collapsed ? 76 : 264)
        .frame(maxHeight: .infinity)
        .background(Nuru.sidebarGradient.ignoresSafeArea())
        .animation(.easeInOut(duration: 0.22), value: collapsed)
    }

    private var collapseToggle: some View {
        Button { collapsed.toggle() } label: {
            HStack(spacing: 8) {
                Image(systemName: collapsed ? "chevron.right" : "chevron.left").font(.system(size: 12, weight: .semibold))
                if !collapsed { Text("Collapse sidebar").font(.inter(12, .medium)) }
            }
            .foregroundStyle(.white.opacity(0.45))
            .frame(maxWidth: .infinity, alignment: collapsed ? .center : .leading)
            .padding(.horizontal, collapsed ? 0 : 18).padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }

    private var brandHeader: some View {
        HStack(spacing: 12) {
            BrandMark(size: 38)
            if !collapsed {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Nuru Pathway").font(.nuruDisplay(18)).foregroundStyle(.white)
                    Text("Portal Admin").font(.nMicro).foregroundStyle(.white.opacity(0.45))
                }
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, alignment: collapsed ? .center : .leading)
        .padding(.horizontal, collapsed ? 0 : 18).padding(.top, 14).padding(.bottom, 16)
        .overlay(alignment: .bottom) {
            Rectangle().fill(.white.opacity(0.08)).frame(height: 1).padding(.horizontal, 14)
        }
    }

    private var profileFooter: some View {
        let name = auth.profile?.fullName ?? "Account"
        let role = (auth.profile?.role ?? "member").uppercased()
        return Menu {
            Button { router.go(.profile) } label: { Label("My Profile", systemImage: "person.crop.circle") }
            Button(role: .destructive) { auth.signOut() } label: {
                Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            HStack(spacing: 10) {
                Monogram(name: name, size: 36, gradient: Nuru.goldGradient)
                if !collapsed {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(name).font(.nBody).fontWeight(.semibold).foregroundStyle(.white).lineLimit(1)
                        Text(role).font(.nMicro).fontWeight(.bold).foregroundStyle(Nuru.goldLight)
                    }
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.nMicro).foregroundStyle(.white.opacity(0.5))
                }
            }
            .frame(maxWidth: .infinity, alignment: collapsed ? .center : .leading)
            .padding(collapsed ? 8 : 12)
            .background(.white.opacity(0.07))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 1))
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 14)
        }
    }

    @ViewBuilder
    private func detail(for section: Section) -> some View {
        switch section {
        case .dashboard:        DashboardView()
        case .notifications:    NotificationsView()
        case .cellEngagement:   CellEngagementView()
        case .members:          MembersView()
        case .reflectionQueue:  ReflectionQueueView()
        case .chat:             ChatView()
        case .events:           EventsView()
        case .finance:          FinanceView()
        case .certificates:     CertificatesView()
        case .badges:           BadgesView()
        case .curriculumLevels: CurriculumLevelsView()
        case .cms:              CmsCurriculumView(title: "CMS — Curriculum")
        case .levelDetail:      CmsCurriculumView(title: "Level Detail")
        case .quizBuilder:      QuizBuilderView()
        case .videoLibrary:     VideoLibraryView()
        case .contentStudio:    ContentStudioView()
        case .users:            UsersView()
        case .roles:            RolesView()
        case .congregations:    CongregationsView()
        case .countries:        CountriesView()
        case .languages:        LanguagesView()
        case .peopleIntelligence: PeopleIntelligenceView()
        case .profile:          ProfileView()
        }
    }
}

/// A sidebar navigation row — gold gradient pill + shadow when selected.
private struct NavRow: View {
    let item: Section
    let selected: Bool
    var collapsed: Bool = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: item.icon)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 22)
                if !collapsed {
                    Text(item.title).font(.inter(14.5, selected ? .semibold : .medium))
                    Spacer(minLength: 0)
                }
            }
            .foregroundStyle(selected ? .white : Color.white.opacity(0.7))
            .frame(maxWidth: collapsed ? .infinity : nil)
            .padding(.horizontal, collapsed ? 0 : 12).padding(.vertical, 10)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(Nuru.goldGradient)
                        .shadow(color: Nuru.gold.opacity(0.45), radius: 8, y: 3)
                        .padding(.horizontal, collapsed ? 8 : 0)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(item.title)
    }
}

/// Global top bar (web parity): page title, global search, notifications bell
/// with unread badge, and the profile menu. Fixed above the routed content.
private struct PortalTopBar: View {
    let title: String
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @State private var query = ""
    @State private var unread = 0

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.inter(17, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                Text("Nuru Pathway Admin Portal").font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            Spacer(minLength: 12)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Nuru.ink400)
                TextField("Search members, modules, events…", text: $query)
                    .font(.nBody).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit { if !query.trimmingCharacters(in: .whitespaces).isEmpty { router.search(query) } }
                    .frame(maxWidth: 320)
            }
            .padding(.horizontal, 14).frame(height: 40)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))

            Button { router.go(.notifications) } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "bell").font(.system(size: 16)).foregroundStyle(Nuru.ink600)
                        .frame(width: 42, height: 42).background(Nuru.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    if unread > 0 {
                        Text(unread > 9 ? "9+" : "\(unread)").font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Nuru.gold).clipShape(Capsule()).offset(x: 6, y: -4)
                    }
                }
            }.buttonStyle(.plain)

            Menu {
                Button { router.go(.profile) } label: { Label("My Profile", systemImage: "person.crop.circle") }
                Button(role: .destructive) { auth.signOut() } label: { Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right") }
            } label: {
                HStack(spacing: 8) {
                    Monogram(name: auth.profile?.fullName ?? "Account", size: 34, gradient: Nuru.navyGradient)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(auth.profile?.fullName ?? "Account").font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        Text((auth.profile?.role ?? "member").uppercased()).font(.system(size: 9, weight: .bold)).foregroundStyle(Nuru.goldLo)
                    }
                    Image(systemName: "chevron.down").font(.system(size: 10)).foregroundStyle(Nuru.ink400)
                }
                .padding(.horizontal, 10).frame(height: 44)
                .background(Nuru.white).overlay(RoundedRectangle(cornerRadius: 12).stroke(Nuru.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(Nuru.white)
        .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }
        .task {
            if let items = try? await PortalAPI.notifications() { unread = items.filter { !$0.read }.count }
        }
    }
}

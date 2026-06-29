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
    case users, roles, congregations, countries, languages
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
    .init(label: "System", items: [.users, .roles, .congregations, .countries, .languages]),
]

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var selection: Section? = .dashboard
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            sidebar
        } detail: {
            NavigationStack {
                detail(for: selection ?? .dashboard)
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    private var sidebar: some View {
        ZStack {
            Nuru.navyGradient.ignoresSafeArea()
            VStack(spacing: 0) {
                brandHeader
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(navGroups) { group in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(group.label.uppercased())
                                    .font(.caption2.weight(.bold)).tracking(1.2)
                                    .foregroundStyle(.white.opacity(0.34))
                                    .padding(.horizontal, 14).padding(.bottom, 2)
                                ForEach(group.items) { item in
                                    NavRow(item: item, selected: selection == item) {
                                        withAnimation(.easeOut(duration: 0.18)) { selection = item }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 16)
                }
                profileFooter
            }
        }
        .navigationTitle("Nuru Pathway")
        .toolbar(removing: .sidebarToggle)
        .toolbarBackground(.hidden, for: .navigationBar)
    }

    private var brandHeader: some View {
        HStack(spacing: 12) {
            BrandMark(size: 38)
            VStack(alignment: .leading, spacing: 1) {
                Text("Nuru Pathway").font(.nuruDisplay(18)).foregroundStyle(.white)
                Text("Portal Admin").font(.caption2).foregroundStyle(.white.opacity(0.45))
            }
            Spacer()
        }
        .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 16)
        .overlay(alignment: .bottom) {
            Rectangle().fill(.white.opacity(0.08)).frame(height: 1).padding(.horizontal, 14)
        }
    }

    private var profileFooter: some View {
        let name = auth.profile?.fullName ?? "Account"
        let role = (auth.profile?.role ?? "member").uppercased()
        return Menu {
            Button { selection = .profile } label: { Label("My Profile", systemImage: "person.crop.circle") }
            Button(role: .destructive) { auth.signOut() } label: {
                Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            HStack(spacing: 10) {
                Monogram(name: name, size: 36, gradient: Nuru.goldGradient)
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(.subheadline).fontWeight(.semibold).foregroundStyle(.white).lineLimit(1)
                    Text(role).font(.caption2).fontWeight(.bold).foregroundStyle(Nuru.goldLight)
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(.white.opacity(0.5))
            }
            .padding(12)
            .background(.white.opacity(0.07))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 1))
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 14)
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
        case .quizBuilder:      CmsCurriculumView(title: "Quiz Builder")
        case .videoLibrary:     VideoLibraryView()
        case .contentStudio:    ContentStudioView()
        case .users:            UsersView()
        case .roles:            RolesView()
        case .congregations:    CongregationsView()
        case .countries:        CountriesView()
        case .languages:        LanguagesView()
        case .profile:          ProfileView()
        }
    }
}

/// A sidebar navigation row — gold gradient pill + shadow when selected.
private struct NavRow: View {
    let item: Section
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: item.icon)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 22)
                Text(item.title)
                    .font(.system(size: 14, weight: selected ? .semibold : .regular))
                Spacer(minLength: 0)
            }
            .foregroundStyle(selected ? .white : Color.white.opacity(0.7))
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(Nuru.goldGradient)
                        .shadow(color: Nuru.gold.opacity(0.45), radius: 8, y: 3)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

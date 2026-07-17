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
    case cellEngagement, disciples, members, reflectionQueue, chat, broadcast, events, finance, certificates, badges, radio, mixer
    // Media (Mac-only sidebar entry — the iPad Radio Studio keeps this inline)
    case uploadsSessions
    // System
    case users, roles, congregations, countries, languages, peopleIntelligence, proximity
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
        case .disciples: "Discipleship Hub"
        case .members: "Members"
        case .reflectionQueue: "Reflection Queue"
        case .chat: "Chat"
        case .broadcast: "Broadcast"
        case .events: "Events"
        case .finance: "Finance"
        case .certificates: "Certificates"
        case .badges: "Badges"
        case .radio: "Radio Studio"
        case .mixer: "Mixer Studio"
        case .uploadsSessions: "Uploads & Sessions"
        case .users: "Users"
        case .roles: "Roles & Permissions"
        case .congregations: "Congregations"
        case .countries: "Countries"
        case .languages: "Languages"
        case .peopleIntelligence: "People Intelligence"
        case .proximity: "Nearby & pairing"
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
        case .disciples: "figure.2.arms.open"
        case .members: "person.2"
        case .reflectionQueue: "text.bubble"
        case .chat: "bubble.left.and.bubble.right"
        case .broadcast: "megaphone"
        case .events: "calendar"
        case .finance: "creditcard"
        case .certificates: "rosette"
        case .badges: "star"
        case .radio: "dot.radiowaves.left.and.right"
        case .mixer: "slider.vertical.3"
        case .uploadsSessions: "tray.and.arrow.up"
        case .users: "person.badge.key"
        case .roles: "lock.shield"
        case .congregations: "building.columns"
        case .countries: "globe"
        case .languages: "character.bubble"
        case .peopleIntelligence: "brain.head.profile"
        case .proximity: "person.2.wave.2"
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
    .init(label: "Curriculum", items: [.curriculumLevels, .cms, .levelDetail, .quizBuilder, .contentStudio]),
    // Uploads & Sessions is Mac-only (MacDesign.isMac is compile-time): the Mac
    // radio desk moved library/session management there; the iPad Radio Studio
    // keeps those sections inline, so its sidebar is unchanged.
    .init(label: "Media", items: [.videoLibrary, .radio, .mixer, .uploadsSessions]),
    .init(label: "Operations", items: [.cellEngagement, .disciples, .members, .reflectionQueue, .events, .finance, .certificates, .badges]),
    .init(label: "Communication", items: [.chat, .broadcast]),
    .init(label: "System", items: [.peopleIntelligence, .proximity]),
    .init(label: "Settings", items: [.users, .roles, .congregations, .countries, .languages]),
]

/// App-wide navigation router — lets any detail screen jump to another top-level
/// sidebar section (the iPad equivalent of the web portal's cross-page links).
struct MemberRef: Identifiable, Equatable { let id: String; let name: String }

extension Notification.Name {
    /// Cross-page deep link: the Radio Studio's Session-audio card posts this
    /// (userInfo: ["programId": String]) to open Uploads & Sessions with that
    /// session's console sheet showing. RootView routes; UploadsSessionsView opens.
    static let nuruOpenUploadsSession = Notification.Name("nuruOpenUploadsSession")
}

/// Hand-off box for `.nuruOpenUploadsSession`: RootView stashes the requested
/// program id here as it switches sections, and UploadsSessionsView consumes it
/// once its sessions have loaded — so the deep link survives the race where the
/// page mounts (or reloads) AFTER the notification was posted.
@MainActor enum UploadsSessionsLink {
    static var pendingProgramId: String?
    /// Read-and-clear, so a consumed link never replays on a later mount.
    static func consume() -> String? {
        defer { pendingProgramId = nil }
        return pendingProgramId
    }
}

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
    @ObservedObject private var network = NetworkMonitor.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var collapsed = false
    /// Keep-alive registry, MRU order (current section first). Each listed
    /// section keeps its NavigationStack mounted (hidden) so scroll position,
    /// push state and loaded VM data survive sidebar switches.
    @State private var visited: [Section] = [.dashboard]

    /// How many section stacks stay alive at once (oldest evicted beyond this).
    private static let keepAliveLimit = 6
    /// Radio/Mixer run meter timers keyed to view visibility — keeping them
    /// alive hidden would leave the timers ticking, so they tear down fully
    /// (like the old `.id()` swap) whenever the user leaves them. A live mic
    /// broadcast SURVIVES this teardown: MicBroadcaster is an app-wide
    /// singleton and RadioStudioView only stops its level monitoring.
    /// Uploads & Sessions (Mac-only) is treated the same — its live poll and
    /// preview player stop when the user leaves.
    private static let ephemeral: Set<Section> = [.radio, .mixer, .uploadsSessions]

    var body: some View {
        // Fixed navy sidebar flush against the content (web-portal layout), not a
        // NavigationSplitView column — so there's no gap/seam and switching is instant.
        HStack(spacing: 0) {
            sidebar
            VStack(spacing: 0) {
                PortalTopBar(title: (router.section ?? .dashboard).title)
                if !network.online { offlineStrip }
                detailStacks
            }
            // Drives the offline strip's slide/fade in and out.
            .animation(.easeInOut(duration: 0.25), value: network.online)
        }
        .environmentObject(router)
        .background(Nuru.paper.ignoresSafeArea())
        // ⌘1…⌘5 jump to the first five sidebar sections (navGroups order) —
        // hidden buttons keep the shortcuts discoverable in the hold-⌘ HUD.
        .background(sectionShortcuts)
        .sheet(item: $router.openMember) { ref in
            NavigationStack { MemberDetailView(userId: ref.id, name: ref.name) }
        }
        .onAppear {
            MacWindow.enforceMinimumSize() // Catalyst: declare the desktop window floor (no-op on iPad/iPhone)
            MacWindow.applyPreferredSize() // Catalyst: one-time comfortable default frame (~1560×980, centered)
            #if targetEnvironment(macCatalyst)
            // Ask for mic permission AT LAUNCH on the Mac (broadcast console —
            // the mic is core). Files the real TCC request via AVCaptureDevice,
            // so the consent dialog appears without navigating to Radio Studio.
            MicBroadcaster.shared.prepareInputSensing()
            #endif
            visit(router.section, leaving: nil)
        }
        .onChange(of: router.section) { old, new in visit(new, leaving: old) }
        // Radio Studio → Uploads & Sessions deep link (Mac AND iPad): stash the
        // program id for UploadsSessionsView to consume, then switch sections.
        .onReceive(NotificationCenter.default.publisher(for: .nuruOpenUploadsSession)) { note in
            if let id = note.userInfo?["programId"] as? String {
                UploadsSessionsLink.pendingProgramId = id
            }
            router.go(.uploadsSessions)
        }
    }

    /// Keep-alive container: every visited section keeps its own NavigationStack
    /// mounted; only the current one is visible/interactive. Switching back is
    /// instant with scroll + state intact (replaces the old `.id(router.section)`
    /// re-key, which destroyed the stack on every switch).
    private var detailStacks: some View {
        let current = router.section ?? .dashboard
        return ZStack {
            ForEach(visited, id: \.self) { s in
                NavigationStack {
                    detail(for: s)
                        // The global top bar carries the page title; hide the root
                        // nav bar so it isn't doubled. Pushed pages keep their own
                        // bar (and back button).
                        .toolbar(.hidden, for: .navigationBar)
                }
                .opacity(s == current ? 1 : 0)
                .allowsHitTesting(s == current)
                .accessibilityHidden(s != current)
            }
        }
    }

    /// MRU bookkeeping for the keep-alive container.
    private func visit(_ new: Section?, leaving old: Section?) {
        // Leaving an ephemeral section drops it entirely — full teardown.
        if let old, Self.ephemeral.contains(old) {
            visited.removeAll { $0 == old }
        }
        guard let new else { return }
        visited.removeAll { $0 == new }
        visited.insert(new, at: 0)
        if visited.count > Self.keepAliveLimit {
            visited.removeLast(visited.count - Self.keepAliveLimit)
        }
    }

    /// Slim amber banner shown under the top bar while offline.
    private var offlineStrip: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash").font(.system(size: 12, weight: .semibold))
            Text("You're offline — some data may be out of date").font(.nCaption)
            Spacer(minLength: 0)
        }
        .foregroundStyle(Nuru.warning)
        .padding(.horizontal, 20).padding(.vertical, 7)
        .background(Nuru.warning.opacity(0.12))
        .overlay(alignment: .bottom) { Rectangle().fill(Nuru.warning.opacity(0.22)).frame(height: 1) }
        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("You're offline. Some data may be out of date.")
    }

    private var sectionShortcuts: some View {
        let quick = Array(navGroups.flatMap(\.items).prefix(5))
        return ForEach(Array(quick.enumerated()), id: \.element.id) { i, section in
            Button(section.title) { router.go(section) }
                .keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: .command)
        }
        .opacity(0).frame(width: 0, height: 0)
        .accessibilityHidden(true)
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
                            // Broadcast is between the shepherd and the individual —
                            // the row itself only exists for SuperAdmin (the server
                            // enforces the role + password step-up regardless).
                            ForEach(group.items.filter { $0 != .broadcast || auth.profile?.role == "SuperAdmin" }) { item in
                                NavRow(item: item, selected: router.section == item, collapsed: collapsed) {
                                    router.go(item)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 16)
            }
            // Mac: the sidebar is persistent (never collapses) like a native
            // source list, so the collapse affordance only ships on iPad.
            if !MacDesign.isMac { collapseToggle }
            profileFooter
        }
        // Desktop: a fixed source-list width (the shell is a hand-rolled split
        // view, so this is the Mac analogue of navigationSplitViewColumnWidth).
        .frame(width: MacDesign.isMac ? 250 : (collapsed ? 76 : 264))
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
        .pressable()
        .hoverEffect(.highlight)
        .accessibilityLabel(collapsed ? "Expand sidebar" : "Collapse sidebar")
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
        .hoverEffect(.highlight)
        .accessibilityLabel("Account menu")
    }

    @ViewBuilder
    private func detail(for section: Section) -> some View {
        switch section {
        case .dashboard:        DashboardView()
        case .notifications:    NotificationsView()
        case .cellEngagement:   CellEngagementView()
        case .disciples:        DisciplesView()
        case .members:          MembersView()
        case .reflectionQueue:  ReflectionQueueView()
        case .chat:             ChatView()
        case .broadcast:        BroadcastConsoleView()
        case .events:           EventsView()
        case .finance:          FinanceView()
        case .certificates:     CertificatesView()
        case .badges:           BadgesView()
        case .radio:            RadioStudioView()
        case .mixer:            MixerStudioView()
        case .uploadsSessions:  UploadsSessionsView()
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
        case .proximity:        ProximityView()
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
        .pressable()
        .hoverEffect(.highlight)
        .help(item.title)
    }
}

/// Global top bar (web parity): page title, global search, notifications bell
/// with unread badge, and the profile menu. Fixed above the routed content.
private struct PortalTopBar: View {
    let title: String
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    /// The mic is an app-wide singleton that keeps broadcasting across navigation;
    /// this bar shows the always-visible ON MIC truth of that, from any section.
    @ObservedObject private var mic = MicBroadcaster.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var micPulse = false
    @State private var query = ""
    @State private var unread = 0
    @FocusState private var searchFocused: Bool

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
                    .focused($searchFocused)
                    .onSubmit { if !query.trimmingCharacters(in: .whitespaces).isEmpty { router.search(query) } }
                    .frame(maxWidth: 320)
            }
            .padding(.horizontal, 14).frame(height: 40)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))

            // Global ON MIC indicator — visible on every section while the mic
            // singleton is live; tap to jump back to the Radio Studio console.
            if mic.state == .onAir {
                Button { router.go(.radio) } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "mic.fill").font(.system(size: 11, weight: .bold))
                        Text("ON MIC").font(.inter(10, .bold)).tracking(0.8)
                        Circle().fill(.white).frame(width: 6, height: 6)
                            .opacity(!reduceMotion && micPulse ? 0.3 : 1)
                            .animation(reduceMotion ? nil : .easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: micPulse)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12).frame(height: 32)
                    .background(Rs.liveGlow)
                    .clipShape(Capsule())
                }
                .pressable()
                .hoverEffect(.highlight)
                .accessibilityLabel("Microphone is live")
                .accessibilityHint("Opens the Radio Studio")
                .onAppear { micPulse = true }
                .onDisappear { micPulse = false }
            }

            Button { router.go(.notifications) } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "bell").font(.system(size: 16)).foregroundStyle(Nuru.ink600)
                        .frame(width: 42, height: 42).background(Nuru.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    if unread > 0 {
                        Text(unread > 9 ? "9+" : "\(unread)").font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                            .contentTransition(.numericText())
                            .animation(.default, value: unread)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Nuru.gold).clipShape(Capsule()).offset(x: 6, y: -4)
                    }
                }
            }
            .pressable()
            .hoverEffect(.highlight)
            .accessibilityLabel("Notifications")
            .accessibilityValue(unread > 0 ? "\(unread) unread" : "No unread")

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
            .hoverEffect(.highlight)
            .accessibilityLabel("Account menu")
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(Nuru.white)
        .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }
        // ⌘F focuses the global search — hidden button so the shortcut shows up
        // in the iPad's hold-⌘ HUD without any visual change.
        .background(
            Button("Search") { searchFocused = true }
                .keyboardShortcut("f", modifiers: .command)
                .opacity(0).frame(width: 0, height: 0)
                .accessibilityHidden(true)
        )
        .task {
            if let items = try? await PortalAPI.notifications() { unread = items.filter { !$0.read }.count }
        }
    }
}

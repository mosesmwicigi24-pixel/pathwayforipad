// App shell — an iPad-native NavigationSplitView (collapsible sidebar + detail),
// the native analogue of the web portal's navy sidebar Layout. Adapts to Split
// View / Slide Over and a Magic Keyboard automatically. Sidebar mirrors nav.tsx.
import SwiftUI

enum Section: String, CaseIterable, Identifiable {
    // Portal
    case dashboard, notifications
    // Curriculum — ONE dashboard entry (docs/CURRICULUM_ARCHITECTURE.md §5.4):
    // .curriculum replaces the old .curriculumLevels/.cms pair and the duplicate
    // .levelDetail; .quizBuilder survives for PROGRAMMATIC navigation only
    // (context-aware launches from the workspace — no sidebar row).
    case curriculum, quizBuilder, videoLibrary, contentStudio
    // Operations
    case cellEngagement, disciples, members, reflectionQueue, levelReviews, chat, broadcast, events, services, followUp, departments, certificates, badges, radio, mixer
    // Finance — the ERP module (pathway docs/FINANCE_ERP.md §1). Partners lives
    // here too; the old single `.finance` page is gone (FinanceView is unrouted).
    case financeOverview, financeTransactions, financePledges, partners, financeClaims, financeRecurring,
         financeCampaigns, financeNeeds, financeExpenses, financeBudgets, financeFunds, financeLedger,
         financeReconciliation, financeReports, financeStatements, financeAudit, financeSettings
    // Media (Mac-only sidebar entry — the iPad Radio Studio keeps this inline)
    case uploadsSessions
    // System
    case users, roles, congregations, countries, languages, peopleIntelligence, flockBrief, proximity
    // Reachable from the profile menu (not listed in the sidebar)
    case profile
    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .notifications: "Notifications"
        case .curriculum: "Curriculum"
        case .quizBuilder: "Quiz Builder"
        case .videoLibrary: "Video Library"
        case .contentStudio: "Content Studio"
        case .cellEngagement: "Cell Engagement"
        case .disciples: "Discipleship Hub"
        case .members: "Members"
        case .reflectionQueue: "Reflection Queue"
        case .levelReviews: "Level Reviews"
        case .chat: "Chat"
        case .broadcast: "Broadcast"
        case .events: "Events"
        case .services: "Services"
        case .followUp: "Follow-up"
        // Finance labels are the spec §1 Label column, verbatim.
        case .financeOverview: "Overview"
        case .financeTransactions: "Transactions"
        case .financePledges: "Pledges"
        case .partners: "Partners"
        case .financeClaims: "Claims"
        case .financeRecurring: "Recurring gifts"
        case .financeCampaigns: "Campaigns"
        case .financeNeeds: "Department needs"
        case .financeExpenses: "Expenses"
        case .financeBudgets: "Budgets"
        case .financeFunds: "Funds"
        case .financeLedger: "Ledger"
        case .financeReconciliation: "Reconciliation"
        case .financeReports: "Reports"
        case .financeStatements: "Statements"
        case .financeAudit: "Audit"
        case .financeSettings: "Settings"
        case .departments: "Departments"
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
        case .flockBrief: "Flock Brief"
        case .proximity: "Nearby & pairing"
        case .profile: "My Profile"
        }
    }

    var icon: String {
        switch self {
        case .dashboard: "square.grid.2x2"
        case .notifications: "bell"
        case .curriculum: "book"
        case .quizBuilder: "questionmark.circle"
        case .videoLibrary: "play.rectangle"
        case .contentStudio: "sparkles"
        case .cellEngagement: "chart.line.uptrend.xyaxis"
        case .disciples: "figure.2.arms.open"
        case .members: "person.2"
        case .reflectionQueue: "text.bubble"
        case .levelReviews: "checkmark.seal"
        case .chat: "bubble.left.and.bubble.right"
        case .broadcast: "megaphone"
        case .events: "calendar"
        case .services: "qrcode"
        case .followUp: "phone.badge.checkmark"
        case .financeOverview: "chart.pie"
        case .financeTransactions: "arrow.left.arrow.right"
        case .financePledges: "signature"
        case .partners: "person.2.badge.gearshape"
        case .financeClaims: "list.clipboard"
        case .financeRecurring: "repeat.circle"
        case .financeCampaigns: "flag"
        case .financeNeeds: "target"
        case .financeExpenses: "banknote"
        case .financeBudgets: "chart.bar.doc.horizontal"
        case .financeFunds: "square.stack.3d.up"
        case .financeLedger: "book.closed"
        case .financeReconciliation: "arrow.triangle.2.circlepath"
        case .financeReports: "chart.bar.xaxis"
        case .financeStatements: "doc.text"
        case .financeAudit: "checkmark.shield"
        case .financeSettings: "gearshape"
        case .departments: "person.3"
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
        case .flockBrief: "heart.text.square"
        case .proximity: "person.2.wave.2"
        case .profile: "person.crop.circle"
        }
    }

    /// Required permission key ("module:capability") from the effective set on
    /// MeProfile.permissions — the native mirror of admin-web's nav.tsx
    /// NavItem.permission, derived from the SAME requirePermission(module,
    /// capability) guard on that section's primary endpoint. `nil` = no
    /// sensible single-permission mapping (a coarse requireRole(...) gate, or
    /// none at all) — the row stays visible; the server keeps enforcing its
    /// own gate regardless of what the sidebar shows.
    var permission: String? {
        switch self {
        case .dashboard, .notifications, .cellEngagement: "dashboard:view"
        case .curriculum: "cms:view"
        case .quizBuilder: "quiz:view"
        case .videoLibrary: "videos:view"
        case .members: "members:view"
        // Every Finance page is gated on finance:view (spec §6) — Partners too:
        // its routes sit under perm("finance", "view") (pathway #482). Write
        // actions inside the pages need export/manage/approve (FinanceCaps).
        case .financeOverview, .financeTransactions, .financePledges, .partners, .financeClaims,
             .financeRecurring, .financeCampaigns, .financeNeeds, .financeExpenses, .financeBudgets,
             .financeFunds, .financeLedger, .financeReconciliation, .financeReports,
             .financeStatements, .financeAudit, .financeSettings: "finance:view"
        // Its own module (pathway #483) — departments:view, not finance.
        case .departments: "departments:view"
        case .certificates: "certificates:view"
        case .badges: "badges:view"
        case .users: "users:view"
        case .roles: "rolesAdmin:view"
        case .congregations: "congregations:view"
        case .countries: "countries:view"
        case .languages: "languages:view"
        case .proximity: "members:proximity"
        // Its own module, so holding it does not imply the member roll and
        // holding the roll does not imply it.
        case .services, .followUp: "followUp:view"
        // contentStudio/disciples/reflectionQueue/levelReviews/chat/events/
        // radio/mixer/uploadsSessions/peopleIntelligence/flockBrief/broadcast/
        // profile: coarse requireRole(...) gates or no gate at all — no fine
        // RBAC permission to key off. Stays visible.
        default: nil
        }
    }

    /// A page of the Finance group (Partners included) — drives the "Finance ·"
    /// breadcrumb and the group's auto-expand.
    var isFinance: Bool {
        switch self {
        case .financeOverview, .financeTransactions, .financePledges, .partners, .financeClaims,
             .financeRecurring, .financeCampaigns, .financeNeeds, .financeExpenses, .financeBudgets,
             .financeFunds, .financeLedger, .financeReconciliation, .financeReports,
             .financeStatements, .financeAudit, .financeSettings: true
        default: false
        }
    }

    /// The detail header's title: "Finance · Ledger" for a Finance page (spec
    /// §1 — the web breadcrumb reads the same), the plain title otherwise.
    var breadcrumbTitle: String { isFinance ? "Finance · \(title)" : title }

    /// Web route → section for "/finance/<sub>" (spec §1 route column; the
    /// legacy "/partners" redirect is mapped by the caller). An unknown or empty
    /// sub-route lands on the Overview rather than nowhere.
    static func finance(route sub: String) -> Section {
        switch sub {
        case "transactions": .financeTransactions
        case "pledges": .financePledges
        case "partners": .partners
        case "claims": .financeClaims
        case "recurring": .financeRecurring
        case "campaigns": .financeCampaigns
        case "needs": .financeNeeds
        case "expenses": .financeExpenses
        case "budgets": .financeBudgets
        case "funds": .financeFunds
        case "ledger": .financeLedger
        case "reconciliation": .financeReconciliation
        case "reports": .financeReports
        case "statements": .financeStatements
        case "audit": .financeAudit
        case "settings": .financeSettings
        default: .financeOverview
        }
    }
}

/// True if `item` should show in the sidebar for this profile: `.broadcast`
/// needs SuperAdmin (the server enforces the role + password step-up
/// regardless); a permission-mapped item needs that key present in
/// `profile.permissions`. `profile == nil` (still booting, /me not back yet)
/// fails OPEN — never hide/redirect on a guess. Everything else defaults to
/// visible. The native mirror of admin-web's nav.tsx `navItemVisible`.
func isSectionVisible(_ item: Section, profile: MeProfile?) -> Bool {
    if item == .broadcast, profile?.role != "SuperAdmin" { return false }
    if let perm = item.permission, let perms = profile?.permissions, !perms.contains(perm) { return false }
    return true
}

/// A folding sub-menu inside a sidebar group — Finance's Giving & Income,
/// Spending & Planning and Accounting & Reporting (pathway docs/FINANCE_ERP.md
/// §1). The native twin of nav.tsx NavSubgroup. `key` is stable: the saved open
/// state is keyed on it, so a relabel keeps it.
private struct NavSubgroup: Identifiable {
    let key: String
    let label: String
    /// SF Symbol for the header in the full sidebar; the mini sidebar shows the rows' own.
    let icon: String
    let items: [Section]
    var id: String { key }
}

/// One line of a group: a page row, or a sub-menu and its rows.
private enum NavEntry: Identifiable {
    case row(Section)
    case subgroup(NavSubgroup)
    var id: String {
        switch self {
        case .row(let s): s.rawValue
        case .subgroup(let sg): "sub:\(sg.key)"
        }
    }
    var sections: [Section] {
        switch self {
        case .row(let s): [s]
        case .subgroup(let sg): sg.items
        }
    }
}

private struct NavGroup: Identifiable {
    let label: String
    let entries: [NavEntry]
    var id: String { label }
    /// Every row, flat, in sidebar order — what the ⌘-shortcuts, the route
    /// guard and the self-check walk. Sub-menus change only how rows are shown.
    var items: [Section] { entries.flatMap(\.sections) }
    /// A group of plain rows (every group but Finance).
    init(label: String, items: [Section]) {
        self.label = label
        entries = items.map { NavEntry.row($0) }
    }
    init(label: String, entries: [NavEntry]) {
        self.label = label
        self.entries = entries
    }
    static let financeLabel = "Finance"
    /// The sub-menus of every group, flat.
    var subgroups: [NavSubgroup] {
        entries.compactMap { if case .subgroup(let sg) = $0 { sg } else { nil } }
    }
}

/// The group's lines for this profile: the rows it may see, and each sub-menu
/// holding at least one of them (with only those rows) — a sub-menu with
/// nothing to show is left out, header and all. The native twin of nav.tsx
/// `sidebarEntries(group, visibleItems)`.
private func visibleEntries(_ group: NavGroup, profile: MeProfile?) -> [NavEntry] {
    group.entries.compactMap { entry in
        switch entry {
        case .row(let s):
            return isSectionVisible(s, profile: profile) ? entry : nil
        case .subgroup(let sg):
            let rows = sg.items.filter { isSectionVisible($0, profile: profile) }
            return rows.isEmpty ? nil : .subgroup(NavSubgroup(key: sg.key, label: sg.label, icon: sg.icon, items: rows))
        }
    }
}

private let navGroups: [NavGroup] = [
    .init(label: "Portal", items: [.dashboard, .notifications]),
    // §5.4 target nav: ONE Curriculum entry (dashboard → workspace drill-in).
    // Quiz Builder is deliberately absent — it is reached context-aware from
    // the workspace/dashboard (NavRouter.openQuizBuilder), never re-selecting.
    .init(label: "Curriculum", items: [.curriculum, .contentStudio]),
    // Uploads & Sessions is Mac-only (MacDesign.isMac is compile-time): the Mac
    // radio desk moved library/session management there; the iPad Radio Studio
    // keeps those sections inline, so its sidebar is unchanged.
    .init(label: "Media", items: [.videoLibrary, .radio, .mixer, .uploadsSessions]),
    // Services and Follow-up sit beside Events on purpose: a service is what a
    // QR belongs to, and follow-up is what the scans feed.
    //
    // Adding the Section case, its title, its icon and its destination is NOT
    // enough to make a page reachable — THIS list is the sidebar, it is explicit
    // and ordered, and a route missing from it compiles, builds clean and ships
    // invisible. Both pages shipped that way on 2026-08-17: every target built,
    // and neither page could be opened.
    // Departments (pathway #483) stays in Operations — where members serve; its
    // money view is Finance → Department needs. Finance and Partners moved out
    // to their own group below (docs/FINANCE_ERP.md §1).
    .init(label: "Operations", items: [.cellEngagement, .disciples, .members, .reflectionQueue, .levelReviews, .events, .departments, .certificates, .badges]),
    // FINANCE — the ERP module, directly after Operations (spec §1). A plain
    // title like Media over three folding sub-menus, with Settings kept apart
    // at the bottom because it is administration rather than day-to-day
    // finance (owner, 2026-09-26: "much cleaner than having 16 items exposed at
    // the same level, while not changing any of your existing terminology").
    // Same order, keys and labels as nav.tsx; every row finance:view.
    .init(label: NavGroup.financeLabel, entries: [
        // Claims are members saying they paid a pledge another way — money in,
        // so Giving & Income, beside Partners (owner, 2026-09-26; first placed
        // under Spending & Planning).
        .subgroup(.init(key: "giving", label: "Giving & Income", icon: "gift", items: [
            .financeOverview, .financeTransactions, .financePledges, .partners, .financeClaims,
            .financeRecurring, .financeCampaigns,
        ])),
        .subgroup(.init(key: "spending", label: "Spending & Planning", icon: "wallet.bifold", items: [
            .financeNeeds, .financeExpenses, .financeBudgets, .financeFunds,
        ])),
        // "The books".
        .subgroup(.init(key: "accounting", label: "Accounting & Reporting", icon: "books.vertical", items: [
            .financeLedger, .financeReconciliation, .financeReports, .financeStatements, .financeAudit,
        ])),
        .row(.financeSettings),
    ]),
    // Follow-up is its own section, a peer of Operations rather than a row
    // inside it (owner ruling, 2026-08-17). It is a distinct pastoral job — a
    // list of names, phone numbers, missed services and what was said on the
    // last call — and it is gated on its own `followUp` module (migration 198),
    // not on members:view. A follow_up_team role grants this section and
    // nothing else, which is what makes it safe to hand to whoever actually
    // rings round on a Monday.
    .init(label: "Follow-up", items: [.services, .followUp]),
    .init(label: "Communication", items: [.chat, .broadcast]),
    .init(label: "System", items: [.peopleIntelligence, .flockBrief, .proximity]),
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
    /// Deep-link: open the Curriculum Dashboard routed into the workspace at a level.
    @Published var pendingLevel: Int?
    /// Deep-link: open the Quiz Builder with this level PRESELECTED (context-aware
    /// launches from the workspace — the builder never re-asks for the level).
    @Published var pendingQuizLevel: Int?
    /// Deep link INTO a Finance page with a filter preset (the Overview's
    /// alerts, a pledge row → its partner, a need → its gifts). The target page
    /// consumes it with `.onFinanceLink(section) { params in … }` (FinanceKit),
    /// which clears it — read-and-clear, so it never replays on a later mount.
    @Published var financeLink: FinanceLink?
    // Instant — no transition animation, for maximum tap reactivity.
    func go(_ s: Section) { section = s }
    /// Open a Finance page with params (e.g. `.financeExpenses, ["status": "recorded"]`).
    func openFinance(_ s: Section, _ params: [String: String] = [:]) {
        financeLink = FinanceLink(section: s, params: params)
        section = s
    }
    func search(_ q: String) { memberSearch = q; section = .members }
    func member(_ id: String, _ name: String) { openMember = MemberRef(id: id, name: name) }
    func openLevel(_ n: Int) { pendingLevel = n; section = .curriculum }
    func openQuizBuilder(level n: Int) { pendingQuizLevel = n; section = .quizBuilder }
}

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var router = NavRouter()
    @ObservedObject private var network = NetworkMonitor.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var collapsed = false
    /// The sidebar sub-menus the user opened (their stable keys, comma-
    /// separated), persisted per device. Folded by default, so FINANCE reads
    /// as its three sub-menu headers and Settings.
    @AppStorage("nuru.nav.subgroups.open") private var savedOpenSubsRaw = ""
    /// Sub-menus opened because a page inside one was selected — for this run
    /// only (web parity), so what is remembered is only what the user chose.
    @State private var autoOpenSubs: Set<String> = []
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
                // Finance pages read "Finance · <Title>" (spec §1 breadcrumb).
                PortalTopBar(title: (router.section ?? .dashboard).breadcrumbTitle)
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
            #if DEBUG
            // Headless smoke-testing (Debug only, like AuthStore's
            // NURU_ACCESS_TOKEN): SIMCTL_CHILD_NURU_START_SECTION=financeLedger
            // opens that section at launch, so a page can be screenshotted
            // without driving the simulator's UI.
            if let raw = ProcessInfo.processInfo.environment["NURU_START_SECTION"], let start = Section(rawValue: raw) {
                router.section = start
            }
            #endif
            visit(router.section, leaving: nil)
            revealSubgroup(of: router.section)
        }
        .onChange(of: router.section) { old, new in
            // Defense in depth for deep links (push notifications, cross-page
            // jumps) that could otherwise target a section this profile can't
            // see — the sidebar already keeps a normal tap from reaching one.
            guard let new else { return }
            if !isSectionVisible(new, profile: auth.profile) {
                router.financeLink = nil          // never replay a link into a page this profile can't see
                router.section = .dashboard
                return
            }
            // The current page is never hidden inside a folded sub-menu.
            revealSubgroup(of: new)
            visit(new, leaving: old)
        }
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
        let quick = Array(navGroups.flatMap(\.items).filter { isSectionVisible($0, profile: auth.profile) }.prefix(5))
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
                        // Permitted-but-limited users see ONLY the rows their
                        // permissions grant — everything else absent, not
                        // grayed (visibleEntries mirrors nav.tsx's filter). A
                        // group with no visible row shows nothing at all, not
                        // an empty header (web parity).
                        let entries = visibleEntries(group, profile: auth.profile)
                        if !entries.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                if !collapsed {
                                    Text(group.label.uppercased())
                                        .font(.inter(11.5, .bold)).tracking(1.2)
                                        .foregroundStyle(.white.opacity(0.34))
                                        .padding(.horizontal, 14).padding(.bottom, 2)
                                } else {
                                    Rectangle().fill(.white.opacity(0.07)).frame(height: 1).padding(.horizontal, 14).padding(.vertical, 4)
                                }
                                ForEach(entries) { entry in
                                    switch entry {
                                    case .row(let item):
                                        navRow(item)
                                    case .subgroup(let sg):
                                        // The mini sidebar has no header to unfold a
                                        // sub-menu from, so it shows every page's icon.
                                        if collapsed {
                                            ForEach(sg.items) { navRow($0) }
                                        } else {
                                            subgroupHeader(sg, containsSelection: sg.items.contains { $0 == router.section })
                                            if isSubOpen(sg.key) {
                                                // its pages, indented under a hairline from the header's icon
                                                VStack(alignment: .leading, spacing: 4) {
                                                    ForEach(sg.items) { navRow($0) }
                                                }
                                                .padding(.leading, 30)
                                                .overlay(alignment: .leading) {
                                                    Rectangle().fill(.white.opacity(0.08)).frame(width: 1)
                                                        .padding(.leading, 23).padding(.vertical, 2)
                                                }
                                                .transition(.opacity)
                                            }
                                        }
                                    }
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

    private func navRow(_ item: Section) -> some View {
        NavRow(item: item, selected: router.section == item, collapsed: collapsed) {
            router.go(item)
        }
    }

    private var savedOpenSubs: Set<String> {
        Set(savedOpenSubsRaw.split(separator: ",").map(String.init))
    }
    private func isSubOpen(_ key: String) -> Bool {
        savedOpenSubs.contains(key) || autoOpenSubs.contains(key)
    }
    /// A fold or unfold the user makes — remembered (web: localStorage per sub-menu).
    private func toggleSub(_ key: String) {
        var saved = savedOpenSubs
        if isSubOpen(key) {
            saved.remove(key)
            autoOpenSubs.remove(key)
        } else {
            saved.insert(key)
        }
        savedOpenSubsRaw = saved.sorted().joined(separator: ",")
    }
    /// Open the sub-menu holding `section`, for this run only (never saved).
    private func revealSubgroup(of section: Section?) {
        guard let section else { return }
        for sg in navGroups.flatMap(\.subgroups) where sg.items.contains(section) {
            autoOpenSubs.insert(sg.key)
        }
    }

    /// A sub-menu header: a row like the page rows (its own glyph, a semibold
    /// label), with a chevron — down while folded, up while open (web parity).
    /// Folded with the current page inside it, a gold dot says where you are
    /// (auto-open makes that rare — only a manual fold).
    private func subgroupHeader(_ sg: NavSubgroup, containsSelection: Bool) -> some View {
        let open = isSubOpen(sg.key)
        return Button {
            if reduceMotion { toggleSub(sg.key) }
            else { withAnimation(.easeInOut(duration: 0.2)) { toggleSub(sg.key) } }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: sg.icon)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 22)
                HStack(spacing: 6) {
                    Text(sg.label).font(.inter(14.5, .semibold))
                        .lineLimit(1).minimumScaleFactor(0.8)
                    if !open && containsSelection {
                        Circle().fill(Nuru.gold).frame(width: 6, height: 6)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white.opacity(0.45))
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
            }
            // brighter while the current page is one of its rows
            .foregroundStyle(containsSelection ? .white : Color.white.opacity(0.7))
            .padding(.horizontal, 12).padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .pressable()
        .hoverEffect(.highlight)
        .help(sg.label)
        .accessibilityLabel(sg.label)
        .accessibilityValue(open ? "Expanded" : "Collapsed")
        .accessibilityHint(open ? "Hides its pages" : "Shows its pages")
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
        case .levelReviews:     LevelReviewsView()
        case .chat:             ChatView()
        case .broadcast:        BroadcastConsoleView()
        case .events:           EventsOperationsView()
        // Finance (spec §1). The old FinanceView is deliberately unrouted — the
        // page agents harvest it and then delete it.
        case .financeOverview:       FinanceOverviewView()
        case .financeTransactions:   FinanceTransactionsView()
        case .financePledges:        FinancePledgesView()
        case .partners:              PartnersView()
        case .financeClaims:         FinanceClaimsView()
        case .financeRecurring:      FinanceRecurringView()
        case .financeCampaigns:      FinanceCampaignsView()
        case .financeNeeds:          FinanceNeedsView()
        case .financeExpenses:       FinanceExpensesView()
        case .financeBudgets:        FinanceBudgetsView()
        case .financeFunds:          FinanceFundsView()
        case .financeLedger:         FinanceLedgerView()
        case .financeReconciliation: FinanceReconciliationView()
        case .financeReports:        FinanceReportsView()
        case .financeStatements:     FinanceStatementsView()
        case .financeAudit:          FinanceAuditView()
        case .financeSettings:       FinanceSettingsView()
        case .departments:      DepartmentsView()
        case .services:         ServicesView()
        case .followUp:         FollowUpView()
        case .certificates:     CertificatesView()
        case .badges:           BadgesView()
        case .radio:            RadioStudioView()
        case .mixer:            MixerStudioView()
        case .uploadsSessions:  UploadsSessionsView()
        case .curriculum:       CurriculumDashboardView()
        case .quizBuilder:      QuizBuilderView()
        case .videoLibrary:     VideoLibraryView()
        case .contentStudio:    ContentStudioView()
        case .users:            UsersView()
        case .roles:            RolesView()
        case .congregations:    CongregationsView()
        case .countries:        CountriesView()
        case .languages:        LanguagesView()
        case .peopleIntelligence: PeopleIntelligenceView()
        case .flockBrief:       FlockBriefView()
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

#if DEBUG
/// DEBUG self-check of the Finance sidebar (this project has no test target —
/// FinanceSelfCheck runs it at launch in Debug builds): FINANCE sits directly
/// after OPERATIONS; its 17 spec §1 pages keep their Label titles, distinct
/// icons and finance:view gates, in the owner's three sub-menus (Giving &
/// Income · Spending & Planning · Accounting & Reporting) with Settings apart
/// at the bottom; every glyph resolves; Operations keeps Departments and
/// nothing of Finance. Returns the failures (empty = pass).
func financeNavSelfCheckFailures() -> [String] {
    var failures: [String] = []
    let labels = navGroups.map(\.label)
    guard let ops = labels.firstIndex(of: "Operations"),
          let fin = labels.firstIndex(of: NavGroup.financeLabel) else {
        return ["nav: the Operations or Finance group is missing"]
    }
    if fin != ops + 1 { failures.append("nav: Finance is not directly after Operations") }
    let finance = navGroups[fin]
    // The sidebar, top to bottom (owner, 2026-09-26).
    let expectedEntries: [String] = ["sub:giving", "sub:spending", "sub:accounting", Section.financeSettings.rawValue]
    if finance.entries.map(\.id) != expectedEntries { failures.append("nav: Finance is not the three sub-menus then Settings") }
    if finance.subgroups.map(\.label) != ["Giving & Income", "Spending & Planning", "Accounting & Reporting"] {
        failures.append("nav: Finance sub-menu labels differ from the owner's")
    }
    let rows: [String: [Section]] = Dictionary(uniqueKeysWithValues: finance.subgroups.map { ($0.key, $0.items) })
    if rows["giving"] != [.financeOverview, .financeTransactions, .financePledges, .partners, .financeClaims, .financeRecurring, .financeCampaigns] {
        failures.append("nav: Giving & Income rows are wrong")
    }
    if rows["spending"] != [.financeNeeds, .financeExpenses, .financeBudgets, .financeFunds] {
        failures.append("nav: Spending & Planning rows are wrong")
    }
    if rows["accounting"] != [.financeLedger, .financeReconciliation, .financeReports, .financeStatements, .financeAudit] {
        failures.append("nav: Accounting & Reporting rows are wrong")
    }
    let expected: [Section] = [
        .financeOverview, .financeTransactions, .financePledges, .partners, .financeClaims, .financeRecurring,
        .financeCampaigns, .financeNeeds, .financeExpenses, .financeBudgets, .financeFunds,
        .financeLedger, .financeReconciliation, .financeReports, .financeStatements, .financeAudit,
        .financeSettings,
    ]
    if finance.items != expected { failures.append("nav: the flat Finance rows are not the 17 spec §1 sections in sidebar order") }
    let titles = ["Overview", "Transactions", "Pledges", "Partners", "Claims", "Recurring gifts",
                  "Campaigns", "Department needs", "Expenses", "Budgets", "Funds",
                  "Ledger", "Reconciliation", "Reports", "Statements", "Audit", "Settings"]
    if expected.map(\.title) != titles { failures.append("nav: Finance titles changed (the owner asked for none to)") }
    for s in expected where s.permission != "finance:view" { failures.append("nav: \(s.rawValue) is not gated on finance:view") }
    for s in expected where !s.isFinance { failures.append("nav: \(s.rawValue) is not marked isFinance") }
    if Set(expected.map(\.icon)).count != expected.count { failures.append("nav: Finance icons are not distinct") }
    // Sub-menu glyphs: distinct, shared with no page row, and real SF Symbols
    // (a misspelt name renders as nothing, silently).
    let subIcons = finance.subgroups.map(\.icon)
    if Set(subIcons).count != subIcons.count { failures.append("nav: sub-menu icons are not distinct") }
    let rowIcons = Set(Section.allCases.map(\.icon))
    for icon in subIcons where rowIcons.contains(icon) { failures.append("nav: sub-menu icon \(icon) is also a page's") }
    for icon in subIcons + expected.map(\.icon) where UIImage(systemName: icon) == nil {
        failures.append("nav: SF Symbol \(icon) does not exist")
    }
    // Sub-menu keys are the saved-state tokens: unique across the whole sidebar.
    let keys = navGroups.flatMap(\.subgroups).map(\.key)
    if Set(keys).count != keys.count { failures.append("nav: sub-menu keys are not unique") }
    if navGroups.filter({ !$0.subgroups.isEmpty }).map(\.label) != [NavGroup.financeLabel] {
        failures.append("nav: a group other than Finance has sub-menus")
    }
    // With no profile yet (booting) everything shows; the filter keeps sub-menu order.
    if visibleEntries(finance, profile: nil).map(\.id) != expectedEntries { failures.append("nav: visibleEntries drops or reorders Finance lines") }
    if navGroups[ops].items.contains(where: \.isFinance) { failures.append("nav: Operations still lists a Finance page") }
    if !navGroups[ops].items.contains(.departments) { failures.append("nav: Departments left Operations") }
    if navGroups.flatMap(\.items).filter(\.isFinance).count != expected.count { failures.append("nav: a Finance page is listed outside the Finance group") }
    if Section.financeLedger.breadcrumbTitle != "Finance · Ledger" { failures.append("nav: Finance breadcrumb is not \"Finance · <Title>\"") }
    if Section.members.breadcrumbTitle != "Members" { failures.append("nav: a non-Finance breadcrumb gained a prefix") }
    if Section.finance(route: "expenses") != .financeExpenses || Section.finance(route: "") != .financeOverview
        || Section.finance(route: "partners") != .partners {
        failures.append("nav: /finance/<sub> route mapping is wrong")
    }
    return failures
}
#endif

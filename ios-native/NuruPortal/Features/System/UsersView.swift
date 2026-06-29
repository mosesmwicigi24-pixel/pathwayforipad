// Users — System page, a SwiftUI port of the web admin portal's Users.tsx
// (packages/admin-web/src/components/pages/Users.tsx). Read view over the RBAC
// user API (PortalAPI.users → /admin/users): navy hero with breadcrumb + "Add
// user" action and a 4-up stat strip (Total / Active / Invited / Roles in use),
// a search + role/status filter bar, and a card per user with avatar, name,
// email, role chips, status pill and last-active. Mutations from the web
// (create/edit/suspend/delete) are out of scope here — this is the read surface.
import SwiftUI

struct UsersView: View {
    @State private var query = ""
    @State private var roleFilter = "All"      // "All" or a role_key
    @State private var statusFilter = "All"    // "All" | "active" | "invited" | "suspended"

    var body: some View {
        AsyncView({ try await UsersLoad.fetch() }) { bundle in
            content(bundle)
        }
        .portalPage("Users")
    }

    @ViewBuilder
    private func content(_ bundle: UsersLoad.Bundle) -> some View {
        let users = bundle.users
        let roles = bundle.roles
        let stats = UserStats(users)
        let filtered = filter(users, roles: roles)
        let roleOrder = ["All"] + roles.map(\.roleKey)
        let statusOrder = ["All", "active", "invited", "suspended"]

        ScrollView {
            VStack(spacing: 0) {
                hero(stats: stats)

                VStack(alignment: .leading, spacing: 16) {
                    filterBar(roles: roles, roleOrder: roleOrder, statusOrder: statusOrder)

                    if filtered.isEmpty {
                        emptyState
                    } else {
                        VStack(spacing: 10) {
                            ForEach(Array(filtered.enumerated()), id: \.element.id) { idx, u in
                                UserRowCard(user: u, index: idx, roles: roles)
                            }
                        }
                    }
                }
                .padding(.horizontal, Nuru.S.screen)
                .padding(.top, Nuru.S.lg)
                .padding(.bottom, Nuru.S.xxl)
            }
        }
    }

    // MARK: Hero (navy banner + breadcrumb + action + stat strip)

    private func hero(stats: UserStats) -> some View {
        PortalHero(
            breadcrumb: ["System", "Users"],
            eyebrow: "Access & accounts",
            title: "System Users",
            subtitle: "People who can sign in to the admin portal. Assign each a role, country and language.",
            stats: [
                HeroStat(label: "Total users", value: "\(stats.total)", hint: "with portal access"),
                HeroStat(label: "Active", value: "\(stats.active)", hint: "signed-in capable"),
                HeroStat(label: "Invited", value: "\(stats.invited)", hint: "awaiting first login"),
                HeroStat(label: "Roles in use", value: "\(stats.roles)", hint: "distinct assignments"),
            ]
        ) {
            HeroChip(label: "Add user", icon: "plus", style: .gold)
        }
    }

    // MARK: Filter bar (search + role/status cycling pills)

    private func filterBar(roles: [SystemRole], roleOrder: [String], statusOrder: [String]) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(Nuru.ink400)
                TextField("Search by name, email, or role…", text: $query)
                    .font(.inter(13)).foregroundStyle(Nuru.ink)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            .padding(.horizontal, 12).frame(height: 38)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            HStack(spacing: 8) {
                FilterPill(label: "Role: \(roleLabel(roleFilter, roles: roles))") {
                    roleFilter = cycle(roleFilter, roleOrder)
                }
                FilterPill(label: "Status: \(statusLabel(statusFilter))") {
                    statusFilter = cycle(statusFilter, statusOrder)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private var emptyState: some View {
        Text("No users match those filters.")
            .font(.inter(14)).foregroundStyle(Nuru.ink600)
            .frame(maxWidth: .infinity).padding(.vertical, 48)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // MARK: Filtering / labels

    private func filter(_ users: [SystemUser], roles: [SystemRole]) -> [SystemUser] {
        users.filter { u in
            let haystack = "\(u.fullName) \(u.email ?? "") \(u.roleKeys.map { roleName($0, roles: roles) }.joined(separator: " "))".lowercased()
            let matchQ = query.isEmpty || haystack.contains(query.lowercased())
            let matchR = roleFilter == "All" || u.roleKeys.contains(roleFilter)
            let matchS = statusFilter == "All" || u.accountStatus == statusFilter
            return matchQ && matchR && matchS
        }
    }

    private func cycle(_ current: String, _ order: [String]) -> String {
        guard let i = order.firstIndex(of: current) else { return order.first ?? "All" }
        return order[(i + 1) % order.count]
    }
    private func roleName(_ key: String, roles: [SystemRole]) -> String {
        roles.first { $0.roleKey == key }?.name ?? key
    }
    private func roleLabel(_ key: String, roles: [SystemRole]) -> String {
        key == "All" ? "All" : roleName(key, roles: roles)
    }
    private func statusLabel(_ s: String) -> String {
        switch s {
        case "All": return "All"
        case "active": return "Active"
        case "invited": return "Invited"
        case "suspended": return "Suspended"
        default: return s.capitalized
        }
    }
}

// MARK: - Aggregated stats (mirrors the web `stats` object)

private struct UserStats {
    let total: Int, active: Int, invited: Int, roles: Int
    init(_ users: [SystemUser]) {
        total = users.count
        active = users.filter { $0.accountStatus == "active" }.count
        invited = users.filter { $0.accountStatus == "invited" }.count
        roles = Set(users.flatMap(\.roleKeys)).count
    }
}

// MARK: - Loader (users + roles, like the web page's parallel fetch)

private enum UsersLoad {
    struct Bundle { let users: [SystemUser]; let roles: [SystemRole] }
    static func fetch() async throws -> Bundle {
        async let users = PortalAPI.users()
        // Roles power the role-chip names + role filter; tolerate failure like the web (`.catch(() => {})`).
        let roles = (try? await PortalAPI.roles()) ?? []
        return Bundle(users: try await users, roles: roles)
    }
}

// MARK: - User row card (avatar, name/email, role chips, status, last-active)

private struct UserRowCard: View {
    let user: SystemUser
    let index: Int
    let roles: [SystemRole]

    var body: some View {
        Card {
            HStack(alignment: .top, spacing: 14) {
                // Gradient avatar with initials — cycles the web AVATAR_GRADIENTS palette.
                Monogram(name: user.fullName, size: 44, gradient: Self.avatarGradients[index % Self.avatarGradients.count])

                VStack(alignment: .leading, spacing: 6) {
                    Text(user.fullName).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                    HStack(spacing: 5) {
                        Image(systemName: "envelope").font(.system(size: 10)).foregroundStyle(Nuru.ink400)
                        Text(displayContact).font(.nCaption).foregroundStyle(Nuru.ink600)
                    }
                    roleChips
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 8) {
                    statusPill
                    HStack(spacing: 4) {
                        Image(systemName: "clock").font(.system(size: 9)).foregroundStyle(Nuru.ink400)
                        Text(lastActive).font(.nMicro).foregroundStyle(Nuru.ink400)
                    }
                }
            }
        }
    }

    private var displayContact: String {
        if let e = user.email, !e.isEmpty { return e }
        return user.phoneNumber.isEmpty ? "—" : user.phoneNumber
    }

    @ViewBuilder
    private var roleChips: some View {
        if user.roleKeys.isEmpty {
            Text("No role").font(.nMicro).foregroundStyle(Nuru.ink400)
        } else {
            // Wrap up to two named chips + "+N" overflow, mirroring the web slice(0,2).
            HStack(spacing: 6) {
                ForEach(user.roleKeys.prefix(2), id: \.self) { key in
                    let tone = roleTone(key)
                    Text(roleName(key))
                        .font(.inter(11, .semibold))
                        .foregroundStyle(tone.fg)
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(tone.bg)
                        .clipShape(Capsule())
                }
                if user.roleKeys.count > 2 {
                    Text("+\(user.roleKeys.count - 2)")
                        .font(.inter(11, .semibold))
                        .foregroundStyle(Nuru.ink600)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Nuru.inputBg)
                        .clipShape(Capsule())
                }
            }
        }
    }

    private var statusPill: some View {
        let s = statusStyle
        return HStack(spacing: 5) {
            Circle().fill(s.fg).frame(width: 6, height: 6)
            Text(s.label).font(.inter(11, .semibold)).foregroundStyle(s.fg)
        }
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(s.bg)
        .clipShape(Capsule())
    }

    private var lastActive: String { Fmt.date(user.lastActive, style: .dateTime.month(.abbreviated).day()) }

    // role_type → chip tones (web roleChip)
    private func roleName(_ key: String) -> String { roles.first { $0.roleKey == key }?.name ?? key }
    private func roleType(_ key: String) -> String { roles.first { $0.roleKey == key }?.roleType ?? "field" }
    private func roleTone(_ key: String) -> (bg: Color, fg: Color) {
        switch roleType(key) {
        case "system": return (Color(hex: 0xFDECEC), Color(hex: 0xA8281F))
        case "staff":  return (Color(hex: 0xEEF1F8), Color(hex: 0x1F3A6B))
        default:       return (Color(hex: 0xE8F6EE), Color(hex: 0x0F6B33)) // field
        }
    }

    // account_status → status chip (web statusChip)
    private var statusStyle: (bg: Color, fg: Color, label: String) {
        switch user.accountStatus {
        case "active":    return (Color(hex: 0xE8F6EE), Color(hex: 0x0F6B33), "Active")
        case "invited":   return (Color(hex: 0xFDF5E5), Color(hex: 0x8A6B1F), "Invited")
        case "suspended": return (Color(hex: 0xFDECEC), Color(hex: 0xA8281F), "Suspended")
        default:          return (Nuru.inputBg, Nuru.ink600, user.accountStatus.capitalized)
        }
    }

    // Web AVATAR_GRADIENTS — 135° two-stop gradients.
    static let avatarGradients: [LinearGradient] = [
        grad(0x0B1F33, 0x1E4068), grad(0xC89B3C, 0x8B6914), grad(0x16A34A, 0x065F46),
        grad(0x7C3AED, 0x4C1D95), grad(0x0EA5E9, 0x075985), grad(0xDC2626, 0x7F1D1D),
    ]
    private static func grad(_ a: UInt32, _ b: UInt32) -> LinearGradient {
        LinearGradient(colors: [Color(hex: a), Color(hex: b)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Filter pill (cycles its value on tap — web Pill with ChevronDown)

private struct FilterPill: View {
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(label).font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.ink400)
            }
            .padding(.horizontal, 12).frame(height: 38)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

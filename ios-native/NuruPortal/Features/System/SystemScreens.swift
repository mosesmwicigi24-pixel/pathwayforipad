// System reference screens — Users, Congregations, Countries, Languages, Roles.
// All read views over the /admin/* reference endpoints.
import SwiftUI

struct UsersView: View {
    var body: some View {
        AsyncView(PortalAPI.users) { users in
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(users) { u in
                        Card {
                            HStack(spacing: 14) {
                                Monogram(name: u.fullName, size: 40)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(u.fullName).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                                    Text(u.email ?? u.phoneNumber).font(.nCaption).foregroundStyle(Nuru.muted)
                                    if !u.roleKeys.isEmpty {
                                        Text(u.roleKeys.joined(separator: ", ")).font(.nMicro).foregroundStyle(Nuru.gold)
                                    }
                                }
                                Spacer()
                                Pill(text: u.accountStatus.capitalized, color: statusColor(u.accountStatus))
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .portalPage("Users")
    }
    private func statusColor(_ s: String) -> Color {
        switch s { case "active": Nuru.success; case "invited": Nuru.warning; default: Nuru.danger }
    }
}

struct CongregationsView: View {
    var body: some View {
        AsyncView(PortalAPI.congregations) { items in
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(items) { c in
                        Card {
                            HStack(spacing: 14) {
                                Image(systemName: "building.columns").font(.fraunces(22, .semibold)).foregroundStyle(Nuru.navy)
                                    .frame(width: 40, height: 40).background(Nuru.navy.opacity(0.1))
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(c.name).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                                    Text("\(c.country) · \(c.timezone)").font(.nCaption).foregroundStyle(Nuru.muted)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text("\(c.cellCount) cells").font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                    Text("\(c.memberCount) members").font(.nMicro).foregroundStyle(Nuru.muted)
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .portalPage("Congregations")
    }
}

struct CountriesView: View {
    var body: some View {
        AsyncView(PortalAPI.countries) { items in
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(items) { c in
                        Card {
                            HStack(spacing: 14) {
                                Text(c.flag ?? "🏳️").font(.fraunces(26, .semibold))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(c.name).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                                    Text([c.region, c.dialCode, c.currency].compactMap { $0 }.joined(separator: " · "))
                                        .font(.nCaption).foregroundStyle(Nuru.muted)
                                }
                                Spacer()
                                Pill(text: c.status.capitalized, color: c.status == "active" ? Nuru.success : Nuru.muted)
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .portalPage("Countries")
    }
}

struct LanguagesView: View {
    var body: some View {
        AsyncView(PortalAPI.languages) { items in
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(items) { l in
                        Card {
                            HStack(spacing: 14) {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) {
                                        Text(l.name).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                                        if l.isDefault { Pill(text: "Default", color: Nuru.gold) }
                                    }
                                    Text("\(l.nativeName) · \(l.direction.uppercased())").font(.nCaption).foregroundStyle(Nuru.muted)
                                }
                                Spacer()
                                Text(String(format: "%.0f%%", l.coverage)).font(.inter(15, .bold)).foregroundStyle(Nuru.gold)
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .portalPage("Languages")
    }
}

struct RolesView: View {
    var body: some View {
        AsyncView(PortalAPI.roles) { items in
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(items) { r in
                        Card {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(r.name).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                                    Spacer()
                                    Pill(text: r.roleType.capitalized, color: Nuru.navy)
                                }
                                Text(r.description).font(.nCaption).foregroundStyle(Nuru.muted)
                                Text("\(r.userCount) users").font(.nMicro).foregroundStyle(Nuru.gold)
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .portalPage("Roles & Permissions")
    }
}

// Member detail — profile + enrollment + engagement, from /admin/members/{id}.
import SwiftUI

struct MemberDetailView: View {
    let userId: String
    let name: String   // shown immediately while detail loads

    var body: some View {
        AsyncView({ try await PortalAPI.memberDetail(userId) }) { m in
            ScrollView {
                VStack(spacing: 16) {
                    Card {
                        HStack(spacing: 14) {
                            Monogram(name: m.fullName, size: 56)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(m.fullName).font(.fraunces(22, .semibold)).foregroundStyle(Nuru.navy)
                                if let cell = m.cellName { Text(cell).font(.nBody).foregroundStyle(Nuru.muted) }
                                HStack(spacing: 8) {
                                    if let band = m.engagement.band { Pill(text: band.capitalized, color: Nuru.bandColor(band)) }
                                    if let s = m.engagement.eScore {
                                        Pill(text: "Score \(Int(s))", color: Nuru.gold)
                                    }
                                }
                            }
                            Spacer()
                        }
                    }

                    Card {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionTitle(text: "Enrollment")
                            InfoRow("Current level", m.enrollment.levelTitle ?? "Level \(m.enrollment.currentLevel)")
                            InfoRow("State", (m.enrollment.state ?? "—").capitalized)
                        }
                    }

                    Card {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionTitle(text: "Contact")
                            InfoRow("Phone", m.phoneNumber)
                            if let e = m.email { InfoRow("Email", e) }
                            if let c = m.city { InfoRow("City", c) }
                            if let l = m.language { InfoRow("Language", l) }
                            InfoRow("Joined", Fmt.date(m.createdAt))
                            InfoRow("Last active", Fmt.relative(m.lastActivity))
                        }
                    }
                }
                .padding(20)
            }
        }
        .portalPage(name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct InfoRow: View {
    let label: String, value: String
    init(_ label: String, _ value: String) { self.label = label; self.value = value }
    var body: some View {
        HStack {
            Text(label).font(.nBody).foregroundStyle(Nuru.muted)
            Spacer()
            Text(value).font(.inter(15, .medium)).foregroundStyle(Nuru.navy)
                .multilineTextAlignment(.trailing)
        }
    }
}

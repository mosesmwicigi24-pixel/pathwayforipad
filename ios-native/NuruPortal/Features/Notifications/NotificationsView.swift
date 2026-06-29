// Notifications — the admin notification feed, from /admin/notifications.
import SwiftUI

struct NotificationsView: View {
    var body: some View {
        AsyncView(PortalAPI.notifications) { items in
            if items.isEmpty {
                ContentUnavailableView("You're all caught up", systemImage: "bell",
                                       description: Text("No notifications right now."))
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(items) { n in
                            Card {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: icon(n.category))
                                        .foregroundStyle(color(n.category))
                                        .frame(width: 34, height: 34)
                                        .background(color(n.category).opacity(0.12))
                                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(n.title).font(.inter(15, n.read ? .medium : .bold))
                                            .foregroundStyle(Nuru.navy)
                                        if let m = n.message { Text(m).font(.nCaption).foregroundStyle(Nuru.muted) }
                                        Text(Fmt.relative(n.at)).font(.nMicro).foregroundStyle(Nuru.muted)
                                    }
                                    Spacer()
                                    if !n.read { Circle().fill(Nuru.gold).frame(width: 8, height: 8) }
                                }
                            }
                        }
                    }
                    .padding(20)
                }
            }
        }
        .portalPage("Notifications")
    }

    private func icon(_ c: String) -> String {
        switch c { case "success": "checkmark.circle"; case "warning": "exclamationmark.triangle"
        case "security": "lock.shield"; default: "info.circle" }
    }
    private func color(_ c: String) -> Color {
        switch c { case "success": Nuru.success; case "warning": Nuru.warning
        case "security": Nuru.danger; default: Nuru.navy }
    }
}

// Badges — the achievement catalog, from /admin/badges.
import SwiftUI

struct BadgesView: View {
    private let cols = [GridItem(.adaptive(minimum: 220), spacing: 14)]
    var body: some View {
        AsyncView(PortalAPI.badges) { badges in
            ScrollView {
                LazyVGrid(columns: cols, spacing: 14) {
                    ForEach(badges) { b in
                        Card {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Image(systemName: "rosette").font(.fraunces(26, .semibold)).foregroundStyle(Nuru.gold)
                                    Spacer()
                                    if b.isActive == false { Pill(text: "Retired", color: Nuru.muted) }
                                }
                                Text(b.name).font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
                                Text(b.description).font(.nCaption).foregroundStyle(Nuru.muted).lineLimit(3)
                                HStack {
                                    Pill(text: b.category.capitalized, color: Nuru.navy)
                                    Spacer()
                                    Text("\(b.earnedCount) earned").font(.nMicro).foregroundStyle(Nuru.muted)
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .portalPage("Badges")
    }
}

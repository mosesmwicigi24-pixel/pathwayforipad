// Events — upcoming calendar occurrences (next 60 days), from /calendar.
import SwiftUI

struct EventsView: View {
    var body: some View {
        AsyncView({
            let now = Date()
            let to = now.addingTimeInterval(60 * 24 * 3600)
            let iso = ISO8601DateFormatter()
            return try await PortalAPI.calendar(from: iso.string(from: now), to: iso.string(from: to))
        }) { events in
            if events.isEmpty {
                ContentUnavailableView("No upcoming events", systemImage: "calendar",
                                       description: Text("Nothing scheduled in the next 60 days."))
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(events.sorted { $0.startAt < $1.startAt }) { e in
                            Card {
                                HStack(spacing: 14) {
                                    VStack(spacing: 1) {
                                        Text(Fmt.date(e.startAt, style: .dateTime.month(.abbreviated)))
                                            .font(.inter(11.5, .bold)).foregroundStyle(Nuru.gold)
                                        Text(Fmt.date(e.startAt, style: .dateTime.day()))
                                            .font(.fraunces(22, .semibold)).foregroundStyle(Nuru.navy)
                                    }
                                    .frame(width: 48)
                                    Divider().frame(height: 36)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(e.title).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                                        Text(Fmt.date(e.startAt, style: .dateTime.weekday().hour().minute()))
                                            .font(.nCaption).foregroundStyle(Nuru.muted)
                                        if let loc = e.location {
                                            Label(loc, systemImage: "mappin.and.ellipse")
                                                .font(.nMicro).foregroundStyle(Nuru.muted)
                                        }
                                    }
                                    Spacer()
                                    Pill(text: e.visibility.capitalized, color: Nuru.navy)
                                }
                            }
                        }
                    }
                    .padding(20)
                }
            }
        }
        .portalPage("Events")
    }
}

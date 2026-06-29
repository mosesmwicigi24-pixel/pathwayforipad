// Reflection Queue — pending reflections awaiting review, from /admin/reflections.
import SwiftUI

struct ReflectionQueueView: View {
    var body: some View {
        AsyncView({ try await PortalAPI.reflections(state: "pending") }) { rows in
            if rows.isEmpty {
                ContentUnavailableView("All caught up", systemImage: "checkmark.seal",
                                       description: Text("No reflections are waiting for review."))
            } else {
                ScrollView {
                    VStack(spacing: 12) {
                        ForEach(rows) { r in
                            Card {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Monogram(name: r.fullName, size: 36)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(r.fullName).font(.subheadline.weight(.semibold)).foregroundStyle(Nuru.navy)
                                            Text("Level \(r.levelNumber) · \(r.moduleTitle)").font(.caption).foregroundStyle(Nuru.muted)
                                        }
                                        Spacer()
                                        if r.overdue { Pill(text: "Overdue", color: Nuru.danger) }
                                    }
                                    Text(r.body).font(.callout).foregroundStyle(Nuru.foreground)
                                        .lineLimit(4).padding(.top, 2)
                                    Text(Fmt.relative(r.submittedAt)).font(.caption2).foregroundStyle(Nuru.muted)
                                }
                            }
                        }
                    }
                    .padding(20)
                }
            }
        }
        .portalPage("Reflection Queue")
    }
}

// Services — create a service, and project its QR.
//
// Ported from packages/admin-web/src/components/pages/Services.tsx. The QR is
// the point of this screen: it goes on the wall, a member scans it to check in,
// and (backend #429) a visitor scans the same code to join. So the projection
// mode is a first-class view rather than a modal — it has to survive being left
// on a screen for an hour with a room looking at it.
import SwiftUI

struct ServicesView: View {
    @State private var services: [ChurchService] = []
    @State private var loading = true
    @State private var error: String?
    @State private var projecting: ChurchService?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if loading {
                    SkeletonList(rows: 4)
                } else if let error {
                    Card { Text(error).font(.system(size: 13)).foregroundStyle(Nuru.danger) }
                } else if services.isEmpty {
                    emptyState
                } else {
                    ForEach(services) { service in
                        serviceCard(service)
                    }
                }
            }
            .padding(20)
        }
        .background(Nuru.paper)
        .task { await load() }
        .sheet(item: $projecting) { ProjectQRView(service: $0) }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Services").font(.system(size: 24, weight: .semibold)).foregroundStyle(Nuru.navy)
            Text("Create a service, then project its code for members to scan.")
                .font(.system(size: 13)).foregroundStyle(Nuru.ink600)
        }
    }

    private var emptyState: some View {
        Card {
            VStack(spacing: 8) {
                Image(systemName: "qrcode").font(.system(size: 22)).foregroundStyle(Nuru.ink600.opacity(0.5))
                Text("No services yet").font(.system(size: 15, weight: .semibold)).foregroundStyle(Nuru.navy)
                Text("A service is what a QR code belongs to — members check in against it, and visitors join through it.")
                    .font(.system(size: 12.5)).foregroundStyle(Nuru.ink600)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
        }
    }

    private func serviceCard(_ s: ChurchService) -> some View {
        Card {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(s.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Nuru.navy)
                    Text(s.serviceDate).font(.system(size: 12.5)).foregroundStyle(Nuru.ink600)
                    HStack(spacing: 6) {
                        // Open vs closed is the whole safeguard on scan-to-join:
                        // a photographed code stops working when the window ends.
                        // Saying so here means nobody has to guess why a scan failed.
                        Pill(text: s.isOpenNow ? "Check-in open" : "Closed",
                             color: s.isOpenNow ? Nuru.success : Nuru.ink600)
                        if !s.countsForStreak {
                            Pill(text: "Not counted in streaks", color: Nuru.ink600)
                        }
                    }
                    .padding(.top, 2)
                }
                Spacer(minLength: 0)
                Button {
                    projecting = s
                } label: {
                    Label("Project QR", systemImage: "qrcode")
                        .font(.system(size: 12.5, weight: .semibold))
                }
                .buttonStyle(PressableButtonStyle())
                .disabled(!s.qrEnabled)
                .opacity(s.qrEnabled ? 1 : 0.4)
            }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            services = try await AttendanceAPI.services()
            error = nil
        } catch {
            // Honest failure: no fabricated list, and the reason stays on screen.
            self.error = "Couldn't load services. \(error.localizedDescription)"
        }
    }
}

/// The projection view. Deliberately austere — this is shown on a wall.
private struct ProjectQRView: View {
    let service: ChurchService
    @Environment(\.dismiss) private var dismiss
    @State private var payload: String?
    @State private var error: String?

    var body: some View {
        VStack(spacing: 18) {
            Text(service.title).font(.system(size: 22, weight: .semibold)).foregroundStyle(.white)
            if let payload, let image = QRRenderer.image(from: payload) {
                Image(decorative: image, scale: 1)
                    .interpolation(.none)          // a QR must never be smoothed
                    .resizable()
                    .frame(width: 420, height: 420)
                    .background(Color.white)
                    .padding(16)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                Text("Scan to check in — or to join, if this is your first time.")
                    .font(.system(size: 14)).foregroundStyle(.white.opacity(0.75))
            } else if let error {
                Text(error).font(.system(size: 14)).foregroundStyle(Nuru.danger)
            } else {
                ProgressView().tint(.white)
            }
            Button("Done") { dismiss() }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.8))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Nuru.navyDeep)
        .task {
            do { payload = try await AttendanceAPI.qr(serviceId: service.serviceId).payload }
            catch { self.error = "Couldn't fetch the code." }
        }
    }
}

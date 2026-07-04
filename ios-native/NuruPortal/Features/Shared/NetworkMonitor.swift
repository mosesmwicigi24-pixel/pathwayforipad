// Offline detection — one NWPathMonitor shared app-wide. Monitors on a
// background queue and publishes `online` on the main actor so views can
// react (offline strip in RootView, friendlier copy in ErrorBanner).
import Foundation
import Network

@MainActor
final class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()

    @Published private(set) var online: Bool = true

    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self, self.online != up else { return }
                self.online = up
            }
        }
        monitor.start(queue: DispatchQueue(label: "org.nuruplace.portal.network-monitor", qos: .utility))
    }
}

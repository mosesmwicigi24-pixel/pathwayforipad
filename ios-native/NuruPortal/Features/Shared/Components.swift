// Shared UI kit + async-loading primitives used across every screen, so each
// feature is a thin declaration over a consistent, polished base (loading /
// empty / error states, brand cards, badges, formatting).
import SwiftUI

// MARK: - Async loading

enum Loadable<T> {
    case idle, loading, loaded(T), failed(String)
}

@MainActor
final class Loader<T>: ObservableObject {
    @Published var state: Loadable<T> = .idle
    private let fetch: () async throws -> T
    init(_ fetch: @escaping () async throws -> T) { self.fetch = fetch }

    func load() async {
        if case .loaded = state {} else { state = .loading }
        do { state = .loaded(try await fetch()) }
        catch { state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription) }
    }
}

/// Drives a screen from a `Loader`: spinner → content → retryable error.
struct AsyncView<T, Content: View>: View {
    @StateObject private var loader: Loader<T>
    private let content: (T) -> Content

    init(_ fetch: @escaping () async throws -> T, @ViewBuilder content: @escaping (T) -> Content) {
        _loader = StateObject(wrappedValue: Loader(fetch))
        self.content = content
    }

    var body: some View {
        Group {
            switch loader.state {
            case .idle, .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded(let value):
                content(value)
            case .failed(let message):
                ScrollView { ErrorBanner(message: message) { Task { await loader.load() } }.padding() }
            }
        }
        .background(Nuru.background)
        .task { if case .idle = loader.state { await loader.load() } }
        .refreshable { await loader.load() }
    }
}

// MARK: - Building blocks

struct ErrorBanner: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle").font(.title2).foregroundStyle(Nuru.danger)
            Text(message).font(.footnote).foregroundStyle(Nuru.muted).multilineTextAlignment(.center)
            Button("Retry", action: retry).font(.footnote.weight(.semibold)).tint(Nuru.gold)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(Nuru.danger.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// White rounded card used for list rows and panels across the portal.
struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Nuru.border, lineWidth: 1))
    }
}

/// Small pill, optionally tinted — engagement bands, statuses, counts.
struct Pill: View {
    let text: String
    var color: Color = Nuru.muted
    var body: some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }
}

/// Leading monogram avatar from a name.
struct Monogram: View {
    let name: String
    var size: CGFloat = 42
    var fill: Color = Nuru.navy
    var body: some View {
        Circle().fill(fill).frame(width: size, height: size)
            .overlay(Text(initials(name)).font(.system(size: size * 0.34, weight: .bold)).foregroundStyle(.white))
    }
    private func initials(_ n: String) -> String {
        let p = n.split(separator: " ").prefix(2).compactMap { $0.first }
        return p.isEmpty ? "?" : String(p).uppercased()
    }
}

struct SectionTitle: View {
    let text: String
    var body: some View {
        Text(text).font(.title3.bold()).foregroundStyle(Nuru.navy)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Formatting

enum Fmt {
    static func money(minor: Int, currency: String?) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency ?? "USD"
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: Double(minor) / 100)) ?? "\(Double(minor) / 100)"
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain = ISO8601DateFormatter()

    static func date(_ s: String?, style: Date.FormatStyle = .dateTime.month().day().year()) -> String {
        guard let s else { return "—" }
        let d = iso.date(from: s) ?? isoPlain.date(from: s)
        return d.map { $0.formatted(style) } ?? "—"
    }
    static func relative(_ s: String?) -> String {
        guard let s, let d = iso.date(from: s) ?? isoPlain.date(from: s) else { return "—" }
        return d.formatted(.relative(presentation: .named))
    }
}

// MARK: - View helpers

extension View {
    /// Standard navy-titled page chrome shared by every detail screen.
    func portalPage(_ title: String) -> some View {
        self.navigationTitle(title)
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(.visible, for: .navigationBar)
            .background(Nuru.background)
    }
}

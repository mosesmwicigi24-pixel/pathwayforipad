// Shared UI kit + async-loading primitives. Every feature is a thin declaration
// over these, so the whole app shares one polished, consistent design language.
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

/// Drives a screen from a `Loader`: branded loader → content → retryable error.
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
                LoadingState()
            case .loaded(let value):
                content(value)
            case .failed(let message):
                ScrollView { ErrorBanner(message: message) { Task { await loader.load() } }.padding(24) }
            }
        }
        .background(Nuru.background)
        .task { if case .idle = loader.state { await loader.load() } }
        .refreshable { await loader.load() }
    }
}

/// Calm, branded loading state (pulsing mark) — replaces a bare spinner.
struct LoadingState: View {
    @State private var pulse = false
    var body: some View {
        VStack(spacing: 14) {
            BrandMark(size: 46)
                .scaleEffect(pulse ? 1.06 : 0.94)
                .opacity(pulse ? 1 : 0.7)
                .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulse)
            Text("Loading…").font(.footnote).foregroundStyle(Nuru.faint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { pulse = true }
    }
}

// MARK: - Building blocks

struct ErrorBanner: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(Nuru.danger.opacity(0.1)).frame(width: 56, height: 56)
                Image(systemName: "exclamationmark.triangle.fill").font(.title2).foregroundStyle(Nuru.danger)
            }
            Text("Something went wrong").font(.headline).foregroundStyle(Nuru.foreground)
            Text(message).font(.subheadline).foregroundStyle(Nuru.muted).multilineTextAlignment(.center)
            Button(action: retry) {
                Text("Try again").fontWeight(.semibold)
                    .padding(.horizontal, 22).padding(.vertical, 11)
                    .background(Nuru.goldGradient).foregroundStyle(.white)
                    .clipShape(Capsule())
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: 420)
        .padding(28)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .nuruShadow()
        .frame(maxWidth: .infinity)
    }
}

/// Elevated white card — the workhorse surface for rows and panels.
struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Nuru.border.opacity(0.7), lineWidth: 1))
            .nuruShadow(0.8)
    }
}

/// Rounded tinted icon chip — adds color + depth to leading glyphs.
struct TintedIcon: View {
    let systemName: String
    var color: Color = Nuru.gold
    var size: CGFloat = 44
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(color.opacity(0.14))
            Image(systemName: systemName)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(color)
        }
        .frame(width: size, height: size)
    }
}

/// Small status pill.
struct Pill: View {
    let text: String
    var color: Color = Nuru.muted
    var filled: Bool = false
    var body: some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .foregroundStyle(filled ? .white : color)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(filled ? AnyShapeStyle(color) : AnyShapeStyle(color.opacity(0.13)))
            .clipShape(Capsule())
    }
}

/// Leading monogram avatar from a name, on a gradient.
struct Monogram: View {
    let name: String
    var size: CGFloat = 44
    var gradient: LinearGradient = Nuru.navyGradient
    var body: some View {
        Circle().fill(gradient).frame(width: size, height: size)
            .overlay(Text(initials(name)).font(.system(size: size * 0.36, weight: .bold)).foregroundStyle(.white))
            .nuruShadow(0.4)
    }
    private func initials(_ n: String) -> String {
        let p = n.split(separator: " ").prefix(2).compactMap { $0.first }
        return p.isEmpty ? "?" : String(p).uppercased()
    }
}

struct SectionTitle: View {
    let text: String
    var action: (() -> Void)?
    var actionLabel: String?
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text).font(.nuruDisplay(21)).foregroundStyle(Nuru.navy)
            Spacer()
            if let action, let actionLabel {
                Button(actionLabel, action: action).font(.caption.weight(.semibold)).tint(Nuru.gold)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A KPI / stat tile with a gradient icon chip and serif numeral.
struct StatCard: View {
    let label: String
    let value: String
    let icon: String
    var color: Color = Nuru.gold
    var caption: String? = nil
    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Nuru.tintGradient(color))
                    Image(systemName: icon).font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                }
                .frame(width: 42, height: 42)
                .nuruShadow(0.5)
                Text(value).font(.nuruDisplay(30)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.6)
                Text(label).font(.footnote.weight(.medium)).foregroundStyle(Nuru.muted)
                if let caption { Text(caption).font(.caption2).foregroundStyle(Nuru.faint) }
            }
        }
    }
}

/// Navy gradient hero header used at the top of feature pages.
struct HeroHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing
    var body: some View {
        ZStack(alignment: .topTrailing) {
            // subtle gold glow
            Circle().fill(Nuru.gold.opacity(0.18)).frame(width: 220, height: 220)
                .blur(radius: 60).offset(x: 70, y: -90)
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(.nuruDisplay(30)).foregroundStyle(.white)
                    if let subtitle {
                        Text(subtitle).font(.subheadline).foregroundStyle(.white.opacity(0.72))
                    }
                }
                Spacer()
                trailing
            }
            .padding(.horizontal, 22).padding(.vertical, 22)
        }
        .background(Nuru.navyGradient)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .nuruShadow()
    }
}
extension HeroHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
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

// MARK: - Page chrome

extension View {
    /// Standard page background + large serif nav title (configured app-wide in
    /// NuruPortalApp via UINavigationBarAppearance).
    func portalPage(_ title: String) -> some View {
        self.navigationTitle(title)
            .navigationBarTitleDisplayMode(.large)
            .background(Nuru.background)
    }
}

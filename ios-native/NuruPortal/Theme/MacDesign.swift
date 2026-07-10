// Mac design kit (feat/macbook-version) — desktop composition for the Catalyst
// build. On a 14"/16" MacBook the iPad's single-column card stacks stretch
// edge-to-edge and read as toy-like; Apple's macOS HIG answer is (1) readable
// content columns, (2) multi-column composition that USES the width, and
// (3) slightly denser chrome. Every helper here is a no-op on iPhone/iPad, so
// the iOS layouts are byte-identical.
import SwiftUI

enum MacDesign {
    /// True only in the Mac Catalyst build (compile-time, not size-class).
    static var isMac: Bool {
        #if targetEnvironment(macCatalyst)
        true
        #else
        false
        #endif
    }

    /// Readable max width for a single content column on desktop — for
    /// text/forms/detail pages. CONSOLES and DASHBOARDS should NOT use this:
    /// they compose in lanes and take the width (`workspaceMaxWidth`).
    static let contentMaxWidth: CGFloat = 1280
    /// Workspace pages (consoles, dashboards, analytics) fill the window up to
    /// an ultra-wide sanity cap, with page margins.
    static let workspaceMaxWidth: CGFloat = 1900
    /// Desktop gutter between columns.
    static let gutter: CGFloat = 20
    /// Desktop page margins (Catalyst windows have no safe-area insets).
    static let pageMargin: CGFloat = 28
    /// Minimum sensible window for the console (enforced at scene connect).
    static let minWindow = CGSize(width: 1080, height: 720)
    /// Comfortable default window on first launch — roomy enough for the
    /// dashboard's full three-lane composition (clamped to the visible screen).
    static let preferredWindow = CGSize(width: 1560, height: 980)
}

// MARK: - Width measurement

extension View {
    /// Measure this view's laid-out width into a binding via a *background*
    /// GeometryReader — safe inside vertical ScrollViews, where wrapping the
    /// content in a GeometryReader would collapse its height. Drives the Mac
    /// responsive breakpoints (dashboard lanes, `MacLanes` splits).
    func measureWidth(_ width: Binding<CGFloat>) -> some View {
        background {
            GeometryReader { geo in
                Color.clear
                    .onAppear { width.wrappedValue = geo.size.width }
                    .onChange(of: geo.size.width) { _, w in width.wrappedValue = w }
            }
        }
    }
}

// MARK: - Content column

/// Center the page content in a readable desktop column. Apply to the CONTENT
/// of a ScrollView (not the ScrollView itself) so the scroll gutter stays at
/// the window edge like every native Mac app.
private struct MacContentColumn: ViewModifier {
    let maxWidth: CGFloat
    func body(content: Content) -> some View {
        if MacDesign.isMac {
            content
                .frame(maxWidth: maxWidth)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, MacDesign.pageMargin)
        } else {
            content
        }
    }
}

extension View {
    /// Desktop: constrain to a centered readable column. iPhone/iPad: unchanged.
    func macContentColumn(_ maxWidth: CGFloat = MacDesign.contentMaxWidth) -> some View {
        modifier(MacContentColumn(maxWidth: maxWidth))
    }
}

// MARK: - Adaptive columns

/// Adaptive card grid: on the Mac, cards flow into as many columns as fit
/// (each at least `minWidth`); elsewhere the iPad/iPhone layout is unchanged
/// (single column unless the caller already grids).
struct MacGrid<Content: View>: View {
    var minWidth: CGFloat
    var spacing: CGFloat
    @ViewBuilder var content: Content

    init(minWidth: CGFloat = 340, spacing: CGFloat = MacDesign.gutter, @ViewBuilder content: () -> Content) {
        self.minWidth = minWidth
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        if MacDesign.isMac {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: minWidth), spacing: spacing, alignment: .top)],
                      alignment: .leading, spacing: spacing) {
                content
            }
        } else {
            content
        }
    }
}

// MARK: - Window sizing

enum MacWindow {
    /// Enforce a desktop-worthy minimum window (call from RootView.onAppear).
    /// Catalyst defaults allow comically small windows that break console
    /// layouts; native Mac apps declare their floor.
    static func enforceMinimumSize() {
        #if targetEnvironment(macCatalyst)
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            windowScene.sizeRestrictions?.minimumSize = MacDesign.minWindow
        }
        #endif
    }

    /// One-time comfortable default frame (call right after `enforceMinimumSize`).
    /// Catalyst's default window is barely wider than the 1080 floor, which lands
    /// every fresh install in the dashboard's compressed modes. Request a
    /// desktop-worthy centered frame ONCE per install (UserDefaults flag) —
    /// afterwards macOS state restoration owns the frame, so we never fight the
    /// user's own resizing.
    static func applyPreferredSize() {
        #if targetEnvironment(macCatalyst)
        let appliedKey = "mac.window.defaultApplied"
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: appliedKey) else { return }
        guard #available(macCatalyst 16.0, *) else { return } // requestGeometryUpdate(.Mac)
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first else { return } // no scene yet — retry next launch
        defaults.set(true, forKey: appliedKey)
        // Already comfortable (e.g. frame restored from a previous install) — leave it.
        guard windowScene.effectiveGeometry.systemFrame.width < MacDesign.preferredWindow.width - 60 else { return }
        windowScene.requestGeometryUpdate(.Mac(systemFrame: preferredFrame(for: windowScene)))
        #endif
    }

    #if targetEnvironment(macCatalyst)
    /// Centered ~1560×980 frame, clamped to the screen's *visible* area (menu
    /// bar and Dock excluded). NSScreen isn't importable from Catalyst code, but
    /// AppKit lives in every Catalyst process — reach it via KVC. Fallback:
    /// grow in place (the window server keeps windows on-screen).
    @available(macCatalyst 16.0, *)
    private static func preferredFrame(for windowScene: UIWindowScene) -> CGRect {
        let target = MacDesign.preferredWindow
        if let screenClass = NSClassFromString("NSScreen") as AnyObject?,
           let screen = screenClass.value(forKey: "mainScreen") as? NSObject,
           let visible = (screen.value(forKey: "visibleFrame") as? NSValue)?.cgRectValue,
           let full = (screen.value(forKey: "frame") as? NSValue)?.cgRectValue,
           visible.width > 0, visible.height > 0 {
            let size = CGSize(width: min(target.width, visible.width),
                              height: min(target.height, visible.height))
            // Center in the visible area, then flip Cocoa's bottom-left origin
            // into the top-left-origin space `.Mac(systemFrame:)` expects.
            let x = visible.midX - size.width / 2
            let cocoaY = visible.midY - size.height / 2
            return CGRect(x: x, y: full.maxY - (cocoaY + size.height),
                          width: size.width, height: size.height)
        }
        return CGRect(origin: windowScene.effectiveGeometry.systemFrame.origin, size: target)
    }
    #endif
}

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

    /// Readable max width for a single content column on desktop. Wider than a
    /// text column (tables/consoles need room) but never wall-to-wall.
    static let contentMaxWidth: CGFloat = 1280
    /// Desktop gutter between columns.
    static let gutter: CGFloat = 20
    /// Desktop page margins (Catalyst windows have no safe-area insets).
    static let pageMargin: CGFloat = 28
    /// Minimum sensible window for the console (enforced at scene connect).
    static let minWindow = CGSize(width: 1080, height: 720)
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
}

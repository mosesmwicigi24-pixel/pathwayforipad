// Nuru Pathway design system — a Swift port of the mobile app's tokens
// (packages/mobile/src/theme/tokens.ts), so the iPad app shares the exact visual
// language: warm paper, white cards that float on one soft shadow, gold used with
// restraint, Fraunces serif display + Inter body. Tuned up for the iPad canvas.
import SwiftUI
import CoreText

enum Nuru {
    // MARK: Surfaces
    static let paper    = Color(hex: 0xF6F4EE)
    static let white    = Color(hex: 0xFFFFFF)
    static let surface  = Color(hex: 0xFBF8F1)   // inset tiles inside cards
    static let coolPaper = Color(hex: 0xF7F9FC)
    static let background = paper                // alias used widely

    // MARK: Navy
    static let navy      = Color(hex: 0x0B1F33)
    static let navyDeep  = Color(hex: 0x00132F)
    static let navy700   = Color(hex: 0x143559)
    static let navyMid   = Color(hex: 0x315F8C)
    static let navyCeremony = Color(hex: 0x081C36)
    static let dark      = navyDeep

    // MARK: Gold
    static let gold      = Color(hex: 0xC89B3C)
    static let goldHi    = Color(hex: 0xE0B85E)
    static let goldLo    = Color(hex: 0xA87F2E)
    static let goldGlow  = Color(hex: 0xE6CA68)
    static let goldLight = Color(hex: 0xE6C068)
    static let goldTint  = Color(hex: 0xFFF4C7)
    static let goldChipBg   = Color(hex: 0xFFF4DA)
    static let goldChipText = Color(hex: 0x7A5A14)

    // MARK: Ink (text)
    static let ink     = Color(hex: 0x0B0B0C)
    static let ink600  = Color(hex: 0x68758A)
    static let ink400  = Color(hex: 0x8B95A5)
    static let ink300  = Color(hex: 0xB5BDC9)
    // semantic aliases kept for existing call sites
    static let foreground = ink
    static let muted   = ink600
    static let faint   = ink400
    static let border  = Color(hex: 0x0A2540, alpha: 0.10)
    static let track   = Color(hex: 0x0A2540, alpha: 0.10)
    static let inputBg = Color(hex: 0xEEF1F5)
    static let mutedBg = Color(hex: 0xEEF1F5)
    static let tintBlue = Color(hex: 0xE8EEF7)

    // MARK: Status
    static let success = Color(hex: 0x1E7F4F)
    static let warning = Color(hex: 0xB45309)
    static let danger  = Color(hex: 0xD4183D)
    static let info    = Color(hex: 0x1B5FAE)
    static let successBg = Color(hex: 0xDCFCE7)
    static let successText = Color(hex: 0x166534)
    static let verseBg  = Color(hex: 0xFFF8E6)
    static let urgentBg = Color(hex: 0xFFF8DD)
    static let urgentText = Color(hex: 0x8A6B10)
    static let activeBadgeBg = Color(hex: 0xDDF4C6)
    static let activeBadgeText = Color(hex: 0x22612A)
    static let teal = success

    // On-navy
    static let onNavyDim   = Color.white.opacity(0.55)
    static let onNavyFaint = Color.white.opacity(0.40)

    // MARK: Luminous accents (shiny brand set — for notifications & status color-coding).
    // Brighter than the deep status colors; used where we want vivid, "shiny" chips.
    static let lumGreen = Color(hex: 0x22C55E)   // thriving, luminous LED/lime green (bright)
    static let lumGreenHi = Color(hex: 0x3BE066) // even brighter lime, for glows/accents on dark
    static let lumGold  = Color(hex: 0xE0B85E)   // gold, luminous (== goldHi)
    static let lumAmber = Color(hex: 0xE08A1E)   // watch, luminous
    static let lumRed   = Color(hex: 0xF0405F)   // at-risk, luminous
    static let lumNavy  = Color(hex: 0x1D4E86)   // brand navy-blue, luminous (NOT the off-brand 0x1B5FAE)
    static func lumTint(_ c: Color) -> Color { c.opacity(0.14) }

    // MARK: Gradients
    static let navyGradient = LinearGradient(
        colors: [navy700, navy, Color(hex: 0x07203A)],
        startPoint: .topLeading, endPoint: .bottomTrailing)
    /// Deeper navy for the app sidebar (richer, darker than the hero/top-bar gradient).
    static let sidebarGradient = LinearGradient(
        colors: [Color(hex: 0x081C36), navyDeep, Color(hex: 0x00091A)],
        startPoint: .top, endPoint: .bottom)
    /// Brand accent pairs WITHOUT blue — for categorisation where decorative blue must go.
    static let brandTints: [Tint] = [
        Tint(bg: Color(hex: 0xDCFCE7), fg: Color(hex: 0x166534)),   // green
        Tint(bg: Color(hex: 0xFBF1DC), fg: Color(hex: 0x8A6B1F)),   // gold
        Tint(bg: Color(hex: 0xE3EAF3), fg: Color(hex: 0x1D4E86)),   // brand navy (not off-brand blue)
        Tint(bg: Color(hex: 0xFCEFD9), fg: Color(hex: 0xB45309)),   // amber
    ]
    static func brandTint(_ i: Int) -> Tint { brandTints[((i % brandTints.count) + brandTints.count) % brandTints.count] }
    static let heroGradient = LinearGradient(
        colors: [Color(hex: 0x1A406B), navy, navyDeep],
        startPoint: .topLeading, endPoint: .bottomTrailing)
    static let goldGradient = LinearGradient(
        colors: [Color(hex: 0xE5BC3A), Color(hex: 0xC9A227), Color(hex: 0xA8861C)],
        startPoint: .top, endPoint: .bottom)
    static func tintGradient(_ c: Color) -> LinearGradient {
        LinearGradient(colors: [c.opacity(0.92), c], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    // MARK: Pastel accent set (categorisation)
    struct Tint { let bg: Color; let fg: Color }
    static let tints: [Tint] = [
        Tint(bg: Color(hex: 0xFBF1DC), fg: Color(hex: 0x8A6B1F)),
        Tint(bg: Color(hex: 0xE8EEF7), fg: Color(hex: 0x1B5FAE)),
        Tint(bg: Color(hex: 0xDCFCE7), fg: Color(hex: 0x166534)),
        Tint(bg: Color(hex: 0xF1EBFB), fg: Color(hex: 0x5B2BB8)),
        Tint(bg: Color(hex: 0xFBEBF2), fg: Color(hex: 0xA8246B)),
    ]
    static func tint(_ i: Int) -> Tint { tints[((i % tints.count) + tints.count) % tints.count] }

    /// Engagement band → color (harmonised with the mobile palette).
    static func bandColor(_ band: String?) -> Color {
        switch band?.lowercased() {
        case "thriving", "high":          return Color(hex: 0x1E7F4F)
        case "steady", "medium":          return Color(hex: 0x1B5FAE)
        case "watch":                     return Color(hex: 0xB45309)
        case "at_risk", "at risk", "low": return Color(hex: 0xD4183D)
        default:                          return ink600
        }
    }

    // MARK: Radii / spacing (8pt grid)
    enum R {
        static let xs: CGFloat = 8, chip: CGFloat = 10, badge: CGFloat = 11, tile: CGFloat = 12
        static let control: CGFloat = 14, button: CGFloat = 14, panel: CGFloat = 16
        static let card: CGFloat = 22, xl: CGFloat = 24, hero: CGFloat = 28, pill: CGFloat = 999
    }
    enum S { static let xs: CGFloat = 4, sm: CGFloat = 8, md: CGFloat = 12, base: CGFloat = 16, screen: CGFloat = 22, lg: CGFloat = 24, xl: CGFloat = 32, xxl: CGFloat = 48 }

    // MARK: Fonts — register the bundled OFL faces (Inter + Fraunces).
    static func registerFonts() {
        let faces = ["Inter-Regular", "Inter-Medium", "Inter-SemiBold", "Inter-Bold",
                     "Fraunces-Regular", "Fraunces-Medium", "Fraunces-SemiBold", "Fraunces-Bold"]
        for f in faces {
            if let url = Bundle.main.url(forResource: f, withExtension: "ttf") {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red:   Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue:  Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }
}

// MARK: - Typography (Inter body · Fraunces display), iPad-tuned

// Mac Catalyst renders the iPad point sizes ~77%-scaled, which reads small on
// a 14"/16" panel at desk distance. One global bump here (every font funnels
// through this block) sizes type for the Mac; iPhone/iPad are untouched (×1).
private let macTypeScale: CGFloat = {
    #if targetEnvironment(macCatalyst)
    1.08
    #else
    1.0
    #endif
}()

extension Font {
    // Raw helpers scale with the user's Dynamic Type setting via `relativeTo:
    // .body` — at the default text size this renders pixel-identical to a fixed
    // size, and at larger/smaller settings every call site scales proportionally.
    static func inter(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom(interFace(weight), size: size * macTypeScale, relativeTo: .body)
    }
    static func fraunces(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .custom(frauncesFace(weight), size: size * macTypeScale, relativeTo: .body)
    }
    /// Display serif (Fraunces). Back-compat name retained.
    static func nuruDisplay(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .custom(frauncesFace(weight), size: size * macTypeScale, relativeTo: .body)
    }

    // Semantic scale (mobile type scale, bumped for iPad). These scale with the
    // user's Dynamic Type setting via `relativeTo:` mapped to their natural
    // text style (the raw helpers above scale relative to `.body`).
    static var nDisplay: Font  { .custom(frauncesFace(.medium), size: 33 * macTypeScale, relativeTo: .largeTitle) }
    static var nTitle: Font    { .custom(frauncesFace(.semibold), size: 24 * macTypeScale, relativeTo: .title2) }
    static var nHeading: Font  { .custom(interFace(.semibold), size: 17 * macTypeScale, relativeTo: .headline) }
    static var nBody: Font     { .custom(interFace(.regular), size: 15 * macTypeScale, relativeTo: .body) }
    static var nBodyLg: Font   { .custom(interFace(.regular), size: 17 * macTypeScale, relativeTo: .body) }
    static var nLabel: Font    { .custom(interFace(.medium), size: 13 * macTypeScale, relativeTo: .subheadline) }
    static var nCaption: Font  { .custom(interFace(.regular), size: 13 * macTypeScale, relativeTo: .caption) }
    static var nMicro: Font    { .custom(interFace(.medium), size: 11.5 * macTypeScale, relativeTo: .caption2) }
    static var nOverline: Font { .custom(interFace(.semibold), size: 11.5 * macTypeScale, relativeTo: .caption2) }
}

private func interFace(_ w: Font.Weight) -> String {
    switch w { case .bold, .heavy, .black: return "Inter-Bold"
    case .semibold: return "Inter-SemiBold"
    case .medium: return "Inter-Medium"
    default: return "Inter-Regular" }
}
// Display/headers now use clean Inter (sans) instead of the Fraunces serif — a
// uniform, modern sans across the whole app. Display defaults to SemiBold for
// presence; `.bold` maps to Inter-Bold. (`fraunces(...)`/`nuruDisplay(...)` call
// sites are unchanged; they just render in Inter now.)
private func frauncesFace(_ w: Font.Weight) -> String {
    switch w {
    case .bold, .heavy, .black: return "Inter-Bold"
    case .semibold:             return "Inter-SemiBold"
    case .medium:               return "Inter-SemiBold"
    default:                    return "Inter-SemiBold"
    }
}

// MARK: - Depth (one soft shadow — never stack)

extension View {
    func nuruShadow(_ strength: Double = 1) -> some View {
        shadow(color: Color(hex: 0x0A2540).opacity(0.07 * strength), radius: 12 * strength, x: 0, y: 6 * strength)
    }
}

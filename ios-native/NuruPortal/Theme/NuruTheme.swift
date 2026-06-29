// Nuru Pathway design system. A warm navy-and-gold language with real depth:
// layered surfaces, gradients, soft shadows, an elegant serif display face
// (New York) over refined SF text, and a pastel accent set for categorisation.
import SwiftUI

enum Nuru {
    // MARK: Brand
    static let navy      = Color(hex: 0x0B1F33)
    static let navy2     = Color(hex: 0x102A45)   // lifted navy (gradient stop)
    static let dark      = Color(hex: 0x071629)
    static let gold      = Color(hex: 0xC89B3C)
    static let goldLight = Color(hex: 0xE3C173)
    static let teal      = Color(hex: 0x16A34A)

    // MARK: Surfaces
    static let background = Color(hex: 0xF4F1E9)   // warm cream
    static let surface    = Color(hex: 0xFFFFFF)
    static let surfaceAlt  = Color(hex: 0xFBF8F1)
    static let border     = Color(hex: 0xE7E3D8)
    static let inputBg    = Color(hex: 0xF3F1EA)

    // MARK: Text
    static let foreground = Color(hex: 0x14202E)
    static let muted      = Color(hex: 0x6B7280)
    static let faint      = Color(hex: 0x9AA1AC)

    // MARK: Status
    static let danger  = Color(hex: 0xDC2626)
    static let warning = Color(hex: 0xE08A1E)
    static let success = Color(hex: 0x16A34A)
    static let info    = Color(hex: 0x2563EB)

    // MARK: Gradients
    static let navyGradient = LinearGradient(
        colors: [Color(hex: 0x102A45), Color(hex: 0x0B1F33), Color(hex: 0x081626)],
        startPoint: .topLeading, endPoint: .bottomTrailing)
    static let goldGradient = LinearGradient(
        colors: [Color(hex: 0xE3C173), Color(hex: 0xC89B3C)],
        startPoint: .topLeading, endPoint: .bottomTrailing)
    static func tintGradient(_ c: Color) -> LinearGradient {
        LinearGradient(colors: [c.opacity(0.9), c], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    // MARK: Pastel accents (cards / category chips) — bg + foreground pairs
    struct Tint { let bg: Color; let fg: Color }
    static let tints: [Tint] = [
        Tint(bg: Color(hex: 0xFBF1DC), fg: Color(hex: 0x8A6B1F)), // amber
        Tint(bg: Color(hex: 0xEAF0FB), fg: Color(hex: 0x1F3A6B)), // blue
        Tint(bg: Color(hex: 0xE7F6EE), fg: Color(hex: 0x0F6B33)), // green
        Tint(bg: Color(hex: 0xF1EBFB), fg: Color(hex: 0x5B2BB8)), // violet
        Tint(bg: Color(hex: 0xFBEBF2), fg: Color(hex: 0xA8246B)), // rose
    ]
    static func tint(_ i: Int) -> Tint { tints[((i % tints.count) + tints.count) % tints.count] }

    /// Engagement band → semantic color.
    static func bandColor(_ band: String?) -> Color {
        switch band?.lowercased() {
        case "thriving", "high":            return success
        case "steady", "medium":            return gold
        case "at_risk", "at risk", "low":   return danger
        default:                            return muted
        }
    }
}

// MARK: - Color hex

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red:   Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue:  Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }
}

// MARK: - Typography (New York serif display + SF text)

extension Font {
    /// Elegant serif display face (New York), the native analogue of DM Serif Display.
    static func nuruDisplay(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
}

// MARK: - Depth

extension View {
    /// Soft, brand-tinted elevation for cards.
    func nuruShadow(_ strength: Double = 1) -> some View {
        self
            .shadow(color: Nuru.navy.opacity(0.06 * strength), radius: 14 * strength, x: 0, y: 8 * strength)
            .shadow(color: Nuru.navy.opacity(0.04 * strength), radius: 2, x: 0, y: 1)
    }
}

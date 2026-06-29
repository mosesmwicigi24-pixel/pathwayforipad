// Nuru Pathway design tokens, ported from the web portal's index.css so the
// native SwiftUI app matches the "Final Pathway Portal" look (navy + gold).
import SwiftUI

enum Nuru {
    // Brand
    static let navy   = Color(hex: 0x0B1F33)
    static let dark   = Color(hex: 0x071629)
    static let gold   = Color(hex: 0xC89B3C)
    static let teal   = Color(hex: 0x16A34A)

    // Surfaces
    static let background = Color(hex: 0xF6F4EE)
    static let card       = Color(hex: 0xFBF8F1)
    static let border     = Color(hex: 0xE5E7EB)
    static let inputBg    = Color(hex: 0xF3F4F6)

    // Text
    static let foreground = Color(hex: 0x111827)
    static let muted      = Color(hex: 0x6B7280)

    // Status
    static let danger  = Color(hex: 0xDC2626)
    static let warning = Color(hex: 0xF59E0B)
    static let success = Color(hex: 0x16A34A)

    // Engagement bands → colors (mirrors the web portal palette)
    static func bandColor(_ band: String?) -> Color {
        switch band?.lowercased() {
        case "thriving", "high":     return success
        case "steady", "medium":     return gold
        case "at_risk", "at risk", "low": return danger
        default:                     return muted
        }
    }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red:   Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue:  Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

extension Font {
    /// Serif display face (DM Serif Display in the web app; system serif here so
    /// we don't need to bundle a font for the first build).
    static func nuruDisplay(_ size: CGFloat) -> Font { .system(size: size, weight: .regular, design: .serif) }
}

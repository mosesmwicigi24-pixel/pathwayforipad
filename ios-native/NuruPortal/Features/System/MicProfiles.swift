// MicProfiles — friendly BRAND naming for USB-C / USB mics in the Radio Studio.
//
// AVAudioSession reports a USB audio input's `portName` straight from the device's
// USB product string, which is often terse or cryptic ("USB Audio", "Digital Audio
// Interface", "Wireless GO II RX", "P020"). This table maps the real market of
// content-creator / podcast / broadcast mics to a clean, human display name so the
// Audio Source card reads "RØDE Wireless GO II" instead of a raw port string — while
// the underlying isUSB detection + USB auto-prefer stay byte-for-byte unchanged
// (this layer only rewrites the *label*, never the routing).
//
// Matching is a case-insensitive substring scan against the raw name. The most
// specific model substrings are listed first so "wireless go ii" wins over the bare
// "rode" brand fallback. No match → the raw name is returned verbatim (never blank).
import Foundation

enum MicProfiles {

    /// One known-device rule: if `match` (lowercased) appears anywhere in the raw
    /// input name, present it as `display` under `brand`, with an SF Symbol `glyph`.
    struct Profile {
        let match: String        // lowercased substring probed against the raw name
        let display: String      // friendly, on-brand label shown to the operator
        let brand: String        // manufacturer (for grouping / a possible badge)
        let glyph: String        // SF Symbol hint (falls back to a mic icon)
    }

    /// Ordered most-specific → least-specific. Model rules precede their brand
    /// fallback so e.g. "Wireless GO II" beats the generic "RØDE".
    static let profiles: [Profile] = [
        // ── Hollyland — wireless lavalier systems, huge in the creator market ──
        Profile(match: "lark max",       display: "Hollyland Lark Max",        brand: "Hollyland", glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "lark m2",        display: "Hollyland Lark M2",         brand: "Hollyland", glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "lark m1",        display: "Hollyland Lark M1",         brand: "Hollyland", glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "lark",           display: "Hollyland Lark",            brand: "Hollyland", glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "hollyland",      display: "Hollyland Mic",             brand: "Hollyland", glyph: "dot.radiowaves.left.and.right"),

        // ── Zoom — handheld recorders + PodTrak interfaces ──
        Profile(match: "podtrak p4",     display: "Zoom PodTrak P4",           brand: "Zoom",      glyph: "waveform"),
        Profile(match: "podtrak p8",     display: "Zoom PodTrak P8",           brand: "Zoom",      glyph: "waveform"),
        Profile(match: "podtrak",        display: "Zoom PodTrak",              brand: "Zoom",      glyph: "waveform"),
        Profile(match: "h1n",            display: "Zoom H1n",                  brand: "Zoom",      glyph: "waveform"),
        Profile(match: "h1 essential",   display: "Zoom H1essential",          brand: "Zoom",      glyph: "waveform"),
        Profile(match: "h4n",            display: "Zoom H4n",                  brand: "Zoom",      glyph: "waveform"),
        Profile(match: "h5",             display: "Zoom H5",                   brand: "Zoom",      glyph: "waveform"),
        Profile(match: "h6",             display: "Zoom H6",                   brand: "Zoom",      glyph: "waveform"),
        Profile(match: "zoom",           display: "Zoom Recorder",             brand: "Zoom",      glyph: "waveform"),

        // ── RØDE / Rode — wireless, USB condensers, VideoMic, RØDECaster ──
        Profile(match: "rodecaster",     display: "RØDECaster",                brand: "RØDE",      glyph: "slider.horizontal.3"),
        Profile(match: "wireless go ii", display: "RØDE Wireless GO II",       brand: "RØDE",      glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "wireless go",    display: "RØDE Wireless GO",          brand: "RØDE",      glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "wireless me",    display: "RØDE Wireless ME",          brand: "RØDE",      glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "nt-usb",         display: "RØDE NT-USB",               brand: "RØDE",      glyph: "mic.fill"),
        Profile(match: "podmic",         display: "RØDE PodMic",               brand: "RØDE",      glyph: "mic.fill"),
        Profile(match: "videomic",       display: "RØDE VideoMic",             brand: "RØDE",      glyph: "mic.fill"),
        Profile(match: "rode",           display: "RØDE Mic",                  brand: "RØDE",      glyph: "mic.fill"),
        Profile(match: "røde",           display: "RØDE Mic",                  brand: "RØDE",      glyph: "mic.fill"),

        // ── Shure — MV7 broadcast dynamic, MVX2U interface, MV88 ──
        Profile(match: "mv7+",           display: "Shure MV7+",                brand: "Shure",     glyph: "mic.fill"),
        Profile(match: "mv7",            display: "Shure MV7",                 brand: "Shure",     glyph: "mic.fill"),
        Profile(match: "mvx2u",          display: "Shure MVX2U",               brand: "Shure",     glyph: "mic.fill"),
        Profile(match: "mv88",           display: "Shure MV88",                brand: "Shure",     glyph: "mic.fill"),
        Profile(match: "shure",          display: "Shure Mic",                 brand: "Shure",     glyph: "mic.fill"),

        // ── Elgato — Wave:3 USB condenser, Wave XLR interface ──
        Profile(match: "wave xlr",       display: "Elgato Wave XLR",           brand: "Elgato",    glyph: "slider.horizontal.3"),
        Profile(match: "wave:3",         display: "Elgato Wave:3",             brand: "Elgato",    glyph: "mic.fill"),
        Profile(match: "wave 3",         display: "Elgato Wave:3",             brand: "Elgato",    glyph: "mic.fill"),
        Profile(match: "elgato",         display: "Elgato Wave",               brand: "Elgato",    glyph: "mic.fill"),

        // ── DJI — Mic / Mic 2 wireless creator kit ──
        Profile(match: "dji mic 2",      display: "DJI Mic 2",                 brand: "DJI",       glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "dji mic",        display: "DJI Mic",                   brand: "DJI",       glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "dji",            display: "DJI Mic",                   brand: "DJI",       glyph: "dot.radiowaves.left.and.right"),

        // ── Saramonic — Blink wireless series + interfaces ──
        Profile(match: "blink me",       display: "Saramonic Blink Me",        brand: "Saramonic", glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "blink500",       display: "Saramonic Blink 500",       brand: "Saramonic", glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "blink 500",      display: "Saramonic Blink 500",       brand: "Saramonic", glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "blink",          display: "Saramonic Blink",           brand: "Saramonic", glyph: "dot.radiowaves.left.and.right"),
        Profile(match: "saramonic",      display: "Saramonic Mic",             brand: "Saramonic", glyph: "mic.fill"),

        // ── Maono — PD/DM USB podcast mics ──
        Profile(match: "maonocaster",    display: "Maono Maonocaster",         brand: "Maono",     glyph: "slider.horizontal.3"),
        Profile(match: "maono",          display: "Maono Mic",                 brand: "Maono",     glyph: "mic.fill"),

        // ── Audio-Technica — ATR2100x, AT2020USB ──
        Profile(match: "atr2100x",       display: "Audio-Technica ATR2100x",   brand: "Audio-Technica", glyph: "mic.fill"),
        Profile(match: "atr2100",        display: "Audio-Technica ATR2100",    brand: "Audio-Technica", glyph: "mic.fill"),
        Profile(match: "at2020usb",      display: "Audio-Technica AT2020USB",  brand: "Audio-Technica", glyph: "mic.fill"),
        Profile(match: "at2005",         display: "Audio-Technica AT2005USB",  brand: "Audio-Technica", glyph: "mic.fill"),
        Profile(match: "audio-technica", display: "Audio-Technica Mic",        brand: "Audio-Technica", glyph: "mic.fill"),
        Profile(match: "audio technica", display: "Audio-Technica Mic",        brand: "Audio-Technica", glyph: "mic.fill"),

        // ── Blue — Yeti / Snowball USB icons ──
        Profile(match: "yeti nano",      display: "Blue Yeti Nano",            brand: "Blue",      glyph: "mic.fill"),
        Profile(match: "yeti x",         display: "Blue Yeti X",               brand: "Blue",      glyph: "mic.fill"),
        Profile(match: "yeti",           display: "Blue Yeti",                 brand: "Blue",      glyph: "mic.fill"),
        Profile(match: "snowball",       display: "Blue Snowball",             brand: "Blue",      glyph: "mic.fill"),
        Profile(match: "blue microphone", display: "Blue Mic",                 brand: "Blue",      glyph: "mic.fill"),

        // ── Samson — Q2U handheld USB/XLR ──
        Profile(match: "q2u",            display: "Samson Q2U",                brand: "Samson",    glyph: "mic.fill"),
        Profile(match: "samson",         display: "Samson Mic",                brand: "Samson",    glyph: "mic.fill"),
    ]

    /// The best-matching profile for a raw AVAudioSession input name, or nil when
    /// no known device substring appears. Case-insensitive; first (most specific)
    /// rule wins.
    static func profile(for rawName: String) -> Profile? {
        let needle = rawName.lowercased()
        return profiles.first { needle.contains($0.match) }
    }

    /// Friendly display name for a raw input name — the mapped brand-model string
    /// when recognised, otherwise the raw name unchanged (never empty-substituted).
    static func friendlyName(for rawName: String) -> String {
        profile(for: rawName)?.display ?? rawName
    }

    /// Manufacturer for a raw input name, or nil when unrecognised.
    static func brand(for rawName: String) -> String? {
        profile(for: rawName)?.brand
    }

    /// SF Symbol hint for a raw input name, or nil when unrecognised.
    static func glyph(for rawName: String) -> String? {
        profile(for: rawName)?.glyph
    }
}

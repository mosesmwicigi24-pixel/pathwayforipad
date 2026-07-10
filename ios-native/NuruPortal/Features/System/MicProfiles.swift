// MicProfiles — friendly BRAND naming + brand intelligence for Radio Studio mics.
//
// AVAudioSession reports a USB audio input's `portName` straight from the device's
// USB product string, which is often terse or cryptic ("USB Audio", "Digital Audio
// Interface", "Wireless GO II RX", "P020"); Catalyst's AVCaptureDevice discovery
// adds a `manufacturer` string. This file maps the real market of content-creator /
// podcast / broadcast gear to a clean, human identity so the Audio Source card reads
// "RØDE Wireless GO II" instead of a raw port string — while the underlying isUSB
// detection + USB auto-prefer stay byte-for-byte unchanged (this layer only rewrites
// the *label*, never the routing).
//
// Two layers:
//   • MicProfiles      — the ordered name table (match substring → display/brand/
//     glyph, now optionally a device class + one-line pro hint per model).
//   • MicBrandRegistry — the "smart recognition" façade the UI asks: given a raw
//     name (+ optional manufacturer + transport) it returns a full Identity —
//     brand, display name, device class, pro hint, glyph — falling back to
//     transport-based classes ("USB microphone", "Bluetooth microphone") when the
//     device is unknown.
//
// Matching is a case- AND diacritic-insensitive substring scan against the raw
// name (Ø folds to O, so "Rode", "RØDE" and "Røde" all hit). The most specific
// model substrings are listed first so "wireless go ii" wins over the bare "rode"
// brand fallback. No match → the raw name is returned verbatim (never blank).
import Foundation

/// How an input physically reaches the device. Drives the transport tag in the
/// Audio source panel ("USB-C" / "BLUETOOTH" / "BUILT-IN") and the fallback
/// device class + hint when a mic isn't in the registry.
enum MicTransport: Equatable {
    case usb
    case bluetooth
    case builtIn
    case headset
    case unknown

    /// Short uppercase tag for the input row.
    var tag: String {
        switch self {
        case .usb:       return "USB-C"
        case .bluetooth: return "BLUETOOTH"
        case .builtIn:   return "BUILT-IN"
        case .headset:   return "HEADSET"
        case .unknown:   return "AUDIO IN"
        }
    }
}

enum MicProfiles {

    /// One known-device rule: if `match` (lowercased, diacritic-folded) appears
    /// anywhere in the raw input name, present it as `display` under `brand`,
    /// with an SF Symbol `glyph`. `deviceClass`/`hint` are optional per-model
    /// intelligence — when nil, MicBrandRegistry falls back to the brand's
    /// defaults, then to the transport.
    struct Profile {
        let match: String        // folded substring probed against the raw name
        let display: String      // friendly, on-brand label shown to the operator
        let brand: String        // manufacturer (grouping + the gold brand chip)
        let glyph: String        // SF Symbol hint (falls back to a mic icon)
        var deviceClass: String? = nil   // e.g. "Dynamic broadcast mic"
        var hint: String? = nil          // one-line pro hint for the row caption
    }

    /// Ordered most-specific → least-specific. Model rules precede their brand
    /// fallback so e.g. "Wireless GO II" beats the generic "RØDE".
    static let profiles: [Profile] = [
        // ── Hollyland — wireless lavalier systems, huge in the creator market ──
        Profile(match: "lark max",       display: "Hollyland Lark Max",        brand: "Hollyland", glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system", hint: "Wireless kit — keep the receiver close and watch TX battery."),
        Profile(match: "lark m2",        display: "Hollyland Lark M2",         brand: "Hollyland", glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system", hint: "Wireless kit — keep the receiver close and watch TX battery."),
        Profile(match: "lark m1",        display: "Hollyland Lark M1",         brand: "Hollyland", glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system", hint: "Wireless kit — keep the receiver close and watch TX battery."),
        Profile(match: "lark",           display: "Hollyland Lark",            brand: "Hollyland", glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system"),
        Profile(match: "hollyland",      display: "Hollyland Mic",             brand: "Hollyland", glyph: "dot.radiowaves.left.and.right"),

        // ── Zoom — handheld recorders + PodTrak interfaces ──
        Profile(match: "podtrak p4",     display: "Zoom PodTrak P4",           brand: "Zoom",      glyph: "waveform",
                deviceClass: "Podcast interface", hint: "Set channel gain on the PodTrak dials — the boost here rides on top."),
        Profile(match: "podtrak p8",     display: "Zoom PodTrak P8",           brand: "Zoom",      glyph: "waveform",
                deviceClass: "Podcast interface", hint: "Set channel gain on the PodTrak dials — the boost here rides on top."),
        Profile(match: "podtrak",        display: "Zoom PodTrak",              brand: "Zoom",      glyph: "waveform",
                deviceClass: "Podcast interface"),
        Profile(match: "h1n",            display: "Zoom H1n",                  brand: "Zoom",      glyph: "waveform",
                deviceClass: "Field recorder", hint: "Recorder-as-interface — set the input level on the recorder itself."),
        Profile(match: "h1 essential",   display: "Zoom H1essential",          brand: "Zoom",      glyph: "waveform",
                deviceClass: "Field recorder", hint: "Recorder-as-interface — set the input level on the recorder itself."),
        Profile(match: "h4n",            display: "Zoom H4n",                  brand: "Zoom",      glyph: "waveform",
                deviceClass: "Field recorder", hint: "Recorder-as-interface — set the input level on the recorder itself."),
        Profile(match: "h5",             display: "Zoom H5",                   brand: "Zoom",      glyph: "waveform",
                deviceClass: "Field recorder", hint: "Recorder-as-interface — set the input level on the recorder itself."),
        Profile(match: "h6",             display: "Zoom H6",                   brand: "Zoom",      glyph: "waveform",
                deviceClass: "Field recorder", hint: "Recorder-as-interface — set the input level on the recorder itself."),
        Profile(match: "zoom",           display: "Zoom Recorder",             brand: "Zoom",      glyph: "waveform"),

        // ── RØDE / Rode — wireless, USB condensers, VideoMic, RØDECaster ──
        Profile(match: "rodecaster",     display: "RØDECaster",                brand: "RØDE",      glyph: "slider.horizontal.3",
                deviceClass: "Broadcast console", hint: "Set channel gain on the RØDECaster — it hands us a finished mix."),
        Profile(match: "wireless go ii", display: "RØDE Wireless GO II",       brand: "RØDE",      glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system", hint: "Keep the RX in line of sight and watch the transmitter battery."),
        Profile(match: "wireless go",    display: "RØDE Wireless GO",          brand: "RØDE",      glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system", hint: "Keep the RX in line of sight and watch the transmitter battery."),
        Profile(match: "wireless me",    display: "RØDE Wireless ME",          brand: "RØDE",      glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system", hint: "Keep the RX in line of sight and watch the transmitter battery."),
        Profile(match: "nt-usb",         display: "RØDE NT-USB",               brand: "RØDE",      glyph: "mic.fill",
                deviceClass: "USB condenser", hint: "Condenser — it hears the room; use the pop shield and a quiet space."),
        Profile(match: "podmic",         display: "RØDE PodMic",               brand: "RØDE",      glyph: "mic.fill",
                deviceClass: "Dynamic broadcast mic", hint: "Dynamic broadcast mic — talk close to the grille (5–10 cm)."),
        Profile(match: "videomic",       display: "RØDE VideoMic",             brand: "RØDE",      glyph: "mic.fill",
                deviceClass: "Shotgun mic", hint: "Shotgun — aim the barrel at the mouth; distance costs presence."),
        Profile(match: "rode",           display: "RØDE Mic",                  brand: "RØDE",      glyph: "mic.fill"),
        Profile(match: "røde",           display: "RØDE Mic",                  brand: "RØDE",      glyph: "mic.fill"),

        // ── Shure — SM7B broadcast icon, MV7 dynamic, MVX2U interface, MV88 ──
        Profile(match: "sm7b",           display: "Shure SM7B",                brand: "Shure",     glyph: "mic.fill",
                deviceClass: "Dynamic broadcast mic", hint: "Broadcast classic — needs plenty of clean gain; talk close."),
        Profile(match: "sm7db",          display: "Shure SM7dB",               brand: "Shure",     glyph: "mic.fill",
                deviceClass: "Dynamic broadcast mic", hint: "Broadcast classic with a built-in preamp — talk close to the grille."),
        Profile(match: "mv7+",           display: "Shure MV7+",                brand: "Shure",     glyph: "mic.fill",
                deviceClass: "Dynamic broadcast mic", hint: "Dynamic broadcast mic — talk close; set gain in MOTIV."),
        Profile(match: "mv7",            display: "Shure MV7",                 brand: "Shure",     glyph: "mic.fill",
                deviceClass: "Dynamic broadcast mic", hint: "Dynamic broadcast mic — talk close; set gain in MOTIV."),
        Profile(match: "mvx2u",          display: "Shure MVX2U",               brand: "Shure",     glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "XLR interface — set gain on the hardware, not the boost slider."),
        Profile(match: "mv88",           display: "Shure MV88",                brand: "Shure",     glyph: "mic.fill",
                deviceClass: "Stereo condenser"),
        Profile(match: "shure",          display: "Shure Mic",                 brand: "Shure",     glyph: "mic.fill"),

        // ── Focusrite — Scarlett / Vocaster / Clarett XLR interfaces ──
        Profile(match: "scarlett 2i2",   display: "Focusrite Scarlett 2i2",    brand: "Focusrite", glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "XLR interface — set gain on the hardware dial; green halo good, red is clipping."),
        Profile(match: "scarlett solo",  display: "Focusrite Scarlett Solo",   brand: "Focusrite", glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "XLR interface — set gain on the hardware dial; green halo good, red is clipping."),
        Profile(match: "scarlett",       display: "Focusrite Scarlett",        brand: "Focusrite", glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "XLR interface — set gain on the hardware dial."),
        Profile(match: "vocaster",       display: "Focusrite Vocaster",        brand: "Focusrite", glyph: "slider.horizontal.3",
                deviceClass: "Podcast interface", hint: "Set gain on the hardware — Auto Gain can level it for you."),
        Profile(match: "clarett",        display: "Focusrite Clarett",         brand: "Focusrite", glyph: "slider.horizontal.3",
                deviceClass: "XLR interface"),
        Profile(match: "focusrite",      display: "Focusrite Interface",       brand: "Focusrite", glyph: "slider.horizontal.3"),

        // ── Behringer — U-Phoria / UMC budget XLR interfaces ──
        Profile(match: "u-phoria",       display: "Behringer U-Phoria",        brand: "Behringer", glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "XLR interface — set gain on the hardware dial; engage +48V for condensers."),
        Profile(match: "umc",            display: "Behringer UMC",             brand: "Behringer", glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "XLR interface — set gain on the hardware dial; engage +48V for condensers."),
        Profile(match: "behringer",      display: "Behringer Interface",       brand: "Behringer", glyph: "slider.horizontal.3"),

        // ── Elgato — Wave:3 USB condenser, Wave XLR interface ──
        Profile(match: "wave xlr",       display: "Elgato Wave XLR",           brand: "Elgato",    glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "Set gain on the dial — Clipguard catches the peaks."),
        Profile(match: "wave:3",         display: "Elgato Wave:3",             brand: "Elgato",    glyph: "mic.fill",
                deviceClass: "USB condenser", hint: "Condenser — watch room noise; Clipguard catches the peaks."),
        Profile(match: "wave 3",         display: "Elgato Wave:3",             brand: "Elgato",    glyph: "mic.fill",
                deviceClass: "USB condenser", hint: "Condenser — watch room noise; Clipguard catches the peaks."),
        Profile(match: "elgato",         display: "Elgato Wave",               brand: "Elgato",    glyph: "mic.fill"),

        // ── DJI — Mic / Mic 2 wireless creator kit ──
        Profile(match: "dji mic 2",      display: "DJI Mic 2",                 brand: "DJI",       glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system", hint: "Wireless kit — keep the receiver close and watch TX battery."),
        Profile(match: "dji mic",        display: "DJI Mic",                   brand: "DJI",       glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system", hint: "Wireless kit — keep the receiver close and watch TX battery."),
        Profile(match: "dji",            display: "DJI Mic",                   brand: "DJI",       glyph: "dot.radiowaves.left.and.right"),

        // ── Saramonic — Blink wireless series + interfaces ──
        Profile(match: "blink me",       display: "Saramonic Blink Me",        brand: "Saramonic", glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system"),
        Profile(match: "blink500",       display: "Saramonic Blink 500",       brand: "Saramonic", glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system"),
        Profile(match: "blink 500",      display: "Saramonic Blink 500",       brand: "Saramonic", glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system"),
        Profile(match: "blink",          display: "Saramonic Blink",           brand: "Saramonic", glyph: "dot.radiowaves.left.and.right",
                deviceClass: "Wireless mic system"),
        Profile(match: "saramonic",      display: "Saramonic Mic",             brand: "Saramonic", glyph: "mic.fill"),

        // ── Maono — PD/DM USB podcast mics ──
        Profile(match: "maonocaster",    display: "Maono Maonocaster",         brand: "Maono",     glyph: "slider.horizontal.3",
                deviceClass: "Podcast console", hint: "Set channel gain on the console — it hands us a finished mix."),
        Profile(match: "maono",          display: "Maono Mic",                 brand: "Maono",     glyph: "mic.fill",
                deviceClass: "USB podcast mic"),

        // ── Audio-Technica — ATR2100x, AT2020 family ──
        Profile(match: "atr2100x",       display: "Audio-Technica ATR2100x",   brand: "Audio-Technica", glyph: "mic.fill",
                deviceClass: "Dynamic USB/XLR mic", hint: "Dynamic — talk close to the top of the grille."),
        Profile(match: "atr2100",        display: "Audio-Technica ATR2100",    brand: "Audio-Technica", glyph: "mic.fill",
                deviceClass: "Dynamic USB/XLR mic", hint: "Dynamic — talk close to the top of the grille."),
        Profile(match: "at2020usb",      display: "Audio-Technica AT2020USB",  brand: "Audio-Technica", glyph: "mic.fill",
                deviceClass: "USB condenser", hint: "Condenser — it hears the room; keep fans and echo down."),
        Profile(match: "at2020",         display: "Audio-Technica AT2020",     brand: "Audio-Technica", glyph: "mic.fill",
                deviceClass: "Condenser mic", hint: "Condenser — it hears the room; keep fans and echo down."),
        Profile(match: "at2005",         display: "Audio-Technica AT2005USB",  brand: "Audio-Technica", glyph: "mic.fill",
                deviceClass: "Dynamic USB/XLR mic", hint: "Dynamic — talk close to the grille."),
        Profile(match: "audio-technica", display: "Audio-Technica Mic",        brand: "Audio-Technica", glyph: "mic.fill"),
        Profile(match: "audio technica", display: "Audio-Technica Mic",        brand: "Audio-Technica", glyph: "mic.fill"),

        // ── Blue — Yeti / Snowball USB icons ──
        Profile(match: "yeti nano",      display: "Blue Yeti Nano",            brand: "Blue",      glyph: "mic.fill",
                deviceClass: "USB condenser", hint: "Condenser: watch room noise — pick the cardioid pattern for speech."),
        Profile(match: "yeti x",         display: "Blue Yeti X",               brand: "Blue",      glyph: "mic.fill",
                deviceClass: "USB condenser", hint: "Condenser: watch room noise — pick the cardioid pattern for speech."),
        Profile(match: "yeti",           display: "Blue Yeti",                 brand: "Blue",      glyph: "mic.fill",
                deviceClass: "USB condenser", hint: "Condenser: watch room noise — pick the cardioid pattern for speech."),
        Profile(match: "snowball",       display: "Blue Snowball",             brand: "Blue",      glyph: "mic.fill",
                deviceClass: "USB condenser", hint: "Condenser — watch room noise."),
        Profile(match: "blue microphone", display: "Blue Mic",                 brand: "Blue",      glyph: "mic.fill"),

        // ── Samson — Q2U handheld USB/XLR ──
        Profile(match: "q2u",            display: "Samson Q2U",                brand: "Samson",    glyph: "mic.fill",
                deviceClass: "Dynamic USB/XLR mic", hint: "Dynamic — talk close to the grille."),
        Profile(match: "samson",         display: "Samson Mic",                brand: "Samson",    glyph: "mic.fill"),

        // ── Sennheiser — Profile USB, MKE creator mics ──
        Profile(match: "sennheiser profile", display: "Sennheiser Profile",    brand: "Sennheiser", glyph: "mic.fill",
                deviceClass: "USB condenser", hint: "Condenser — it hears the room; set gain on the front dial."),
        Profile(match: "mke 400",        display: "Sennheiser MKE 400",        brand: "Sennheiser", glyph: "mic.fill",
                deviceClass: "Shotgun mic"),
        Profile(match: "mke",            display: "Sennheiser MKE",            brand: "Sennheiser", glyph: "mic.fill"),
        Profile(match: "sennheiser",     display: "Sennheiser Mic",            brand: "Sennheiser", glyph: "mic.fill"),

        // ── AKG — Lyra USB condenser ──
        Profile(match: "lyra",           display: "AKG Lyra",                  brand: "AKG",       glyph: "mic.fill",
                deviceClass: "USB condenser", hint: "Condenser — watch room noise; front dial sets the headphone mix."),
        Profile(match: "akg",            display: "AKG Mic",                   brand: "AKG",       glyph: "mic.fill"),

        // ── PreSonus — Revelator USB mics, AudioBox interfaces ──
        Profile(match: "revelator",      display: "PreSonus Revelator",        brand: "PreSonus",  glyph: "mic.fill",
                deviceClass: "USB podcast mic"),
        Profile(match: "audiobox",       display: "PreSonus AudioBox",         brand: "PreSonus",  glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "XLR interface — set gain on the hardware dial."),
        Profile(match: "presonus",       display: "PreSonus Interface",        brand: "PreSonus",  glyph: "slider.horizontal.3"),

        // ── MOTU — M-series studio interfaces ──
        Profile(match: "motu",           display: "MOTU Interface",            brand: "MOTU",      glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "XLR interface — set gain on the hardware dial."),

        // ── Universal Audio — Volt / Apollo interfaces ──
        Profile(match: "apollo",         display: "UA Apollo",                 brand: "Universal Audio", glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "XLR interface — set gain on the hardware; console handles DSP."),
        Profile(match: "volt",           display: "UA Volt",                   brand: "Universal Audio", glyph: "slider.horizontal.3",
                deviceClass: "XLR interface", hint: "XLR interface — set gain on the hardware dial."),
        Profile(match: "universal audio", display: "UA Interface",             brand: "Universal Audio", glyph: "slider.horizontal.3"),

        // ── Yamaha — AG mixing consoles ──
        Profile(match: "ag03",           display: "Yamaha AG03",               brand: "Yamaha",    glyph: "slider.horizontal.3",
                deviceClass: "Mixer / interface", hint: "Set channel gain on the mixer — it hands us the finished mix."),
        Profile(match: "ag06",           display: "Yamaha AG06",               brand: "Yamaha",    glyph: "slider.horizontal.3",
                deviceClass: "Mixer / interface", hint: "Set channel gain on the mixer — it hands us the finished mix."),
        Profile(match: "yamaha",         display: "Yamaha Audio",              brand: "Yamaha",    glyph: "slider.horizontal.3"),
    ]

    /// Case- + diacritic-insensitive canonical form for matching. Ø has no
    /// combining-mark decomposition, so fold it to O by hand — "RØDE", "Røde"
    /// and "rode" all normalise identically.
    static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
            .replacingOccurrences(of: "ø", with: "o")
    }

    /// The best-matching profile for a raw AVAudioSession/AVCaptureDevice input
    /// name, or nil when no known device substring appears. Case- and
    /// diacritic-insensitive; first (most specific) rule wins.
    static func profile(for rawName: String) -> Profile? {
        let needle = fold(rawName)
        return profiles.first { needle.contains(fold($0.match)) }
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

// MARK: - ===================== MicBrandRegistry (smart recognition) =====================

/// The "wise" layer: turn whatever the OS reports about an input — raw name,
/// USB manufacturer string, transport — into a full presentation identity for the
/// Audio source panel: brand chip, friendly name, device class, one-line pro hint
/// and a glyph. Recognition never touches routing; unknown devices degrade
/// gracefully to a transport-based class ("USB microphone").
enum MicBrandRegistry {

    struct Identity: Equatable {
        /// Brand for the gold chip ("RØDE") — nil when the device is unrecognised.
        let brand: String?
        /// Friendly full label ("RØDE PodMic"); the raw name when unrecognised.
        let displayName: String
        /// What kind of device this is ("Dynamic broadcast mic", "XLR interface",
        /// "USB microphone" when only the transport is known).
        let deviceClass: String
        /// One-line pro hint shown as the row caption when the input is active.
        let hint: String?
        /// SF Symbol for the row icon.
        let glyph: String
    }

    /// Brand-level defaults when a matched model row carries no explicit
    /// class/hint (e.g. the bare "shure" fallback rule).
    private static let brandTraits: [String: (deviceClass: String, hint: String?)] = [
        "RØDE":            ("Broadcast mic", nil),
        "Shure":           ("Broadcast mic", nil),
        "Hollyland":       ("Wireless mic system", "Wireless kit — watch the transmitter battery."),
        "Zoom":            ("Recorder / interface", nil),
        "Elgato":          ("USB mic / interface", nil),
        "DJI":             ("Wireless mic system", "Wireless kit — watch the transmitter battery."),
        "Saramonic":       ("Wireless mic system", nil),
        "Maono":           ("USB podcast mic", nil),
        "Audio-Technica":  ("Studio mic", nil),
        "Blue":            ("USB condenser", "Condenser — watch room noise."),
        "Samson":          ("USB mic", nil),
        "Focusrite":       ("XLR interface", "XLR interface — set gain on the hardware dial."),
        "Behringer":       ("XLR interface", "XLR interface — set gain on the hardware dial."),
        "Sennheiser":      ("Studio mic", nil),
        "AKG":             ("Studio mic", nil),
        "PreSonus":        ("XLR interface", "XLR interface — set gain on the hardware dial."),
        "MOTU":            ("XLR interface", "XLR interface — set gain on the hardware dial."),
        "Universal Audio": ("XLR interface", "XLR interface — set gain on the hardware dial."),
        "Yamaha":          ("Mixer / interface", "Set channel gain on the mixer."),
    ]

    /// Apple built-in mics arrive with clean names already ("MacBook Pro
    /// Microphone", "iPad Microphone") — recognise them by name so Catalyst
    /// discovery (where everything is deviceType .microphone) still brands them.
    private static let appleBuiltInMarkers =
        ["macbook", "imac", "mac mini", "mac studio", "studio display", "built-in", "ipad microphone", "iphone microphone"]

    static func looksLikeAppleBuiltIn(_ rawName: String) -> Bool {
        let folded = MicProfiles.fold(rawName)
        return appleBuiltInMarkers.contains { folded.contains($0) }
    }

    /// Full identity for an input. Matches the name first, then the USB
    /// manufacturer string; Apple built-ins and unknown devices fall back to
    /// transport-based classes so the row NEVER shows an empty identity.
    static func identity(rawName: String,
                         manufacturer: String? = nil,
                         transport: MicTransport = .unknown) -> Identity {
        // 1) Known creator/broadcast gear — by product name, then manufacturer.
        let byName = MicProfiles.profile(for: rawName)
        let profile = byName ?? manufacturer.flatMap { MicProfiles.profile(for: $0) }
        if let profile {
            let traits = brandTraits[profile.brand]
            return Identity(
                brand: profile.brand,
                // Matched only via the manufacturer string → the profile display
                // may be a generic brand fallback; still friendlier than the raw
                // USB product string, so use it either way.
                displayName: profile.display,
                deviceClass: profile.deviceClass ?? traits?.deviceClass ?? transportClass(transport),
                hint: profile.hint ?? traits?.hint ?? transportHint(transport),
                glyph: profile.glyph)
        }

        // 2) Apple built-in mics — talkback quality, not broadcast.
        if transport == .builtIn || looksLikeAppleBuiltIn(rawName) {
            return Identity(brand: "Apple",
                            displayName: rawName,
                            deviceClass: "Built-in mic",
                            hint: builtInHint,
                            glyph: "laptopcomputer")
        }

        // 3) Unknown — classify by how it's connected.
        return Identity(brand: nil,
                        displayName: rawName,
                        deviceClass: transportClass(transport),
                        hint: transportHint(transport),
                        glyph: transportGlyph(transport))
    }

    private static var builtInHint: String {
        #if targetEnvironment(macCatalyst)
        return "MacBook mic — fine for talkback, not broadcast."
        #else
        return "Built-in mic — fine for talkback; prefer a USB mic for broadcast."
        #endif
    }

    private static func transportClass(_ transport: MicTransport) -> String {
        switch transport {
        case .usb:       return "USB microphone"
        case .bluetooth: return "Bluetooth microphone"
        case .builtIn:   return "Built-in mic"
        case .headset:   return "Headset mic"
        case .unknown:   return "Audio input"
        }
    }

    private static func transportHint(_ transport: MicTransport) -> String? {
        switch transport {
        case .bluetooth: return "Bluetooth mic — latency + compression; prefer USB for broadcast."
        case .builtIn:   return builtInHint
        default:         return nil
        }
    }

    private static func transportGlyph(_ transport: MicTransport) -> String {
        switch transport {
        case .usb:       return "cable.connector"
        case .bluetooth: return "dot.radiowaves.left.and.right"
        case .builtIn:   return "laptopcomputer"
        case .headset:   return "headphones"
        case .unknown:   return "mic"
        }
    }
}

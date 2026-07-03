// Virtual Audio Mixer — a native SwiftUI port of the web portal's MixerStudio page,
// dark studio theme (shares the `Rs` palette + `StudioPanel` from RadioStudioView).
//
// REAL, persisted bits (wired to the frozen admin API):
//   • scene presets           GET/POST /admin/radio/mixer/scenes  (+ seed 4 defaults)
//   • jingle soundboard        GET/POST/DELETE /admin/radio/mixer/jingles — the audio
//     file is uploaded to OUR server first (PortalAPI.uploadRadioAudio), then the
//     jingle is created with the returned URL so the live engine can actually fire it.
//   • ON-AIR MIX ENGINE        /admin/radio/mixer/live/* — status polled every 5s while
//     visible. When connected: mapped strips (mic→mic, music→bed, jingle→jingle, plus
//     the master fader) push debounced gain changes, applying a scene also recalls it
//     on the engine, and jingle pads fire the server-hosted audio.
//   • EQ & SOUND               POST /admin/radio/mixer/live/eq — 3-band peaking EQ per
//     bus (mic/bed/master × 100 Hz/1.2 kHz/8 kHz, −12…+12 dB) on the live broadcast.
//     Tone presets POST all buses at once; slider tweaks debounce ~250ms per bus.
//     EQ values are client-held (default flat) — offline they're local-only.
//   • ONE-SHOT HYDRATION       the view is deliberately not kept alive, so a fresh
//     visit starts from defaults while the engine still holds the real values. The
//     first connected /live/status poll that carries gains copies the engine truth
//     into the EQ sliders + mapped strips/master — but only if the operator hasn't
//     touched anything yet, and without re-pushing those values back on air.
// CLIENT-ONLY: unmapped strips (they carry a LOCAL tag while the engine is live),
// pan/solo, and the music-bed player. With the engine offline the studio behaves
// exactly as before — pure local state.
import SwiftUI
import UniformTypeIdentifiers

// MARK: - JSON body for scene / jingle writes (omit-null, mirrors RadioJSON).

private enum MixJSON: Encodable {
    case string(String), int(Int), bool(Bool), double(Double), null
    case channels([LocalChannel])
    func encode(to encoder: Encoder) throws {
        switch self {
        case .channels(let ch):
            var u = encoder.unkeyedContainer()
            for c in ch { try u.encode(c) }
        default:
            var c = encoder.singleValueContainer()
            switch self {
            case .string(let v): try c.encode(v)
            case .int(let v): try c.encode(v)
            case .bool(let v): try c.encode(v)
            case .double(let v): try c.encode(v)
            case .null: try c.encodeNil()
            case .channels: break
            }
        }
    }
}

// Local, editable channel (encodes to the scene channels[] shape).
struct LocalChannel: Identifiable, Encodable, Equatable {
    var id: String
    var name: String
    var sub: String
    var color: String
    var level: Double     // 0..100
    var pan: Double        // -100..100
    var muted: Bool
    var solo: Bool

    init(from c: MixerChannel) {
        id = c.id.isEmpty ? UUID().uuidString : c.id
        name = c.name; sub = c.sub ?? ""; color = c.color ?? "#E6C66E"
        level = c.level; pan = c.pan; muted = c.muted; solo = c.solo
    }
    init(id: String = UUID().uuidString, name: String, sub: String, color: String, level: Double) {
        self.id = id; self.name = name; self.sub = sub; self.color = color
        self.level = level; pan = 0; muted = false; solo = false
    }
}

private func chColor(_ hex: String) -> Color {
    var s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    return Color(hex: UInt32(s, radix: 16) ?? 0xE6C66E)
}

// MARK: - EQ state (client-held; the engine applies whatever we push)

/// One bus's 3-band EQ — dB gains at 100 Hz / 1.2 kHz / 8 kHz, −12…+12.
struct EqBands: Equatable {
    var low: Double = 0
    var mid: Double = 0
    var high: Double = 0
    func dict() -> [String: Double] { ["low": low, "mid": mid, "high": high] }
    /// True when every band sits within ±tolerance dB of the other's — used to
    /// re-derive the preset-chip highlight after hydrating from the engine.
    func matches(_ other: EqBands, tolerance: Double = 0.05) -> Bool {
        abs(low - other.low) <= tolerance
            && abs(mid - other.mid) <= tolerance
            && abs(high - other.high) <= tolerance
    }
}

/// A named tone preset across all three buses. Most are tone-only (Scenes own
/// level balance), but a preset may optionally carry a level balance too —
/// `levels` is keyed by engine channel ("mic"/"bed"), 0..100. Preset-chip
/// highlighting stays EQ-based; levels never take part in the match.
struct EqPreset: Identifiable, Equatable {
    let id: String
    let name: String
    let mic: EqBands
    let bed: EqBands
    let master: EqBands
    var levels: [String: Int]? = nil
}

// MARK: - View model

@MainActor
private final class MixerModel: ObservableObject {
    @Published var channels: [LocalChannel] = MixerModel.defaultStrips()
    @Published var master: Double = 80
    @Published var scenes: [MixerScene] = []
    @Published var jingles: [MixerJingle] = []
    @Published var activeSceneId: String?
    @Published var loaded = false
    @Published var error: String?
    @Published var actionError: String?
    @Published var busy = false
    // Live on-air engine bridge.
    @Published var engineConnected = false
    @Published var sceneNote: String?      // inline note under the scene grid
    @Published var jingleNote: String?     // inline note under the soundboard
    // 3-band EQ per bus — client-held (defaults flat); pushed live when connected.
    @Published var eqMic = EqBands()
    @Published var eqBed = EqBands()
    @Published var eqMaster = EqBands()
    @Published var activeEqPreset: String? = "flat"   // nil once a slider is touched
    @Published var eqNote: String?         // inline note under the EQ panel

    // One-shot hydration bookkeeping (see `hydrate(from:)`): the model is rebuilt
    // on every visit, so the first connected status with gains restores the
    // engine's truth — unless the operator already touched something (`dirty`).
    private var hydrated = false
    /// Set on any user fader/EQ/mute edit; hydration then never overwrites.
    private var dirty = false
    /// Level values just written by hydration, keyed by engine channel. The view's
    /// `.onChange` echoes them back through the edit handlers; matching echoes are
    /// swallowed so hydration never marks state dirty or re-pushes gains on air.
    private var hydrationEcho: [String: Int] = [:]

    /// One in-flight debounce task per engine channel (cancel-and-replace).
    private var levelPushTasks: [String: Task<Void, Never>] = [:]
    /// One in-flight debounce task per EQ bus (cancel-and-replace).
    private var eqPushTasks: [String: Task<Void, Never>] = [:]

    // Stable strip ids so the live mapping survives renames; saved scenes still
    // match by NAME in applyScene, so pre-existing server scenes keep working.
    static func defaultStrips() -> [LocalChannel] {
        [
            .init(id: "mic", name: "Preacher", sub: "Lav mic", color: "#E6C66E", level: 82),
            .init(id: "worship", name: "Worship", sub: "Stereo bus", color: "#22C55E", level: 68),
            .init(id: "choir", name: "Choir", sub: "Overheads", color: "#7DD3FC", level: 60),
            .init(id: "keys", name: "Keys", sub: "DI", color: "#C4B5FD", level: 55),
            .init(id: "ambience", name: "Congregation", sub: "Room", color: "#F9A8D4", level: 40),
            .init(id: "music", name: "Music bed", sub: "Playback", color: "#FDBA74", level: 30),
            .init(id: "jingle", name: "Jingles", sub: "Soundboard", color: "#5EEAD4", level: 75),
        ]
    }

    /// Fixed strip→engine mapping — only these strips ride the live path.
    static func engineKey(forStrip id: String) -> String? {
        switch id {
        case "mic": return "mic"
        case "music": return "bed"
        case "jingle": return "jingle"
        default: return nil
        }
    }

    func load() async {
        do {
            async let s = PortalAPI.mixerScenes()
            async let j = PortalAPI.mixerJingles()
            var loadedScenes = try await s
            jingles = try await j
            if loadedScenes.isEmpty { loadedScenes = await seedDefaultScenes() }
            scenes = loadedScenes
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not load the mixer."
        }
        loaded = true
    }

    // Seed the 4 canonical scenes if the church has none yet.
    private func seedDefaultScenes() async -> [MixerScene] {
        let presets: [(String, String, [LocalChannel])] = [
            ("Preaching", "Voice forward, beds low", tuned(preacher: 88, worship: 35, choir: 20, keys: 30, room: 45, bed: 18)),
            ("Worship", "Band + choir up", tuned(preacher: 55, worship: 82, choir: 74, keys: 70, room: 50, bed: 30)),
            ("Prayer", "Intimate, soft bed", tuned(preacher: 70, worship: 40, choir: 25, keys: 45, room: 35, bed: 42)),
            ("Interview", "Two voices, minimal music", tuned(preacher: 80, worship: 25, choir: 15, keys: 20, room: 55, bed: 12)),
        ]
        var created: [MixerScene] = []
        for (i, p) in presets.enumerated() {
            if let scene = try? await createScene(name: p.0, hint: p.1, channels: p.2, isDefault: i == 0) {
                created.append(scene)
            }
        }
        return created
    }

    private func tuned(preacher: Double, worship: Double, choir: Double, keys: Double, room: Double, bed: Double) -> [LocalChannel] {
        var s = MixerModel.defaultStrips()
        let vals = [preacher, worship, choir, keys, room, bed]
        for i in s.indices where i < vals.count { s[i].level = vals[i] }
        return s
    }

    func createScene(name: String, hint: String, channels: [LocalChannel], isDefault: Bool) async throws -> MixerScene {
        let body: [String: MixJSON] = [
            "name": .string(name),
            "hint": hint.isEmpty ? .null : .string(hint),
            "channels": .channels(channels),
            "is_default": .bool(isDefault),
        ]
        return try await APIClient.shared.post("/admin/radio/mixer/scenes", body: body, as: MixerScene.self)
    }

    func applyScene(_ scene: MixerScene) {
        activeSceneId = scene.id
        sceneNote = nil
        dirty = true   // an explicit level recall — hydration must not undo it
        // Match saved channels onto local strips by name; apply level/pan/mute/solo.
        for saved in scene.channels {
            if let i = channels.firstIndex(where: { $0.name == saved.name }) {
                channels[i].level = saved.level
                channels[i].pan = saved.pan
                channels[i].muted = saved.muted
                channels[i].solo = saved.solo
            }
        }
        // Live: recall the same scene on the on-air engine (local behaviour unchanged).
        guard engineConnected else { return }
        Task {
            do { try await PortalAPI.mixerLiveScene(scene.id) }
            catch { sceneNote = "Applied locally — the on-air engine didn't take \"\(scene.name)\"." }
        }
    }

    // MARK: Live engine bridge

    /// Poll the engine every 5s while the studio is visible. Runs inside the view's
    /// `.task`, so it cancels automatically on disappear; transport errors read as
    /// "offline" (the contract says /status itself never errors).
    func pollEngine() async {
        while !Task.isCancelled {
            let status = try? await PortalAPI.mixerLiveStatus()
            engineConnected = status?.connected ?? false
            // First connected poll that carries gains → one-shot hydration. If the
            // early polls are disconnected we simply keep waiting for the first
            // connected one; after that, later polls never touch view state.
            if engineConnected, !hydrated, let gains = status?.gains {
                hydrate(from: gains)
            }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
    }

    /// One-shot: copy the engine's truth into the fresh view state. Runs at most
    /// once per visit, and only if the operator hasn't edited anything (`dirty`) —
    /// user state always wins. Backing state is set directly: EQ slider bindings
    /// only fire `onEdit` on real drags, and the level `.onChange` echoes are
    /// swallowed via `hydrationEcho`, so hydration never triggers live pushes.
    private func hydrate(from gains: [String: Double]) {
        hydrated = true
        guard !dirty else { return }

        // Nine EQ bands — keys eq_<bus>_<band>, raw dB −12…+12 (missing → flat 0).
        func bus(_ name: String) -> EqBands {
            func band(_ b: String) -> Double { min(12, max(-12, gains["eq_\(name)_\(b)"] ?? 0)) }
            return EqBands(low: band("low"), mid: band("mid"), high: band("high"))
        }
        eqMic = bus("mic"); eqBed = bus("bed"); eqMaster = bus("master")
        // Re-derive the chip highlight: light a preset only if the engine's tone
        // matches it on every band (±0.05 dB); otherwise none.
        activeEqPreset = MixerModel.eqPresets.first {
            $0.mic.matches(eqMic) && $0.bed.matches(eqBed) && $0.master.matches(eqMaster)
        }?.id

        // Mapped strips + master — only the keys the engine actually reported.
        for (stripId, key) in [("mic", "mic"), ("music", "bed"), ("jingle", "jingle")] {
            guard let g = gains[key],
                  let i = channels.firstIndex(where: { $0.id == stripId }) else { continue }
            let v = min(100, max(0, g.rounded()))
            if channels[i].level != v {
                hydrationEcho[key] = Int(v)
                channels[i].level = v
            }
        }
        if let g = gains["master"] {
            let v = min(100, max(0, g.rounded()))
            if master != v {
                hydrationEcho["master"] = Int(v)
                master = v
            }
        }
    }

    /// A strip's level or mute changed. Mapped strips push to the engine when it is
    /// connected; mute sends 0 and unmute re-sends the fader value. Offline (or on an
    /// unmapped strip) this is a no-op — exactly the old local behaviour.
    func liveLevelChanged(stripId: String, level: Double, muted: Bool) {
        guard let key = MixerModel.engineKey(forStrip: stripId) else {
            dirty = true   // local-only strip edits still count as operator edits
            return
        }
        let value = muted ? 0 : Int(level.rounded())
        // A hydration write echoing back through `.onChange` isn't a user edit —
        // swallow it instead of marking dirty / re-pushing the engine's own value.
        if hydrationEcho.removeValue(forKey: key) == value { return }
        dirty = true
        pushLiveLevel(key, value: value)
    }

    func masterChanged(_ value: Double) {
        let v = Int(value.rounded())
        if hydrationEcho.removeValue(forKey: "master") == v { return }
        dirty = true
        pushLiveLevel("master", value: v)
    }

    /// Debounced (~250ms) per-channel push: each movement cancels and replaces the
    /// channel's pending task, so a fader drag lands as a single POST carrying the
    /// latest value instead of a burst of writes.
    private func pushLiveLevel(_ engineKey: String, value: Int) {
        guard engineConnected else { return }
        let v = min(100, max(0, value))
        levelPushTasks[engineKey]?.cancel()
        levelPushTasks[engineKey] = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            try? await PortalAPI.mixerLiveLevels([engineKey: v])
        }
    }

    // MARK: EQ & sound presets (tone shaping — Scenes own level balance)

    static let eqPresets: [EqPreset] = [
        .init(id: "flat", name: "Flat",
              mic: EqBands(), bed: EqBands(), master: EqBands()),
        .init(id: "talk", name: "Talk Show",
              mic: EqBands(low: -2, mid: 2.5, high: 3.5),
              bed: EqBands(low: 1, mid: -1.5, high: -1),
              master: EqBands(low: 0, mid: 0, high: 1)),
        .init(id: "podcast", name: "Podcast Studio",
              mic: EqBands(low: 1.5, mid: 1, high: 2.5),
              bed: EqBands(low: 0, mid: -2, high: 0),
              master: EqBands(low: 0.5, mid: 0, high: 1)),
        // Presenter loud + clear; music mid-carved and tucked under the voice.
        .init(id: "voiceover", name: "Voice Over Music",
              mic: EqBands(low: -1, mid: 3, high: 4),
              bed: EqBands(low: 1, mid: -5.5, high: -2),
              master: EqBands(low: 0, mid: 0, high: 0.5),
              levels: ["mic": 95, "bed": 28]),
        .init(id: "warm", name: "Warm Music",
              mic: EqBands(),
              bed: EqBands(low: 3, mid: 0, high: -1),
              master: EqBands(low: 1, mid: 0, high: 0),
              levels: ["mic": 60, "bed": 80]),   // swings back to music-forward
        .init(id: "bright", name: "Bright Music",
              mic: EqBands(),
              bed: EqBands(low: 1, mid: 0.5, high: 3),
              master: EqBands(low: 0, mid: 0, high: 1.5)),
    ]

    /// Apply a preset to all three buses locally, then recall it on the engine in a
    /// single POST carrying every bus. Offline → local-only (same rule as levels).
    /// Presets that also carry a level balance set the mapped strips the same way
    /// hydration does — echoes swallowed, pending debounces cancelled — and ride
    /// one `mixerLiveLevels` POST alongside the EQ POST.
    func applyEqPreset(_ p: EqPreset) {
        eqMic = p.mic; eqBed = p.bed; eqMaster = p.master
        activeEqPreset = p.id
        eqNote = nil
        dirty = true   // an explicit tone choice — hydration must not undo it
        // A stale per-bus debounce must not overwrite the preset we just applied.
        for t in eqPushTasks.values { t.cancel() }
        eqPushTasks.removeAll()
        // Level-carrying presets: set the mapped strips directly. The strips'
        // `.onChange` echoes are swallowed via `hydrationEcho`, and any pending
        // per-channel debounce is cancelled, so the preset lands as one combined
        // POST instead of a burst of per-fader pushes.
        let levels = p.levels?.mapValues { min(100, max(0, $0)) }
        if let levels {
            for (stripId, key) in [("mic", "mic"), ("music", "bed"), ("jingle", "jingle")] {
                guard let v = levels[key],
                      let i = channels.firstIndex(where: { $0.id == stripId }) else { continue }
                levelPushTasks[key]?.cancel()
                levelPushTasks[key] = nil
                if channels[i].level != Double(v) {
                    hydrationEcho[key] = v
                    channels[i].level = Double(v)
                }
            }
        }
        guard engineConnected else { return }
        Task {
            do {
                if let levels { try await PortalAPI.mixerLiveLevels(levels) }
                try await PortalAPI.mixerLiveEq([
                    "mic": p.mic.dict(), "bed": p.bed.dict(), "master": p.master.dict(),
                ])
            } catch {
                eqNote = "Applied locally — the on-air engine didn't take \"\(p.name)\"."
            }
        }
    }

    /// A slider on `bus` was tweaked by hand: the preset highlight clears, and (when
    /// the engine is connected) the bus's three bands ride a ~250ms cancel-and-replace
    /// debounce so a drag lands as one POST with the final values — the same pattern
    /// as the fader level pushes. Offline this is local-only, exactly like levels.
    func eqEdited(_ bus: String) {
        activeEqPreset = nil
        dirty = true
        guard engineConnected else { return }
        eqPushTasks[bus]?.cancel()
        eqPushTasks[bus] = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            do {
                try await PortalAPI.mixerLiveEq([bus: self.eqBands(for: bus).dict()])
                eqNote = nil
            } catch {
                eqNote = "EQ change didn't reach the on-air engine — adjusting locally."
            }
        }
    }

    private func eqBands(for bus: String) -> EqBands {
        switch bus {
        case "mic": return eqMic
        case "bed": return eqBed
        default: return eqMaster
        }
    }

    /// Fire a jingle on air (the pad's local flash always happens regardless).
    /// 422 means the jingle predates server-hosted audio — tell the operator.
    func fireJingle(_ j: MixerJingle) {
        guard engineConnected else { return }
        jingleNote = nil
        let label = j.label.isEmpty ? "Jingle" : j.label
        Task {
            do { try await PortalAPI.mixerLiveJingle(j.id) }
            catch let e as APIError {
                if case .http(let status, _) = e, status == 422 {
                    jingleNote = "Re-upload \"\(label)\" — its audio isn't stored on the server."
                } else {
                    jingleNote = "Couldn't fire \"\(label)\" on the live engine."
                }
            } catch {
                jingleNote = "Couldn't fire \"\(label)\" on the live engine."
            }
        }
    }

    func saveCurrentAsScene(name: String, hint: String) {
        Task {
            busy = true; actionError = nil
            do {
                let scene = try await createScene(name: name, hint: hint, channels: channels, isDefault: false)
                scenes.append(scene)
                activeSceneId = scene.id
            } catch {
                actionError = (error as? APIError)?.errorDescription ?? "Could not save the scene."
            }
            busy = false
        }
    }

    /// Upload the picked audio to OUR server first, then create the jingle with the
    /// returned URL — the live engine can only fire server-hosted audio (422 otherwise).
    func addJingle(label: String, fileURL: URL) {
        Task {
            busy = true; actionError = nil
            let scoped = fileURL.startAccessingSecurityScopedResource()
            defer { if scoped { fileURL.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: fileURL)
                if let msg = AudioUploadRules.validate(filename: fileURL.lastPathComponent, byteCount: data.count) {
                    actionError = msg
                    busy = false
                    return
                }
                let up = try await PortalAPI.uploadRadioAudio(data: data, filename: fileURL.lastPathComponent)
                let body: [String: MixJSON] = [
                    "label": .string(label),
                    "color": .string("#E6C66E"),
                    "audio_url": .string(up.url),
                    "sort": .int(jingles.count),
                ]
                let j = try await APIClient.shared.post("/admin/radio/mixer/jingles", body: body, as: MixerJingle.self)
                jingles.append(j)
            } catch {
                actionError = (error as? APIError)?.errorDescription ?? "Could not add the jingle."
            }
            busy = false
        }
    }

    func deleteJingle(_ id: String) {
        Task {
            do {
                _ = try await APIClient.shared.delete("/admin/radio/mixer/jingles/\(id)", as: EmptyOk.self)
                jingles.removeAll { $0.id == id }
            } catch {
                actionError = (error as? APIError)?.errorDescription ?? "Could not delete the jingle."
            }
        }
    }

    struct EmptyOk: Codable {}
}

// MARK: - MixerStudioView

struct MixerStudioView: View {
    @StateObject private var m = MixerModel()
    @State private var showSaveScene = false
    @State private var showAddJingle = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let error = m.error, m.scenes.isEmpty, !m.loaded {
                    DarkError(message: error) { Task { await m.load() } }
                } else {
                    scenePresets
                    channelStrips
                    eqAndSound
                    musicBed
                    jingleBoard
                }
            }
            .padding(18).padding(.bottom, 48)
        }
        .background(Rs.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task { if !m.loaded { await m.load() } }
        .task { await m.pollEngine() }   // 5s status loop; cancelled on disappear
        .sheet(isPresented: $showSaveScene) {
            NameSheet(title: "Save scene", placeholder: "Scene name", hintPlaceholder: "Hint (optional)") { name, hint in
                m.saveCurrentAsScene(name: name, hint: hint)
            }
        }
        .sheet(isPresented: $showAddJingle) {
            AddJingleSheet { label, url in m.addJingle(label: label, fileURL: url) }
        }
        .alert("Something went wrong", isPresented: Binding(get: { m.actionError != nil }, set: { if !$0 { m.actionError = nil } })) {
            Button("OK", role: .cancel) { m.actionError = nil }
        } message: { Text(m.actionError ?? "") }
    }

    private var header: some View {
        StudioPanel(padding: 20) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text("OPERATIONS").font(.inter(10.5, .bold)).tracking(1.4).foregroundStyle(Rs.dim)
                    Image(systemName: "chevron.right").font(.system(size: 7)).foregroundStyle(Rs.faint)
                    Text("Mixer Studio").font(.inter(10.5, .bold)).tracking(1.4).foregroundStyle(Rs.text)
                    Spacer()
                    EngineChip(connected: m.engineConnected)
                }
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("VIRTUAL AUDIO MIXER").font(.inter(10.5, .bold)).tracking(1.8).foregroundStyle(Rs.gold)
                        Text("Mixer Studio").font(Rs.serif(30)).foregroundStyle(Rs.text)
                        Text("Balance every source, recall a scene, and drop jingles between segments.")
                            .font(.inter(13)).foregroundStyle(Rs.dim).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 12)
                    Button { showSaveScene = true } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "square.and.arrow.down").font(.system(size: 11, weight: .bold))
                            Text("Save scene").font(.inter(12, .bold))
                        }
                        .foregroundStyle(Color(hex: 0x0A1120))
                        .padding(.horizontal, 14).frame(height: 34).background(Rs.goldFill).clipShape(Capsule())
                    }.pressable()
                }
            }
        }
    }

    // MARK: Scene presets

    private var scenePresets: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                StudioHeader(icon: "rectangle.stack.fill", title: "Scene presets", caption: "\(m.scenes.count) saved")
                if m.scenes.isEmpty {
                    Text(m.loaded ? "No scenes yet — save the current mix to create one." : "Loading scenes…")
                        .font(.inter(12)).foregroundStyle(Rs.dim).padding(.vertical, 6)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10, alignment: .top)], spacing: 10) {
                        ForEach(m.scenes) { s in
                            let on = s.id == m.activeSceneId
                            Button { m.applyScene(s) } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "slider.horizontal.3").font(.system(size: 12)).foregroundStyle(on ? Rs.gold : Rs.dim)
                                        Text(s.name.isEmpty ? "Scene" : s.name).font(.inter(13, .bold)).foregroundStyle(on ? Rs.text : Rs.dim).lineLimit(1)
                                        if s.isDefault { Image(systemName: "star.fill").font(.system(size: 8)).foregroundStyle(Rs.gold) }
                                    }
                                    Text(s.hint ?? "\(s.channels.count) channels").font(.inter(10.5)).foregroundStyle(Rs.dim).lineLimit(1)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 12).padding(.vertical, 11)
                                .background(on ? Rs.gold.opacity(0.10) : Color.white.opacity(0.03))
                                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(on ? Rs.gold.opacity(0.45) : Rs.border, lineWidth: 1))
                            }.pressable()
                        }
                    }
                }
                if let note = m.sceneNote {
                    Text(note).font(.inter(11)).foregroundStyle(Rs.red).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: Channel strips + master (live-mapped strips push debounced gains)

    private var channelStrips: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                StudioHeader(icon: "slider.vertical.3", title: "Channel strips", caption: "\(m.channels.count) + master")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach($m.channels) { $ch in
                            ChannelStrip(channel: $ch,
                                         soloActive: m.channels.contains { $0.solo },
                                         localOnly: m.engineConnected && MixerModel.engineKey(forStrip: ch.id) == nil)
                                .onChange(of: ch.level) { _, v in m.liveLevelChanged(stripId: ch.id, level: v, muted: ch.muted) }
                                .onChange(of: ch.muted) { _, muted in m.liveLevelChanged(stripId: ch.id, level: ch.level, muted: muted) }
                        }
                        MasterStrip(level: $m.master)
                            .onChange(of: m.master) { _, v in m.masterChanged(v) }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    // MARK: EQ & sound presets (REAL — 3-band peaking EQ per bus on the live engine)

    private var eqAndSound: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                StudioHeader(icon: "waveform.path", title: "EQ & Sound", caption: "100 Hz · 1.2 kHz · 8 kHz")
                // Preset chips — active one highlighted; any manual tweak clears it.
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(MixerModel.eqPresets) { p in
                            EqPresetChip(name: p.name, active: p.id == m.activeEqPreset) {
                                m.applyEqPreset(p)
                            }
                        }
                    }
                    .padding(.vertical, 1)
                }
                Text("Presets shape tone (EQ); some also set the mic/music balance. Use Scenes for full level recalls.")
                    .font(.inter(10.5)).foregroundStyle(Rs.dim)
                // Three bus groups: MIC (gold) · MUSIC BED (green) · MASTER (white).
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        EqBusGroup(title: "MIC", tint: Rs.gold, bands: $m.eqMic) { m.eqEdited("mic") }
                        EqBusGroup(title: "MUSIC BED", tint: Rs.green, bands: $m.eqBed) { m.eqEdited("bed") }
                        EqBusGroup(title: "MASTER", tint: Rs.text, bands: $m.eqMaster) { m.eqEdited("master") }
                    }
                    .padding(.vertical, 2)
                }
                if let note = m.eqNote {
                    Text(note).font(.inter(11)).foregroundStyle(Rs.red).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: Music bed (client-only player)

    private var musicBed: some View {
        MusicBedPanel()
    }

    // MARK: Jingle soundboard

    private var jingleBoard: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    StudioHeader(icon: "music.note.list", title: "Jingle soundboard", tint: Rs.green)
                    Button { showAddJingle = true } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "plus").font(.system(size: 10, weight: .bold))
                            Text("Add").font(.inter(11.5, .semibold))
                        }.foregroundStyle(Rs.gold).padding(.horizontal, 11).frame(height: 30)
                        .background(Rs.gold.opacity(0.12)).clipShape(Capsule()).overlay(Capsule().stroke(Rs.gold.opacity(0.3), lineWidth: 1))
                    }.pressable()
                }
                if m.jingles.isEmpty {
                    Text(m.loaded ? "No jingles yet — add one to build the soundboard." : "Loading…")
                        .font(.inter(12)).foregroundStyle(Rs.dim).padding(.vertical, 6)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10, alignment: .top)], spacing: 10) {
                        ForEach(m.jingles) { j in
                            JinglePad(jingle: j, onFire: { m.fireJingle(j) }, onDelete: { m.deleteJingle(j.id) })
                        }
                    }
                }
                if let note = m.jingleNote {
                    Text(note).font(.inter(11)).foregroundStyle(Rs.red).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

// MARK: - Channel strip

private struct ChannelStrip: View {
    @Binding var channel: LocalChannel
    let soloActive: Bool
    /// True while the engine is connected but this strip isn't in the live path.
    let localOnly: Bool
    var body: some View {
        let color = chColor(channel.color)
        let dimmed = soloActive && !channel.solo
        return VStack(spacing: 8) {
            VStack(spacing: 1) {
                Text(channel.name).font(.inter(11.5, .bold)).foregroundStyle(Rs.text).lineLimit(1)
                Text(channel.sub).font(.inter(9)).foregroundStyle(Rs.dim).lineLimit(1)
            }.frame(height: 30)

            // Vertical level fader (rotated Slider is finicky; use a tap/drag track).
            VerticalFader(value: $channel.level, color: channel.muted ? Rs.faint : color)
                .frame(width: 44, height: 150)

            Text("\(Int(channel.level))").font(Rs.mono(10, .semibold)).foregroundStyle(Rs.dim)

            // Pan
            VStack(spacing: 3) {
                Text("PAN").font(.inter(7.5, .bold)).tracking(0.6).foregroundStyle(Rs.faint)
                Slider(value: $channel.pan, in: -100...100).tint(color).frame(width: 52)
            }

            HStack(spacing: 5) {
                toggle("M", on: channel.muted, color: Rs.red) { channel.muted.toggle() }
                toggle("S", on: channel.solo, color: Rs.gold) { channel.solo.toggle() }
            }
        }
        .frame(width: 74)
        .padding(.horizontal, 8).padding(.vertical, 12)
        .background(Color.white.opacity(0.03)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.border, lineWidth: 1))
        // Tiny corner tag (overlay, so strip/master fader alignment never shifts).
        .overlay(alignment: .topTrailing) {
            if localOnly {
                Text("LOCAL").font(.inter(6.5, .bold)).tracking(0.7).foregroundStyle(Rs.faint)
                    .padding(.horizontal, 4).padding(.vertical, 2)
                    .background(Color.white.opacity(0.06)).clipShape(Capsule())
                    .padding(4)
            }
        }
        .opacity(dimmed ? 0.5 : 1)
    }
    private func toggle(_ s: String, on: Bool, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(s).font(.inter(11, .bold)).foregroundStyle(on ? Color(hex: 0x0A1120) : Rs.dim)
                .frame(width: 26, height: 26)
                .background(on ? color : Color.white.opacity(0.05)).clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }.pressable()
    }
}

private struct MasterStrip: View {
    @Binding var level: Double
    var body: some View {
        VStack(spacing: 8) {
            VStack(spacing: 1) {
                Text("MASTER").font(.inter(11.5, .bold)).foregroundStyle(Rs.gold)
                Text("Main out").font(.inter(9)).foregroundStyle(Rs.dim)
            }.frame(height: 30)
            VerticalFader(value: $level, color: Rs.gold).frame(width: 44, height: 150)
            Text("\(Int(level))").font(Rs.mono(10, .semibold)).foregroundStyle(Rs.gold)
            Spacer(minLength: 0).frame(height: 22)
            Image(systemName: "speaker.wave.3.fill").font(.system(size: 12)).foregroundStyle(Rs.gold).frame(height: 26)
        }
        .frame(width: 74)
        .padding(.horizontal, 8).padding(.vertical, 12)
        .background(Rs.gold.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.gold.opacity(0.3), lineWidth: 1))
    }
}

/// A vertical fader — a drag-controlled track (stable, fixed frame).
private struct VerticalFader: View {
    @Binding var value: Double     // 0..100
    var color: Color
    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            let fill = h * CGFloat(value / 100)
            ZStack(alignment: .bottom) {
                Capsule().fill(Color.white.opacity(0.06)).frame(width: 8)
                Capsule().fill(color).frame(width: 8, height: fill)
                // Knob
                Circle().fill(Rs.text).frame(width: 20, height: 20)
                    .overlay(Circle().stroke(color, lineWidth: 2))
                    .offset(y: -(fill - 10).clamped(to: 0...(h - 20)))
                    .shadow(color: .black.opacity(0.4), radius: 3, y: 1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { g in
                    let v = Double((h - g.location.y) / h) * 100
                    value = min(100, max(0, v))
                }
            )
        }
    }
}

private extension CGFloat { func clamped(to r: ClosedRange<CGFloat>) -> CGFloat { Swift.min(Swift.max(self, r.lowerBound), r.upperBound) } }

// MARK: - EQ & Sound components

/// A tone-preset chip; the active one carries the gold fill.
private struct EqPresetChip: View {
    let name: String
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(name).font(.inter(11.5, .bold))
                .foregroundStyle(active ? Color(hex: 0x0A1120) : Rs.dim)
                .padding(.horizontal, 13).frame(height: 28)
                .background(active ? AnyShapeStyle(Rs.goldFill) : AnyShapeStyle(Color.white.opacity(0.04)))
                .clipShape(Capsule())
                .overlay(Capsule().stroke(active ? Rs.gold.opacity(0.5) : Rs.border, lineWidth: 1))
        }.pressable()
    }
}

/// One bus (MIC / MUSIC BED / MASTER): three LOW/MID/HIGH sliders in a tinted card,
/// visually the EQ sibling of the channel strips.
private struct EqBusGroup: View {
    let title: String
    let tint: Color
    @Binding var bands: EqBands
    /// Fired on any manual slider tweak in this bus (the model debounces per bus).
    let onEdit: () -> Void
    var body: some View {
        VStack(spacing: 10) {
            Text(title).font(.inter(9.5, .bold)).tracking(1.2).foregroundStyle(tint).lineLimit(1)
            HStack(alignment: .top, spacing: 8) {
                EqSlider(label: "LOW", freq: "100 Hz", value: $bands.low, color: tint, onEdit: onEdit)
                EqSlider(label: "MID", freq: "1.2 kHz", value: $bands.mid, color: tint, onEdit: onEdit)
                EqSlider(label: "HIGH", freq: "8 kHz", value: $bands.high, color: tint, onEdit: onEdit)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 12)
        .background(Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.border, lineWidth: 1))
    }
}

/// A slim center-origin vertical EQ slider (−12…+12 dB, 0.5 dB steps) with a live
/// mono readout, a subtle 0 dB center tick, and a frequency caption. Center-origin
/// fill needs its own control — the channel VerticalFader fills from the bottom.
private struct EqSlider: View {
    let label: String       // LOW / MID / HIGH
    let freq: String        // 100 Hz · 1.2 kHz · 8 kHz
    @Binding var value: Double   // −12…+12 dB
    var color: Color
    /// User drags only — preset writes set the binding directly and skip this,
    /// so applying a preset never clears its own highlight.
    var onEdit: () -> Void

    var body: some View {
        VStack(spacing: 5) {
            Text(value == 0 ? "0.0" : String(format: "%+.1f", value))
                .font(Rs.mono(10, .semibold))
                .foregroundStyle(value == 0 ? Rs.dim : color)
            GeometryReader { geo in
                let w = geo.size.width, h = geo.size.height
                let mid = h / 2
                let travel = mid - 9                       // keeps the 14pt knob inside
                let knobY = mid - CGFloat(value / 12) * travel
                ZStack {
                    Capsule().fill(Color.white.opacity(0.06))
                        .frame(width: 5, height: h)
                        .position(x: w / 2, y: mid)
                    // Subtle 0 dB center tick.
                    Rectangle().fill(Color.white.opacity(0.16))
                        .frame(width: 16, height: 1)
                        .position(x: w / 2, y: mid)
                    // Fill runs from the center tick to the knob (boost up, cut down).
                    Capsule().fill(color.opacity(0.9))
                        .frame(width: 5, height: max(abs(knobY - mid), 2))
                        .position(x: w / 2, y: (knobY + mid) / 2)
                    Circle().fill(Rs.text)
                        .frame(width: 14, height: 14)
                        .overlay(Circle().stroke(color, lineWidth: 1.5))
                        .shadow(color: .black.opacity(0.4), radius: 2, y: 1)
                        .position(x: w / 2, y: knobY)
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0).onChanged { g in
                        let raw = Double((mid - g.location.y) / travel) * 12
                        let stepped = (min(12, max(-12, raw)) * 2).rounded() / 2
                        if stepped != value {
                            value = stepped
                            onEdit()
                        }
                    }
                )
            }
            .frame(width: 38, height: 110)
            VStack(spacing: 1) {
                Text(label).font(.inter(8, .bold)).tracking(0.6).foregroundStyle(Rs.dim)
                Text(freq).font(.inter(7.5)).foregroundStyle(Rs.faint)
            }
        }
    }
}

// MARK: - Music bed player (client-only)

private struct MusicBedPanel: View {
    @State private var playing = false
    @State private var progress: Double = 0.28
    @State private var volume: Double = 30
    // Timer lives in @State so it can be cancelled off-screen / when the scene is
    // inactive, and skipped entirely under Reduce Motion (frozen progress bar).
    @State private var clock = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                StudioHeader(icon: "music.quarternote.3", title: "Music bed", caption: "under-service loop")
                HStack(spacing: 14) {
                    Button { playing.toggle() } label: {
                        Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Color(hex: 0x0A1120)).frame(width: 46, height: 46)
                            .background(Rs.goldFill).clipShape(Circle())
                    }.pressable()
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Ambient Pad — Loop A").font(.inter(12.5, .semibold)).foregroundStyle(Rs.text)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.white.opacity(0.06))
                                Capsule().fill(Rs.gold).frame(width: geo.size.width * progress)
                            }
                        }.frame(height: 5)
                    }
                    VStack(spacing: 3) {
                        Image(systemName: "speaker.wave.2.fill").font(.system(size: 10)).foregroundStyle(Rs.dim)
                        Slider(value: $volume, in: 0...100).tint(Rs.gold).frame(width: 72)
                    }
                }
            }
        }
        .onReceive(clock) { _ in if playing { progress += 0.01; if progress >= 1 { progress = 0 } } }
        .onAppear { startClock() }
        .onDisappear { stopClock() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { startClock() } else { stopClock() }
        }
    }
    private func startClock() {
        stopClock()
        guard !reduceMotion else { return }   // frozen progress under Reduce Motion
        clock = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()
    }
    private func stopClock() { clock.upstream.connect().cancel() }
}

// MARK: - Jingle pad

private struct JinglePad: View {
    let jingle: MixerJingle
    let onFire: () -> Void
    let onDelete: () -> Void
    var body: some View {
        let color = chColor(jingle.color ?? "#E6C66E")
        // The pad is a real Button: the press flash comes from the shared
        // PressableButtonStyle, and firing now also drops the jingle on air
        // when the live engine is connected (no-op offline, as before).
        return Button(action: onFire) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "play.circle.fill").font(.system(size: 20)).foregroundStyle(color)
                    Spacer()
                    Button(action: onDelete) { Image(systemName: "trash").font(.system(size: 11)).foregroundStyle(Rs.dim) }.pressable()
                }
                Text(jingle.label.isEmpty ? "Jingle" : jingle.label).font(.inter(12.5, .semibold)).foregroundStyle(Rs.text).lineLimit(2)
            }
            .frame(maxWidth: .infinity, minHeight: 78, alignment: .topLeading)
            .padding(12)
            .background(color.opacity(0.10)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(color.opacity(0.3), lineWidth: 1))
        }
        .pressable()
        .hoverEffect(.highlight)
    }
}

// MARK: - Live engine status chip

/// Top-bar chip: green pulsing "LIVE MIX" while the on-air engine is connected,
/// a dim "LOCAL — engine offline" otherwise. The pulse is skipped entirely under
/// Reduce Motion (static dot).
private struct EngineChip: View {
    let connected: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(connected ? Rs.green : Rs.faint).frame(width: 7, height: 7)
                .opacity(pulsing ? 0.35 : 1)
                .animation(pulsing ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : .default, value: pulsing)
            Text(connected ? "LIVE MIX" : "LOCAL — ENGINE OFFLINE")
                .font(.inter(9.5, .bold)).tracking(1.2)
                .foregroundStyle(connected ? Rs.green : Rs.dim)
        }
        .padding(.horizontal, 11).frame(height: 26)
        .background((connected ? Rs.green : Color.white).opacity(connected ? 0.10 : 0.04))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(connected ? Rs.green.opacity(0.35) : Rs.border, lineWidth: 1))
        .onAppear { pulsing = connected && !reduceMotion }
        .onChange(of: connected) { _, c in pulsing = c && !reduceMotion }
    }
}

// MARK: - Add-jingle sheet (label + REAL audio file upload)

/// Collects a label and an audio file; Save is disabled until both exist. The
/// picked file is uploaded to our server by the model before the jingle is
/// created, so the live engine can fire it (a URL-less jingle would 422 on air).
private struct AddJingleSheet: View {
    let onSave: (String, URL) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var fileURL: URL?
    @State private var showImporter = false
    @State private var pickError: String?
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                TextField("", text: $label, prompt: Text("Jingle label").foregroundColor(Rs.faint))
                    .font(.inter(15)).foregroundStyle(Rs.text).tint(Rs.gold)
                    .padding(.horizontal, 14).frame(height: 46)
                    .background(Color.white.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.border, lineWidth: 1))
                Button { showImporter = true } label: {
                    HStack(spacing: 8) {
                        Image(systemName: fileURL == nil ? "waveform.badge.plus" : "waveform")
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(Rs.gold)
                        Text(fileURL?.lastPathComponent ?? "Choose audio file")
                            .font(.inter(13, .semibold))
                            .foregroundStyle(fileURL == nil ? Rs.dim : Rs.text).lineLimit(1)
                        Spacer()
                    }
                    .padding(.horizontal, 14).frame(height: 46)
                    .background(Color.white.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.border, lineWidth: 1))
                }.pressable()
                Text("The audio is uploaded to the server so the live engine can fire it on air.")
                    .font(.inter(11)).foregroundStyle(Rs.dim)
                if let pickError {
                    Text(pickError).font(.inter(11)).foregroundStyle(Rs.red)
                }
                Spacer()
            }
            .padding(18)
            .background(Rs.bg.ignoresSafeArea())
            .navigationTitle("Add jingle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundStyle(Rs.dim) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let n = label.trimmingCharacters(in: .whitespaces)
                        if !n.isEmpty, let url = fileURL { onSave(n, url); dismiss() }
                    }
                    .font(.inter(15, .bold)).foregroundStyle(Rs.gold)
                    .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || fileURL == nil)
                }
            }
        }
        .preferredColorScheme(.dark)
        .fileImporter(isPresented: $showImporter,
                      allowedContentTypes: AudioUploadRules.allowedContentTypes) { result in
            switch result {
            case .success(let url):
                // Validate right at pick time so the error shows inline in the sheet
                // (the actual upload happens after Save, once the sheet is gone).
                let scoped = url.startAccessingSecurityScopedResource()
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if scoped { url.stopAccessingSecurityScopedResource() }
                if let msg = AudioUploadRules.validate(filename: url.lastPathComponent, byteCount: size) {
                    fileURL = nil; pickError = msg
                } else {
                    fileURL = url; pickError = nil
                }
            case .failure(let err): pickError = err.localizedDescription
            }
        }
    }
}

// MARK: - Simple name-entry sheet (save scene)

private struct NameSheet: View {
    let title: String
    let placeholder: String
    let hintPlaceholder: String?
    let onSave: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var hint = ""
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                fieldBox(placeholder, text: $name)
                if hintPlaceholder != nil { fieldBox(hintPlaceholder!, text: $hint) }
                Spacer()
            }
            .padding(18)
            .background(Rs.bg.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundStyle(Rs.dim) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let n = name.trimmingCharacters(in: .whitespaces)
                        if !n.isEmpty { onSave(n, hint.trimmingCharacters(in: .whitespaces)); dismiss() }
                    }.font(.inter(15, .bold)).foregroundStyle(Rs.gold).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
    private func fieldBox(_ ph: String, text: Binding<String>) -> some View {
        TextField("", text: text, prompt: Text(ph).foregroundColor(Rs.faint))
            .font(.inter(15)).foregroundStyle(Rs.text).tint(Rs.gold)
            .padding(.horizontal, 14).frame(height: 46)
            .background(Color.white.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.border, lineWidth: 1))
    }
}

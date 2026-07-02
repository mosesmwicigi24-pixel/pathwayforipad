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

    /// One in-flight debounce task per engine channel (cancel-and-replace).
    private var levelPushTasks: [String: Task<Void, Never>] = [:]

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
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
    }

    /// A strip's level or mute changed. Mapped strips push to the engine when it is
    /// connected; mute sends 0 and unmute re-sends the fader value. Offline (or on an
    /// unmapped strip) this is a no-op — exactly the old local behaviour.
    func liveLevelChanged(stripId: String, level: Double, muted: Bool) {
        guard let key = MixerModel.engineKey(forStrip: stripId) else { return }
        pushLiveLevel(key, value: muted ? 0 : Int(level.rounded()))
    }

    func masterChanged(_ value: Double) {
        pushLiveLevel("master", value: Int(value.rounded()))
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

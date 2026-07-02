// Radio Broadcast Studio + Virtual Mixer — shared wire models.
// Mirrors the frozen backend contract (docs/RADIO_STUDIO_CONTRACT.md). APIClient
// decodes with convertFromSnakeCase, so snake_case keys map to the camelCase
// properties here. Every field uses a resilient default (@DefaultEmpty/@DefaultZero/
// @DefaultFalse) or a plain optional so a partial/null-heavy payload never crashes a
// whole screen — the admin studio degrades gracefully rather than throwing.
import Foundation

// MARK: - RadioProgram (admin view — includes the secret stream_key)

struct RadioProgram: Codable, Identifiable, Equatable {
    @DefaultEmpty var id: String
    @DefaultEmpty var title: String
    let description: String?
    @DefaultEmpty var category: String        // Sermon|Worship|Prayer|Bible Study|Conference
    let speaker: String?
    let location: String?
    let artworkUrl: String?
    @DefaultEmptyStrings var tags: [String]
    @DefaultEmpty var visibility: String      // public|members|private
    let scheduledAt: String?
    let durationMin: Int?
    let repeatRule: String?
    let timezone: String?
    @DefaultEmpty var status: String          // draft|scheduled|live|ended
    @DefaultEmpty var loopMode: String        // none | loop_all | repeat_one
    @DefaultFalse var isLive: Bool
    let liveStartedAt: String?
    let liveEndedAt: String?
    @DefaultFalse var recordBroadcast: Bool
    let recordTarget: String?                 // cloud|local|both
    @DefaultZero var peakListeners: Int
    let ingestProvider: String?
    let ingestUrl: String?
    let streamKey: String?
    let hlsUrl: String?
    // Uploaded session audio + auto-air scheduler (contract ADDENDUM 2026-07-02).
    let audioUrl: String?
    let audioDurationSec: Int?
    @DefaultTrue var autoGoLive: Bool
    let createdBy: String?
    let createdAt: String?
    let updatedAt: String?

    // `repeat` is a Swift keyword — decode the wire key into `repeatRule`. The
    // decoder's convertFromSnakeCase strategy transforms both the JSON key and this
    // raw value ("repeat" → "repeat"), so the mapping matches.
    enum CodingKeys: String, CodingKey {
        case id, title, description, category, speaker, location, artworkUrl, tags, visibility
        case scheduledAt, durationMin, timezone, status, loopMode, isLive, liveStartedAt, liveEndedAt
        case recordBroadcast, recordTarget, peakListeners, ingestProvider, ingestUrl, streamKey, hlsUrl
        case audioUrl, audioDurationSec, autoGoLive
        case createdBy, createdAt, updatedAt
        case repeatRule = "repeat"
    }

    static func == (l: RadioProgram, r: RadioProgram) -> Bool { l.id == r.id && l.status == r.status && l.streamKey == r.streamKey }
}

// MARK: - Audio library + session playlist (contract ADDENDUM)

/// A reusable audio-library asset (music | preaching | audio). Members do get audio_url.
struct RadioTrack: Codable, Identifiable, Equatable {
    @DefaultEmpty var id: String
    @DefaultEmpty var title: String
    @DefaultEmpty var kind: String            // music | preaching | audio
    @DefaultEmpty var audioUrl: String
    let durationSec: Int?
    let sizeBytes: Int?
    let createdAt: String?

    static func == (l: RadioTrack, r: RadioTrack) -> Bool { l.id == r.id && l.title == r.title && l.kind == r.kind }
}

/// One ordered slot in a session playlist, embedding its track.
struct RadioPlaylistItem: Codable, Identifiable, Equatable {
    @DefaultEmpty var id: String
    @DefaultZero var position: Int
    let track: RadioTrack

    static func == (l: RadioPlaylistItem, r: RadioPlaylistItem) -> Bool { l.id == r.id && l.position == r.position && l.track == r.track }
}

/// `/rotate-key` → { stream_key }
struct RadioStreamKey: Codable { let streamKey: String? }

/// `POST /admin/media/audio/upload` → { url, duration_sec? }
struct RadioAudioUpload: Codable { let url: String; let durationSec: Int? }

/// `/health` (live only). All simulated-but-stable numbers from the fake provider.
struct StreamHealth: Codable {
    @DefaultZeroD var cpu: Double
    @DefaultZeroD var memory: Double
    @DefaultZeroD var bitrate: Double
    @DefaultZeroD var latency: Double
    @DefaultZero var dropped: Int
    @DefaultZeroD var stability: Double
    @DefaultZero var listeners: Int
}

struct RadioComment: Codable, Identifiable {
    @DefaultEmpty var id: String
    let memberId: String?
    let memberName: String?
    @DefaultEmpty var body: String
    @DefaultFalse var hidden: Bool
    let createdAt: String?
}

// MARK: - Mixer

struct MixerChannel: Codable, Identifiable, Equatable {
    @DefaultEmpty var id: String
    @DefaultEmpty var name: String
    let sub: String?
    let color: String?
    @DefaultZeroD var level: Double           // 0..100
    @DefaultZeroD var pan: Double             // -100..100
    @DefaultFalse var muted: Bool
    @DefaultFalse var solo: Bool
}

struct MixerScene: Codable, Identifiable, Equatable {
    @DefaultEmpty var id: String
    @DefaultEmpty var name: String
    let hint: String?
    @DefaultEmptyChannels var channels: [MixerChannel]
    @DefaultFalse var isDefault: Bool
    let createdAt: String?
    let updatedAt: String?

    static func == (l: MixerScene, r: MixerScene) -> Bool { l.id == r.id && l.name == r.name && l.channels == r.channels }
}

struct MixerJingle: Codable, Identifiable, Equatable {
    @DefaultEmpty var id: String
    @DefaultEmpty var label: String
    let color: String?
    let audioUrl: String?
    @DefaultZero var sort: Int
    let createdAt: String?
}

/// `GET /admin/radio/mixer/live/status` → `{ connected, gains? }`. The endpoint
/// never errors (an unconfigured engine just reports connected:false), and the
/// resilient defaults keep a partial payload from ever throwing.
struct MixerLiveStatus: Codable {
    @DefaultFalse var connected: Bool
    let gains: [String: Double]?
}

// MARK: - List defaults for [String] / [MixerChannel]

enum EmptyStringsProvider: DefaultValueProvider { static let defaultValue: [String] = [] }
typealias DefaultEmptyStrings = DefaultCodable<EmptyStringsProvider>

enum EmptyChannelsProvider: DefaultValueProvider { static let defaultValue: [MixerChannel] = [] }
typealias DefaultEmptyChannels = DefaultCodable<EmptyChannelsProvider>

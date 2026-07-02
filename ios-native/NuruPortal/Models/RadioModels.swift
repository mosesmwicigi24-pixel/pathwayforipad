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
    let createdBy: String?
    let createdAt: String?
    let updatedAt: String?

    // `repeat` is a Swift keyword — decode the wire key into `repeatRule`. The
    // decoder's convertFromSnakeCase strategy transforms both the JSON key and this
    // raw value ("repeat" → "repeat"), so the mapping matches.
    enum CodingKeys: String, CodingKey {
        case id, title, description, category, speaker, location, artworkUrl, tags, visibility
        case scheduledAt, durationMin, timezone, status, isLive, liveStartedAt, liveEndedAt
        case recordBroadcast, recordTarget, peakListeners, ingestProvider, ingestUrl, streamKey, hlsUrl
        case createdBy, createdAt, updatedAt
        case repeatRule = "repeat"
    }

    static func == (l: RadioProgram, r: RadioProgram) -> Bool { l.id == r.id && l.status == r.status && l.streamKey == r.streamKey }
}

/// `/rotate-key` → { stream_key }
struct RadioStreamKey: Codable { let streamKey: String? }

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

// MARK: - List defaults for [String] / [MixerChannel]

enum EmptyStringsProvider: DefaultValueProvider { static let defaultValue: [String] = [] }
typealias DefaultEmptyStrings = DefaultCodable<EmptyStringsProvider>

enum EmptyChannelsProvider: DefaultValueProvider { static let defaultValue: [MixerChannel] = [] }
typealias DefaultEmptyChannels = DefaultCodable<EmptyChannelsProvider>

// Events & Announcements API surface — the native client of the canonical
// events architecture (pathway docs/EVENTS_ARCHITECTURE.md §3 admin series API,
// §5 announcements lifecycle, §6 attendance & QR, §7 automations).
//
// Decode-tolerance is deliberate and layered:
//  · Models for endpoints that exist on the deployed backend today (calendar
//    projection, rosters, announcements CRUD, moments) use the shared
//    @Default* wrappers with exact contract keys.
//  · Models for the NEW §3/§5/§6 endpoints (series list/detail/timeline,
//    search, insights, qr, duplicate/archive/restore) decode through EvKey
//    candidate-key lookups so the client works unchanged across the backend
//    rollout — and every view degrades honestly (no fabricated numbers) when
//    an endpoint is not there yet.
import Foundation

// MARK: - Conditional JSON body (omit-null, mirrors the web spreads)

indirect enum EJSON: Encodable {
    case string(String), int(Int), bool(Bool), null
    case array([EJSON]), object([String: EJSON]), ints([Int])
    func encode(to encoder: Encoder) throws {
        switch self {
        case .string(let v): var c = encoder.singleValueContainer(); try c.encode(v)
        case .int(let v):    var c = encoder.singleValueContainer(); try c.encode(v)
        case .bool(let v):   var c = encoder.singleValueContainer(); try c.encode(v)
        case .null:          var c = encoder.singleValueContainer(); try c.encodeNil()
        case .array(let a):  var c = encoder.unkeyedContainer(); for v in a { try c.encode(v) }
        case .ints(let a):   var c = encoder.unkeyedContainer(); for v in a { try c.encode(v) }
        case .object(let o):
            var c = encoder.container(keyedBy: EvKey.self)
            for (k, v) in o { try c.encode(v, forKey: EvKey(k)) }
        }
    }
}

/// Free-form coding key for dynamic containers.
struct EvKey: CodingKey, Hashable {
    var stringValue: String
    var intValue: Int? { nil }
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

// MARK: - Tolerant decode helpers

/// Reads a keyed container through candidate keys (camelCase — the shared
/// decoder converts the snake_case wire before matching).
struct EvReader {
    let c: KeyedDecodingContainer<EvKey>
    init?(_ d: Decoder) { guard let c = try? d.container(keyedBy: EvKey.self) else { return nil }; self.c = c }
    // Note: `try?` flattens the nested optional, so each lookup yields T? where
    // nil covers missing key, explicit null, and a mismatched type alike.
    func string(_ names: [String]) -> String? {
        for n in names { if let v = try? c.decodeIfPresent(String.self, forKey: EvKey(n)) { return v } }
        return nil
    }
    func int(_ names: [String]) -> Int? {
        for n in names {
            if let v = try? c.decodeIfPresent(Int.self, forKey: EvKey(n)) { return v }
            if let v = try? c.decodeIfPresent(Double.self, forKey: EvKey(n)) { return Int(v.rounded()) }
            if let v = try? c.decodeIfPresent(String.self, forKey: EvKey(n)), let i = Int(v) { return i }
        }
        return nil
    }
    func bool(_ names: [String]) -> Bool? {
        for n in names { if let v = try? c.decodeIfPresent(Bool.self, forKey: EvKey(n)) { return v } }
        return nil
    }
    func rows<T: Decodable>(_ names: [String], as type: T.Type) -> [T]? {
        for n in names {
            if let v = try? c.decodeIfPresent(EvRows<T>.self, forKey: EvKey(n)) { return v.items }
        }
        return nil
    }
    func value<T: Decodable>(_ names: [String], as type: T.Type) -> T? {
        for n in names { if let v = try? c.decodeIfPresent(T.self, forKey: EvKey(n)) { return v } }
        return nil
    }
}

/// Swallows one JSON value of any shape (used to skip corrupt rows).
private struct EvIgnore: Decodable { init(from decoder: Decoder) throws {} }

/// An array of T that skips rows failing to decode instead of failing wholesale.
struct EvRows<T: Decodable>: Decodable {
    let items: [T]
    init(from d: Decoder) throws {
        var out: [T] = []
        var u = try d.unkeyedContainer()
        while !u.isAtEnd {
            if let v = try? u.decode(T.self) { out.append(v) }
            else { _ = try? u.decode(EvIgnore.self) }
        }
        items = out
    }
}

/// Accepts either a bare JSON array or a `{data|items|series|rows: [...]}` envelope.
struct EvList<T: Decodable>: Decodable {
    let items: [T]
    init(from d: Decoder) throws {
        if let rows = try? EvRows<T>(from: d) { items = rows.items; return }
        if let r = EvReader(d), let rows = r.rows(["data", "items", "series", "rows", "results"], as: T.self) {
            items = rows; return
        }
        items = []
    }
}

// MARK: - Calendar occurrences (GET /calendar — deployed contract, member-frozen)

struct EvFace: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    let avatarUrl: String?
    var id: String { userId }
}

/// One projected occurrence with the admin-relevant fields.
struct AdminOcc: Codable, Identifiable {
    @DefaultEmpty var occurrenceId: String
    @DefaultEmpty var seriesId: String
    @DefaultEmpty var title: String
    let description: String?
    let location: String?
    @DefaultEmpty var visibility: String
    let category: String?
    let status: String?                 // "draft" | "active"
    let cellGroupId: String?
    let primaryImageUrl: String?
    @DefaultFalse var showOnHome: Bool
    @DefaultEmpty var startAt: String
    @DefaultEmpty var endAt: String
    @DefaultEmpty var originalStartAt: String
    @DefaultFalse var rescheduled: Bool
    @DefaultZero var going: Int
    let attendees: [EvFace]?
    var id: String { occurrenceId }
}
private struct AdminOccPage: Codable { let data: [AdminOcc] }

// MARK: - Admin series (GET /admin/events/series — §3, tolerant)

/// Per-series automation settings (§7 JSONB) — tolerant on read, canonical on write.
struct EvAutomation {
    var reminderOffsetsMin: [Int] = [1440, 60]
    var autoArchiveDays: Int? = nil
    var lowRsvpThreshold: Int? = nil
    var qrAutoReady: Bool = false

    init() {}
    init?(reader r: EvReader?) {
        guard let r else { return nil }
        if let offs = r.value(["reminderOffsetsMin", "reminderOffsets"], as: [Int].self) { reminderOffsetsMin = offs }
        autoArchiveDays = r.int(["autoArchiveDays"])
        // low_rsvp_alert may arrive as an int threshold or {threshold: n}.
        if let t = r.int(["lowRsvpThreshold", "lowRsvpAlert"]) { lowRsvpThreshold = t }
        else if let nested = r.value(["lowRsvpAlert"], as: EvLowRsvpAlert.self) { lowRsvpThreshold = nested.threshold }
        qrAutoReady = r.bool(["qrAutoReady"]) ?? false
    }
    var body: EJSON {
        var o: [String: EJSON] = [
            "reminder_offsets_min": .ints(reminderOffsetsMin),
            "qr_auto_ready": .bool(qrAutoReady),
        ]
        o["auto_archive_days"] = autoArchiveDays.map { .int($0) } ?? .null
        o["low_rsvp_threshold"] = lowRsvpThreshold.map { .int($0) } ?? .null
        return .object(o)
    }
}
private struct EvLowRsvpAlert: Decodable { let threshold: Int? }

/// One row of the admin series list; also the seed the command center opens with.
struct AdminSeriesRow: Decodable, Identifiable {
    var seriesId = ""
    var title = ""
    var description: String?
    var location: String?
    var category: String?
    var status: String?                // draft | active
    var visibility: String?
    var timezone: String?
    var dtstartLocal: String?
    var durationMin: Int?
    var rrule: String?
    var isPaused = false
    var showOnHome = false
    var isFeatured = false
    var cadence: String?
    var nextAt: String?
    var nextOccurrenceId: String?
    var follows: Int?
    var occurrenceCount: Int?
    var rsvpCount: Int?
    var attendanceCount: Int?
    var primaryImageUrl: String?
    var videoUrl: String?
    var rsvpEnabled = true
    var qrEnabled = true
    var manualCheckinEnabled = true
    var remindersEnabled = true
    var checkinOpensMinBefore: Int?
    var cellGroupId: String?
    var splitFrom: String?
    var automation: EvAutomation?
    /// True when the row was synthesized client-side from calendar occurrences
    /// (server series list unavailable) — some fields are then unknown.
    var derived = false
    var id: String { seriesId }

    init() {}
    init(from d: Decoder) throws {
        guard let r = EvReader(d) else { return }
        seriesId = r.string(["seriesId", "id"]) ?? ""
        title = r.string(["title"]) ?? ""
        description = r.string(["description"])
        location = r.string(["location"])
        category = r.string(["category"])
        status = r.string(["status"])
        visibility = r.string(["visibility"])
        timezone = r.string(["timezone"])
        dtstartLocal = r.string(["dtstartLocal"])
        durationMin = r.int(["durationMin"])
        rrule = r.string(["rrule"])
        isPaused = r.bool(["isPaused", "paused"]) ?? false
        showOnHome = r.bool(["showOnHome"]) ?? false
        isFeatured = r.bool(["isFeatured", "featured"]) ?? false
        cadence = r.string(["cadence", "cadenceLabel"])
        nextAt = r.string(["nextAt"])
        nextOccurrenceId = r.string(["nextOccurrenceId"])
        follows = r.int(["follows", "followerCount", "followsCount"])
        occurrenceCount = r.int(["occurrenceCount", "occurrences"])
        rsvpCount = r.int(["rsvpCount", "rsvpGoing", "goingCount"])
        attendanceCount = r.int(["attendanceCount", "checkinCount", "checkedInCount"])
        primaryImageUrl = r.string(["primaryImageUrl"])
        videoUrl = r.string(["videoUrl"])
        rsvpEnabled = r.bool(["rsvpEnabled"]) ?? true
        qrEnabled = r.bool(["qrEnabled"]) ?? true
        manualCheckinEnabled = r.bool(["manualCheckinEnabled", "allowManualCheckin"]) ?? true
        remindersEnabled = r.bool(["remindersEnabled"]) ?? true
        checkinOpensMinBefore = r.int(["checkinOpensMinBefore"])
        cellGroupId = r.string(["cellGroupId"])
        splitFrom = r.string(["splitFrom"])
        automation = EvAutomation(reader: EvReader(fromNested: d, key: "automation"))
    }
}

extension EvReader {
    /// Reader over a nested object value, or nil when absent/not an object.
    init?(fromNested d: Decoder, key: String) {
        guard let outer = try? d.container(keyedBy: EvKey.self),
              let nested = try? outer.nestedContainer(keyedBy: EvKey.self, forKey: EvKey(key)) else { return nil }
        self.c = nested
    }
}

/// A lightweight occurrence inside the series detail (next/recent).
struct EvOccLite: Decodable, Identifiable {
    var eventId = ""
    var startAt = ""
    var endAt: String?
    var going: Int?
    var checkedIn: Int?
    var cancelled = false
    var id: String { eventId.isEmpty ? startAt : eventId }
    init(from d: Decoder) throws {
        guard let r = EvReader(d) else { return }
        eventId = r.string(["eventId", "occurrenceId", "id"]) ?? ""
        startAt = r.string(["startAt", "occursAt", "occurrenceStart"]) ?? ""
        endAt = r.string(["endAt"])
        going = r.int(["going", "rsvpGoing"])
        checkedIn = r.int(["checkedIn", "checkins"])
        cancelled = r.bool(["cancelled", "isCancelled"]) ?? false
    }
}

/// One recorded exception on a series (existing table shape).
struct EvException: Decodable, Identifiable {
    @DefaultEmpty var originalStartAt: String
    @DefaultFalse var isCancelled: Bool
    let newStartAt: String?
    let newEndAt: String?
    let note: String?
    var id: String { originalStartAt }
}

/// Aggregate attendance stats in the series detail.
struct EvSeriesStats {
    var rsvpGoing: Int?
    var conversionPct: Int?
    var checkins: Int?
    var guests: Int?
    var firstTimers: Int?
    var noShows: Int?
    init?(reader r: EvReader?) {
        guard let r else { return nil }
        rsvpGoing = r.int(["rsvpGoing", "going", "rsvpCount"])
        conversionPct = r.int(["conversionPct", "conversion"])
        checkins = r.int(["checkins", "checkedIn", "attendanceCount"])
        guests = r.int(["guests", "guestCount"])
        firstTimers = r.int(["firstTimers", "firstTimeGuests"])
        noShows = r.int(["noShows", "rsvpNoShow"])
    }
}

/// GET /admin/events/series/{id} — everything the command center needs (§3).
struct AdminSeriesDetail: Decodable {
    var series: AdminSeriesRow?
    var nextOccurrences: [EvOccLite] = []
    var recentOccurrences: [EvOccLite] = []
    var exceptions: [EvException] = []
    var announcements: [AnnouncementRow] = []
    var stats: EvSeriesStats?
    init(from d: Decoder) throws {
        guard let r = EvReader(d) else { return }
        series = r.value(["series"], as: AdminSeriesRow.self)
        // Flat payloads carry the series fields at the top level.
        if series == nil, let flat = try? AdminSeriesRow(from: d), !flat.seriesId.isEmpty { series = flat }
        nextOccurrences = r.rows(["nextOccurrences", "upcoming", "next"], as: EvOccLite.self) ?? []
        recentOccurrences = r.rows(["recentOccurrences", "recent"], as: EvOccLite.self) ?? []
        exceptions = r.rows(["exceptions"], as: EvException.self) ?? []
        announcements = r.rows(["announcements", "linkedAnnouncements"], as: AnnouncementRow.self) ?? []
        stats = EvSeriesStats(reader: EvReader(fromNested: d, key: "stats"))
    }
}

/// GET /admin/events/series/{id}/timeline — the audit-log slice (§3).
struct EvTimelineEntry: Decodable, Identifiable {
    var at = ""
    var kind = ""
    var title = ""
    var actorName: String?
    var note: String?
    var id: String { "\(at)-\(kind)-\(title)" }
    init(from d: Decoder) throws {
        guard let r = EvReader(d) else { return }
        at = r.string(["at", "createdAt", "occurredAt"]) ?? ""
        kind = r.string(["kind", "action", "type"]) ?? ""
        title = r.string(["title", "summary", "label"]) ?? kind
        actorName = r.string(["actorName", "actor"])
        note = r.string(["note", "detail", "message"])
    }
}

// MARK: - Insights (GET /admin/events/insights — §6, replaces hard-coded tiles)

struct EvLowRsvpEvent: Decodable, Identifiable {
    var eventId = ""
    var title = ""
    var startAt: String?
    var going: Int?
    var id: String { eventId.isEmpty ? title : eventId }
    init(from d: Decoder) throws {
        guard let r = EvReader(d) else { return }
        eventId = r.string(["eventId", "occurrenceId", "id"]) ?? ""
        title = r.string(["title"]) ?? ""
        startAt = r.string(["startAt", "occursAt"])
        going = r.int(["going", "rsvpGoing"])
    }
}

struct EventsInsights: Decodable {
    var conversionPct: Int?
    var firstTimeGuests30d: Int?
    var manualCheckins7d: Int?
    var rsvpNoShow: Int?
    var noResponse: Int?
    var lowRsvp: [EvLowRsvpEvent] = []
    init(from d: Decoder) throws {
        guard let r = EvReader(d) else { return }
        conversionPct = r.int(["conversionPct", "rsvpConversionPct", "conversion"])
        firstTimeGuests30d = r.int(["firstTimeGuests30d", "firstTimeGuests", "firstTimers30d"])
        manualCheckins7d = r.int(["manualCheckins7d", "manualCheckins"])
        rsvpNoShow = r.int(["rsvpNoShow", "rsvpdAbsent", "noShows"])
        noResponse = r.int(["noResponse", "noResponseCount"])
        lowRsvp = r.rows(["lowRsvp", "lowRsvpEvents", "lowRsvpUpcoming"], as: EvLowRsvpEvent.self) ?? []
    }
}

// MARK: - Search (GET /admin/events/search?q= — §3)

struct EventsSearchResults: Decodable {
    var series: [AdminSeriesRow] = []
    var occurrences: [AdminOcc] = []
    var announcements: [AnnouncementRow] = []
    init(from d: Decoder) throws {
        guard let r = EvReader(d) else { return }
        series = r.rows(["series"], as: AdminSeriesRow.self) ?? []
        occurrences = r.rows(["occurrences", "events", "upcoming"], as: AdminOcc.self) ?? []
        announcements = r.rows(["announcements"], as: AnnouncementRow.self) ?? []
    }
}

// MARK: - Real QR (GET /admin/events/{id}/qr — §6)

/// The REAL check-in token members can scan: the member scanner submits the raw
/// QR string as `scan_token` to POST /events/{id}/attendance, so the panel
/// encodes `scanToken` verbatim (never a made-up client string).
struct EventQr: Decodable {
    let scanToken: String?
    let checkinUrl: String?
    let expiresAt: String?
}

// MARK: - Rosters (deployed contract: attendance.ts / rsvpRoster)

struct EvCheckIn: Codable, Identifiable {
    @DefaultEmpty var attendanceId: String
    @DefaultEmpty var fullName: String
    @DefaultEmpty var method: String
    let note: String?
    @DefaultEmpty var checkedInAt: String
    var id: String { attendanceId }
}
struct EvGuest: Codable, Identifiable {
    @DefaultEmpty var guestId: String
    @DefaultEmpty var guestName: String
    let phone: String?
    @DefaultFalse var firstTime: Bool
    @DefaultEmpty var createdAt: String
    var id: String { guestId }
}
struct EvNoShow: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    var id: String { userId }
}
struct EvRoster: Codable {
    let checkedIn: [EvCheckIn]?
    let guests: [EvGuest]?
    let rsvpNoShow: [EvNoShow]?
    var attended: Int { (checkedIn?.count ?? 0) + (guests?.count ?? 0) }
    var firstTimers: Int { (guests ?? []).filter(\.firstTime).count }
}

struct EvRsvpRow: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    @DefaultEmpty var response: String
    let cellName: String?
    let respondedAt: String?
    var id: String { userId }
}
struct EvRsvpBuckets: Codable {
    let going: [EvRsvpRow]?; let maybe: [EvRsvpRow]?
    let declined: [EvRsvpRow]?; let noResponse: [EvRsvpRow]?
}
struct EvRsvpCounts: Codable {
    @DefaultZero var going: Int; @DefaultZero var maybe: Int
    @DefaultZero var declined: Int; @DefaultZero var noResponse: Int
}
struct EvRsvpRoster: Codable {
    let buckets: EvRsvpBuckets?
    let counts: EvRsvpCounts?
    @DefaultEmpty var noResponseScope: String   // "cell" | "none"
}

// MARK: - Announcements (deployed CRUD + §5 lifecycle additions)

struct AnnouncementRow: Decodable, Identifiable {
    var announcementId = ""
    var title = ""
    var body = ""
    var channels: [String] = []
    var audienceKind = "all"
    var audienceCells: [String] = []
    var audienceLevel: Int?
    var status = "draft"
    var scheduledAt: String?
    var sentAt: String?
    var bannerExpiresAt: String?
    var primaryImageUrl: String?
    var videoUrl: String?
    var isFeatured = false
    var seriesId: String?              // §5 series-attached
    var eventOccurrenceId: String?     // §5 event-attached
    var archivedAt: String?            // §5 archive/restore
    var deliveredCount: Int?
    var openedCount: Int?
    var createdAt: String?
    var id: String { announcementId }

    var isArchived: Bool { archivedAt != nil }
    /// The §5 attachment mode: standalone · event-attached · series-attached.
    var attachmentLabel: String? {
        if let e = eventOccurrenceId, !e.isEmpty { return "This occurrence" }
        if let s = seriesId, !s.isEmpty { return "Whole series" }
        return nil
    }

    init() {}
    init(from d: Decoder) throws {
        guard let r = EvReader(d) else { return }
        announcementId = r.string(["announcementId", "id"]) ?? ""
        title = r.string(["title"]) ?? ""
        body = r.string(["body"]) ?? ""
        channels = r.value(["channels"], as: [String].self) ?? []
        audienceKind = r.string(["audienceKind"]) ?? "all"
        audienceCells = r.value(["audienceCells"], as: [String].self) ?? []
        audienceLevel = r.int(["audienceLevel"])
        status = r.string(["status"]) ?? "draft"
        scheduledAt = r.string(["scheduledAt"])
        sentAt = r.string(["sentAt"])
        bannerExpiresAt = r.string(["bannerExpiresAt"])
        primaryImageUrl = r.string(["primaryImageUrl"])
        videoUrl = r.string(["videoUrl"])
        isFeatured = r.bool(["isFeatured"]) ?? false
        seriesId = r.string(["seriesId"])
        eventOccurrenceId = r.string(["eventOccurrenceId"])
        archivedAt = r.string(["archivedAt"])
        deliveredCount = r.int(["deliveredCount"])
        openedCount = r.int(["openedCount"])
        createdAt = r.string(["createdAt"])
    }
}

/// One per-channel stat row (§5: targeted / delivered / suppressed+reason /
/// failed / opened — nothing we cannot measure is displayed).
struct EvChannelStat: Decodable, Identifiable {
    var channel = ""
    var targeted = 0
    var delivered = 0
    var suppressed = 0
    var failed = 0
    var opened = 0
    var suppressReasons: [String: Int] = [:]
    var id: String { channel }
    init(from d: Decoder) throws {
        guard let r = EvReader(d) else { return }
        channel = r.string(["channel"]) ?? ""
        targeted = r.int(["targeted"]) ?? 0
        delivered = r.int(["delivered"]) ?? 0
        suppressed = r.int(["suppressed"]) ?? 0
        failed = r.int(["failed"]) ?? 0
        opened = r.int(["opened"]) ?? 0
        if let m = r.value(["suppressReasons", "suppressedReasons", "reasons"], as: [String: Int].self) {
            suppressReasons = m
        } else if let s = r.string(["suppressReason", "reason"]), suppressed > 0 {
            suppressReasons = [s: suppressed]
        }
    }
}

/// GET /admin/announcements/{id} — the row plus per-channel stats.
struct AnnouncementDetail: Decodable {
    var row: AnnouncementRow?
    var stats: [EvChannelStat] = []
    init(from d: Decoder) throws {
        row = try? AnnouncementRow(from: d)
        if let r = EvReader(d) { stats = r.rows(["stats", "channelStats"], as: EvChannelStat.self) ?? [] }
    }
}

// MARK: - Moments / member picker (deployed contract)

struct EvMoment: Codable, Identifiable {
    @DefaultEmpty var momentId: String
    @DefaultEmpty var imageUrl: String
    let caption: String?
    let tag: String?
    var id: String { momentId }
}
private struct EvMomentsPage: Codable { let data: [EvMoment] }

struct EvMemberLite: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    let cellName: String?
    let currentLevel: Int?
    var id: String { userId }
}
private struct EvMembersPage: Codable { let data: [EvMemberLite] }

/// Tolerant ack for writes whose echo we don't render.
struct EvOk: Decodable { init(from decoder: Decoder) throws {} }

// MARK: - Endpoints

extension PortalAPI {

    // ---- Calendar reads (§4: clients page by visible range — no fixed horizon) ----

    /// Projected occurrences for one visible window (≤92 days server cap).
    static func eventsWindow(fromISO: String, toISO: String) async throws -> [AdminOcc] {
        try await APIClient.shared.get("/calendar", query: ["from": fromISO, "to": toISO], as: AdminOccPage.self).data
    }

    // ---- Admin series API (§3) ----

    static func adminSeriesList() async throws -> [AdminSeriesRow] {
        try await APIClient.shared.get("/admin/events/series", as: EvList<AdminSeriesRow>.self).items
    }
    static func adminSeriesDetail(_ id: String) async throws -> AdminSeriesDetail {
        try await APIClient.shared.get("/admin/events/series/\(id)", as: AdminSeriesDetail.self)
    }
    static func adminSeriesTimeline(_ id: String) async throws -> [EvTimelineEntry] {
        try await APIClient.shared.get("/admin/events/series/\(id)/timeline", as: EvList<EvTimelineEntry>.self).items
    }
    static func eventsSearch(_ q: String) async throws -> EventsSearchResults {
        try await APIClient.shared.get("/admin/events/search", query: ["q": q], as: EventsSearchResults.self)
    }
    static func eventsInsights() async throws -> EventsInsights {
        try await APIClient.shared.get("/admin/events/insights", as: EventsInsights.self)
    }

    // ---- Series writes ----

    static func createEventSeries(_ body: [String: EJSON]) async throws -> AdminSeriesRow {
        try await APIClient.shared.post("/admin/events/series", body: body, as: AdminSeriesRow.self)
    }
    @discardableResult
    static func updateEventSeries(_ id: String, _ body: [String: EJSON]) async throws -> AdminSeriesRow {
        try await APIClient.shared.put("/admin/events/series/\(id)", body: body, as: AdminSeriesRow.self)
    }
    /// Google-style "this and following" (§2): old series truncates at the pivot,
    /// a linked new series starts there with `changes` applied.
    static func splitEventSeries(_ id: String, pivotStartAt: String, changes: [String: EJSON]) async throws {
        let body: [String: EJSON] = ["pivot_start_at": .string(pivotStartAt), "changes": .object(changes)]
        _ = try await APIClient.shared.post("/admin/events/series/\(id)/split", body: body, as: EvOk.self)
    }
    /// Cancel or reschedule ONE occurrence (the exceptions path — reschedule sends
    /// new_start_at/new_end_at, cancel sends is_cancelled).
    static func addSeriesException(_ seriesId: String, _ body: [String: EJSON]) async throws {
        _ = try await APIClient.shared.post("/admin/events/series/\(seriesId)/exceptions", body: body, as: EvOk.self)
    }
    static func deleteEventSeries(_ id: String) async throws {
        _ = try await APIClient.shared.delete("/admin/events/series/\(id)", as: EvOk.self)
    }
    static func pauseEventSeries(_ id: String) async throws {
        _ = try await APIClient.shared.postEmpty("/admin/events/series/\(id)/pause", as: EvOk.self)
    }
    static func resumeEventSeries(_ id: String) async throws {
        _ = try await APIClient.shared.postEmpty("/admin/events/series/\(id)/resume", as: EvOk.self)
    }
    static func setSeriesFeatured(_ id: String, _ featured: Bool) async throws {
        if featured { _ = try await APIClient.shared.postEmpty("/admin/events/series/\(id)/homepage", as: EvOk.self) }
        else { _ = try await APIClient.shared.delete("/admin/events/series/\(id)/homepage", as: EvOk.self) }
    }
    static func setSeriesShowOnHome(_ id: String, _ show: Bool) async throws {
        _ = try await APIClient.shared.patch("/admin/events/series/\(id)/show-on-home",
                                             body: ["show_on_home": EJSON.bool(show)], as: EvOk.self)
    }

    // ---- Attendance & QR (§6) ----

    /// The REAL rotating check-in token (HMAC machinery members validate).
    static func eventQr(_ eventId: String) async throws -> EventQr {
        try await APIClient.shared.get("/admin/events/\(eventId)/qr", as: EventQr.self)
    }
    static func eventRoster(_ eventId: String) async throws -> EvRoster {
        try await APIClient.shared.get("/admin/events/\(eventId)/attendance", as: EvRoster.self)
    }
    static func eventRsvps(_ eventId: String) async throws -> EvRsvpRoster {
        try await APIClient.shared.get("/admin/events/\(eventId)/rsvps", as: EvRsvpRoster.self)
    }
    /// GET /admin/events/{id}/attendance.csv → raw CSV bytes.
    static func eventAttendanceCsv(_ eventId: String) async throws -> Data {
        try await APIClient.shared.getData("/admin/events/\(eventId)/attendance.csv", accept: "text/csv")
    }
    static func manualCheckIn(_ eventId: String, userId: String, note: String?) async throws {
        var body: [String: EJSON] = ["user_id": .string(userId)]
        if let note, !note.isEmpty { body["note"] = .string(note) }
        _ = try await APIClient.shared.post("/admin/events/\(eventId)/checkins", body: body, as: EvOk.self)
    }
    static func addEventGuest(_ eventId: String, name: String, phone: String?, firstTime: Bool) async throws {
        var body: [String: EJSON] = ["guest_name": .string(name), "first_time": .bool(firstTime)]
        if let phone, !phone.isEmpty { body["phone"] = .string(phone) }
        _ = try await APIClient.shared.post("/admin/events/\(eventId)/guests", body: body, as: EvOk.self)
    }
    static func searchMembersLite(_ q: String) async throws -> [EvMemberLite] {
        try await APIClient.shared.get("/admin/members", query: ["search": q], as: EvMembersPage.self).data
    }

    // ---- Announcements (§5 lifecycle) ----

    static func announcementsList(status: String? = nil, archived: Bool = false) async throws -> [AnnouncementRow] {
        var q: [String: String] = [:]
        if let status { q["status"] = status }
        if archived { q["archived"] = "true" }
        return try await APIClient.shared.get("/admin/announcements", query: q, as: EvList<AnnouncementRow>.self).items
    }
    static func announcementDetail(_ id: String) async throws -> AnnouncementDetail {
        try await APIClient.shared.get("/admin/announcements/\(id)", as: AnnouncementDetail.self)
    }
    static func createAnnouncement(_ body: [String: EJSON]) async throws -> AnnouncementRow {
        try await APIClient.shared.post("/admin/announcements", body: body, as: AnnouncementRow.self)
    }
    @discardableResult
    static func updateAnnouncement(_ id: String, _ body: [String: EJSON]) async throws -> AnnouncementRow {
        try await APIClient.shared.put("/admin/announcements/\(id)", body: body, as: AnnouncementRow.self)
    }
    static func sendAnnouncement(_ id: String) async throws {
        _ = try await APIClient.shared.postEmpty("/admin/announcements/\(id)/send", as: EvOk.self)
    }
    static func cancelAnnouncement(_ id: String) async throws {
        _ = try await APIClient.shared.postEmpty("/admin/announcements/\(id)/cancel", as: EvOk.self)
    }
    static func deleteAnnouncement(_ id: String) async throws {
        _ = try await APIClient.shared.delete("/admin/announcements/\(id)", as: EvOk.self)
    }
    /// §5: duplicate → a fresh draft clone (also "resend" and "use as template").
    static func duplicateAnnouncement(_ id: String) async throws -> AnnouncementRow {
        try await APIClient.shared.postEmpty("/admin/announcements/\(id)/duplicate", as: AnnouncementRow.self)
    }
    static func archiveAnnouncement(_ id: String) async throws {
        _ = try await APIClient.shared.postEmpty("/admin/announcements/\(id)/archive", as: EvOk.self)
    }
    static func restoreAnnouncement(_ id: String) async throws {
        _ = try await APIClient.shared.postEmpty("/admin/announcements/\(id)/restore", as: EvOk.self)
    }
    static func setAnnouncementFeatured(_ id: String, _ featured: Bool) async throws {
        if featured { _ = try await APIClient.shared.postEmpty("/admin/announcements/\(id)/homepage", as: EvOk.self) }
        else { _ = try await APIClient.shared.delete("/admin/announcements/\(id)/homepage", as: EvOk.self) }
    }

    // ---- Moments ----

    static func momentsList() async throws -> [EvMoment] {
        try await APIClient.shared.get("/moments", as: EvMomentsPage.self).data
    }
    static func createMoment(imageUrl: String, caption: String?, tag: String?) async throws {
        var body: [String: EJSON] = ["image_url": .string(imageUrl)]
        if let caption, !caption.isEmpty { body["caption"] = .string(caption) }
        if let tag, !tag.isEmpty { body["tag"] = .string(tag) }
        _ = try await APIClient.shared.post("/admin/moments", body: body, as: EvOk.self)
    }
    static func deleteMoment(_ id: String) async throws {
        _ = try await APIClient.shared.delete("/admin/moments/\(id)", as: EvOk.self)
    }
}

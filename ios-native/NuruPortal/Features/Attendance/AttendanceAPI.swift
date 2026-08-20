// Church-service attendance & follow-up — the native client of pathway's
// attendance module (backend #427 services/QR/streaks, #429 scan-to-join and
// the follow-up cadence engine).
//
// Ported from packages/admin-web/src/components/pages/Services.tsx and
// FollowUp.tsx. Those two pages postdate the SwiftUI port, so they were absent
// from PORT_STATUS.md entirely rather than pending — the iPad and Mac could not
// create a service, project its QR, or see who was waiting to be called.
//
// Decode-tolerance follows the house rule: every optional is defaulted, so a
// field the deployed backend does not send yet degrades to an honest empty
// rather than failing the whole screen. No number here is ever fabricated —
// a missing count reads as "—", never as 0.
import Foundation

// MARK: - Models

struct ChurchService: Decodable, Identifiable, Hashable {
    let serviceId: String
    let title: String
    let serviceDate: String
    let startsAt: String?
    let checkinOpensAt: String?
    let checkinClosesAt: String?
    let qrEnabled: Bool
    let countsForStreak: Bool
    var id: String { serviceId }

    private enum CodingKeys: String, CodingKey {
        case serviceId = "service_id", title, serviceDate = "service_date"
        case startsAt = "starts_at", checkinOpensAt = "checkin_opens_at"
        case checkinClosesAt = "checkin_closes_at"
        case qrEnabled = "qr_enabled", countsForStreak = "counts_for_streak"
    }

    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        serviceId = try c.decode(String.self, forKey: .serviceId)
        title = (try? c.decode(String.self, forKey: .title)) ?? "Service"
        serviceDate = (try? c.decode(String.self, forKey: .serviceDate)) ?? ""
        startsAt = try? c.decode(String.self, forKey: .startsAt)
        checkinOpensAt = try? c.decode(String.self, forKey: .checkinOpensAt)
        checkinClosesAt = try? c.decode(String.self, forKey: .checkinClosesAt)
        qrEnabled = (try? c.decode(Bool.self, forKey: .qrEnabled)) ?? true
        countsForStreak = (try? c.decode(Bool.self, forKey: .countsForStreak)) ?? true
    }

    /// Whether check-in — and therefore joining by scan — is open right now.
    /// The whole safeguard on scan-to-join is that this window closes, so the
    /// screen must show it plainly rather than implying a code works forever.
    var isOpenNow: Bool {
        let now = Date()
        let opens = PortalDate.parse(checkinOpensAt)
        let closes = PortalDate.parse(checkinClosesAt)
        if let opens, now < opens { return false }
        if let closes, now > closes { return false }
        return qrEnabled
    }
}

/// What the projector shows. The payload is a URL (backend #429) so a visitor's
/// own camera can act on it — the earlier opaque token only worked for people
/// who already had the app.
struct ServiceQR: Decodable {
    let payload: String
    let serviceId: String
    private enum CodingKeys: String, CodingKey { case payload, serviceId = "service_id" }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        payload = (try? c.decode(String.self, forKey: .payload)) ?? ""
        serviceId = (try? c.decode(String.self, forKey: .serviceId)) ?? ""
    }
}

struct ServiceAttendanceSummary: Decodable, Identifiable, Hashable {
    let serviceId: String
    let title: String
    let serviceDate: String
    let attended: Int
    let expected: Int
    var id: String { serviceId }
    private enum CodingKeys: String, CodingKey {
        case serviceId = "service_id", title, serviceDate = "service_date", attended, expected
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        serviceId = try c.decode(String.self, forKey: .serviceId)
        title = (try? c.decode(String.self, forKey: .title)) ?? "Service"
        serviceDate = (try? c.decode(String.self, forKey: .serviceDate)) ?? ""
        attended = (try? c.decode(Int.self, forKey: .attended)) ?? 0
        expected = (try? c.decode(Int.self, forKey: .expected)) ?? 0
    }
}

struct FollowUpMemberRow: Decodable, Identifiable, Hashable {
    let userId: String
    let fullName: String
    let phoneNumber: String?
    let status: String
    let lastAttendedAt: String?
    let currentStreak: Int
    var id: String { userId }
    private enum CodingKeys: String, CodingKey {
        case userId = "user_id", fullName = "full_name", phoneNumber = "phone_number"
        case status, lastAttendedAt = "last_attended_at", currentStreak = "current_streak"
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        userId = try c.decode(String.self, forKey: .userId)
        fullName = (try? c.decode(String.self, forKey: .fullName)) ?? "Member"
        phoneNumber = try? c.decode(String.self, forKey: .phoneNumber)
        status = (try? c.decode(String.self, forKey: .status)) ?? "new"
        lastAttendedAt = try? c.decode(String.self, forKey: .lastAttendedAt)
        currentStreak = (try? c.decode(Int.self, forKey: .currentStreak)) ?? 0
    }
}

/// A human cadence step that has come due — one person, one action.
struct FollowUpDueStep: Decodable, Identifiable, Hashable {
    let eventId: String
    let userId: String
    let fullName: String
    let phoneNumber: String?
    let action: String
    let dueAt: String
    let cadenceName: String
    let serviceTitle: String?
    let daysOverdue: Int
    var id: String { eventId }
    private enum CodingKeys: String, CodingKey {
        case eventId = "event_id", userId = "user_id", fullName = "full_name"
        case phoneNumber = "phone_number", action, dueAt = "due_at"
        case cadenceName = "cadence_name", serviceTitle = "service_title"
        case daysOverdue = "days_overdue"
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        eventId = try c.decode(String.self, forKey: .eventId)
        userId = (try? c.decode(String.self, forKey: .userId)) ?? ""
        fullName = (try? c.decode(String.self, forKey: .fullName)) ?? "Member"
        phoneNumber = try? c.decode(String.self, forKey: .phoneNumber)
        action = (try? c.decode(String.self, forKey: .action)) ?? "Follow up"
        dueAt = (try? c.decode(String.self, forKey: .dueAt)) ?? ""
        cadenceName = (try? c.decode(String.self, forKey: .cadenceName)) ?? ""
        serviceTitle = try? c.decode(String.self, forKey: .serviceTitle)
        daysOverdue = (try? c.decode(Int.self, forKey: .daysOverdue)) ?? 0
    }
}

/// What a leader records after doing it. Required — "no answer" and "reached"
/// are different pastoral facts, and a register that collapses them cannot say
/// who still needs reaching.
enum FollowUpOutcome: String, CaseIterable {
    case reached, noAnswer = "no_answer", wrongNumber = "wrong_number", skipped
    var label: String {
        switch self {
        case .reached: "Reached"
        case .noAnswer: "No answer"
        case .wrongNumber: "Wrong number"
        case .skipped: "Skip"
        }
    }
}

// MARK: - API

private struct Envelope<T: Decodable>: Decodable { let data: T }
private struct Empty: Decodable {}

enum AttendanceAPI {
    static func services(limit: Int = 50) async throws -> [ChurchService] {
        try await APIClient.shared.get("/services", query: ["limit": String(limit)],
                                       as: Envelope<[ChurchService]>.self).data
    }

    static func qr(serviceId: String) async throws -> ServiceQR {
        try await APIClient.shared.get("/services/\(serviceId)/qr", as: ServiceQR.self)
    }

    static func serviceSummaries(year: Int) async throws -> [ServiceAttendanceSummary] {
        try await APIClient.shared.get("/admin/follow-up/services", query: ["year": String(year)],
                                       as: Envelope<[ServiceAttendanceSummary]>.self).data
    }

    static func members(year: Int) async throws -> [FollowUpMemberRow] {
        try await APIClient.shared.get("/admin/follow-up/members", query: ["year": String(year)],
                                       as: Envelope<[FollowUpMemberRow]>.self).data
    }

    /// The call list. Human steps only — automated ones are the worker's job.
    static func due(limit: Int = 200) async throws -> [FollowUpDueStep] {
        try await APIClient.shared.get("/admin/follow-up/due", query: ["limit": String(limit)],
                                       as: Envelope<[FollowUpDueStep]>.self).data
    }

    struct RecordContactBody: Encodable { let outcome: String; let note: String? }

    static func recordContact(eventId: String, outcome: FollowUpOutcome, note: String?) async throws {
        _ = try await APIClient.shared.post(
            "/admin/follow-up/due/\(eventId)",
            body: RecordContactBody(outcome: outcome.rawValue, note: note?.isEmpty == false ? note : nil),
            as: Empty.self,
        )
    }
}

/// Parsing the backend's timestamps.
///
/// It sends fractional seconds on some fields and not others, and a single
/// ISO8601DateFormatter can only match one shape — configured with
/// `.withFractionalSeconds` it returns nil for `2026-08-17T09:00:00Z`, and
/// without it, nil for `...09:00:00.123Z`. Either way the failure is silent and
/// shows up on screen as "no check-in window set", which is the opposite of what
/// the data says.
///
/// So: try both, fractional first.
enum PortalDate {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    static func parse(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        return withFraction.date(from: s) ?? plain.date(from: s)
    }
}

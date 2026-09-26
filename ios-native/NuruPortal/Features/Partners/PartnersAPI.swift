// Partners programme — the native client of pathway's admin partner routes
// (backend financial/index.ts + financial/partners.ts, pathway #482;
// docs/PARTNERS_PROGRAMME.md §1, §3, §5–§6). The TypeScript field lists in
// admin-web's api/client.ts (PartnersApi) are the contract these mirror.
//
// Money is integer minor units + ISO currency; every progress value and every
// "behind" flag is computed on the server — nothing here derives standing or
// money on its own (§1.1). Decode-tolerance follows the house rule: only ids
// are required; a field the deployed backend does not send yet degrades to an
// honest empty rather than failing the whole screen. BIGINT columns cast
// `::text` (claim / schedule / payment amounts) decode through `@LooseInt`.
import Foundation

// MARK: - Models (snake_case wire → camelCase via the shared decoder)

struct PartnerMembership: Codable {
    @DefaultEmpty var status: String            // active | paused | left
    let joinedAt: String?
}

struct PartnerTier: Codable {
    @DefaultEmpty var name: String
    @LooseInt var monthlyMinor: Int
}

/// One row of GET /admin/partners (financial/partners.ts adminList).
struct PartnerRow: Codable, Identifiable {
    let userId: String
    @DefaultEmpty var fullName: String
    let avatarUrl: String?
    let phone: String?
    let email: String?
    let cellName: String?
    let membership: PartnerMembership?
    let tier: PartnerTier?
    @DefaultZero var pledgesActive: Int
    @LooseInt var committedMonthlyMinor: Int
    @LooseInt var givenYearMinor: Int
    let lastGiftAt: String?
    @DefaultFalse var behind: Bool
    let nextDueOn: String?                       // YYYY-MM-DD
    var id: String { userId }
}

struct PartnersSummary: Codable {
    @DefaultZero var partners: Int
    @DefaultZero var activePledges: Int
    @LooseInt var committedMonthlyMinor: Int
    @DefaultZero var behind: Int
    @LooseInt var givenYearMinor: Int
}

/// `data` is required (the DataList idiom): a malformed list is an error to
/// show, never a silent "No partners yet". `summary` may lag a deploy.
struct PartnersPage: Codable {
    let data: [PartnerRow]
    let summary: PartnersSummary?
}

struct PledgeFund: Codable { @DefaultEmpty var code: String; let name: String? }
struct PledgeCampaign: Codable { @DefaultEmpty var campaignId: String; let title: String? }

/// Computed on the server, never stored (§1 "Progress").
struct PledgeProgress: Codable {
    @LooseInt var paidMinor: Int
    @LooseInt var periodPaidMinor: Int
    @DefaultEmpty var label: String              // on_track | behind | fulfilled | paused
    let nextDue: String?                          // YYYY-MM-DD
    let overdueSince: String?
}

struct PartnerPledge: Codable, Identifiable {
    let pledgeId: String
    @DefaultEmpty var shape: String              // monthly | total
    /// Monthly pledges carry amount_minor; total pledges carry target_minor.
    @LooseInt var amountMinor: Int
    @LooseInt var targetMinor: Int
    @DefaultEmpty var currency: String
    let dueDay: Int?
    let dueOn: String?
    let untilOn: String?
    let fund: PledgeFund?
    let campaign: PledgeCampaign?
    let needId: String?
    @DefaultEmpty var status: String             // active | paused | fulfilled | cancelled
    let progress: PledgeProgress?
    let scheduleId: String?
    @DefaultTrue var remindersEnabled: Bool
    let note: String?
    let createdAt: String?
    let title: String?
    /// Where this pledge's money is booked (PledgePaysTo — FinancialService
    /// .pledgeFundCode's one rule); null only when no fund is active at all.
    /// Additive, 2026-09-26 (Finance → Claims states it before confirming).
    let paysTo: FinFundRef?
    var id: String { pledgeId }
    var isMonthly: Bool { shape == "monthly" }
}

/// Row of the `schedules` list on GET /admin/partners/{userId} (giving_schedules).
struct PartnerSchedule: Codable, Identifiable {
    let scheduleId: String
    @DefaultEmpty var status: String
    @DefaultEmpty var frequency: String
    let method: String?
    @LooseInt var amountMinor: Int
    @DefaultEmpty var currency: String
    let nextRunAt: String?
    let lastRunAt: String?
    @DefaultZero var consecutiveFailures: Int
    let pledgeId: String?
    let fund: String?
    var id: String { scheduleId }
}

struct PartnerPayment: Codable, Identifiable {
    let transactionId: String
    @LooseInt var amountMinor: Int
    @DefaultEmpty var currency: String
    let at: String?
    let fund: String?
    let pledgeId: String?
    let receiptCode: String?
    let status: String?
    var id: String { transactionId }
}

struct PartnerReminder: Codable, Identifiable {
    @DefaultEmpty var pledgeId: String
    let dueOn: String?
    @DefaultZero var sequence: Int
    /// "auto" = the notification worker on the §3 schedule; "manual" = the
    /// office. Optional so a payload that predates the column still renders:
    /// every manual reminder is written with sent_by, every automatic one without.
    let kind: String?
    @DefaultEmpty var channel: String
    let sentAt: String?
    let sentBy: String?
    let sentByName: String?
    var id: String { "\(pledgeId):\(dueOn ?? ""):\(sequence):\(sentAt ?? "")" }
    var isManual: Bool { kind == "manual" || (kind == nil && sentBy != nil) }
}

/// GET /admin/partners/{userId} (financial/partners.ts adminDetail).
struct PartnerDetail: Codable {
    let member: PartnerRow
    @DefaultEmptyList var pledges: [PartnerPledge]
    @DefaultEmptyList var schedules: [PartnerSchedule]
    @DefaultEmptyList var payments: [PartnerPayment]
    @DefaultEmptyList var reminders: [PartnerReminder]
}

/// POST /admin/partners/{userId}/remind and /remind-behind. Counts are per
/// pledge; `skipped` = a reminder (automatic or manual) already went out in
/// the last 12 hours, so the server left that pledge alone (§3). `partners`
/// only on remind-behind: how many were behind when the run started.
struct RemindResult: Codable {
    @DefaultZero var reminded: Int
    @DefaultZero var skipped: Int
    let partners: Int?
}

/// Row of GET /admin/partners/claims (pendingClaims) — "I paid another way".
struct PledgeClaimRow: Codable, Identifiable {
    let claimId: String
    @DefaultEmpty var pledgeId: String
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    @LooseInt var amountMinor: Int                // BIGINT::text on the wire
    @DefaultEmpty var currency: String
    let paidOn: String?                           // YYYY-MM-DD
    let note: String?
    @DefaultEmpty var status: String
    let createdAt: String?
    @DefaultEmpty var pledgeTitle: String
    var id: String { claimId }
}

// MARK: - API

enum PartnersAPI {
    private static var api: APIClient { .shared }
    private struct Envelope<T: Codable>: Codable { let data: T }
    /// Tolerant ack for decision responses whose shape the page does not use.
    private struct Ack: Decodable { init(from decoder: Decoder) throws {} }

    /// Server-enforced (§3): office reminders keep the same 12 h spacing as automatic ones.
    static let reminderSpacingHours = 12
    /// Body limit of the remind `message` (zod max(200)).
    static let reminderMessageMax = 200

    /// GET /admin/partners?q=&status=&sort= — all three filters are server-side
    /// (§5). "all" omits the status param, like the web client.
    static func list(q: String?, status: String, sort: String) async throws -> PartnersPage {
        var query: [String: String] = ["sort": sort]
        if let q, !q.isEmpty { query["q"] = q }
        if status != "all" { query["status"] = status }
        return try await api.get("/admin/partners", query: query, as: PartnersPage.self)
    }

    static func detail(_ userId: String) async throws -> PartnerDetail {
        try await api.get("/admin/partners/\(userId)", as: PartnerDetail.self)
    }

    /// finance:manage. One partner — every open pledge, or one; note ≤ 200
    /// chars. 404 = no open pledge to remind about. Nil fields are omitted,
    /// which the route's `.nullish()` schema accepts.
    static func remind(_ userId: String, pledgeId: String?, message: String?) async throws -> RemindResult {
        struct Body: Encodable { let pledgeId: String?; let message: String? }
        return try await api.post("/admin/partners/\(userId)/remind",
                                  body: Body(pledgeId: pledgeId, message: message), as: RemindResult.self)
    }

    /// finance:manage. Every partner with a pledge that is behind; the server
    /// applies the 12 h spacing per pledge. POSTs `{}` — the body the web sends.
    static func remindBehind() async throws -> RemindResult {
        try await api.post("/admin/partners/remind-behind", body: [String: String](), as: RemindResult.self)
    }

    /// finance:view. Pending claims, oldest first.
    static func claims() async throws -> [PledgeClaimRow] {
        try await api.get("/admin/partners/claims", as: Envelope<[PledgeClaimRow]>.self).data
    }

    /// finance:manage. `confirm` records a succeeded manual gift attributed to
    /// the pledge (ledger + receipt); `reject` tells the member. 422 = already
    /// decided, 404 = unknown claim — both mean the row is stale.
    static func decideClaim(_ claimId: String, decision: String) async throws {
        _ = try await api.post("/admin/partners/claims/\(claimId)/\(decision)", body: [String: String](), as: Ack.self)
    }
}

// MARK: - Postgres wire dates

/// Parsing the timestamps these routes emit. Most columns are cast `::text`
/// in SQL, so they arrive as Postgres text — "2026-09-23 10:11:12.123456+00"
/// (a space, 0–6 fractional digits, a bare "+00" zone) — not ISO 8601; plain
/// DATE columns arrive as "2026-09-23"; a few fields are real ISO. `Fmt.date`
/// only reads ISO and would show every one of the others as "—", which is the
/// opposite of what the data says. So: ISO first, then the two Postgres shapes.
/// Shared by the Partners and Departments pages.
enum PgDate {
    private static let isoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    /// A calendar date with no instant — read in the device's zone so "23 Sep"
    /// never renders as the 22nd west of Greenwich.
    private static let dayOnly: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func parse(_ s: String?) -> Date? {
        guard let raw = s?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
        if raw.count == 10 { return dayOnly.date(from: raw) }
        if let d = isoFraction.date(from: raw) ?? iso.date(from: raw) { return d }
        // Postgres `timestamptz::text`: "2026-09-23 10:11:12.123456+00".
        var t = raw.replacingOccurrences(of: " ", with: "T")
        if let fraction = t.range(of: #"\.\d+"#, options: .regularExpression) { t.removeSubrange(fraction) }
        if t.range(of: #"[+-]\d{2}$"#, options: .regularExpression) != nil {
            t += ":00"                                   // "+00" → "+00:00"
        } else if t.range(of: #"([+-]\d{2}:\d{2}|Z)$"#, options: .regularExpression) == nil {
            t += "Z"                                     // `timestamp` without a zone: stored UTC
        }
        return iso.date(from: t)
    }

    /// "23 Sep 2026", or "—".
    static func day(_ s: String?) -> String {
        parse(s).map { $0.formatted(.dateTime.day().month(.abbreviated).year()) } ?? "—"
    }

    /// "23 Sep 2026, 10:11", or "—".
    static func stamp(_ s: String?) -> String {
        parse(s).map { $0.formatted(.dateTime.day().month(.abbreviated).year().hour().minute()) } ?? "—"
    }
}

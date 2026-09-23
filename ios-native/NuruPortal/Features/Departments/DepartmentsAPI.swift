// Departments — the native client of pathway's office routes for where
// members serve (backend departments/index.ts + service.ts, pathway #483;
// docs/PARTNERS_PROGRAMME.md §4). The TypeScript field lists in admin-web's
// api/client.ts (DepartmentsApi) are the contract these mirror.
//
// An APPROVED need is its own giving target (transactions.need_id /
// pledges.need_id are written at giving time), so `raised_minor` is exact and
// server-computed — this client derives nothing about money (§1.1). Money is
// integer minor units + ISO currency; every count comes from the server.
// Decode-tolerance follows the house rule: only ids are required.
import Foundation

// MARK: - Models (snake_case wire → camelCase via the shared decoder)

/// One row of GET /admin/departments — every count is server-computed.
struct DepartmentRow: Codable, Identifiable {
    let departmentId: String
    @DefaultEmpty var name: String
    @DefaultEmpty var purpose: String
    let meets: String?
    let imageUrl: String?
    /// funds.code the department's gifts land in (validated server-side).
    let fundCode: String?
    /// Free-form keys matched against members' top gifts ("a good fit for you").
    @DefaultEmptyList var giftKeys: [String]
    @DefaultTrue var isOpenToJoin: Bool
    @DefaultEmpty var status: String             // active | archived
    let leaderUserId: String?
    let leaderName: String?
    /// Active members.
    @DefaultZero var memberCount: Int
    /// Requests to serve still awaiting a decision.
    @DefaultZero var pendingRequests: Int
    /// Needs awaiting the office's approval.
    @DefaultZero var pendingNeeds: Int
    /// Approved needs — giving is open.
    @DefaultZero var openNeeds: Int
    let createdAt: String?
    var id: String { departmentId }
    var isArchived: Bool { status == "archived" }
}

/// POST / PATCH /admin/departments response — the fresh list row, or only the
/// id when the server could not re-read it. The caller reloads the list anyway.
struct DepartmentAck: Codable { let departmentId: String? }

struct DepartmentPost: Codable, Identifiable {
    let postId: String
    @DefaultEmpty var body: String
    let imageUrl: String?
    let createdAt: String?
    let authorName: String?
    let authorAvatar: String?
    var id: String { postId }
}

struct DepartmentMemberRow: Codable, Identifiable {
    let userId: String
    @DefaultEmpty var fullName: String
    let avatarUrl: String?
    @DefaultEmpty var role: String               // leader | member
    var id: String { userId }
}

/// GET /departments/{id} — the member-facing page (auth only; no admin mirror
/// exists for reading posts). The console reads posts + active members from
/// it. Active departments only: an archived one 404s, and the panel says so.
struct DepartmentPage: Codable {
    @DefaultEmpty var departmentId: String
    @DefaultEmpty var name: String
    @DefaultEmptyList var posts: [DepartmentPost]
    @DefaultEmptyList var members: [DepartmentMemberRow]
}

/// One row of GET /admin/departments/serve-requests?status=
struct ServeRequestRow: Codable, Identifiable {
    let departmentId: String
    @DefaultEmpty var department: String
    let userId: String
    @DefaultEmpty var fullName: String
    let avatarUrl: String?
    let phoneNumber: String?
    @DefaultEmpty var status: String             // requested | active | declined | left
    @DefaultEmpty var role: String
    let requestedAt: String?
    let decidedAt: String?
    var id: String { "\(departmentId):\(userId)" }
}

/// One row of GET /admin/departments/needs?status= — `raised_minor` is exact.
struct DepartmentNeedRow: Codable, Identifiable {
    let needId: String
    @DefaultEmpty var departmentId: String
    @DefaultEmpty var department: String
    @DefaultEmpty var title: String
    @DefaultEmpty var why: String
    @LooseInt var targetMinor: Int
    @DefaultEmpty var currency: String
    let deadline: String?                         // YYYY-MM-DD
    @DefaultEmpty var status: String             // pending | approved | rejected | closed
    let createdAt: String?
    @DefaultEmpty var submittedName: String
    @LooseInt var raisedMinor: Int
    var id: String { needId }
}

/// A fund from GET /admin/finance/config (needs finance:view) for the fund picker.
struct FundOption: Codable, Identifiable {
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
    @DefaultFalse var isActive: Bool
    var id: String { code }
}

/// Omit-null-free JSON value for the department bodies: the web sends explicit
/// `null` to clear leader / meets / image / fund, and the zod schemas accept it.
enum DepartmentJSON: Encodable {
    case string(String), int(Int), bool(Bool), strings([String]), null
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v):    try c.encode(v)
        case .bool(let v):   try c.encode(v)
        case .strings(let v): try c.encode(v)
        case .null:          try c.encodeNil()
        }
    }
}

// MARK: - API

enum DepartmentsAPI {
    private static var api: APIClient { .shared }
    private struct Envelope<T: Codable>: Codable { let data: T }
    /// Tolerant ack for responses whose shape the page does not use (and for
    /// the 204 on post removal, which APIClient decodes as `{}`).
    private struct Ack: Decodable { init(from decoder: Decoder) throws {} }

    /// The seven gift keys of the gifts assessment (backend growth/service.ts
    /// GIFT_AXES). The server accepts any key; these are offered as presets so
    /// the "good fit" match lines up with what the assessment can produce.
    static let giftKeys = ["leadership", "teaching", "service", "mercy", "evangelism", "giving", "hospitality"]

    // Server limits (zod, backend departments/service.ts).
    enum Limits {
        static let nameMin = 2, nameMax = 80, purposeMax = 600, meetsMax = 120
        static let fundCodeMin = 2, fundCodeMax = 40, giftKeysMax = 12, giftKeyMax = 40
        static let postMax = 2000, needTitleMin = 3, needTitleMax = 120
        static let needWhyMin = 10, needWhyMax = 1500, noteMax = 300
    }

    /// departments:view. Every department of the caller's congregation (all, when unscoped), archived last.
    static func list() async throws -> [DepartmentRow] {
        try await api.get("/admin/departments", as: Envelope<[DepartmentRow]>.self).data
    }
    /// departments:manage. 404 = unknown fund_code.
    static func create(_ body: [String: DepartmentJSON]) async throws -> DepartmentAck {
        try await api.post("/admin/departments", body: body, as: DepartmentAck.self)
    }
    /// departments:manage. Partial; `status: "archived"` archives, `"active"` restores.
    static func update(_ id: String, _ body: [String: DepartmentJSON]) async throws -> DepartmentAck {
        try await api.patch("/admin/departments/\(id)", body: body, as: DepartmentAck.self)
    }
    /// Member-facing read (auth only) — the only route that returns posts. 404 when archived.
    static func page(_ id: String) async throws -> DepartmentPage {
        try await api.get("/departments/\(id)", as: DepartmentPage.self)
    }
    /// departments:manage. Posts as the office; active members are nudged.
    static func createPost(_ id: String, body: String, imageUrl: String?) async throws {
        var b: [String: DepartmentJSON] = ["body": .string(body)]
        b["image_url"] = imageUrl.map { DepartmentJSON.string($0) } ?? DepartmentJSON.null
        _ = try await api.post("/admin/departments/\(id)/posts", body: b, as: Ack.self)
    }
    /// departments:manage. Soft-delete (204).
    static func deletePost(_ id: String, postId: String) async throws {
        _ = try await api.delete("/admin/departments/\(id)/posts/\(postId)", as: Ack.self)
    }
    /// departments:manage. Enters the needs queue as pending. `targetMinor` is
    /// already integer minor units — the caller converts ONCE, before this.
    static func createNeed(_ id: String, title: String, why: String, targetMinor: Int, currency: String, deadline: String?) async throws {
        var b: [String: DepartmentJSON] = [
            "title": .string(title), "why": .string(why),
            "target_minor": .int(targetMinor), "currency": .string(currency),
        ]
        b["deadline"] = deadline.map { DepartmentJSON.string($0) } ?? DepartmentJSON.null
        _ = try await api.post("/admin/departments/\(id)/needs", body: b, as: Ack.self)
    }
    /// departments:view. Oldest first.
    static func serveRequests(status: String = "requested") async throws -> [ServeRequestRow] {
        try await api.get("/admin/departments/serve-requests", query: ["status": status], as: Envelope<[ServeRequestRow]>.self).data
    }
    /// departments:manage. 404 = no pending request (decided elsewhere). The member is told.
    static func decideServe(_ id: String, userId: String, decision: String) async throws {
        _ = try await api.post("/admin/departments/\(id)/serve-requests/\(userId)/\(decision)", body: [String: String](), as: Ack.self)
    }
    /// departments:view. Oldest first, with raised so far.
    static func needs(status: String = "pending") async throws -> [DepartmentNeedRow] {
        try await api.get("/admin/departments/needs", query: ["status": status], as: Envelope<[DepartmentNeedRow]>.self).data
    }
    /// Every status at once — the panel shows a department's needs across all four.
    static func needsAllStatuses() async throws -> [DepartmentNeedRow] {
        async let p = needs(status: "pending")
        async let a = needs(status: "approved")
        async let r = needs(status: "rejected")
        async let c = needs(status: "closed")
        return try await p + a + r + c
    }
    /// departments:manage. approve = giving opens (the department is told);
    /// reject = the submitter is told; close = only an approved need. 422 =
    /// already decided. `note` (≤ 300) is kept as the decision note and sent to
    /// the submitter. Sends `{note: null}` when there is none — the body the web sends.
    static func decideNeed(_ needId: String, decision: String, note: String?) async throws {
        let b: [String: DepartmentJSON] = ["note": note.map { DepartmentJSON.string($0) } ?? DepartmentJSON.null]
        _ = try await api.post("/admin/departments/needs/\(needId)/\(decision)", body: b, as: Ack.self)
    }
    /// Funds for the fund picker (finance:view). A refusal or failure means the
    /// form falls back to a typed fund code, which the server validates.
    static func funds() async throws -> [FundOption] {
        struct Config: Codable { @DefaultEmptyList var funds: [FundOption] }
        return try await api.get("/admin/finance/config", as: Config.self).funds
    }
}

// Typed endpoint surface used by the view models, mirroring api/client.ts.
import Foundation

/// /auth/login resolves to a session or a 2FA challenge.
struct LoginResult: Decodable {
    let session: Session?
    let mfa: MfaChallenge?

    enum K: String, CodingKey { case mfaRequired, mfaToken, accessToken, refreshToken }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        if c.contains(.mfaRequired) {
            mfa = MfaChallenge(
                mfaRequired: (try? c.decode(Bool.self, forKey: .mfaRequired)) ?? true,
                mfaToken: try c.decode(String.self, forKey: .mfaToken))
            session = nil
        } else {
            session = Session(
                accessToken: try c.decode(String.self, forKey: .accessToken),
                refreshToken: try c.decode(String.self, forKey: .refreshToken))
            mfa = nil
        }
    }
}

enum PortalAPI {
    private static var api: APIClient { .shared }

    // Auth
    struct LoginBody: Encodable { let email: String; let password: String }
    static func login(email: String, password: String) async throws -> LoginResult {
        try await api.post("/auth/login", body: LoginBody(email: email, password: password), as: LoginResult.self)
    }

    struct MfaBody: Encodable { let mfaToken: String; let code: String }
    static func completeMfa(mfaToken: String, code: String) async throws -> Session {
        try await api.post("/auth/login/mfa", body: MfaBody(mfaToken: mfaToken, code: code), as: Session.self)
    }

    // Identity
    static func me() async throws -> MeProfile {
        try await api.get("/me", as: MeResponse.self).profile
    }

    // Dashboard
    static func overview() async throws -> OverviewKpis {
        try await api.get("/admin/reports/overview", as: OverviewKpis.self)
    }
    static func engagement() async throws -> EngagementReport {
        try await api.get("/admin/reports/engagement", as: EngagementReport.self)
    }

    // Members
    static func members(search: String? = nil, cursor: String? = nil) async throws -> MembersPage {
        var q: [String: String] = [:]
        if let search, !search.isEmpty { q["search"] = search }
        if let cursor { q["cursor"] = cursor }
        return try await api.get("/admin/members", query: q, as: MembersPage.self)
    }
    static func memberDetail(_ userId: String) async throws -> MemberDetail {
        try await api.get("/admin/members/\(userId)", as: MemberDetail.self)
    }

    // Reflection queue
    static func reflections(state: String? = nil) async throws -> [ReflectionRow] {
        var q: [String: String] = [:]
        if let state { q["state"] = state }
        return try await api.get("/admin/reflections", query: q, as: ReflectionsPage.self).data
    }

    // Finance
    static func financeSummary() async throws -> [FundSummary] {
        try await api.get("/admin/finance/summary", as: FinanceSummary.self).funds
    }

    // Curriculum
    static func levels() async throws -> [LevelAnalyticsRow] {
        try await api.get("/admin/reports/levels", as: LevelsReport.self).levels
    }

    // Notifications
    static func notifications() async throws -> [NotificationFeedItem] {
        try await api.get("/admin/notifications", as: NotificationsFeed.self).data
    }

    // Events (next 60 days)
    static func calendar(from: String, to: String) async throws -> [CalendarOccurrence] {
        try await api.get("/calendar", query: ["from": from, "to": to], as: CalendarPage.self).data
    }

    // Badges & certificates
    static func badges() async throws -> [BadgeRow] {
        try await api.get("/admin/badges", as: BadgesPage.self).data
    }
    static func certificates() async throws -> [CertificateRow] {
        try await api.get("/admin/certificates", as: CertificatesPage.self).data
    }

    // System reference data
    static func countries() async throws -> [Country] {
        try await api.get("/admin/countries", as: DataList<Country>.self).data
    }
    static func languages() async throws -> [Language] {
        try await api.get("/admin/languages", as: DataList<Language>.self).data
    }
    static func congregations() async throws -> [Congregation] {
        try await api.get("/admin/congregations", as: DataList<Congregation>.self).data
    }
    static func roles() async throws -> [SystemRole] {
        try await api.get("/admin/roles", as: DataList<SystemRole>.self).data
    }
    static func users() async throws -> [SystemUser] {
        try await api.get("/admin/users", as: DataList<SystemUser>.self).data
    }

    // Curriculum
    static func curriculumLevels() async throws -> [AdminLevel] {
        try await api.get("/admin/levels", as: DataList<AdminLevel>.self).data
    }
    static func modules(level: Int) async throws -> [AdminModuleSummary] {
        try await api.get("/admin/levels/\(level)/modules", as: DataList<AdminModuleSummary>.self).data
    }
    static func questions(moduleId: String) async throws -> [AdminQuestion] {
        try await api.get("/admin/modules/\(moduleId)/questions", as: DataList<AdminQuestion>.self).data
    }

    // Content Studio (growth)
    static func devotionals() async throws -> [DevotionalRow] {
        try await api.get("/admin/growth/devotionals", as: DataList<DevotionalRow>.self).data
    }
    static func verses() async throws -> [VerseRow] {
        try await api.get("/admin/growth/memory-verses", as: DataList<VerseRow>.self).data
    }
    static func plans() async throws -> [PlanRow] {
        try await api.get("/admin/growth/plans", as: DataList<PlanRow>.self).data
    }
    static func resources() async throws -> [ResourceAdminRow] {
        try await api.get("/admin/growth/resources", as: DataList<ResourceAdminRow>.self).data
    }

    // Video Library (media)
    static func media() async throws -> [MediaAssetRow] {
        try await api.get("/admin/media", as: MediaListResponse.self).data
    }

    // Dashboard report extras
    static func attendance(weeks: Int = 8) async throws -> [AttendanceTrendPoint] {
        try await api.get("/admin/reports/attendance", query: ["weeks": "\(weeks)"], as: AttendanceReport.self).trend
    }
    static func auditFeed() async throws -> [AuditRow] {
        try await api.get("/admin/audit", as: AuditPage.self).data
    }
    static func consentsCount() async throws -> Int {
        try await api.get("/admin/reports/consents", as: ConsentsPage.self).data.count
    }
    static func mediaStuck() async throws -> Int {
        try await api.get("/admin/media", as: MediaListResponse.self).stuck
    }

    // Chat
    static func chatConversations() async throws -> ChatList {
        try await api.get("/chat/conversations", query: ["scope": "mine"], as: ChatList.self)
    }
    static func chatConversation(_ id: String) async throws -> ChatConversationDetail {
        try await api.get("/chat/conversations/\(id)", as: ChatConversationDetail.self)
    }
}

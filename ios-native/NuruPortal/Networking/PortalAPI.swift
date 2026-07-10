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
    // scope:"admin" — this is a staff console. The backend refuses a member
    // (Student) account here even with a correct password (§5.4).
    struct LoginBody: Encodable { let email: String; let password: String; let scope = "admin" }
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

    /// Manual password reset (web ResetPasswordModal): the server mints a temporary
    /// password, revokes ALL the member's sessions and invalidates the old password.
    /// The plaintext is returned exactly once and is never retrievable again.
    /// Rank-guarded server-side — resetting peers/higher roles is rejected (403).
    static func resetMemberPassword(_ memberId: String) async throws -> String {
        struct Result: Decodable { let temporaryPassword: String }  // temporary_password
        return try await api.postEmpty("/admin/members/\(memberId)/password-reset", as: Result.self).temporaryPassword
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

    // MARK: Radio Studio (admin) — see docs/RADIO_STUDIO_CONTRACT.md
    // Programs CRUD + broadcast lifecycle, live stream health, comments.
    static func radioPrograms(status: String? = nil) async throws -> [RadioProgram] {
        var q: [String: String] = [:]
        if let status, !status.isEmpty { q["status"] = status }
        return try await api.get("/admin/radio/programs", query: q, as: [RadioProgram].self)
    }
    static func radioProgram(_ id: String) async throws -> RadioProgram {
        try await api.get("/admin/radio/programs/\(id)", as: RadioProgram.self)
    }
    static func radioGoLive(_ id: String) async throws -> RadioProgram {
        try await api.postEmpty("/admin/radio/programs/\(id)/go-live", as: RadioProgram.self)
    }
    static func radioEnd(_ id: String) async throws -> RadioProgram {
        try await api.postEmpty("/admin/radio/programs/\(id)/end", as: RadioProgram.self)
    }
    static func radioRotateKey(_ id: String) async throws -> RadioStreamKey {
        try await api.postEmpty("/admin/radio/programs/\(id)/rotate-key", as: RadioStreamKey.self)
    }
    static func radioHealth(_ id: String) async throws -> StreamHealth {
        try await api.get("/admin/radio/programs/\(id)/health", as: StreamHealth.self)
    }
    static func radioComments(_ id: String) async throws -> [RadioComment] {
        try await api.get("/admin/radio/programs/\(id)/comments", as: [RadioComment].self)
    }
    /// Live listener roster — REAL names of members heartbeating from the mobile
    /// player. This is the MEMBER route (auth-only, no /admin prefix); an admin JWT
    /// authenticates fine, so the studio reads the same presence rows the app writes.
    static func radioListeners(_ id: String) async throws -> RadioListenerRoster {
        try await api.get("/radio/programs/\(id)/listeners", as: RadioListenerRoster.self)
    }

    /// One overlapping session from GET /admin/radio/schedule/conflicts (snake_case
    /// wire; the shared convertFromSnakeCase decoder maps to these camelCase keys).
    struct ScheduleConflict: Decodable, Identifiable {
        let id: String
        let title: String
        let scheduledAt: String?
        let durationMin: Int?
        let status: String?
        let isLive: Bool?
    }

    /// Frequency check for the program form — windows are [start, start+duration);
    /// sessions without a duration are assumed 60 min, a LIVE session projects from
    /// its live_started_at, and `excludeId` skips the program being edited.
    static func radioScheduleConflicts(scheduledAt: String, durationMin: Int?, excludeId: String?) async throws -> [ScheduleConflict] {
        struct Wrapper: Decodable { let conflicts: [ScheduleConflict] }
        var q: [String: String] = ["scheduled_at": scheduledAt]
        if let durationMin { q["duration_min"] = String(durationMin) }
        if let excludeId, !excludeId.isEmpty { q["exclude_id"] = excludeId }
        return try await api.get("/admin/radio/schedule/conflicts", query: q, as: Wrapper.self).conflicts
    }

    /// Upload a broadcast audio recording to OUR API (self-hosted disk, multipart).
    /// File field is "file" (audio/* only); optional text field `duration_sec`.
    static func uploadRadioAudio(data: Data, filename: String, durationSec: Int? = nil) async throws -> RadioAudioUpload {
        var fields: [String: String] = [:]
        if let durationSec { fields["duration_sec"] = String(durationSec) }
        return try await api.uploadFile(
            "/admin/media/audio/upload",
            fileData: data, filename: filename, mimeType: mimeType(for: filename),
            fields: fields, as: RadioAudioUpload.self)
    }

    /// Create a program from an omit-null JSON body (audioUrl/autoGoLive included by caller).
    static func createRadioProgram(_ body: [String: RadioJSON]) async throws -> RadioProgram {
        try await api.post("/admin/radio/programs", body: body, as: RadioProgram.self)
    }

    /// Patch a program with an omit-null JSON body (e.g. attach audio_url after upload).
    static func updateRadioProgram(_ id: String, _ body: [String: RadioJSON]) async throws -> RadioProgram {
        try await api.patch("/admin/radio/programs/\(id)", body: body, as: RadioProgram.self)
    }

    // MARK: Radio — audio library (reusable tracks; bare arrays, no {data:[]} envelope)
    /// A tolerant ack for the radio `{ ok: true }` delete responses.
    private struct RadioOk: Decodable { init(from decoder: Decoder) throws {} }

    static func radioTracks(kind: String? = nil) async throws -> [RadioTrack] {
        var q: [String: String] = [:]
        if let kind, !kind.isEmpty { q["kind"] = kind }
        return try await api.get("/admin/radio/tracks", query: q, as: [RadioTrack].self)
    }
    /// Register an uploaded audio file as a library track (omit-null JSON body).
    static func createRadioTrack(_ body: [String: RadioJSON]) async throws -> RadioTrack {
        try await api.post("/admin/radio/tracks", body: body, as: RadioTrack.self)
    }
    static func deleteRadioTrack(_ id: String) async throws {
        _ = try await api.delete("/admin/radio/tracks/\(id)", as: RadioOk.self)
    }

    // MARK: Radio — sessions (programs) create/delete + loop mode
    static func createRadioProgramTitle(_ title: String) async throws -> RadioProgram {
        try await api.post("/admin/radio/programs", body: ["title": RadioJSON.string(title)], as: RadioProgram.self)
    }
    static func deleteRadioProgram(_ id: String) async throws {
        _ = try await api.delete("/admin/radio/programs/\(id)", as: RadioOk.self)
    }
    /// PATCH the session's loop mode (none | loop_all | repeat_one).
    static func setRadioLoopMode(_ id: String, _ loopMode: String) async throws -> RadioProgram {
        try await api.patch("/admin/radio/programs/\(id)", body: ["loop_mode": RadioJSON.string(loopMode)], as: RadioProgram.self)
    }

    // MARK: Radio — session playlist (ordered tracks embedding their track)
    static func radioPlaylist(_ programId: String) async throws -> [RadioPlaylistItem] {
        try await api.get("/admin/radio/programs/\(programId)/tracks", as: [RadioPlaylistItem].self)
    }
    static func addToRadioPlaylist(_ programId: String, trackId: String) async throws -> RadioPlaylistItem {
        try await api.post("/admin/radio/programs/\(programId)/tracks", body: ["track_id": RadioJSON.string(trackId)], as: RadioPlaylistItem.self)
    }
    static func removeFromRadioPlaylist(_ programId: String, itemId: String) async throws {
        _ = try await api.delete("/admin/radio/programs/\(programId)/tracks/\(itemId)", as: RadioOk.self)
    }
    /// Reorder the playlist by item-id order — encoder converts `itemIds` → `item_ids`.
    static func reorderRadioPlaylist(_ programId: String, itemIds: [String]) async throws -> [RadioPlaylistItem] {
        struct Body: Encodable { let itemIds: [String] }
        return try await api.put("/admin/radio/programs/\(programId)/tracks/order", body: Body(itemIds: itemIds), as: [RadioPlaylistItem].self)
    }

    private static func mimeType(for filename: String) -> String {
        switch (filename as NSString).pathExtension.lowercased() {
        case "mp3": return "audio/mpeg"
        case "m4a", "mp4": return "audio/mp4"
        case "aac": return "audio/aac"
        case "wav": return "audio/wav"
        case "ogg": return "audio/ogg"
        default: return "audio/mpeg"
        }
    }

    // MARK: Virtual Mixer (admin) — scene presets + jingle soundboard.
    static func mixerScenes() async throws -> [MixerScene] {
        try await api.get("/admin/radio/mixer/scenes", as: [MixerScene].self)
    }
    static func mixerJingles() async throws -> [MixerJingle] {
        try await api.get("/admin/radio/mixer/jingles", as: [MixerJingle].self)
    }

    // MARK: Virtual Mixer — live on-air engine bridge (/admin/radio/mixer/live/*).
    // Writes use the same omit-null snake-key bodies as the other radio endpoints.
    // /status never errors server-side (engine-off reports connected:false); levels
    // return 503 when no engine is configured, /jingle returns 422 when the jingle
    // has no server-hosted audio.

    static func mixerLiveStatus() async throws -> MixerLiveStatus {
        try await api.get("/admin/radio/mixer/live/status", as: MixerLiveStatus.self)
    }
    /// Push one or more channel gains (keys mic|bed|jingle|master, ints 0..100).
    static func mixerLiveLevels(_ channels: [String: Int]) async throws {
        struct Body: Encodable { let channels: [String: Int] }
        _ = try await api.post("/admin/radio/mixer/live/levels", body: Body(channels: channels), as: RadioOk.self)
    }
    /// Push 3-band EQ gains for one or more buses on the live engine.
    /// Buses: mic|bed|master → bands low|mid|high in dB (−12…+12, server-clamped).
    /// Same body pattern as the level pushes; every key here is already lowercase,
    /// so the snake-case encoder leaves them identical on the wire. 503 when no
    /// engine is configured (callers treat that as offline/local-only).
    static func mixerLiveEq(_ bands: [String: [String: Double]]) async throws {
        struct Body: Encodable { let bands: [String: [String: Double]] }
        _ = try await api.post("/admin/radio/mixer/live/eq", body: Body(bands: bands), as: RadioOk.self)
    }
    /// Recall a saved scene on the engine.
    static func mixerLiveScene(_ id: String) async throws {
        _ = try await api.post("/admin/radio/mixer/live/scene", body: ["scene_id": RadioJSON.string(id)], as: RadioOk.self)
    }
    /// Fire a soundboard jingle on air.
    static func mixerLiveJingle(_ id: String) async throws {
        _ = try await api.post("/admin/radio/mixer/live/jingle", body: ["jingle_id": RadioJSON.string(id)], as: RadioOk.self)
    }

    // Chat
    static func chatConversations() async throws -> ChatList {
        try await api.get("/chat/conversations", query: ["scope": "mine"], as: ChatList.self)
    }
    static func chatConversation(_ id: String) async throws -> ChatConversationDetail {
        try await api.get("/chat/conversations/\(id)", as: ChatConversationDetail.self)
    }

    // MARK: Disciples (Discipleship Hub — web DiscipleshipHub.tsx / DisciplesApi)
    // Roster + dossier are pure read-aggregation (Instructor+, server-scoped to the
    // caller's disciple set; Admin/SuperAdmin unrestricted, §5.4). The three actions
    // reuse existing write surfaces: POST /chat/dms + /chat/conversations/{id}/messages,
    // POST /reviews/levels/{advancementId}/usher, POST /admin/reflections/{id}/decision.

    /// GET /disciples — the leader's roster + triage summary.
    static func disciplesRoster() async throws -> DiscipleRoster {
        try await api.get("/disciples", as: DiscipleRoster.self)
    }
    /// GET /disciples/{id} — one student's full journey.
    /// 403 FORBIDDEN_SCOPE if the student is outside the caller's disciple set.
    static func discipleDossier(_ userId: String) async throws -> DiscipleDossier {
        try await api.get("/disciples/\(userId)", as: DiscipleDossierEnvelope.self).data
    }
    /// Create-or-open a 1:1 DM with a member (portal staff may DM anyone).
    static func createDm(userId: String) async throws -> String {
        struct Body: Encodable { let userId: String }
        struct Ack: Decodable { let conversationId: String }
        return try await api.post("/chat/dms", body: Body(userId: userId), as: Ack.self).conversationId
    }
    /// Send a text message over an existing conversation (idempotent on message_id, §3.6).
    static func sendChatMessage(_ conversationId: String, text: String) async throws {
        struct Body: Encodable { let messageId: String; let body: String; let msgType = "text" }
        struct Ack: Decodable { let messageId: String?; let duplicate: Bool? }
        _ = try await api.post("/chat/conversations/\(conversationId)/messages",
                               body: Body(messageId: UUID().uuidString, body: text), as: Ack.self)
    }
    /// GET /reviews/levels — pending level advancements the caller may usher
    /// (cell-scoped; Admin sees all). Used to resolve the ADVANCEMENT id.
    static func levelReviews() async throws -> [LevelReviewItem] {
        try await api.get("/reviews/levels", as: DataList<LevelReviewItem>.self).data
    }
    /// Usher a member into the next level. NOTE the path param is the advancement
    /// id from /reviews/levels — NOT the member's user id. Idempotent server-side.
    static func usherLevel(advancementId: String, note: String?) async throws {
        struct Ack: Decodable { let status: String?; let advanced: Bool? }
        var body: [String: String] = [:]
        let n = note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !n.isEmpty { body["note"] = n }
        _ = try await api.post("/reviews/levels/\(advancementId)/usher", body: body, as: Ack.self)
    }
    /// Decide a reflection (approve | return | defer); feedback required to return.
    static func decideReflection(_ reflectionId: String, decision: String, feedback: String?) async throws {
        struct Ack: Decodable { let state: String? }
        var body: [String: String] = ["decision": decision]
        let fb = feedback?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !fb.isEmpty { body["feedback_notes"] = fb }
        _ = try await api.post("/admin/reflections/\(reflectionId)/decision", body: body, as: Ack.self)
    }
}

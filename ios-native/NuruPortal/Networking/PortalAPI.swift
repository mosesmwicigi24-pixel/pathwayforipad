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

    // MARK: Curriculum stats — ONE stats source (docs/CURRICULUM_ARCHITECTURE.md §3)
    // The dashboard payload in one call, the completeness report, and the
    // classified activity feed. All replica reads; perm("levels","view").

    /// GET /admin/curriculum/summary → totals + pipeline + per-level cards (no envelope).
    static func curriculumSummary() async throws -> CurriculumSummary {
        try await api.get("/admin/curriculum/summary", as: CurriculumSummary.self)
    }
    /// { data: [...] } envelope for Decodable-only rows (DataList needs Codable).
    private struct DecList<T: Decodable>: Decodable { let data: [T] }

    /// GET /admin/curriculum/validate → { data: [issues] }, errors-first server-side.
    static func curriculumValidate() async throws -> [CurriculumIssue] {
        try await api.get("/admin/curriculum/validate", as: DecList<CurriculumIssue>.self).data
    }
    /// GET /admin/curriculum/activity → { data: [rows] }, each row classified
    /// server-side (kind: published|edited|review|video|quiz|module|milestone).
    static func curriculumActivity(limit: Int = 40) async throws -> [CurriculumActivityRow] {
        try await api.get("/admin/curriculum/activity", query: ["limit": "\(limit)"],
                          as: DecList<CurriculumActivityRow>.self).data
    }

    // MARK: Media placements (§2.2 — one asset, many modules; level always inferred)

    /// GET /admin/modules/{id}/media → { data: [placements] }, position-ordered.
    static func modulePlacements(_ moduleId: String) async throws -> [ModulePlacementRow] {
        try await api.get("/admin/modules/\(moduleId)/media", as: DecList<ModulePlacementRow>.self).data
    }
    /// POST /admin/media/{id}/placements { module_id, position?, required? }.
    /// 404 unknown asset/module; 409 when the pair already exists.
    static func addPlacement(mediaAssetId: String, moduleId: String,
                             position: Int? = nil, required: Bool? = nil) async throws -> PlacementAck {
        struct Body: Encodable { let moduleId: String; let position: Int?; let required: Bool? }
        return try await api.post("/admin/media/\(mediaAssetId)/placements",
                                  body: Body(moduleId: moduleId, position: position, required: required),
                                  as: PlacementAck.self)
    }
    /// DELETE /admin/media/placements/{placementId} — removes ONE placement, never the asset.
    static func removePlacement(_ placementId: String) async throws {
        struct Ack: Decodable { let deleted: Bool? }
        _ = try await api.delete("/admin/media/placements/\(placementId)", as: Ack.self)
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
    /// TRUE aggregate reaction totals ({heart, amen, fire} across ALL members) —
    /// polled with the comments cadence so the console shows server truth.
    static func radioReactions(_ id: String) async throws -> RadioReactionCounts {
        try await api.get("/admin/radio/programs/\(id)/reactions", as: RadioReactionCounts.self)
    }
    /// The admin's own reaction — the MEMBER /radio/* route (admin JWT accepted,
    /// like the listener roster). Idempotent per client_event_id; the ack carries
    /// the fresh server totals so the caller never locally increments.
    static func radioReact(_ id: String, kind: String) async throws -> RadioReactAck {
        try await api.post("/radio/programs/\(id)/react",
                           body: ["kind": RadioJSON.string(kind),
                                  "client_event_id": RadioJSON.string(UUID().uuidString.lowercased())],
                           as: RadioReactAck.self)
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

    /// Progress-capable variant of `uploadRadioAudio` (ADDITIVE — same endpoint,
    /// fields and response). `onProgress` streams (bytesSent, bytesTotal) from the
    /// URLSession task delegate while the multipart body uploads; it fires on a
    /// background queue, so UI callers hop to the main actor.
    static func uploadRadioAudioWithProgress(
        data: Data, filename: String, durationSec: Int? = nil,
        onProgress: @escaping @Sendable (Int64, Int64) -> Void
    ) async throws -> RadioAudioUpload {
        var fields: [String: String] = [:]
        if let durationSec { fields["duration_sec"] = String(durationSec) }
        return try await api.uploadFileWithProgress(
            "/admin/media/audio/upload",
            fileData: data, filename: filename, mimeType: mimeType(for: filename),
            fields: fields, as: RadioAudioUpload.self, onProgress: onProgress)
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

    // MARK: Flock Brief (Shepherd's Pulse — web FlockBrief.tsx / AdminApi)
    // Instructor+ read THEIR flock (cells they lead + direct disciples, §5.4);
    // Admin/SuperAdmin see all signals and may run the scan / brief batch now.
    // Writes POST an empty JSON object `{}` — the exact body the web client sends.

    /// Tolerant ack for the intelligence action responses (shape ignored).
    private struct PulseOk: Decodable { init(from decoder: Decoder) throws {} }

    /// GET /admin/intelligence/flock-brief → { brief: {...} | null }.
    static func flockBrief() async throws -> FlockBrief? {
        try await api.get("/admin/intelligence/flock-brief", as: FlockBriefEnvelope.self).brief
    }
    /// GET /admin/intelligence/signals?since_days=N → { data: [...] }.
    static func pulseSignals(sinceDays: Int = 14) async throws -> [PulseSignal] {
        try await api.get("/admin/intelligence/signals",
                          query: ["since_days": "\(sinceDays)"],
                          as: DataList<PulseSignal>.self).data
    }
    /// POST /admin/intelligence/signals/{id}/ack — marks one signal acknowledged.
    static func ackPulseSignal(_ signalId: String) async throws {
        _ = try await api.post("/admin/intelligence/signals/\(signalId)/ack",
                               body: [String: String](), as: PulseOk.self)
    }
    /// POST /admin/intelligence/signals/scan (Admin) → counts of what it found.
    static func runPulseScan() async throws -> PulseScanResult {
        try await api.post("/admin/intelligence/signals/scan",
                           body: [String: String](), as: PulseScanResult.self)
    }
    /// POST /admin/intelligence/flock-brief/run (Admin) → { week_of, written, skipped }.
    static func runFlockBriefs() async throws -> FlockBriefRunResult {
        try await api.post("/admin/intelligence/flock-brief/run",
                           body: [String: String](), as: FlockBriefRunResult.self)
    }
}

// MARK: - Curriculum stats models (GET /admin/curriculum/* — stats.ts shapes)
//
// Decode-tolerant per the app convention: every non-optional scalar uses a
// @Default* wrapper so a missing/null key can never take down the dashboard;
// nested objects are optionals the views default. Wire is snake_case — the
// shared convertFromSnakeCase decoder maps to these camelCase keys.

/// Counts-by-status bucket (levels: published/draft/in_review; modules: +archived).
struct CurriculumStatusCounts: Decodable {
    @DefaultZero var published: Int
    @DefaultZero var draft: Int
    @DefaultZero var inReview: Int
    @DefaultZero var archived: Int
    @DefaultZero var total: Int
}

/// Attached/unattached split of the video library.
struct CurriculumAssetCounts: Decodable {
    @DefaultZero var attached: Int
    @DefaultZero var unattached: Int
    @DefaultZero var total: Int
}

struct CurriculumTotals: Decodable {
    let levels: CurriculumStatusCounts?
    let modules: CurriculumStatusCounts?
    @DefaultZero var modulesMissingVideo: Int
    @DefaultZero var modulesMissingQuiz: Int
    @DefaultZero var modulesMissingContent: Int
    @DefaultZero var learnersActive: Int
    /// The ONE completion formula (§3): distinct completed published-module
    /// rows ÷ (active learners × published modules), server-rounded.
    @DefaultZero var avgCompletionPct: Int
    let avgQuizScore: Int?
    @DefaultZero var certificatesIssued: Int
    @DefaultZero var badgesConfigured: Int
    @DefaultZero var reflectionQueue: Int
    @DefaultZero var levelReviewsWaiting: Int
    let videoAssets: CurriculumAssetCounts?
}

/// The Draft / In Review / Locked / Live strip.
struct CurriculumPipeline: Decodable {
    @DefaultZero var drafts: Int
    @DefaultZero var inReview: Int
    @DefaultZero var locked: Int
    @DefaultZero var live: Int
}

/// One §5.1 level summary card.
struct CurriculumLevelCard: Decodable, Identifiable {
    struct Quiz: Decodable {
        @DefaultFalse var examExists: Bool
        @DefaultFalse var examPublished: Bool
        let examQuestionCount: Int?
        @DefaultZero var questionCount: Int
    }
    struct Validation: Decodable {
        @DefaultZero var errors: Int
        @DefaultZero var warnings: Int
        @DefaultEmpty var status: String   // "ok" | "warnings" | "errors"
    }
    @DefaultZero var levelNumber: Int
    @DefaultEmpty var title: String
    let theme: String?
    @DefaultEmpty var color: String
    @DefaultEmpty var status: String
    @DefaultFalse var locked: Bool
    let duration: String?
    @DefaultZero var modulesPublished: Int
    @DefaultZero var modulesDraft: Int
    @DefaultZero var modulesTotal: Int
    @DefaultZero var modulesArchived: Int
    let quiz: Quiz?
    @DefaultZero var videosAttached: Int
    @DefaultZero var estimatedMinutes: Int
    @DefaultZero var learners: Int
    @DefaultZero var completionPct: Int
    @DefaultZero var certificates: Int
    let lastUpdated: String?
    let validation: Validation?
    var id: Int { levelNumber }
}

/// GET /admin/curriculum/summary — the whole dashboard payload in one call.
struct CurriculumSummary: Decodable {
    let totals: CurriculumTotals?
    let pipeline: CurriculumPipeline?
    let levels: [CurriculumLevelCard]?
}

/// One completeness-report issue ({severity, level_number, module_id?, code, message}).
struct CurriculumIssue: Decodable, Identifiable {
    @DefaultEmpty var severity: String   // "error" | "warning" | "info"
    @DefaultZero var levelNumber: Int
    let moduleId: String?
    @DefaultEmpty var code: String
    @DefaultEmpty var message: String
    var id: String { "\(severity)-\(levelNumber)-\(code)-\(moduleId ?? "L")" }
}

/// One classified activity row. `audit_id` may arrive as a JSON number or a
/// string depending on the column type, so it's decoded by hand; `metadata`
/// is dropped (the feed shows actor/action/time only).
struct CurriculumActivityRow: Decodable, Identifiable {
    var auditId = ""
    var actorName: String?
    var action = ""
    var entity = ""
    var entityId: String?
    var occurredAt = ""
    var kind = "edited"
    var id: String { auditId.isEmpty ? "\(action)-\(occurredAt)" : auditId }

    enum CodingKeys: String, CodingKey { case auditId, actorName, action, entity, entityId, occurredAt, kind }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        if let s = try? c.decode(String.self, forKey: .auditId) { auditId = s }
        else if let n = try? c.decode(Int.self, forKey: .auditId) { auditId = String(n) }
        actorName = try? c.decodeIfPresent(String.self, forKey: .actorName)
        action = (try? c.decode(String.self, forKey: .action)) ?? ""
        entity = (try? c.decode(String.self, forKey: .entity)) ?? ""
        if let s = try? c.decodeIfPresent(String.self, forKey: .entityId) { entityId = s }
        occurredAt = (try? c.decode(String.self, forKey: .occurredAt)) ?? ""
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "edited"
    }
}

// MARK: - Media placement models (§2.2)

/// One placement of a module (GET /admin/modules/{id}/media) with the asset's
/// library fields joined in.
struct ModulePlacementRow: Decodable, Identifiable {
    @DefaultEmpty var placementId: String
    @DefaultEmpty var mediaAssetId: String
    @DefaultZero var position: Int
    @DefaultTrue var required: Bool
    let title: String?
    let caption: String?
    let durationSec: Int?
    @DefaultEmpty var status: String
    let thumbnailUrl: String?
    @DefaultEmpty var videoSource: String
    let externalUrl: String?
    var id: String { placementId }
}

/// POST /admin/media/{id}/placements response row.
struct PlacementAck: Decodable {
    @DefaultEmpty var placementId: String
    @DefaultEmpty var mediaAssetId: String
    @DefaultEmpty var moduleId: String
    @DefaultZero var position: Int
    @DefaultTrue var required: Bool
}

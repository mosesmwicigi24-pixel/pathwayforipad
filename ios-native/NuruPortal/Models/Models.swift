// Codable models mirroring the backend wire contracts (packages/backend, §3) as
// consumed by the web portal's api/client.ts. Field names match the JSON, so we
// keep snake_case via an explicit CodingKeys-free `keyDecodingStrategy` set on
// the decoder in APIClient.
import Foundation

/// Generic `{ "data": [...] }` envelope used by most list endpoints.
struct DataList<T: Codable>: Codable { let data: [T] }

// MARK: - Auth

struct Session: Codable {
    @DefaultEmpty var accessToken: String
    @DefaultEmpty var refreshToken: String
}

/// /auth/login may return a session OR a 2FA challenge.
struct MfaChallenge: Codable {
    @DefaultFalse var mfaRequired: Bool
    @DefaultEmpty var mfaToken: String
}

// MARK: - Me

struct MeProfile: Codable, Identifiable {
    @DefaultEmpty var userId: String
    let email: String?
    @DefaultEmpty var fullName: String
    @DefaultEmpty var phoneNumber: String
    @DefaultEmpty var role: String
    let locale: String?
    @DefaultEmpty var accountStatus: String
    let roleKeys: [String]
    var id: String { userId }
}

struct MeResponse: Codable {
    let profile: MeProfile
}

// MARK: - Dashboard

struct OverviewKpis: Codable {
    @DefaultZero var totalMembers: Int
    @DefaultZero var activeLearners: Int
    @DefaultZeroD var avgEngagement: Double
    @DefaultZero var membersAtRisk: Int
    @DefaultZero var certificatesThisMonth: Int
    @DefaultZero var reflectionsThisWeek: Int
    @DefaultZero var pendingReviews: Int
    @DefaultZero var reviewsOverdue: Int
    @DefaultZero var modulesPublished: Int
    @DefaultZero var cohortsRunning: Int
    @DefaultZero var checkedInThisWeek: Int
}

struct EngagementCellRow: Codable, Identifiable {
    @DefaultEmpty var cellGroupId: String
    @DefaultEmpty var name: String
    @DefaultZero var members: Int
    @DefaultZeroD var avgEngagement: Double
    @DefaultZero var atRisk: Int
    let disciplerName: String?
    let levelLabel: String?
    var id: String { cellGroupId }
}

struct EngagementReport: Codable {
    let bands: [String: Int]
    let cells: [EngagementCellRow]
}

// MARK: - Members

struct MemberRow: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    let email: String?
    @DefaultEmpty var phoneNumber: String
    let cellName: String?
    let currentLevel: Int?
    let eScore: Double?
    let band: String?
    let city: String?
    let countryCode: String?
    var id: String { userId }
}

struct MembersPage: Codable {
    let data: [MemberRow]
    let nextCursor: String?
}

struct MemberDetail: Codable, Identifiable {
    struct Enrollment: Codable {
        @DefaultZero var currentLevel: Int
        let levelTitle: String?
        let state: String?
    }
    struct Engagement: Codable { let eScore: Double?; let band: String? }
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    let email: String?
    @DefaultEmpty var phoneNumber: String
    let city: String?
    let countryCode: String?
    let cellName: String?
    let language: String?
    @DefaultEmpty var createdAt: String
    let lastActivity: String?
    let enrollment: Enrollment
    let engagement: Engagement
    var id: String { userId }
}

// MARK: - Reflections (review queue)

struct ReflectionRow: Codable, Identifiable {
    @DefaultEmpty var reflectionId: String
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    @DefaultEmpty var moduleTitle: String
    @DefaultZero var levelNumber: Int
    @DefaultEmpty var body: String
    @DefaultEmpty var state: String
    @DefaultEmpty var submittedAt: String
    @DefaultFalse var overdue: Bool
    var id: String { reflectionId }
}
struct ReflectionsPage: Codable { let data: [ReflectionRow] }

// MARK: - Finance

struct FundSummary: Codable, Identifiable {
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
    let currency: String?
    @DefaultZero var totalMinor: Int
    @DefaultZero var monthMinor: Int
    @DefaultZero var giftCount: Int
    var id: String { code }
}
struct FinanceSummary: Codable { let funds: [FundSummary] }

// MARK: - Curriculum

struct LevelAnalyticsRow: Codable, Identifiable {
    @DefaultZero var levelNumber: Int
    @DefaultEmpty var title: String
    let theme: String?
    @DefaultEmpty var status: String
    @DefaultZero var modulesTotal: Int
    @DefaultZero var modulesPublished: Int
    @DefaultZero var learners: Int
    @DefaultZeroD var completionPct: Double
    @DefaultZero var certificates: Int
    var id: Int { levelNumber }
}
struct LevelsReport: Codable { let levels: [LevelAnalyticsRow] }

// MARK: - Notifications

struct NotificationFeedItem: Codable, Identifiable {
    @DefaultEmpty var id: String
    @DefaultEmpty var title: String
    let message: String?
    @DefaultEmpty var category: String
    @DefaultEmpty var at: String
    @DefaultFalse var read: Bool
}
struct NotificationsFeed: Codable { let data: [NotificationFeedItem] }

// MARK: - Events (calendar)

struct CalendarOccurrence: Codable, Identifiable {
    @DefaultEmpty var occurrenceId: String
    @DefaultEmpty var title: String
    let location: String?
    @DefaultEmpty var visibility: String
    @DefaultEmpty var startAt: String
    @DefaultEmpty var endAt: String
    var id: String { occurrenceId }
}
struct CalendarPage: Codable { let data: [CalendarOccurrence] }

// MARK: - Badges & certificates

struct BadgeRow: Codable, Identifiable {
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
    @DefaultEmpty var description: String
    @DefaultEmpty var category: String
    @DefaultZero var earnedCount: Int
    let isActive: Bool?
    var id: String { code }
}
struct BadgesPage: Codable { let data: [BadgeRow] }

struct CertificateRow: Codable, Identifiable {
    @DefaultEmpty var certificateId: String
    @DefaultEmpty var fullName: String
    let levelNumber: Int?
    let levelTitle: String?
    @DefaultEmpty var verificationCode: String
    @DefaultEmpty var issuedAt: String
    let revokedAt: String?
    var id: String { certificateId }
}
struct CertificatesPage: Codable { let data: [CertificateRow]; let nextCursor: String? }

// MARK: - System reference data

struct Country: Codable, Identifiable {
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
    let flag: String?
    let region: String?
    let dialCode: String?
    let currency: String?
    @DefaultEmpty var status: String
    var id: String { code }
}
struct Language: Codable, Identifiable {
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
    @DefaultEmpty var nativeName: String
    @DefaultEmpty var direction: String
    @DefaultFalse var isDefault: Bool
    @DefaultZeroD var coverage: Double
    @DefaultEmpty var status: String
    var id: String { code }
}
struct Congregation: Codable, Identifiable {
    @DefaultEmpty var congregationId: String
    @DefaultEmpty var name: String
    @DefaultEmpty var country: String
    @DefaultEmpty var timezone: String
    @DefaultZero var cellCount: Int
    @DefaultZero var memberCount: Int
    var id: String { congregationId }
}
struct SystemRole: Codable, Identifiable {
    @DefaultEmpty var roleKey: String
    @DefaultEmpty var name: String
    @DefaultEmpty var roleType: String
    @DefaultEmpty var description: String
    @DefaultEmpty var status: String
    @DefaultZero var userCount: Int
    var id: String { roleKey }
}
struct SystemUser: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    let email: String?
    @DefaultEmpty var phoneNumber: String
    @DefaultEmpty var accountStatus: String
    let roleKeys: [String]
    let lastActive: String?
    var id: String { userId }
}

// MARK: - Curriculum (CMS / Level Detail / Quiz Builder)

struct AdminLevel: Codable, Identifiable {
    @DefaultZero var levelNumber: Int
    @DefaultEmpty var title: String
    let theme: String?
    let duration: String?
    @DefaultEmpty var status: String
    @DefaultFalse var locked: Bool
    @DefaultEmpty var color: String
    @DefaultEmpty var publishedCount: String
    @DefaultEmpty var draftCount: String
    @DefaultEmpty var archivedCount: String
    var id: Int { levelNumber }
}

struct AdminModuleSummary: Codable, Identifiable {
    @DefaultEmpty var moduleId: String
    @DefaultZero var levelNumber: Int
    @DefaultZero var moduleSequenceNumber: Int
    @DefaultEmpty var title: String
    let summary: String?
    @DefaultEmpty var status: String
    @DefaultEmpty var evaluationKind: String
    @DefaultEmpty var activeQuestionCount: String
    var id: String { moduleId }
}

struct AdminQuestion: Codable, Identifiable {
    @DefaultEmpty var questionId: String
    @DefaultEmpty var qType: String
    @DefaultEmpty var questionText: String
    @DefaultEmpty var correctAnswer: String
    @DefaultFalse var isActive: Bool
    let explanation: String?
    @DefaultZero var points: Int
    @DefaultFalse var required: Bool
    var id: String { questionId }
}

// MARK: - Content Studio (growth)

struct DevotionalRow: Codable, Identifiable {
    @DefaultEmpty var devotionalId: String
    @DefaultZero var dayNumber: Int
    let series: String?
    @DefaultEmpty var title: String
    let scriptureRef: String?
    @DefaultEmpty var body: String
    @DefaultFalse var isPublished: Bool
    var id: String { devotionalId }
}
struct VerseRow: Codable, Identifiable {
    @DefaultEmpty var memoryVerseId: String
    @DefaultEmpty var reference: String
    @DefaultEmpty var verseText: String
    @DefaultEmpty var version: String
    let weekNumber: Int?
    @DefaultFalse var isActive: Bool
    var id: String { memoryVerseId }
}
struct PlanRow: Codable, Identifiable {
    @DefaultEmpty var planId: String
    @DefaultEmpty var code: String
    @DefaultEmpty var title: String
    let subtitle: String?
    let description: String?
    let category: String?
    @DefaultZero var dayCount: Int
    @DefaultFalse var isActive: Bool
    var id: String { planId }
}
struct ResourceAdminRow: Codable, Identifiable {
    @DefaultEmpty var resourceId: String
    @DefaultEmpty var title: String
    let author: String?
    @DefaultEmpty var kind: String
    let durationLabel: String?
    let url: String?
    @DefaultFalse var isActive: Bool
    var id: String { resourceId }
}

// MARK: - Video Library (media)

struct MediaAssetRow: Codable, Identifiable {
    @DefaultEmpty var mediaAssetId: String
    @DefaultEmpty var kind: String
    @DefaultEmpty var status: String
    @DefaultEmpty var videoSource: String
    let externalUrl: String?
    let caption: String?
    let levelNumber: Int?
    let thumbnailUrl: String?
    let durationSec: Int?
    @DefaultEmpty var createdAt: String
    let attachedModuleTitle: String?
    let views: Int?
    let completion: Double?
    var id: String { mediaAssetId }
}
struct MediaListResponse: Codable {
    let data: [MediaAssetRow]
    @DefaultZero var stuck: Int
    @DefaultZero var total: Int
}

// MARK: - Dashboard report extras

struct AttendanceTrendPoint: Codable, Identifiable {
    @DefaultEmpty var weekStart: String
    @DefaultZero var checkIns: Int
    @DefaultZero var uniqueMembers: Int
    var id: String { weekStart }
}
struct AttendanceReport: Codable { let trend: [AttendanceTrendPoint] }

struct AuditRow: Codable, Identifiable {
    @DefaultZero var auditId: Int
    @DefaultEmpty var action: String
    let entity: String?
    let actorName: String?
    @DefaultEmpty var createdAt: String
    var id: Int { auditId }
}
struct AuditPage: Codable { let data: [AuditRow] }

struct ConsentRow: Codable { @DefaultEmpty var consentId: String }
struct ConsentsPage: Codable { let data: [ConsentRow] }

// MARK: - Chat

struct ChatConversationRow: Codable, Identifiable {
    @DefaultEmpty var conversationId: String
    @DefaultEmpty var kind: String
    @DefaultFalse var isPublic: Bool
    let title: String?
    let topic: String?
    let avatarUrl: String?
    @DefaultZero var memberCount: Int
    let lastBody: String?
    let lastAt: String?
    let lastAuthor: String?
    @DefaultZero var unread: Int
    var id: String { conversationId }
    var displayName: String { title ?? topic ?? "Conversation" }
}
struct ChatDiscoverSpace: Codable, Identifiable {
    @DefaultEmpty var conversationId: String
    let title: String?
    let topic: String?
    @DefaultZero var memberCount: Int
    var id: String { conversationId }
}
struct ChatList: Codable {
    let conversations: [ChatConversationRow]
    let discoverSpaces: [ChatDiscoverSpace]
}
struct ChatMessageRow: Codable, Identifiable {
    @DefaultEmpty var messageId: String
    @DefaultEmpty var authorName: String
    @DefaultEmpty var body: String
    @DefaultEmpty var msgType: String
    @DefaultEmpty var createdAt: String
    @DefaultFalse var mine: Bool
    let replyBody: String?
    let replyAuthor: String?
    var id: String { messageId }
}
struct ChatConversationDetail: Codable {
    @DefaultEmpty var conversationId: String
    @DefaultEmpty var kind: String
    @DefaultFalse var isPublic: Bool
    let topic: String?
    let title: String?
    @DefaultFalse var joined: Bool
    let messages: [ChatMessageRow]
    var displayName: String { title ?? topic ?? "Conversation" }
}

// Codable models mirroring the backend wire contracts (packages/backend, §3) as
// consumed by the web portal's api/client.ts. Field names match the JSON, so we
// keep snake_case via an explicit CodingKeys-free `keyDecodingStrategy` set on
// the decoder in APIClient.
import Foundation

/// Generic `{ "data": [...] }` envelope used by most list endpoints.
struct DataList<T: Codable>: Codable { let data: [T] }

// MARK: - Auth

struct Session: Codable {
    let accessToken: String
    let refreshToken: String
}

/// /auth/login may return a session OR a 2FA challenge.
struct MfaChallenge: Codable {
    let mfaRequired: Bool
    let mfaToken: String
}

// MARK: - Me

struct MeProfile: Codable, Identifiable {
    let userId: String
    let email: String?
    let fullName: String
    let phoneNumber: String
    let role: String
    let locale: String?
    let accountStatus: String
    let roleKeys: [String]
    var id: String { userId }
}

struct MeResponse: Codable {
    let profile: MeProfile
}

// MARK: - Dashboard

struct OverviewKpis: Codable {
    let totalMembers: Int
    let activeLearners: Int
    let avgEngagement: Double
    let membersAtRisk: Int
    let certificatesThisMonth: Int
    let reflectionsThisWeek: Int
    let pendingReviews: Int
    let reviewsOverdue: Int
    let modulesPublished: Int
    let cohortsRunning: Int
    let checkedInThisWeek: Int
}

struct EngagementCellRow: Codable, Identifiable {
    let cellGroupId: String
    let name: String
    let members: Int
    let avgEngagement: Double
    let atRisk: Int
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
    let userId: String
    let fullName: String
    let email: String?
    let phoneNumber: String
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
        let currentLevel: Int
        let levelTitle: String?
        let state: String?
    }
    struct Engagement: Codable { let eScore: Double?; let band: String? }
    let userId: String
    let fullName: String
    let email: String?
    let phoneNumber: String
    let city: String?
    let countryCode: String?
    let cellName: String?
    let language: String?
    let createdAt: String
    let lastActivity: String?
    let enrollment: Enrollment
    let engagement: Engagement
    var id: String { userId }
}

// MARK: - Reflections (review queue)

struct ReflectionRow: Codable, Identifiable {
    let reflectionId: String
    let userId: String
    let fullName: String
    let moduleTitle: String
    let levelNumber: Int
    let body: String
    let state: String
    let submittedAt: String
    let overdue: Bool
    var id: String { reflectionId }
}
struct ReflectionsPage: Codable { let data: [ReflectionRow] }

// MARK: - Finance

struct FundSummary: Codable, Identifiable {
    let code: String
    let name: String
    let currency: String?
    let totalMinor: Int
    let monthMinor: Int
    let giftCount: Int
    var id: String { code }
}
struct FinanceSummary: Codable { let funds: [FundSummary] }

// MARK: - Curriculum

struct LevelAnalyticsRow: Codable, Identifiable {
    let levelNumber: Int
    let title: String
    let theme: String?
    let status: String
    let modulesTotal: Int
    let modulesPublished: Int
    let learners: Int
    let completionPct: Double
    let certificates: Int
    var id: Int { levelNumber }
}
struct LevelsReport: Codable { let levels: [LevelAnalyticsRow] }

// MARK: - Notifications

struct NotificationFeedItem: Codable, Identifiable {
    let id: String
    let title: String
    let message: String?
    let category: String
    let at: String
    let read: Bool
}
struct NotificationsFeed: Codable { let data: [NotificationFeedItem] }

// MARK: - Events (calendar)

struct CalendarOccurrence: Codable, Identifiable {
    let occurrenceId: String
    let title: String
    let location: String?
    let visibility: String
    let startAt: String
    let endAt: String
    var id: String { occurrenceId }
}
struct CalendarPage: Codable { let data: [CalendarOccurrence] }

// MARK: - Badges & certificates

struct BadgeRow: Codable, Identifiable {
    let code: String
    let name: String
    let description: String
    let category: String
    let earnedCount: Int
    let isActive: Bool?
    var id: String { code }
}
struct BadgesPage: Codable { let data: [BadgeRow] }

struct CertificateRow: Codable, Identifiable {
    let certificateId: String
    let fullName: String
    let levelNumber: Int?
    let levelTitle: String?
    let verificationCode: String
    let issuedAt: String
    let revokedAt: String?
    var id: String { certificateId }
}
struct CertificatesPage: Codable { let data: [CertificateRow]; let nextCursor: String? }

// MARK: - System reference data

struct Country: Codable, Identifiable {
    let code: String
    let name: String
    let flag: String?
    let region: String?
    let dialCode: String?
    let currency: String?
    let status: String
    var id: String { code }
}
struct Language: Codable, Identifiable {
    let code: String
    let name: String
    let nativeName: String
    let direction: String
    let isDefault: Bool
    let coverage: Double
    let status: String
    var id: String { code }
}
struct Congregation: Codable, Identifiable {
    let congregationId: String
    let name: String
    let country: String
    let timezone: String
    let cellCount: Int
    let memberCount: Int
    var id: String { congregationId }
}
struct SystemRole: Codable, Identifiable {
    let roleKey: String
    let name: String
    let roleType: String
    let description: String
    let status: String
    let userCount: Int
    var id: String { roleKey }
}
struct SystemUser: Codable, Identifiable {
    let userId: String
    let fullName: String
    let email: String?
    let phoneNumber: String
    let accountStatus: String
    let roleKeys: [String]
    let lastActive: String?
    var id: String { userId }
}

// MARK: - Curriculum (CMS / Level Detail / Quiz Builder)

struct AdminLevel: Codable, Identifiable {
    let levelNumber: Int
    let title: String
    let theme: String?
    let duration: String?
    let status: String
    let locked: Bool
    let color: String
    let publishedCount: String
    let draftCount: String
    let archivedCount: String
    var id: Int { levelNumber }
}

struct AdminModuleSummary: Codable, Identifiable {
    let moduleId: String
    let levelNumber: Int
    let moduleSequenceNumber: Int
    let title: String
    let summary: String?
    let status: String
    let evaluationKind: String
    let activeQuestionCount: String
    var id: String { moduleId }
}

struct AdminQuestion: Codable, Identifiable {
    let questionId: String
    let qType: String
    let questionText: String
    let correctAnswer: String
    let isActive: Bool
    let explanation: String?
    let points: Int
    let required: Bool
    var id: String { questionId }
}

// MARK: - Content Studio (growth)

struct DevotionalRow: Codable, Identifiable {
    let devotionalId: String
    let dayNumber: Int
    let series: String?
    let title: String
    let scriptureRef: String?
    let body: String
    let isPublished: Bool
    var id: String { devotionalId }
}
struct VerseRow: Codable, Identifiable {
    let memoryVerseId: String
    let reference: String
    let verseText: String
    let version: String
    let weekNumber: Int?
    let isActive: Bool
    var id: String { memoryVerseId }
}
struct PlanRow: Codable, Identifiable {
    let planId: String
    let code: String
    let title: String
    let subtitle: String?
    let description: String?
    let category: String?
    let dayCount: Int
    let isActive: Bool
    var id: String { planId }
}
struct ResourceAdminRow: Codable, Identifiable {
    let resourceId: String
    let title: String
    let author: String?
    let kind: String
    let durationLabel: String?
    let url: String?
    let isActive: Bool
    var id: String { resourceId }
}

// MARK: - Video Library (media)

struct MediaAssetRow: Codable, Identifiable {
    let mediaAssetId: String
    let kind: String
    let status: String
    let videoSource: String
    let externalUrl: String?
    let caption: String?
    let levelNumber: Int?
    let thumbnailUrl: String?
    let durationSec: Int?
    let createdAt: String
    let attachedModuleTitle: String?
    let views: Int?
    let completion: Double?
    var id: String { mediaAssetId }
}
struct MediaListResponse: Codable { let data: [MediaAssetRow] }

// MARK: - Chat

struct ChatConversationRow: Codable, Identifiable {
    let conversationId: String
    let kind: String
    let isPublic: Bool
    let title: String?
    let topic: String?
    let avatarUrl: String?
    let memberCount: Int
    let lastBody: String?
    let lastAt: String?
    let lastAuthor: String?
    let unread: Int
    var id: String { conversationId }
    var displayName: String { title ?? topic ?? "Conversation" }
}
struct ChatDiscoverSpace: Codable, Identifiable {
    let conversationId: String
    let title: String?
    let topic: String?
    let memberCount: Int
    var id: String { conversationId }
}
struct ChatList: Codable {
    let conversations: [ChatConversationRow]
    let discoverSpaces: [ChatDiscoverSpace]
}
struct ChatMessageRow: Codable, Identifiable {
    let messageId: String
    let authorName: String
    let body: String
    let msgType: String
    let createdAt: String
    let mine: Bool
    let replyBody: String?
    let replyAuthor: String?
    var id: String { messageId }
}
struct ChatConversationDetail: Codable {
    let conversationId: String
    let kind: String
    let isPublic: Bool
    let topic: String?
    let title: String?
    let joined: Bool
    let messages: [ChatMessageRow]
    var displayName: String { title ?? topic ?? "Conversation" }
}

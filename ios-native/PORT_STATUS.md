# Web → SwiftUI port status (line-by-line parity tracker)

Mechanism: every page below is ported from its exact web source in
`packages/admin-web/src/components/pages/`. A page is **done** only when its hero,
every card/section, and every analytic in the web source is represented natively.
No page, section, or code path is skipped. Build + PR happen only after ALL are ✅.

| # | Page (sidebar) | Web source | Native file | Status |
|---|----------------|-----------|-------------|--------|
| 1 | Dashboard | Dashboard.tsx | Dashboard/DashboardView.swift | ✅ done |
| 2 | Notifications | Notifications.tsx | Notifications/NotificationsView.swift | ✅ |
| 3 | Cell Engagement | CellEngagement.tsx | Operations/CellEngagementView.swift | ✅ |
| 4 | Cell Detail | CellDetail.tsx | Operations/CellDetailView.swift | ✅ |
| 5 | Members | Members.tsx | Members/MembersView.swift | ✅ |
| 6 | Member Profile | MemberProfile.tsx | Members/MemberDetailView.swift | ✅ |
| 7 | Reflection Queue | ReflectionQueue.tsx | Operations/ReflectionQueueView.swift | ✅ |
| 8 | Chat | Chat.tsx | Chat/ChatView.swift | ✅ |
| 9 | Events | Events.tsx | Events/EventsView.swift | ✅ |
| 10 | Finance | Finance.tsx | Finance/FinanceView.swift | ✅ |
| 11 | Certificates | Certificates.tsx | Certificates/CertificatesView.swift | ✅ |
| 12 | Badges | Badges.tsx | Badges/BadgesView.swift | ✅ |
| 13 | Curriculum Levels | CurriculumLevels.tsx | Curriculum/CurriculumLevelsView.swift | ✅ |
| 14 | CMS — Curriculum | CmsCurriculum.tsx | Curriculum/CmsCurriculumView.swift | ✅ |
| 15 | Level Detail | LevelDetail.tsx | Curriculum/CmsCurriculumView.swift (LevelDetailView) | ✅ |
| 16 | Level Quiz Builder | QuizBuilder.tsx + ModuleQuizBuilder.tsx | Curriculum/QuizBuilderView.swift | ✅ |
| 17 | Video Library | VideoLibrary.tsx | Curriculum/VideoLibraryView.swift | ✅ |
| 18 | Content Studio | GrowthContent.tsx | Curriculum/ContentStudioView.swift | ✅ |
| 19 | Users | Users.tsx | System/UsersView.swift | ✅ |
| 20 | Roles & Permissions | Roles.tsx | System/RolesView.swift | ✅ |
| 21 | Congregations | Congregations.tsx | System/CongregationsView.swift | ✅ |
| 22 | Countries | Countries.tsx | System/CountriesView.swift | ✅ |
| 23 | Languages | Languages.tsx | System/LanguagesView.swift | ✅ |
| 24 | Profile | Profile.tsx | Profile/ProfileView.swift | ✅ |
| 25 | Services | Services.tsx | Attendance/ServicesView.swift | ✅ |
| 26 | Follow-up | FollowUp.tsx | Attendance/FollowUpView.swift | ✅ |

Each page file is self-contained: page-local Codable models + `APIClient.shared.get(...)`
calls, composed over the shared design kit (NuruTheme + Components). Shared files are
never edited by page work, so all pages port in parallel without collisions.

## 2026-08-17 — Services and Follow-up

These two were not "pending" in this tracker; they were ABSENT. Both pages
postdate the original port (pathway #427 church-service QR attendance, #429
scan-to-join and the follow-up cadence engine), so the iPad and Mac could not
create a service, project its QR, or see who was waiting to be called — while
the web portal could.

That is the failure mode a parity tracker exists to prevent, and it did not,
because nothing adds a row for a page that was invented after the last audit.
Worth remembering the next time this list reads as complete: a full column of
green means every page SOMEONE LISTED is done.

  Services   — service list with a live open/closed pill, and a projection view.
               The QR is rendered on-device with CoreImage at correction level H
               (photographed across a room, at an angle, often half-blocked by a
               head) and never interpolated, because a smoothed QR is an
               unreadable one.
  Follow-up  — "To call" first and default; it is the only tab that asks
               something of the reader. Members and Services tabs alongside.
               Closing a call demands an outcome, not a tick.

Both build for iPad and for Mac Catalyst.

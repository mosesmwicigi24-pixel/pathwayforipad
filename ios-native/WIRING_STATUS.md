# Functional wiring pass — connect every interactive element (page by page)

Every button, card, link, save/edit/cancel/delete, toggle and filter on each page is
wired to the same endpoint/navigation the web portal uses (from each page's `.tsx`
handlers + `api/client.ts`). Mechanism: one agent per page(s), editing only that
page's file, over the shared `APIClient` (get/post/put/patch/delete) + `NavRouter`.

| Page | Native file | Status |
|------|-------------|--------|
| Dashboard | Dashboard/DashboardView.swift | ✅ cross-links wired |
| Members | Members/MembersView.swift | ✅ add/edit/graduate/export/results wired |
| Notifications | Notifications/NotificationsView.swift | ✅ |
| Profile | Profile/ProfileView.swift | ✅ |
| Cell Engagement | Operations/CellEngagementView.swift | ✅ |
| Cell Detail | Operations/CellDetailView.swift | ✅ |
| Member Detail | Members/MemberDetailView.swift | ✅ |
| Certificates | Certificates/CertificatesView.swift | ✅ |
| Badges | Badges/BadgesView.swift | ✅ |
| Users | System/UsersView.swift | ✅ |
| Roles & Permissions | System/RolesView.swift | ✅ |
| Congregations | System/CongregationsView.swift | ✅ |
| Countries | System/CountriesView.swift | ✅ |
| Languages | System/LanguagesView.swift | ✅ |
| Reflection Queue | Operations/ReflectionQueueView.swift | ✅ |
| Curriculum Levels | Curriculum/CurriculumLevelsView.swift | ✅ |
| CMS Curriculum / Level Detail | Curriculum/CmsCurriculumView.swift | ✅ |
| Quiz Builder | Curriculum/QuizBuilderView.swift | ✅ |
| Video Library | Curriculum/VideoLibraryView.swift | ✅ |
| Content Studio | Curriculum/ContentStudioView.swift | ✅ |
| Finance | Finance/FinanceView.swift | ✅ |
| Chat | Chat/ChatView.swift | ✅ |
| Events | Events/EventsView.swift | ✅ |

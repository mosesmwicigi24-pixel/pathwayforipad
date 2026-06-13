# Nuru Pathway Web Portal — UI Rebuild Spec

Extracted from the Figma Make source `Mdaaz36GGxSqXvXUHDb6ra` ("Nuru Pathway Web
Portal"). This is the authoritative reference for rebuilding `packages/admin-web`
to the new design. The Make is **React Router + Tailwind v4 + shadcn/ui**; we port
the tokens + layout + per-page composition onto admin-web, keeping our real
`api/client.ts` wiring (no mock data — every screen reads/writes the backend).

## Goal (from the user)
- The web portal **is** the CMS / Admin Portal. **Every mobile content element is
  authored/edited here** (curriculum levels, modules, lessons, quizzes, videos,
  devotionals, memory verses, reading plans, resources, events, announcements,
  badges, certificates).
- Richer admin **reports** (dashboard KPIs, cohort engagement, finance, pathway report).
- DB ↔ backend ↔ web AND DB ↔ backend ↔ mobile all fully wired.

## Design tokens (`src/styles/theme.css`)
Light theme only (dark map exists but unused).
- **Surfaces**: `--background #F6F4EE` (cream page), `--card #FBF8F1`, `--popover #FFFFFF`.
- **Ink**: `--foreground #111827`, `--muted-foreground #6B7280`, `--border #E5E7EB`,
  `--input-background #F3F4F6`, `--switch-background #D1D5DB`.
- **Brand**: `--nuru-navy #0B1F33` (primary, sidebar, headings), `--nuru-gold #C89B3C`
  (accent/active/focus), `--nuru-light-gold #F5E7C5`, `--nuru-dark #071629`, `--nuru-teal/#16A34A`.
- **Status**: success #16A34A / bg #F0FDF4; warning #F59E0B / bg #FFFBEB; danger #DC2626 / bg #FEF2F2.
- **Charts**: navy #0B1F33, gold #C89B3C, green #16A34A, amber #F59E0B, indigo #6366F1.
- **Radius**: `--radius 0.625rem` (10px); cards use `1rem` (16px).
- **Sidebar**: bg `#0B1F33`, fg `#E8EFF5`, active item bg = gold, border `rgba(255,255,255,0.07)`.

### Fonts
- Sans (UI/body): **Manrope**. Display (titles/numerals): **DM Serif Display**.
  Mono (codes/kbd): **DM Mono**. (Load via Google Fonts; fall back Georgia/serif, system-ui.)
- Type scale: display 32/700, section 24/600, card 18/600, body 15/400 (lh 1.65),
  small 13, button 14/600, table-header 12/600 uppercase ls 0.07em.
- `.type-display`/`.type-section` use the **serif** in navy; numerals (`.nuru-numeric`) use serif.

### Reusable design utilities (port these as classes or style helpers)
- `.nuru-card` — card bg + 1px border + 16px radius.
- `.nuru-eyebrow` — 10.5px/700 uppercase ls 0.1em muted; `.nuru-eyebrow-gold` color #8A6B1F.
- Pastel icon-tile tints: `.tint-amber/blue/red/green/violet/rose` (bg + fg pairs).
- Pastel card backgrounds: `.card-amber/blue/green/violet/rose/red` (soft bg + border).
- `.nuru-card-rotate` — rotates the 5 pastel card bgs across children (keeps grids from going monotone).
- `.nuru-date-pill` — gold filter/date pill (bg #FDF5E5, border #F2E2BD, color #8A6B1F).
- `.nuru-tabs` / `.nuru-tab[data-active]` — tab strip with gold underline.
- `.nuru-footnote` — dashed top border, 11px muted footnote inside a card.

## App shell (`Layout.tsx`)
- Full-height flex: **navy sidebar** (260px, mini 68px collapsed) + right column
  (72px white top bar + scrolling main). Mobile: sidebar becomes a drawer with backdrop.
- **Sidebar**: logo row (gold rounded-xl "N" in DM Serif + "Nuru Pathway / Portal Admin");
  nav groups with 9px/800 uppercase group labels; nav items 13px/500, active = gold bg + white text,
  idle = `rgba(232,239,245,0.65)`, lucide icon size 15. Bottom: profile button (avatar initials,
  name, ADMIN gold pill) → popover (My Profile / Sign out); collapse toggle.
- **Top bar** (white): page title (18/700 navy) + subtitle ("Nuru Pathway Admin Portal");
  center search box (`Search members, modules, events…` + ⌘K kbd); right = notification bell
  (gold count badge + dropdown) + user chip (navy avatar, name, ADMIN pill, dropdown).

### Nav groups & routes (`App.tsx`)
- **Portal**: Dashboard `/` (LayoutDashboard).
- **Curriculum**: Curriculum Levels `/curriculum-levels` (AlignLeft) · CMS — Curriculum `/cms` (BookOpen,
  also `/cms/level/:id`) · Level Detail `/level-detail` (Layers) · Module Editor `/module-editor` (Edit3) ·
  Quiz Builder `/quiz-builder` (HelpCircle) · Video Library `/video-library` (Video).
- **Operations**: Cohort Engagement `/cohort-engagement` (TrendingUp) · Members `/members` (Users) ·
  Reflection Queue `/reflection-queue` (MessageSquare) · Events `/events` (CalendarDays) ·
  Finance `/finance` (Wallet) · Certificates `/certificates` (Award) · Badges `/badges` (Star).
- Also `/member-profile` (MemberProfile, reached from a member row / profile menu) and `/login`.
- Top-bar titles: Events→"Events & Attendance", Certificates→"Certificates & Badges", cms/level→"CMS — Level Detail".

## Page inventory (detail pulled per-phase from `src/imports/pasted_text/*.md`)
1. **Dashboard** — "Good evening, {name}"; 4 hero KPIs (Active Learners, Cohorts Running,
   Reflections wk, Pass Rate) with MoM/WoW deltas; 4 pastel stat cards (Modules published,
   Pending reviews, Certificates mo, Members at risk); Curriculum pipeline (Drafts/In review/
   Awaiting publish/Live) ; Pathway Report (Overview/Curriculum/Members tabs) with status-distribution
   donut, status breakdown, daily-engagement bar chart; date pill, Export CSV/Print/Filters.
2. **Curriculum Levels** — the 6-level overview.
3. **CMS — Curriculum** — level/module tree authoring.
4. **Level Detail** — one level: modules list, exam config.
5. **Module Editor** — lesson content, media, evaluation kind, publish lifecycle (guide: cms-module-editor.md).
6. **Quiz Builder** — question bank per module.
7. **Video Library** — video assets + ABR (guide: video-library-management.md).
8. **Cohort Engagement** — engagement bands, E-score, trends.
9. **Members** — congregation table (search/band/level), Add learner, **Set starting point**
   (the §1.9 placement feature already on `main`), row → Member Profile.
10. **Member Profile** — one member: identity, enrollment/placement, progress, giving, milestones.
11. **Reflection Queue** — level-reflection review (approve/return/defer) (guide: reflection-review-design.md).
12. **Events** — events & attendance command center (guide: events-command-center.md).
13. **Finance** — giving ledger, funds, reconciliation (guide: finance-giving-ledger.md).
14. **Certificates** — issued register + issue/revoke.
15. **Badges** — badge catalog (guide: badges-catalog.md).
16. **Login** — admin sign-in (navy).

## Build approach (phases)
- **WP1 — Foundation**: Tailwind v4 + tokens (theme.css) + fonts + shadcn-style primitives
  (Card, Button, Table, Tabs, Dialog, Input, Select, Badge, etc.) + Layout shell (sidebar/topbar) +
  Login + role-gated nav, wired to existing Redux auth. Dashboard rebuilt on real `/admin/reports/*`.
- **WP2 — Curriculum CMS suite**: Curriculum Levels, CMS, Level Detail, Module Editor, Quiz Builder,
  Video Library — all on the existing `CurriculumApi` (admin curriculum endpoints).
- **WP3 — Operations**: Cohort Engagement, Members (+ set-start), Member Profile, Reflection Queue.
- **WP4 — Events / Finance / Certificates / Badges** on existing admin endpoints.
- **WP5 — Mobile-content authoring + wiring**: add admin authoring endpoints for growth content
  (devotionals, memory verses, reading plans, resources) + announcements UI; verify every mobile
  surface has a CMS editor and DB↔backend↔web↔mobile round-trips.

Backend stays authoritative; the portal is Admin/SuperAdmin (role-gated). No mock data —
each screen uses real endpoints (extend the backend where an authoring endpoint is missing).

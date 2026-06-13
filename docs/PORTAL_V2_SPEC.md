# Portal v2 — Final Pathway Portal rebuild

Source of truth: Figma make **Final Pathway Portal** (`ZMEsnrOJCXXY7rHfTBautI`).
This supersedes all prior makes (Pulse-era, FR series). Every admin/CMS page is
rebuilt to this make's exact inline detail; all data comes from the database.

## Decisions (locked with the product owner, 2026-06-13)

1. **Full RBAC, incl. enforcement.** New tables for roles, a module×capability
   permission matrix, user_roles, countries, languages; users gain country /
   language / 2FA / status. Every endpoint is rewired to check the matrix.
2. **Cohort → Cell** renamed through the whole stack (DB, backend, API, web,
   mobile) — forward-only migration, not just UI labels.
3. Cadence: **phase by phase, merge as I go** (each phase a green PR to `main`).

## Shell & tokens

- `react-router-dom` (v7) drives routing. Shell = navy sidebar (4 nav groups,
  collapsible + mobile drawer) + white top bar (search, notifications, profile).
- Design tokens already live in `packages/admin-web/src/index.css` and match the
  make's `theme.css`: navy `#0B1F33`, gold `#C89B3C`, bg `#F6F4EE`, card `#FBF8F1`,
  DM Serif Display + Manrope; utilities `nuru-card`, `type-display/section/card`,
  `card-amber/blue/green/violet/rose/red`, `nuru-card-rotate`, `nuru-tabs`,
  `nuru-eyebrow`, `nuru-date-pill`, `nuru-footnote`.

## Nav groups & routes

- **Portal** — Dashboard (`/`)
- **Curriculum** — Curriculum Levels (`/curriculum-levels`), CMS — Curriculum
  (`/cms`, detail `/cms/level/:id`), Level Detail (`/level-detail`), Level Quiz
  Builder (`/quiz-builder`, now per-level), Video Library (`/video-library`)
- **Operations** — Cell Engagement (`/cell-engagement`, detail
  `/cell-engagement/:cellId`), Members (`/members`), Member Profile
  (`/member-profile`), Reflection Queue (`/reflection-queue`), Events (`/events`),
  Finance (`/finance`), Certificates (`/certificates`), Badges (`/badges`)
- **System (new)** — Users (`/users`), Roles & Permissions (`/roles`), Countries
  (`/countries`), Languages (`/languages`)
- Full-screen: Login (`/login`), Module Preview (`/preview/:moduleId`)

## RBAC model (from the make's `systemData.tsx`)

- 11 roles across 3 tiers: **system** (Super Admin, System Administrator),
  **staff** (National Director, Regional Coach, Curriculum Editor, Pastoral
  Reviewer, Events Coordinator, Finance Officer), **field** (Discipler/Cell
  Leader, Mentor, Member).
- 16 permission modules × 6 capabilities (view, create, edit, delete, approve,
  export). Per-role access profiles compose from levels none/read/contribute/
  manage/full. Users may hold multiple roles.

## Phases (tracked in the task list)

- **P0** Foundation — router, shell, tokens, Login. _(this PR)_
- **P1** Cohort → Cell rename across DB/backend/web/mobile.
- **P2** RBAC schema + seed (roles, permissions, countries, languages, users).
- **P3** RBAC enforcement — permission middleware + rewire endpoints.
- **P4** System pages — Users, Roles & Permissions, Countries, Languages.
- **P5** Dashboard.
- **P6** Curriculum group (Levels, CMS, Level Detail, Module Editor, Module
  Preview, Level Quiz Builder, Video Library).
- **P7** Operations group (Cell Engagement + Detail, Members + Profile,
  Reflection Queue, Events, Finance, Certificates, Badges).

Each inner page ships as a labelled placeholder in P0 and is replaced by its
real, data-wired rebuild in the owning phase.

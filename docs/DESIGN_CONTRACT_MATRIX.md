# Design ⟷ Backend Contract Matrix

Reconciliation of the two published Figma designs against the implemented backend:
- **Mobile**: `thing-dew-10682473.figma.site` — "Nuru Pathway app design"
- **Web portal**: `pulse-revamp-01435126.figma.site` — "Nuru Pathway Web Portal" (CMS + ERP)

Method: extracted each design's full screen/label inventory from its published
bundle and compared it three ways — *what mobile needs from the backend*, *what the
admin needs to manage disciples/reports/administration*, *what exists today*.
Conflicts are resolved here with the spec's guardrails as the authority
(server-authoritative scoring/gating/money §1.1, offline-first §1.7, money never
offline §5.6, RBAC + scoping §5.4, minors §5.9). Pure look-and-feel follows Figma.

Legend: ✅ exists · 🔧 extend · 🆕 build · ⚖️ conflict (decision recorded)

---

## 1. Mobile app (member) ⟷ backend

### 1.1 Navigation (⚖️ conflict — resolved)
The repo's current tabs (`Home · Levels · Calendar · Portal · Chat`) came from the
earlier design. The **new design is authoritative**: tabs are
**Home · Pathway · Give · Community · Profile**. Calendar/events fold into Home +
Community; "Portal" disappears (its content moves to Profile/Home); free-form Chat
is replaced by structured **Community (cohort) discussions**.
**Decision:** retab the app to the new five; keep Calendar/EventDetail as pushed
screens, retire Chat/Portal screens.

### 1.2 Feature ⟶ backend mapping
| Mobile feature (from design) | Needs from backend | Status |
| --- | --- | --- |
| Sign in (Google/Apple/KingsChat), phone, "Not me", change password | `/auth/oauth/{provider}`, refresh rotation; password change for password accounts | ✅ (+🔧 `POST /v1/me/password`) |
| Onboarding (name, DOB, gender, phone, email, city) | onboarding stepper | ✅ (+🔧 add `gender`, `city` to profile step) |
| Home dashboard (greeting, level progress, today/this-week, upcoming events, streak) | `/me`, `/me/pathway`, `/calendar`, `/me/achievements` | ✅ |
| Pathway → Levels → Modules → Lesson | `/me/pathway`, `/levels/{n}/modules`, `/modules/{id}` (gated) | ✅ |
| Lesson media: **Read / Listen / Watch** + "Listened"/"Watched"/"Full video watched", time-on-module telemetry | signed HLS manifest ✅; **audio variant** of a lesson 🔧 (media_assets `kind:'lesson_audio'` + same manifest path); telemetry via `interaction_events` kinds (`audio_played`, `video_watched`, `time_on_module`) | 🔧 |
| Module **reflection** with states *Pending review / Approved / Returned / Deferred* | per-module reflection exists (`module_progress.reflection_text`) but is **not reviewable**; level reflections only have pending/approved/rejected | ⚖️ **Decision:** introduce `module_reflections` review flow; extend `review_state` enum with `returned`, `deferred`; "Returned" sends it back to the member editable, "Deferred" parks it without blocking gating | 🆕 |
| Quiz (one-per-screen, True/False etc., locked answers) | server-assembled + server-scored quiz | ✅ |
| **Spiritual gifts assessment** (Likert: Strongly agree → Rarely), "Your top gifts", "Where to serve" | nothing exists | 🆕 gifts assessment: question bank kind `gifts`, server scoring → top-gift profile + serving-track suggestions (web has matching "Serving track"/"Placement") |
| **Prayer journal** ("New prayer", "Saved to journal", answered) | nothing exists | 🆕 `prayer_entries` (private to member; offline-synced push+pull domain; never visible to leaders — pastoral privacy) |
| **Verse library** ("Your verse library") | scripture fetch ✅; saved verses | 🆕 `saved_verses` (offline-synced) |
| **Community / cohort** ("Your cohort", members, "Streak together", *Next discussion*, Discuss/Comment/Share, prayer wall) | nothing (free chat was deferred) | ⚖️ **Decision:** build as **structured cohort discussions** (threads + comments scoped to the cell, leader-moderated), *not* real-time chat — satisfies the design, avoids the v3 WebSocket/moderation tier. 🆕 |
| Events: RSVP **Going/Maybe/Decline**, "My RSVPs", Check in, reschedule notices | calendar projection ✅, RSVP ✅ (`declined` naming aligned), QR check-in ✅; "My RSVPs" list 🔧 (`GET /v1/me/rsvps`) | 🔧 |
| **Give**: funds (tithe/offering/mission/gift), **M-Pesa, Airtel Money, Card, Apple/Google Pay**, frequency **One-time / Weekly / Monthly** | Stripe card intents ✅ only | ⚖️ **Decision:** (a) provider abstraction `PaymentProvider` with `stripe` (cards/wallets) + `mpesa`/`airtel` (STK-push style, faked in tests) behind the same intent/webhook/ledger flow — PCI + "money never offline" guardrails unchanged; (b) 🆕 `giving_schedules` for weekly/monthly recurring (server-side scheduler creates intents; member manages/cancels). Funds list comes from `funds` table (add `mission`,`gift` seeds). |
| Profile (avatar, personal fields, **socials**, baptism, sign out) | `/me` PATCH ✅ | 🔧 add `gender`, `city`, `socials JSONB` to profile |
| Badges ("Word Lover", "Faithful presence", faithful-reader) | achievements ✅ | ✅ (catalog content authored in web Badges admin) |
| Offline-first everywhere | sync pull/push ✅ + new domains (`prayer_entries`, `saved_verses`, `module_reflections`, `discussion_*` pull) | 🔧 register new domains |

## 2. Web portal (CMS + ERP) ⟷ backend

The design's own labels: **"CMS — Curriculum"** and **"ERP — Cohort Engagement
Dashboard"**, nav: Portal → Dashboard · Curriculum (Levels → Level Detail → Module
Editor → Quiz Builder → Video Library) · Operations (Members, Reflection Queue,
Attendance, Events, Announcements, Badges, Certificates, Finance, Audit).

| Web feature (from design) | Needs from backend | Status |
| --- | --- | --- |
| **Dashboard KPIs**: total members, active learners, avg engagement, members at-risk, certificates/mo, reflections/wk, modules published, cohorts running, attendance trend, guardian-consents-expiring | aggregate report endpoints | 🆕 `GET /v1/admin/reports/overview`, `/admin/reports/attendance`, `/admin/reports/engagement`, `/admin/reports/consents` |
| **CMS levels/modules** (New Level/Module, level detail, publish, versions v1.3…) | full admin CRUD + versioning | ✅ |
| **Module Editor**: rich-text toolbar (headings, bold, lists, quote, scripture, divider), live preview, readiness checklist (title/summary/body≥100 words/key verses) | markdown storage ✅ + sanitized preview ✅ (toolbar emits markdown; checklist is client-side) | ✅ |
| **Quiz Builder**: MC/TF/FitB, pass mark, **time limit**, **attempts cap**, active questions | question CRUD ✅; time limit + attempt cap don't exist | 🔧 add `time_limit_sec`, `max_attempts` to modules; enforce server-side on submit |
| **Video Library**: upload, transcoding status, "stuck encoding", attach to module/event, total assets | upload sessions + transcode pipeline ✅; admin asset LIST 🔧 (`GET /v1/admin/media`) | 🔧 |
| **Members**: list/search, current level, last activity, engagement band, **Add learner** | cohort table ✅ (per cell); congregation-wide member admin list + create | 🆕 `GET/POST /v1/admin/members` |
| **Reflection Queue**: assigned-to-you, approve / **return** / **defer**, internal pastoral note, notify member+multiplier, review history, overdue >3 days, issue certificate | level reviews ✅ (approve/reject) | 🔧 extend states (`returned`,`deferred`), pastoral note column, module-reflection queue (§1.2), history + overdue filters |
| **Attendance**: QR ✅, **manual check-in with reason** (allow-toggle), walk-ins, first-time guests, RSVP'd-but-absent, trend | QR-only today | 🔧 manual check-in endpoint (leader-scoped, audited) + guests/walk-in counters + report |
| **Events admin**: schedule + recurrence ✅, visibility ✅, **enable QR / enable RSVP toggles, check-in opens, reminders 24h/1h, reschedule + notify RSVPs, cancel + announcement** | series/exceptions ✅; toggles + reminder wiring + notify-on-change | 🔧 |
| **Announcements**: compose, channels (**App push / Email / SMS / WhatsApp / In-app banner**), audience (all/cells/level), schedule send, quiet-hours respect, delivered/open rates | notifications infra ✅ (push/email) | 🆕 announcements module on top of notifications; SMS/WhatsApp as provider stubs (abstracted, faked in tests) |
| **Badges admin**: catalog CRUD, criteria, award type, points, most-earned, revocation policy | ✅ (catalog CRUD + revoke exist) | ✅ (+🔧 `points` column, most-earned report) |
| **Certificates admin**: issued list, verification code, **manual issue**, **revoke with reason** | issue-via-outbox ✅, public verify ✅ | 🔧 admin list + manual issue + revoke-with-reason (audited) |
| **Finance**: ledger view, transactions, funds, "Tithe Fund Revenue" | ledger/transactions exist in DB; admin read endpoints | 🆕 `GET /v1/admin/finance/{summary,transactions,ledger}` (Admin view-only; SuperAdmin config per §5.4) |
| **Audit** viewer (actor, action) | `audit_log` table ✅ | 🆕 `GET /v1/admin/audit` (filterable, SuperAdmin) |

## 3. Conflicts corrected (the ⚖️ list, one place)
1. **Mobile tab structure** → new design wins (Home · Pathway · Give · Community · Profile).
2. **Chat** → replaced by structured cohort **discussions** (threaded, cell-scoped, moderated) — no real-time tier needed.
3. **Reflections** → unified model: module-level reflections become reviewable; `review_state` gains `returned` + `deferred`; level reflections unchanged in role (graduation gate). Gating: a *returned* module reflection re-locks "passed" until resubmitted; *deferred* does not block.
4. **Payments** → design's M-Pesa/Airtel/recurring accepted **without** weakening guardrails: provider abstraction (server-side STK push, webhooks, same idempotent ledger), recurring as server-side schedules; cards stay Stripe-tokenized; nothing financial is ever queued offline.
5. **Quiz time limit / attempts** → enforced **server-side** (assembled-at timestamp + attempt counting), never client-trusted.
6. **RSVP naming** → design's "Decline/Not Going" maps to existing `declined`.
7. **Rich-text editor** → authoring UI is rich-text, storage stays **Markdown** (toolbar emits MD; sanitized render unchanged).
8. **"ERP"/"CMS" labels** → adopted as the portal's two nav groups (matches `docs/FUNCTIONAL_OVERVIEW.md`).

## 4. Build plan (each phase = a green PR)
**Backend first (B1–B7):**
- **B1 — ERP core reads:** admin reports (overview/engagement/attendance/consents), members admin (list/search/add), certificates admin (list/issue/revoke), finance reads, audit viewer.
- **B2 — Attendance+Events ops:** manual check-in (+reason, toggle, audit), walk-ins/guests, event toggles (QR/RSVP/check-in-opens), reminders wiring, reschedule/cancel notifications, `GET /v1/me/rsvps`.
- **B3 — Reflection unification:** `module_reflections` review flow, `returned`/`deferred`, pastoral notes, queue/history/overdue, gating hook.
- **B4 — Quiz config:** time limit + attempts cap (schema + server enforcement + builder API).
- **B5 — Announcements:** module + audiences + channel providers (push/email real path; SMS/WhatsApp stubs), delivery stats.
- **B6 — Member growth domains:** spiritual-gifts assessment (+serving tracks), prayer journal, saved verses, profile extensions (gender/city/socials/password) — with sync domains.
- **B7 — Payments v2:** PaymentProvider abstraction, M-Pesa/Airtel adapters (faked), wallets via Stripe, `giving_schedules` recurring + scheduler; funds seeds.
- **B8 — Community:** cohort discussions (threads/comments, moderation, sync pull).

**Web portal (W1–W4):** shell + Dashboard (B1) → CMS screens to design (editor/quiz builder/video library) → Operations screens (members/reflections/attendance/events/announcements) → Badges/Certificates/Finance/Audit.

**Mobile (M1–M3):** retab + Home/Pathway/Profile to new design → Give (methods/recurring) + Community → gifts/prayer/verses/reflection states.

Throughout: OpenAPI + route-parity test stays green; every new offline write gets an idempotency key; new tables follow §2 conventions.

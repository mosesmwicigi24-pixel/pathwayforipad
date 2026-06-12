# Nuru Pathway Web Portal — Functional Guide (step by step)

What the website does, function by function. The portal wears two hats: the **CMS**
(authoring the discipleship curriculum) and the **ERP / church-operations backoffice**
(people, engagement, reviews, events, attendance, money, certificates, badges). Every flow
below is grounded in `nuru-place-technical-spec.pdf` (§ references), `FEATURES_V2_SPEC.md`,
`DESIGN_CONTRACT_MATRIX.md`, and the implemented `/v1` API. The portal nav (Pulse design):
**Dashboard · Curriculum** (Levels & Modules, Video Library) **· Operations** (Members,
My Cohort, Reflection Queue, Attendance, Events, Announcements, Badges, Certificates,
Finance, Audit Log). Format per function: **You do → The system does.**

---

## 0. Access, roles & safety rails

**Sign in.**
1. Open the portal → navy login screen → sign in (dev: email via dev-login; production:
   KingsChat/Google/Apple OIDC, §5.3).
2. System verifies identity server-side, mints a 15-minute access JWT + rotating refresh
   token (reuse of an old token kills the whole session family — theft protection).

**What you can see is decided by role (§5.4).**
- **Student** — no portal access beyond their own data.
- **Instructor / Multiplier** — only the cells in their `leader_assignments`: cohort,
  reviews, relationships, cell events. Anything outside scope returns 403 — the data never
  leaves the database.
- **Admin** — congregation-wide + the CMS + finance view + badge catalog.
- **SuperAdmin** — everything, plus role assignment and financial configuration, which
  additionally demand **step-up MFA** (a fresh TOTP code) even inside a valid session.

**Always-on rails (every function below inherits these).** Every privileged action writes an
immutable audit row (who/what/when); every list paginates by cursor; every error uses one
envelope with a request id; rate limits are stricter on auth/payment/sync; authored content
is sanitized before rendering (no script injection).

---

# PART I — THE CMS (curriculum authoring)

The pathway is 6 levels → modules in sequence → each module is a lesson + an evaluation
(quiz / reflection / none). The CMS is how ministry staff create and maintain all of it
in-app, blog-style — no files, no engineers.

## 1. Create or edit a level
1. Curriculum → "＋ New level" (or open an existing one).
2. Enter title (e.g. "Inner Transformation"), theme, and the **exam pass mark** (default 80%).
3. Save.
- System: creates the next contiguous level number (no gaps allowed), audits the change,
  busts the cached level catalog so apps see it on next refresh.

## 2. Create a module (starts as a draft)
1. Inside a level → "＋ New module".
2. Title, optional summary, estimated minutes, optional key verses.
3. Pick the **evaluation kind** — this decides how members unlock the *next* module:
   `quiz` (must pass), `reflection` (must write one), `none` (completing the lesson is enough).
4. Save → module appears in the level rail with a hollow dot = **draft**.
- System: auto-assigns the next sequence number; drafts are invisible to members everywhere
  (list, lesson, video manifest — the §1.9 hard-lock extends to lifecycle state).

## 3. Write the lesson
1. Open the module → write/paste the lesson in the Markdown editor (headings, lists,
   scripture quotes, callouts).
2. Watch the live preview (server-sanitized — exactly what members will see).
3. Save draft as often as you like.
- System: **every content save creates an immutable version** (`module_versions`) with
  who/when. Nothing is ever lost.

## 4. Author the quiz (if evaluation = quiz)
1. In the quiz panel → "＋ Question".
2. Choose type — MultipleChoice (≥2 options; the correct answer must be one of them),
   TrueFalse, or FillInTheBlank — write the question, mark the correct answer, set difficulty.
3. Add as many as you want; edit/delete freely while drafting; set the module pass mark
   (default 70%).
4. Optionally set a **time limit** (30s–2h) and an **attempts cap** (1–50) — leave blank for
   no limit / unlimited.
- System: validates each type's rules on save; members are later served a **randomized
  subset**, scored server-side — answers and scoring never live in the app. The time limit
  and attempts cap are **server-enforced**: the clock starts when the quiz is opened, a
  late submission is refused (with a small network grace), the member sees attempts
  remaining, and an offline replay of an already-recorded attempt still returns its
  original result instead of burning another attempt.

## 5. Configure the level exam
1. Level → "Exam settings": pass mark (default 80%) + how the exam is assembled from the
   level's question banks (size, selection).
- System: the exam gates level advancement (necessary but not sufficient — see Reviews, §11).

## 6. Publish
1. Hit **Publish**.
- System validation before anything goes live: a `quiz` module with zero active questions is
  refused (422 with reason); the level's published sequence must stay contiguous. On success:
  status flips to published (gold dot), caches bust, and the module becomes visible —
  *but still locked for each member until their own progress unlocks it.*

## 7. Edit after publish / revert
1. Edit anytime — same editor.
2. Version history drawer → view any prior version → **Restore** (restoring creates a new
   version; history stays intact).
- System: members' past quiz attempts keep the question set they were actually served
  (snapshotted), so editing never rewrites history.

## 8. Reorder & archive
1. Drag (or arrow) a module to a new position within its level.
2. "Archive" removes it from members' view.
- System: re-sequences atomically keeping contiguity; **archiving never deletes** — learner
  progress and attempts referencing it are preserved; hard-delete is refused if any progress
  exists.

## 9. Bulk import (one-time accelerator)
1. Admin runs the importer against the curriculum PDF.
- System: creates Levels 1–2 lessons (and titles for 3–6) **as drafts** — a human still
  reviews and publishes each one. It never invents quiz questions.

**End-to-end CMS flow in one line:** New module → write lesson → add quiz → Publish → member
completes prior module → this one unlocks → they read, take the quiz, the server scores it →
your engagement dashboard updates.

---

# PART II — THE ERP (church operations backoffice)

## 10. Cohort engagement dashboard (the multiplier's home screen, §1.3/§1.8)
1. Pick one of your cells.
2. Read the table — **sorted lowest engagement first**, so the person most at risk of
   drifting is row one.
3. Each row: member, three thin progress bars (Habits ÷ Curriculum ÷ Attendance), the
   composite Eᵢ score and its band pill — Thriving ≥ .75 · Steady · Watch · At-risk < .40 —
   and days since last activity.
4. Click a member → their full breakdown and recent signal history.
- System: scores are recomputed nightly (plus instantly when a high-signal event lands, e.g.
  a 14-day gap), from verified events only: lesson opens, server-scored quizzes, HMAC-verified
  QR check-ins. The table is a single indexed read — instant even at scale. Scoping is
  enforced in the query layer: a leader literally cannot fetch another cell's rows.

## 11. Reflection queue (the human gate, §1.9/§1.10 Flow B)
1. Operations → Reflection Queue → state tabs (**pending / returned / deferred / approved**),
   oldest first, with an **overdue** filter and ⚠ flags on anything pending more than 3 days.
2. Open one → read the member's module reflection (set in calm, readable type).
3. Decide — one of three:
   - **Approve** → the reflection passes; the member keeps moving.
   - **Return** → member-visible feedback is **required**; the module **re-locks** until they
     revise and resubmit (the app reopens their composer with your feedback quoted).
   - **Defer** → you're setting it aside for a conversation; nothing is blocked.
4. Optionally add a **pastoral note** — internal only, visually fenced in the form, and
   **never shown to the member** (it never leaves the server, not even via sync). The member
   (and their multiplier) are notified of the decision; a decided reflection can't be decided
   twice, and every decision is audited.
- Level advancement keeps its own human gate: the end-of-level reflection review still flips
  `current_level`, issues the tamper-evident certificate via the outbox, and notifies the
  member — in one transaction. *No one advances a level without a human pastor's yes.*

## 12. Members, milestones & minors
1. Operations → Members: search by name, filter by engagement band or level; minors carry a
   visible flag. **Add learner** creates the Student *and* their Level-1 enrollment in one
   audited step.
2. Find a member (fuzzy search) → profile: progress, engagement, attendance, certificates.
3. Record externally-verified milestones (e.g. water baptism) — audited.
4. Minors are flagged automatically from DOB; their enrollment **cannot be finalized without
   a recorded guardian consent** (name/contact encrypted at rest, immutable, revocable), and
   their data is visible only to assigned leaders — never searchable broadly.

## 13. Cells, leaders & the relationship tree
1. Admin creates cells, assigns leaders (`leader_assignments` = the scoping source of truth).
2. Leaders log multiplier→disciple edges (one multiplier per disciple; no self-links).
- System: the tree is the only "relationship" the platform models (§1.1 — measurement, not
  ministry); every edge is audited.

## 14. Events & calendar (v2 + ops)
1. Create a **series**: title, location, start time *in your local timezone*, duration, and
   recurrence ("every Wednesday 7pm") — validated against safe recurrence rules — plus the
   **ops toggles**: enable RSVP, enable QR check-in, reminders on/off, and when check-in
   opens (minutes before start).
2. The system projects occurrences (DST-correct), materializes the next ~5 weeks, and gives
   **each occurrence its own rotating QR secret**.
3. Cancel or reschedule a single occurrence without touching the series (exceptions) — every
   member who RSVP'd "going" is notified of the change automatically.
4. Members see the calendar (offline too), RSVP, and get reminders (T-24h/T-1h, quiet hours
   respected; only scheduled when reminders are enabled and the event is still ahead).
5. On the day: show the occurrence QR; members scan → idempotent, forgery-proof check-in →
   feeds the Attendance component of engagement. Check-in is refused before the window opens.

**Attendance screen (the day-of roster).** Pick the event →
- the live roster: QR and manual check-ins, with method and time;
- **manual check-in** for a member who forgot their phone — requires a reason, allowed only
  when the event permits it, leader-scoped and audited;
- **walk-in guests** (name + phone, first-time flag) — captured without creating accounts;
- **RSVP'd but absent** — the follow-up list, computed for you.

## 15. Finance — giving & the ledger (§1.10 Flow C, §5.6)
What it does for the treasurer, step by step of the money path:
1. A member gives in the app (online only — giving is hard-blocked offline): amount + fund
   (Tithe / Offering / Missions / Gift / General / Media — the list is data-driven), a
   **payment method** (Card / M-Pesa / Airtel Money), and a **frequency** (one-time /
   weekly / monthly).
2. **Card**: the card never touches our servers — Stripe Elements tokenizes on-device
   (PCI SAQ-A). **Mobile money**: the server sends an STK push to the member's phone; they
   confirm with their PIN on-device — we never see it. Either way the backend only creates
   the intent and records the idempotency key (a retried tap can never double-charge).
3. The provider confirms → fires a webhook/callback → the backend verifies its HMAC
   signature, dedupes it under a row lock (a replay is dropped), then posts **balanced
   double-entry ledger rows** (cash:stripe / cash:mpesa / cash:airtel ↔ fund) in one
   transaction. Settlement happens *only* on that verified callback.
4. **Recurring giving**: weekly/monthly schedules are charged **by the server** on cycle,
   with deterministic per-cycle idempotency keys — a crashed or overlapping run can never
   double-charge; the member manages/cancels schedules in the app (online-only — money is
   never queued offline).
5. Portal → Finance (Admin, view-only per §5.4): per-fund revenue cards (this month +
   all-time + gift counts), the transaction register with fund/status filters, and the
   append-only ledger view. Refunds reverse the ledger; nothing is ever edited in place.
6. Financial *configuration* (funds, etc.) is SuperAdmin + step-up MFA.

## 16. Certificates
1. Issued automatically on approval (see §11): rendered PDF, content hash, detached
   signature, printed verification code, stored in object storage.
2. Portal → Certificates: the issued register (member, level, code, status), **manual
   issuance** for edge cases (idempotent — re-issuing returns the existing certificate),
   and **revocation** with a required reason (audited).
3. Anyone (employer, another church) can verify a code on the **public verify page** — it
   confirms name/level/date validity and nothing more (minors: nothing beyond that, ever).
   A revoked certificate verifies as **invalid** immediately.

## 17. Badges & encouragement (gamification, v2 — faithfulness, not competition)
1. Admin curates the badge catalog (name, icon, category, criteria) — the portal lists it
   **most-earned first** so you can see what's landing; criteria are JSON validated against
   the registered rule schemas; deactivating a badge never strips earners; a wrongful award
   can be revoked with a mandatory reason (audited).
2. The system awards automatically via the rules worker (module completions, attendance,
   level advances, streak ticks) — idempotent, so no event can double-award.
3. Members see their own badges/streaks; leaders see their members' (pastoral); cells see
   **aggregate-only** milestones (suppressed below 3 active members). **No public individual
   leaderboards — by design.**

## 18. Video library (v2)
1. Admin: "Upload video" → browser uploads **directly to storage** via a signed URL (the API
   never proxies bytes) → "Complete" kicks transcoding.
2. Worker transcodes to the ABR ladder capped at **720p/30fps** (PRD §7.3): 720/480/360,
   4-second HLS segments → CDN with immutable caching.
3. Status flips to **Ready** → attach the asset to a module from the editor. The library
   shows every asset with its status; anything **transcoding for more than 30 minutes is
   flagged as stuck**, and archiving is refused while a *published* module still references
   the asset.
4. Members: the player requests a short-lived signed manifest — issued **only if that module
   is unlocked for that member** (the hard-lock covers video). Resume positions sync across
   devices, offline-first.

## 19. Announcements (multi-channel)
1. Operations → Announcements → **Compose**: title + Markdown body, pick the **channels**
   (app push · email · SMS · WhatsApp · in-app banner) and the **audience** (everyone ·
   specific cells · a level). Save as a draft, schedule a send time, or send now.
2. System: fan-out is one delivery per recipient × channel, **idempotent** — a crashed or
   retried send can never double-deliver. Push/email ride the notifications engine, so each
   member's **quiet hours and daily cap still apply** (suppressions are counted, not
   hidden); SMS/WhatsApp go through the provider abstraction; the banner appears in-app.
3. After sending: per-channel **targeted / delivered / suppressed / opened** stats with open
   rates. Scheduled announcements dispatch automatically; drafts and scheduled ones can be
   edited or cancelled — sent ones can't.

## 20. Admin dashboard & audit
1. **Dashboard** (Admin home): the 11-KPI grid — total members, active learners (7d), avg
   engagement, members at risk, pending/overdue reviews, reflections this week, certificates
   this month, check-ins this week, modules published, cohorts running — with at-risk and
   overdue rendered as red alerts; the 8-week attendance trend with recent events; and the
   guardian-consent renewal watchlist (§5.9: consents older than 11 months for members who
   are still minors).
2. **Audit Log** (SuperAdmin): the append-only trail — actor, action, entity, detail —
   filterable by action prefix (e.g. `giving.`) or entity, keyset-paged.

## 21. Notifications & nudges
1. The 12-nudge cadence, inactivity triggers, event reminders, badge awards — all scheduled
   server-side, all respecting each member's quiet hours and daily cap, all dispatched by the
   worker (never from request handlers).

---

## One-page cheat sheet

| Function | You do | System guarantees |
|---|---|---|
| CMS authoring | write → quiz → publish | versioned, validated, sanitized, draft-invisible |
| Cohort | open cell table | verified-signal scores, worst-first, scope-enforced |
| Reviews | approve / return / defer | human gate; returns re-lock; pastoral notes never reach members |
| Events | create series + toggles, show QR | DST-correct recurrence, rotating QR, manual check-in audited |
| Announcements | compose → channels × audience | idempotent fan-out, quiet hours honored, open rates |
| Finance | watch funds/ledger | SAQ-A + mobile money via verified callbacks, double-entry, server-charged recurring |
| Certificates | issue / revoke (rare) | tamper-evident, publicly verifiable; revocation invalidates instantly |
| Badges | curate catalog | server-awarded, idempotent, no leaderboards |
| Video | upload → attach | 720p ABR, signed gated manifests, CDN |
| Members | search, milestones | minors consent-gated and shielded |

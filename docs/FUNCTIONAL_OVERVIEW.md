# Nuru Place Pathway — Functional Overview (step-by-step)

What the platform does, end to end, written as concrete step-by-step flows and
grounded in the engineering spec (`nuru-place-technical-spec.pdf` §1–§5) and the
Features v2 spec (`docs/FEATURES_V2_SPEC.md`). Every step names the API surface and
the spec section it implements. This is the "what it does" companion to the build
docs (`README.md`, `docs/NEXT_STEPS.md`, `docs/MOBILE_UI.md`).

## The three faces of the system
| Face | Who | What it is | Where |
| --- | --- | --- | --- |
| **Member app** | Students / disciples | The discipleship journey — learn, be assessed, give, attend, grow | `packages/mobile` (React Native) |
| **Curriculum CMS** | Admin / SuperAdmin | Author the whole pathway in-app — levels, lessons, quizzes, publishing | `packages/admin-web` → `/v1/admin/*` |
| **Operations ("ERP")** | Instructors / Multipliers / Admins | Run the ministry — cohort engagement, reflection review, relationships, giving ledger, certificates, RBAC | `packages/admin-web` + back-office services |

**Governing rules (binding across every flow):** offline-first on the client
(§1.7); the server is the single authority for gating, scoring, and money (§1.1);
every offline-originated write carries an idempotency key (§2.1/§3.6); money is
never queued offline and cards never touch our servers (§5.6); RBAC + cell scoping
on every request (§5.4); minors are protected data subjects (§5.9).

---

## PART A — Member app: the discipleship journey

### A1. Sign in (§5.3)
1. Member opens the app → **Login** screen.
2. Production: "Continue with KingsChat / Google / Apple" → OAuth authorization-code
   exchange at `POST /v1/auth/oauth/{provider}`; the server validates the IdP token,
   provisions the user on first login, and returns an access token (15-min) + a
   rotating refresh token. Dev builds use `POST /v1/auth/dev-login` with a seeded email.
3. Tokens are stored in the device secure enclave (Keychain/Keystore, §5.7), never
   in plain storage. On any `401`, the client rotates once via
   `POST /v1/auth/token/refresh` and retries; refresh-token reuse revokes the family.

### A2. Onboarding — resumable stepper (§O, §5.9)
1. `GET /v1/onboarding` returns the current step and what's required next (so a
   dropped connection mid-onboarding never loses progress).
2. Steps, each idempotent and individually saved:
   - **profile** → `PUT /v1/onboarding/steps/profile` (DOB, phone, salvation year, baptism).
   - **cell_selection** → browse `GET /v1/directory/cell-groups`, then
     `PUT /v1/onboarding/steps/cell_selection` (derives congregation).
   - **guardian_consent** (minors only) → `PUT …/guardian_consent`; immutable once granted, audited, guardian contact field-encrypted.
   - **literacy_quiz** → `GET /v1/onboarding/literacy-quiz` then `PUT …/literacy_quiz` (server-scored).
   - **notifications** → `PUT …/notifications` (quiet hours / opt-in).
3. **Finalize** → `POST /v1/onboarding/finalize`. For a minor with no unrevoked
   consent this hard-blocks with `422 CONSENT_REQUIRED`. On success it reuses the
   existing enrollment logic to instantiate the member at **Level 1 · Module 1**.

### A3. The pathway home & levels (§1.9, §3.3)
1. `GET /v1/me/pathway` returns every level with the member's completed-module count,
   minutes, and derived status (`completed` / `active` / `locked`) — the dashboard
   renders this instantly from cache, then reconciles (§1.3).
2. Tapping a level → `GET /v1/levels/{n}/modules` returns its modules **in sequence**.
   Each module is `completed`, `next` (the one to do), or `locked`. The **hard-lock
   invariant** (§1.9) means the API never returns higher-level or locked bodies.

### A4. A lesson (§1.7, §1.9)
1. Tap the next module → `GET /v1/modules/{id}` returns the Markdown lesson body,
   key verses, estimated minutes, and (when present) a signed video manifest. Locked
   or unpublished modules return `404`/`409 GATE_LOCKED`.
2. The member reads (Markdown rendered **sanitized**, §5.8). If the module's
   `evaluation_kind = reflection`, a reflection field appears.
3. **Mark complete** → `POST /v1/modules/{id}/complete` (offline-queueable; carries a
   `client_mutation_id` so replays are no-ops). The server records progress and
   re-evaluates gating. The client invalidates the pathway/level caches so the next
   step unlocks immediately.

### A5. The quiz — server-assembled, server-scored (§3.7, §1.1)
1. For a `quiz` module, completion routes to the **Quiz**.
2. `GET /v1/modules/{id}/quiz` returns a **randomized question set with no correct
   answers leaked** (§5.8). The client renders one question per screen
   (MultipleChoice / TrueFalse / FillInTheBlank).
3. Submit → `POST /v1/modules/{id}/quiz/attempts` with a `client_mutation_id` and the
   answers. **The server scores it** against the module pass mark and records the
   attempt; the client never decides pass/fail. The response carries
   `is_passed`, `score_achieved`, `pass_mark`, and `unlocked_next_module_id`.
4. Pass → celebrate, advance to the unlocked module (or Home). Fail → review the
   lesson or retry (a fresh randomized set).

### A6. Level graduation → reflection → certificate (§1.9, §1.10 Flow B)
1. After the last module, `GET /v1/levels/{n}/exam` assembles the level exit exam;
   `POST /v1/levels/{n}/exam/attempts` scores it server-side (must reach
   `required_exam_pass_mark`).
2. The member submits a level reflection → `POST /v1/levels/{n}/reflection` (enqueued
   to the pastor review queue).
3. **A pastor approves** the reflection (operations side, A-ERP below). Only then does
   the server flip `enrollments.current_level` and enqueue certificate issuance via
   the transactional outbox; the certificate worker renders a tamper-evident PDF and
   the member sees it under achievements.

### A7. Video lessons (§V)
1. A module's video → `GET /v1/media/{id}/manifest` returns a **signed, expiring HLS
   master URL** (TTL ≤ 10 min), gated exactly like lesson content (404 until ready,
   `409 GATE_LOCKED` if the owning module is locked). The 720p-capped ABR ladder is
   produced by the transcode pipeline.
2. The player streams adaptively; coarse telemetry (`video_started/paused/75pct`)
   feeds the Hᵢ engagement signal via `interaction_events`.
3. Cross-device **resume position** syncs as the `video_progress` domain (last-writer-
   wins — convenience state, §V.0).

### A8. Attendance (§3.3, offline-tolerant)
1. At a gathering the member scans the event QR.
2. `POST /v1/events/{id}/attendance` validates the HMAC scan token (a screenshot of a
   generic code can't forge it) and records an idempotent check-in (one per event).
3. Offline scans are captured and **replayed through `/v1/sync/push`** (domain
   `attendance`, op `scan`) when connectivity returns. Check-ins feed the Aᵢ signal.

### A9. Calendar & RSVP (§C)
1. `GET /v1/calendar?from&to` returns projected occurrences in a bounded window,
   timezone-aware (DST-correct) and **visibility-scoped** (congregation/cell/leaders).
2. Tap an occurrence → details + RSVP counts. RSVP → `POST /v1/events/{id}/rsvp`
   (offline-queueable via the `event_rsvps` sync domain; idempotent).
3. Reminders (T-24h, T-1h) are scheduled honoring quiet hours + the daily cap.

### A10. Giving — online only (§1.10 Flow C, §5.6)
1. Member enters an amount + fund. **If offline, the flow hard-blocks** with a kind
   message — financial intent is never queued.
2. Online → `POST /v1/giving/intents` (idempotency key) creates a Stripe PaymentIntent;
   the card is tokenized **client-side by Stripe Elements** and confirmed directly
   with Stripe — card data never touches our servers (PCI SAQ-A).
3. Stripe fires a webhook → `POST /v1/webhooks/stripe` (HMAC-verified, deduped under a
   row lock); on `succeeded` the server posts a balanced double-entry ledger row and
   the member sees the gift in `GET /v1/giving/history`.

### A11. Achievements (§G)
1. `GET /v1/me/achievements` returns earned **badges** (faithfulness milestones) and
   the member's streak. Awards are **server-derived** from already-verified events;
   the client can never originate one (pull-only sync domain).
2. No public individual leaderboards — only aggregate, cell-level encouragement.

### A12. Offline sync (the spine, §1.7, §3.6)
- **Pull** (`POST /v1/sync/pull`): per-domain cursors in → changed rows + tombstones
  + new cursors out (modules, progress, quiz attempts, enrollments, video_progress,
  event_rsvps, achievements).
- **Push** (`POST /v1/sync/push`): the client replays its ordered `pending_mutations`
  queue; each carries a `client_mutation_id`; the server applies, validates against
  authoritative rules, and returns a per-mutation result (`applied`/`duplicate`/
  `rejected` with a reason, e.g. `GATE_LOCKED`). Money is explicitly never accepted here.

---

## PART B — Curriculum CMS (Admin authoring)

The whole pathway is authored in-app; there is no file seeding in the loop. CMS
routes are `Admin`/`SuperAdmin` only (`403 FORBIDDEN_SCOPE` otherwise); every write
is audited and content edits are versioned.

### B1. Author a level
1. Admin opens **Curriculum** in the portal (visible only to Admin+).
2. **New level** → `POST /v1/admin/levels` creates the *next contiguous* level number
   (no gaps allowed). Title/theme/exam pass-mark editable via `PUT /v1/admin/levels/{n}`.
3. `GET /v1/admin/levels` lists every level with per-status module counts.

### B2. Author a module + lesson
1. **New module** → `POST /v1/admin/modules` (`level_number`, title, Markdown
   `lesson_content`, `evaluation_kind`, optional pass mark / minutes / video / summary).
   Sequence auto-appends; a clash returns `409`, a gap returns `422`.
2. Edit in the blog-like editor → `PUT /v1/admin/modules/{id}`. **Every content change
   writes an immutable `module_versions` row** and bumps the version. Optimistic
   concurrency: a stale `expected_row_version` returns `409 VERSION_STALE`.
3. Live **sanitized** Markdown preview (`POST /v1/admin/preview`, §5.8).

### B3. Author the quiz / question bank
1. `GET /v1/admin/modules/{id}/questions` lists active questions.
2. Add → `POST /v1/admin/modules/{id}/questions`; edit → `PUT /v1/admin/questions/{qid}`;
   remove → `DELETE …` (soft-deactivate, preserving past attempts).
3. **Per-type validation** (§5.8): MultipleChoice needs ≥2 options incl. the correct
   one; TrueFalse correct ∈ {True,False}; FillInTheBlank needs non-empty text.

### B4. Configure the level exam
- `PUT /v1/admin/levels/{n}/exam` sets the pass mark and served question count;
  the exam draws from the level's published question banks.

### B5. Publish lifecycle (server-validated, §1.9 rule 12)
1. **Publish** → `POST /v1/admin/modules/{id}/publish`. Rejected (`422`) if a `quiz`
   module has no active questions, or if publishing would break the level's published-
   sequence contiguity (earlier modules must be published first). Students only ever
   see `published`.
2. **Unpublish** → back to draft, instantly hidden from students.
3. **Reorder** → `POST /v1/admin/modules/{id}/reorder` re-sequences atomically,
   preserving contiguity and never orphaning learner progress.
4. **Archive** (`DELETE`) → soft; never hard-deleted while progress/attempts reference it.

### B6. Version history & revert
- `GET /v1/admin/modules/{id}/versions` lists who/when/version; `POST …/revert`
  restores a prior version's content **as a new version** (forward-only history).

### B7. Bulk import (accelerator)
- `pnpm --filter @nuru/backend import:curriculum <file>` ingests a PDF/text course
  into **draft** modules (upsert by level+sequence, idempotent, no fabricated
  quizzes) for an Admin to review and publish.

### B8. Curriculum is data-driven
- The framework size is not hard-coded: the engagement Cᵢ denominator uses the **live
  count of published modules** (a constant is only a zero-count fallback). Levels and
  modules are created/edited freely.

---

## PART C — Operations ("ERP"): running the ministry

The back-office for Instructors/Multipliers, Admins, and SuperAdmins. Coarse role
from `users.role`; fine-grained scope from `leader_assignments` (a multiplier only
sees their assigned cells) — enforced in the **query layer**, not just the UI
(`403 FORBIDDEN_SCOPE` for out-of-scope ids, §5.4).

### C1. The cohort engagement table (the defining ops screen, §1.3, §1.8)
1. A multiplier opens the portal → **Cohort**.
2. `GET /v1/cohorts/{cell_id}/members` returns the cell's members **sorted ascending
   by engagement score** (lowest first — who needs attention), cursor-paginated,
   filterable by band. A single indexed read of the pre-computed snapshot table.
3. Each row shows the composite **Eᵢ** and its Hᵢ/Cᵢ/Aᵢ breakdown + band
   (`thriving`/`steady`/`watch`/`at_risk`) + days since last active.
4. Drill in → `GET /v1/members/{id}/engagement` for the full breakdown + recent signals
   (scope-checked).

### C2. How engagement is produced (§1.8, §2.5)
- **Nightly batch** (scheduled worker) recomputes Eᵢ for every active enrollment over
  a 30-day window and upserts `engagement_scores` — the number the cohort sorts on.
- **Incremental nudge**: a high-signal event (e.g. a long inactivity gap) triggers a
  single-member recompute via the outbox so a stalling member surfaces *before* the
  nightly run. `Eᵢ = 0.40·Hᵢ + 0.35·Cᵢ + 0.25·Aᵢ`, each normalized to [0,1].

### C3. Reflection review queue (§1.9 rule 3)
1. **Reviews** → `GET /v1/reviews?state=pending` lists pending reflections **in the
   reviewer's scope**.
2. Approve/Reject → `POST /v1/reviews/{id}/decision` (+ feedback notes). **Approval is
   the gate** that advances the member's level and triggers the certificate (A6).
   Every decision writes an immutable `audit_log` row.

### C4. Relationship tree & milestones (§3.3)
- `POST /v1/relationships` records a multiplier→disciple edge (the discipleship tree).
- `PATCH /v1/members/{id}/milestones` records external milestones (e.g. water-baptism
  verified). The platform models discipleship structure, not counselling content (§1.1).

### C5. Calendar administration (§C)
- Instructors create series for their assigned cells; Admins congregation-wide:
  `POST /v1/admin/events/series` (RRULE validated against an allow-list, capped to
  guard against expansion bombs). `PUT …/series/{id}` edits future occurrences;
  `POST …/series/{id}/exceptions` cancels/reschedules one; `DELETE` soft-deletes
  (past occurrences + attendance preserved). A materializer worker realizes near-term
  occurrences into `events` (each with its own rotating `qr_secret`) for attendance.
- Quick-add: `POST /v1/calendar/parse` (chrono-node) turns "Sunday 9am service" into a
  suggested draft — never auto-creates.

### C6. Gamification administration (§G)
- Admins manage the badge catalog (CRUD, audited); deactivating a badge never revokes
  earned ones. `POST /v1/admin/members/{id}/badges/{code}/revoke` is the only manual
  award path (data-correction, reason required, audited). Cell milestones expose
  **aggregates only**, suppressed below a k-anonymity floor of 3 active members.

### C7. Media administration (§V)
- Admin creates a **direct-to-storage upload session** (`POST /v1/admin/media/uploads`
  → signed PUT URL; bytes never proxy through our API). On
  `POST …/uploads/{id}/complete` a `media.transcode` job is enqueued; the worker runs
  the provider pipeline (Cloudinary or self-managed FFmpeg, 720p cap) and marks the
  asset ready. `GET /v1/admin/media/{id}` shows status/ladder; `DELETE` archives
  (refused while a published module references it).

### C8. RBAC capability matrix (§5.4)
| Capability | Student | Instructor/Multiplier | Admin | SuperAdmin |
| --- | --- | --- | --- | --- |
| Own progress / quizzes / giving | ✓ | ✓ | ✓ | ✓ |
| View assigned-cohort engagement | — | ✓ (own cells) | ✓ (branch) | ✓ (all) |
| Approve reflections | — | ✓ (own cells) | ✓ | ✓ |
| Edit curriculum / question banks | — | — | ✓ | ✓ |
| Manage funds / financial config | — | — | view | ✓ (step-up MFA) |
| Assign roles / leaders | — | — | — | ✓ (step-up MFA) |

Sensitive SuperAdmin/financial actions require **step-up MFA** (a fresh second
factor), enforced server-side (§5.3).

---

## PART D — Financial / giving ledger (§1.10 C, §3.5, §5.6)
1. **Intent** — `POST /v1/giving/intents` (idempotency key) → Stripe PaymentIntent;
   we store only the Stripe id + our ledger (never card data).
2. **Confirm** — the client confirms with Stripe Elements directly.
3. **Webhook** — `POST /v1/webhooks/stripe`: HMAC-verified, deduped against
   `processed_webhooks` under a row lock; first delivery posts a **balanced
   double-entry ledger** (debit cash / credit fund) in one transaction + enqueues a
   receipt notification. `payment_intent.failed` marks failed; `charge.refunded`
   reverses; unknown types are acknowledged and ignored.
4. **Products** — media purchases follow the same path (`POST /v1/products/{id}/purchase`),
   granting access on success.
5. Money is **integer minor units + ISO currency** (never floats), never queued offline.

---

## PART E — The engine room (cross-cutting)

### E1. Transactional outbox + workers (§1.6)
A business write and its side-effect's `outbox` row commit in **one transaction**; a
worker pool drains the outbox (`SELECT … FOR UPDATE SKIP LOCKED`, bounded retries →
dead-letter) and publishes at-least-once; consumers dedupe. Drives certificate
issuance, engagement recompute, notifications, transcode, and calendar materialization.

### E2. Scheduler (the worker process)
Frequent pollers (outbox drain ~5s, notification dispatch ~10s, re-engagement scan
hourly) + nightly cron (engagement recompute, partition maintenance, `is_minor`
refresh). Idempotent and safe across replicas.

### E3. Notifications (§1.5)
The 12-step inactivity nudge cadence, honoring each member's **quiet hours** (local
timezone) and a daily cap; dispatched via the (abstracted) push/email provider.

### E4. Observability & API hardening (§4.7, §5.8)
Liveness `/healthz`, readiness `/readyz` (DB + Redis), RED metrics `/metrics`; W3C
trace propagation; structured logs with secret redaction. Token-bucket rate limiting
(stricter on auth/giving/sync), helmet headers, payload caps, parameterized queries.

### E5. Data & security posture (§2, §5)
3NF PostgreSQL (primary + read replicas, PgBouncer); Redis for sessions/cache/queue;
object storage for certs/uploads/backups. TLS everywhere; field-level PII encryption;
soft-delete + append-only `audit_log`; raw interaction events pruned at 13 months
(only the engagement snapshot persists); minors minimized and never broadly searchable.

---

## Two end-to-end journeys (spec §1.10)
- **Flow A — learn → quiz → unlock:** complete a module (offline-ok) → take its quiz →
  server scores ≥ pass mark → next module unlocks → client pulls the new content.
- **Flow B — graduate → reflect → certify:** pass the level exam → submit reflection →
  pastor approves in the review queue → `current_level` advances → outbox issues the
  signed certificate → member is notified.

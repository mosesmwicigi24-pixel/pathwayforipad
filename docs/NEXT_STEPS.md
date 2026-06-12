# Next steps

The monorepo scaffold is complete and verified (see the root `README.md`). No feature code exists yet — the backend modules, web/mobile screens, and the sync/engagement/gating logic are stubbed seams. This file is the running handoff for continuing in Claude Code.

## 0. Get the repo running locally

Dependencies were validated in an isolated sandbox, **not** installed in this folder. First thing:

```bash
pnpm install
cp .env.example .env          # fill in DATABASE_URL, JWT_SIGNING_KEY, etc. (App. B.1)
```

You need a local PostgreSQL 16 for migrations and dev. Easiest is Docker:

```bash
docker run --name nuru-pg -e POSTGRES_USER=nuru -e POSTGRES_PASSWORD=nuru \
  -e POSTGRES_DB=nuru -p 5432:5432 -d postgres:16
```

Then point `DATABASE_URL` at it and:

```bash
pnpm db:migrate      # apply all 11 §2 migrations
pnpm db:seed         # load 5 levels + 4 funds
```

Sanity-check the toolchain is green in *this* folder (it passed in the sandbox copy):

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm openapi:lint
```

## 1. Build order (suggested)

Work module-by-module against the spec. Each backend module already has a seam at `packages/backend/src/modules/<name>/index.ts` and a `register<Name>(ctx)` hook mounted in `src/http/app.ts`.

1. **Identity / Auth (§5.3, §3.3)** — OAuth code exchange (KingsChat primary, Google, Apple), JWT minting + 15-min access TTL, rotating refresh tokens with reuse detection, `/v1/auth/*` and `/v1/me`. Foundation for everything else.
2. **Curriculum (§3.3)** — `/v1/levels`, `/v1/levels/{n}/modules`, `/v1/modules/{id}` with gating, admin module/question editing writing `module_versions`.
3. **Progress / Gating (§1.9, §3.3)** — module completion, the server-side gating engine (`fn_module_unlocked` already exists), level transitions. Honor the **hard-lock invariant** — no API path returns higher-level content for a lower-level member.
4. **Assessment (§3.3)** — randomized quiz assembly, server-side scoring, attempt logs, reflection submission → review queue.
5. **Sync / Offline (§1.7, §3.6)** — `/v1/sync/pull` (delta + tombstones + cursors) and `/v1/sync/push` (ordered mutation replay, per-mutation results). Conflict rules by record class; the `@nuru/shared` sync types and the mobile `offlineSlice` are already shaped for this.
6. **Engagement (§1.8, §2.5)** — wire the nightly batch worker to `src/db/engagement-aggregation.sql`, upsert `engagement_scores` with bands (`engagementBand()` in `@nuru/shared`), plus the incremental-recompute trigger via the outbox.
7. **Financial (§1.10 Flow C, §3.5, §5.6)** — Stripe Elements intent creation, the `verifyStripeWebhookIdempotent` middleware (HMAC + `processed_webhooks` row-lock dedupe), double-entry ledger posting. **Keep money off our servers (PCI SAQ-A) and never offline.**
8. **Certificates / Notifications / Media** — outbox-driven cert issuance + public verify, the 12-nudge cadence with quiet hours, signed Cloudinary URLs.

Cross-cutting, add as you go: the **transactional outbox worker** (drains `outbox`), the **partition-maintenance job** (`src/db/partition-maintenance.sql`), and per-request RBAC scoping through `leader_assignments` (§5.4).

## 2. Frontends

- **admin-web** (`packages/admin-web`) — start with the defining screen: the cohort table sorted ascending by `e_score`, a single indexed read of the snapshot table (§1.3). Then the reflection-review queue, relationship-tree editor, curriculum editors.
- **mobile** (`packages/mobile`) — generate the native `ios/`/`android/` projects with the RN CLI (not committed yet), wire the encrypted SQLite `LocalStore` (SQLCipher) behind the interface in `src/db/localStore.ts`, and the `pending_mutations` replay loop against `/v1/sync/push`.

## 3. Open items to resolve

- **45-module curriculum seed (blocking for curriculum).** `seeds/03_modules.placeholder.sql` and the contiguity test in `test/reference-integrity.test.ts` are parked pending the **PRD curriculum appendix**, which is not in the engineering spec. Supply it, then populate the seed and un-skip the test. The gating engine depends on contiguous sequence numbers.
- **`is_minor` staleness (product/security decision, §5.9).** Currently trigger-maintained, so the flag only refreshes on the next write to the row. Decide between a nightly refresh job or computing minor-status at query time, since minors are protected data subjects.
- **Spec deviations already applied** (see README "Flagged spec deviations"): `citext` extension added; `is_minor` trigger instead of a generated column; widened partitioned-table keys on `interaction_events`. Keep these in mind when reading §2.

## 4. Guardrails (from the project spec — keep intact)

- Offline-first sync engine, **server-authoritative** gating/scoring/money.
- Idempotency keys on every offline-originated write; mutation queue is the mobile system of record.
- Money is integer minor units + ISO currency, never floats.
- Secrets by name only, never committed.
- The OpenAPI doc (`packages/shared/src/openapi/openapi.yaml`) is the wire contract — keep it and the code in sync; CI lints it.
- Ask before adding dependencies or changing the spec's decisions.

---

# Build prompts (paste into Claude Code)

These are ready-to-run prompts for the next milestones. Run them in order — each
assumes the previous is green. They follow the autonomous-operation rules in
`CLAUDE.md` (make the recommended call, add standard deps, keep going until tests pass).

> **Run the whole chain hands-off:** paste this into Claude Code —
> *"Work through the build prompts in docs/NEXT_STEPS.md in order (Prompt 1 → 2 → 3 → 4 → 5 → 6 → 7).
> Complete each one and get it fully green (typecheck, lint, test, openapi:lint) before
> starting the next. Follow CLAUDE.md autonomous-operation rules — don't stop to ask;
> make the recommended choice and keep going. After each prompt, summarize what changed
> and the test result, then continue to the next."*
>
> _Status: Prompts 1–5, the UI/UX pass, and Features v2 are complete and green
> (see docs/FEATURES_V2_SPEC.md, docs/FUNCTIONAL_OVERVIEW.md)._
>
> _**Current direction (supersedes the prompts below):** the two published Figma
> designs — mobile app + web portal (CMS/ERP) — were reconciled against the
> backend in **docs/DESIGN_CONTRACT_MATRIX.md**. That matrix is now the governing
> build plan: backend phases **B1–B8**, then web portal **W1–W4**, then mobile
> **M1–M3**. The prompts below are retained as history of how the platform got
> here; new work follows the matrix._

## Prompt 1 — Get to 100% green + end-to-end journeys + OpenAPI contract

```
Read CLAUDE.md and docs/NEXT_STEPS.md. Work autonomously to green + harden, per CLAUDE.md.
1. Fix the failing test in test/engagement.test.ts: cohort() returns { data, next_cursor },
   so destructure { data: list } instead of treating the result as an array. Get pnpm
   --filter @nuru/backend test fully green.
2. Add end-to-end journey tests (test/journey-*.test.ts) against the embedded Postgres:
   - Journey A (§1.10 Flow A): onboard a user, complete L1·M1, pass its quiz, assert M2
     unlocks; replay the same completion+quiz via /v1/sync/push and assert idempotent.
   - Journey B (§1.10 Flow B): pass the L1 exam, submit a reflection, approve it as a
     pastor, assert current_level flips to 2 and a certificate row is issued via the
     outbox worker.
3. Reconcile packages/shared/src/openapi/openapi.yaml with every implemented route and
   add a test asserting each mounted Express route exists in the OpenAPI paths (and vice
   versa). Keep pnpm openapi:lint green.
Definition of done: typecheck, lint, test, openapi:lint all green.
```

## Prompt 2 — Run the admin portal in the browser (dev seed)

```
Read CLAUDE.md and docs/NEXT_STEPS.md. Goal: make the admin portal show the cohort table
with live engagement bands in the browser, end-to-end, against a dev seed. Work
autonomously per CLAUDE.md; keep typecheck/lint/test green.

BACKEND / DATA:
1. Ensure a dev seed exists and is idempotent, separate from the production seeds (don't
   touch 01_levels/02_funds). Create scripts/seed-dev.mjs + a "seed:dev" script on
   @nuru/backend that inserts: one congregation, 2 cell groups, an Admin user
   (email admin@dev.local), an Instructor (email leader@dev.local) WITH a
   leader_assignments row for cell group 1, and ~6 Student members in cell group 1 with
   varied signal (different interaction-day counts, module completions, and attendance)
   so engagement spans thriving->at_risk. Print the seeded emails + cell_group_id at the end.
2. After seeding, run the engagement recompute so engagement_scores is populated (either
   call the recompute service at the end of seed-dev, or add a "recompute:dev" script).
   The cohort table reads the snapshot, so this must run or the table is empty.
3. CORS: the Vite dev server (http://localhost:5173) calls the API cross-origin. Prefer a
   Vite dev proxy over enabling CORS on the server — configure vite.config.ts to proxy
   "/v1" -> http://localhost:8080. (If you instead add CORS middleware, gate it to
   NODE_ENV !== 'production' and the dev origin only.)

FRONTEND (packages/admin-web):
4. Point src/api/client.ts at base "/v1" (so the Vite proxy handles it; no hardcoded host).
5. Dev login UI: an email field that POSTs /v1/auth/dev-login, stores the returned
   access_token in memory (Redux/React state — NOT localStorage), and attaches it as the
   Authorization: Bearer header on every request. Clearly mark dev-only.
6. Cohort screen (the defining portal screen, §1.3): a cell-group picker, the cohort table
   sorted ascending by engagement score, band color-coding (thriving=green, steady=blue,
   watch=amber, at_risk=red), and Hᵢ/Cᵢ/Aᵢ + last_active_days_ago columns. Wire it to
   GET /v1/cohorts/{cell_id}/members (handle the { data, next_cursor } envelope, 401, 403).
7. Reuse the existing CohortTable component if present; don't duplicate it.

DELIVERABLE: after it's green, write the exact local run recipe into docs/NEXT_STEPS.md and
print it to me — the docker Postgres command, pnpm db:migrate, pnpm --filter @nuru/backend
seed:dev, starting the backend (port 8080), starting admin-web (port 5173), the dev-login
email to use, and which cell group to pick to see a full spread of bands.
```

## Prompt 3 — Wire the mobile app login + offline sync loop

> Note: the React Native app needs the Mac native toolchain (Xcode / Android Studio) to
> render on a simulator. This prompt makes the sync loop testable in Node against the dev
> backend (the real validation) and documents the simulator run as a follow-on.

```
Read CLAUDE.md, docs/NEXT_STEPS.md, and nuru-place-technical-spec.pdf §1.3, §1.7, §3.6,
§5.6, §5.7. Goal: wire the mobile app's login + offline-first sync loop against the dev
backend, and prove it with an integration test that runs in Node (no simulator needed).
Work autonomously per CLAUDE.md; keep typecheck/lint/test green.

API CLIENT (packages/mobile/src/api/client.ts):
1. Configurable base URL via env/config: default http://localhost:8080 for iOS simulator,
   but document that the Android emulator must use http://10.0.2.2:8080 to reach the host.
2. Inject Authorization: Bearer <access token>. On 401/TOKEN_EXPIRED, call
   /v1/auth/token/refresh once, store the rotated pair, and retry the original request.
   Tokens live in the OS secure store (react-native-keychain), NOT plain SQLite/asyncStorage
   (§5.7) — add a thin TokenVault interface with a keychain impl + an in-memory impl for tests.

AUTH:
3. LoginScreen: for dev, call POST /v1/auth/dev-login with a seeded Student email
   (from seed-dev, e.g. student1@dev.local) and store the returned tokens in TokenVault.
   Keep the real OAuth button stubbed/disabled with a "dev login" path clearly marked.
   On launch, render from local state first, then reconcile (§1.3) — never block on network.

OFFLINE SYNC LOOP (packages/mobile/src/sync/syncEngine.ts + store/offlineSlice + db/localStore):
4. Mutation queue is the system of record (§1.7): lesson completion, quiz submission,
   attendance scan, habit ticks are written to the local pending_mutations table as intent
   records with a client UUID + monotonic seq, and replayed in seq order via POST
   /v1/sync/push. Handle per-mutation results: applied/duplicate -> drop from queue;
   rejected (e.g. GATE_LOCKED) -> surface a human-readable reason and drop.
5. After push, POST /v1/sync/pull with per-domain cursors; apply returned upserts +
   tombstones to the local store and persist the new cursors. Server is authoritative on
   conflict — a client that optimistically unlocked something is corrected on pull (§1.7).
6. Connectivity: use NetInfo (or an injectable connectivity port) to drain the queue when
   online; queue silently when offline.
7. MONEY GUARD (§5.6): the giving flow must HARD-BLOCK when offline — financial intent is
   never queued. Assert this in code and in a test.

TESTS:
8. Integration test that runs in Node against a real backend instance (spin the Express app
   on the embedded test Postgres, seed a Student + an unlocked L1·M1 with a quiz):
   dev-login -> enqueue module completion + passing quiz OFFLINE -> push -> assert applied ->
   pull -> assert M2 now unlocked in local store. Then replay the same push and assert
   duplicate (idempotent, no double-apply).
9. Unit tests: queue stays in seq order and is never reordered; a rejected mutation is
   removed with its reason; the 401->refresh->retry path; giving is blocked offline.
   Use the in-memory LocalStore + in-memory TokenVault.

DELIVERABLE: append to docs/NEXT_STEPS.md the steps to actually run the app on a simulator
later (generate native projects via the RN CLI / Expo prebuild, the 10.0.2.2 Android host
note, point at the dev backend, dev-login email), and tell me what's verified by tests vs
what still needs the Mac native toolchain to see on screen.
```

## Dev login & dev seed (local portal auth — added)

To use the multiplier portal locally without OAuth:

- **`POST /v1/auth/dev-login`** — DEV ONLY. Body `{ "email" }` or `{ "user_id" }`. Looks up a
  seeded user and mints a real session through the normal `IdentityService` token path
  (`signAccessToken` + `issueRefreshToken`). **Hard-gated to `NODE_ENV !== 'production'`** —
  the route is never mounted in production, so it 404s there (`test/devLogin.test.ts` proves both).
- **`pnpm db:seed:dev`** (→ `packages/backend/scripts/seed-dev.mjs`) — DEV ONLY, separate from
  the production seeds (5 levels + 4 funds stay untouched). Creates `Dev Branch`, `Dev Cell A`/`B`,
  an Admin, an Instructor with a `leader_assignments` row on Cell A, and 5 students with varied
  interaction/attendance/progress, then runs the §2.5 aggregation so the cohort shows a spread of
  bands (thriving → steady → watch → at_risk). Idempotent (wipes the prior dev dataset first).
  Seeded logins: `admin@dev.local` (all cells), `leader@dev.local` (cell group 1), and
  `student1@dev.local`…`student6@dev.local`.

The portal talks to the API via a **Vite dev proxy** (`/v1` → `http://localhost:8080`, in
`packages/admin-web/vite.config.ts`), so the browser stays same-origin and no CORS is needed.

### Run the cohort table locally

```bash
# 1) Postgres 16 (Docker) — or the brew service on :6432 used in this repo
docker run --name nuru-pg -e POSTGRES_USER=nuru -e POSTGRES_PASSWORD=nuru -e POSTGRES_DB=nuru -p 5432:5432 -d postgres:16
export DATABASE_URL=postgres://nuru:nuru@localhost:5432/nuru   # or ...@localhost:6432/nuru

pnpm db:migrate        # schema
pnpm db:seed           # 5 levels + 4 funds (production seeds)
pnpm db:seed:dev       # dev congregation/cells/users (prints the Cell A id + logins)

# 2) Backend (http://localhost:8080)
pnpm --filter @nuru/backend dev

# 3) Portal (http://localhost:5173) — Vite proxies /v1 → http://localhost:8080
pnpm --filter @nuru/admin-web dev
```

Open http://localhost:5173, dev-login as `leader@dev.local`, paste the **cell group 1 id** from
the `seed:dev` output, and Load — you'll see the cohort sorted ascending by engagement with bands.
`admin@dev.local` can load any cell; the leader loading a cell they don't own gets 403.

## Prompt 4 — Runnable system: background workers, scheduler, docker-compose, API hardening

```
Read CLAUDE.md, docs/NEXT_STEPS.md, and nuru-place-technical-spec.pdf §1.6 (outbox),
§1.8 (engagement batch + incremental), §4.3-§4.4 (orchestration/data), §4.7 (observability),
§5.8 (API hardening), §5.9 (retention). Goal: turn the tested services into a system that
actually runs and operates. Work autonomously per CLAUDE.md; keep typecheck/lint/test green.

WORKER PROCESS + SCHEDULER (new entrypoint, e.g. packages/backend/src/worker.ts):
1. A standalone worker process (separate from the API) that runs the background jobs. Use a
   small in-process scheduler (node-cron or an injectable timer) so jobs are testable.
   Wire these existing services to real runners:
   - Outbox drainer: continuously claim pending outbox rows (SELECT ... FOR UPDATE SKIP
     LOCKED), dispatch the side-effect (certificate issuance, notification scheduling,
     engagement recompute), mark done/dead with bounded retries + backoff. At-least-once,
     consumers dedupe on event id (§1.6).
   - Nightly engagement recompute: cron (per region/local low-traffic) calling recomputeAll,
     upserting engagement_scores (§1.8).
   - Notification cadence: scan for due notifications, honor quiet-hours by the member's
     local timezone and max_daily cap, dispatch via the (faked) push/email provider (§1.5).
   - Partition maintenance: provision N+2 months for interaction_events, prune > 13 months
     (src/db/partition-maintenance.sql, §2.4/§5.9).
   - is_minor refresh: nightly job recomputing the flag so it can't go stale (the flagged
     §5.9 item). Document the choice in docs/NEXT_STEPS.md.
   Make each job idempotent and safe to run concurrently across replicas (advisory locks or
   SKIP LOCKED). Graceful shutdown drains in-flight work.

API HARDENING (§5.8) — middleware on the API app:
2. Rate limiting: token-bucket per IP and per user, with stricter buckets on auth, payment,
   and sync routes; return 429 RATE_LIMITED with Retry-After and X-RateLimit-* headers.
   Back it with Redis when REDIS_URL is set, in-memory otherwise (injectable store for tests).
3. Security headers (helmet), strict body-size caps already present, and ensure X-Request-Id
   correlation is on every response (§3.1/§4.7). Confirm no PII/token is ever logged.

OBSERVABILITY (§4.7):
4. Add /healthz (liveness) and /readyz (readiness: DB + Redis reachable) probes. Structured
   JSON logs already exist — add a minimal RED-style request metric hook and OpenTelemetry
   trace context propagation behind OTEL_EXPORTER_OTLP_ENDPOINT (no-op when unset).

LOCAL FULL STACK:
5. docker-compose.yml at the repo root bringing up: postgres:16, redis:7, PgBouncer
   (transaction mode), the API, and the worker — one `docker compose up` starts everything,
   runs migrations + seeds on boot, and the API is reachable on :8080. Add Dockerfiles for
   the api and worker (multi-stage, non-root). Document the commands in docs/NEXT_STEPS.md.

TESTS (Vitest, embedded Postgres):
6. Outbox drainer: an enqueued event is delivered exactly once, a failing handler retries
   then goes 'dead' after the cap, and two concurrent drainers never double-process.
   Notification cadence respects quiet hours + max_daily. Partition provision/prune does the
   right thing around the 13-month boundary. Rate limiter returns 429 past the bucket and
   resets. /readyz fails when a dependency is down.

DELIVERABLE: update docs/NEXT_STEPS.md with how to run the full stack (docker compose up),
how to run just the worker (pnpm --filter @nuru/backend worker), and what each scheduled job
does + its cadence. Definition of done: typecheck, lint, test, openapi:lint all green.
```

### Prompt 4 — done (runbook)

The API is now a stateless HTTP process (`src/index.ts`) and all background work lives
in a separate worker process (`src/worker.ts`). Both build from one Docker image.

**Run the whole stack (Postgres 16 + Redis 7 + PgBouncer + API + worker):**

```bash
docker compose up --build
# migrations + dev seed run automatically (one-shot `migrate` service) before
# api/worker start. API → http://localhost:8080  (GET /healthz, /readyz, /metrics)
```

`migrate` talks to Postgres directly on :5432 (DDL/migrations); `api` and `worker`
talk through PgBouncer in **transaction** pooling mode on :6432. node-postgres uses
the extended protocol without server-side named prepared statements, so it is safe
under transaction pooling.

**Run just the worker (against a local DB, no Docker):**

```bash
pnpm --filter @nuru/backend worker        # tsx src/worker.ts (dev)
pnpm --filter @nuru/backend build && pnpm --filter @nuru/backend worker:start  # compiled
```

**Scheduled / background jobs and their cadence** (all idempotent + safe across
replicas via `SKIP LOCKED` / `IF NOT EXISTS`):

| Job | Trigger | What it does |
| --- | --- | --- |
| Outbox drainer | every 5s | Claims pending `outbox` rows (`FOR UPDATE SKIP LOCKED`), dispatches the side-effect, marks done / retries with backoff / dead-letters at the cap. At-least-once; consumers dedupe (§1.6). |
| Notification dispatch | every 10s | Sends due notifications honoring quiet hours + `max_daily` (§1.5). |
| Re-engagement scan | hourly | Enqueues the 12-step inactivity nudge cadence (§1.5). |
| Engagement recompute | daily 02:00 | `EngagementService.runRecompute()` → upserts `engagement_scores` (§1.8). |
| Partition maintenance | daily 03:00 | Provisions current + next 2 months of `interaction_events`, prunes partitions older than 13 months (§2.4/§5.9), via SQL functions in migration `…014_partition-maintenance-functions`. |
| `is_minor` refresh | daily 04:00 | Recomputes `users.is_minor` from `date_of_birth` so the flag can't go stale (see decision below). |

**`is_minor` decision (resolves the flagged §5.9 open item):** the flag is set on
write by a DB trigger, but age changes with the calendar, not with writes — a member
who turns 18 would otherwise keep `is_minor = true` until their next profile edit.
We keep the trigger for write-time correctness **and** add a nightly reconciliation
job (`refreshMinorFlags`, idempotent `UPDATE … WHERE is_minor IS DISTINCT FROM …`)
so the flag is always at most ~24h stale. This is cheaper and simpler than a
per-request computed check and keeps the column directly queryable for gating/COPPA.

**API hardening / observability added:** helmet security headers; token-bucket rate
limiting (Redis-backed when `REDIS_URL` is set, in-memory otherwise) with stricter
buckets on `/v1/auth`, `/v1/giving`, `/v1/sync` returning `429 RATE_LIMITED` +
`Retry-After` + `X-RateLimit-*`; W3C `traceparent` propagation; RED metrics at
`GET /metrics`; `GET /readyz` (DB + Redis ping → 503 when a dependency is down);
log redaction of `authorization` / `cookie` / `stripe-signature`.

## Mobile app — login + offline sync (NEXT_STEPS Prompt 3)

The login + offline-sync loop is wired and **proven in Node** (no simulator needed):
- `TokenVault` (secure enclave) — `KeychainTokenVault` for device, `InMemoryTokenVault` for tests (§5.7).
- API client: `configureApiBase()` (default `http://localhost:8080/v1`), `installAuth(vault)` attaches the Bearer and does **401 → refresh → retry once**.
- `SyncEngine`: mutation queue is the system of record — enqueue (monotonic seq) → push in order → drop applied/duplicate/rejected (rejected surfaces a reason) → pull deltas/tombstones, advance cursors. `syncIfOnline(connectivity)` queues when offline.
- **Money guard (§5.6):** giving hard-blocks offline; the queue refuses money domains entirely.

**Verified by tests** (`pnpm --filter @nuru/mobile test`, `pnpm --filter @nuru/backend test`):
- mobile unit: TokenVault, `withRefresh` 401-path, money guard + money-domain enqueue refusal, queue seq order, rejected-mutation drop-with-reason.
- backend HTTP integration (`test/journey-sync-http.test.ts`): dev-login → offline push (complete+quiz) → pull delta → idempotent replay, against the embedded Postgres.

**Still needs the Mac native toolchain to see on a simulator** (not runnable here):
1. Generate native projects (not committed): `npx react-native@0.74 init` shell or Expo prebuild; or add `ios/`+`android/` for RN 0.74.
2. iOS: `cd ios && pod install`, then `pnpm --filter @nuru/mobile ios`. Android: `pnpm --filter @nuru/mobile android`.
3. Backend host: iOS simulator uses `http://localhost:8080/v1`; **Android emulator must use `http://10.0.2.2:8080/v1`** — call `configureApiBase("http://10.0.2.2:8080/v1")` on Android.
4. On device, swap the keychain vault in before `installAuth`: `setVault(new KeychainTokenVault())` (in `App.tsx`).
5. Dev login uses `student1@dev.local` (from `pnpm db:seed:dev`); the real OAuth buttons are stubbed/disabled until the provider SDKs land.

## Prompt 5 — Curriculum CMS (done — runbook)

Admins now author the **entire** pathway in the portal — no file seeding. The
source of truth is the database; `seeds/01_levels.sql` only ships the six empty
levels. Curriculum size is data-driven (the engagement Cᵢ denominator uses the
live count of *published* modules).

**Author curriculum as an Admin (local):**

1. `pnpm db:migrate && pnpm db:seed:dev` (creates `admin@dev.local`, an Admin).
2. Start the backend (`pnpm --filter @nuru/backend dev`) and portal
   (`pnpm --filter @nuru/admin-web dev`); sign in at http://localhost:5173 with
   `admin@dev.local`. The **Curriculum** tab appears only for Admin/SuperAdmin.
3. **New level** → title (created as the next contiguous level number).
4. Expand a level → **New module** → title + evaluation kind
   (`none` / `reflection` / `quiz` / `exit_exam`). The kind drives gating:
   - `none`/`exit_exam` → completion unlocks the next module
   - `reflection` → completion + a submitted reflection
   - `quiz` → completion + a passing quiz attempt
5. **Write the lesson** in the split-pane Markdown editor (live sanitized preview).
6. For a `quiz` module, add questions in the quiz panel (per-type validation;
   MultipleChoice needs ≥2 options incl. the correct one, etc.).
7. **Save draft**, then **Publish**. Publish is blocked (with a tooltip) until the
   module is saved, a quiz module has ≥1 question, and earlier modules in the
   level are already published (published sequence stays contiguous).
   Use **History** to view/restore prior versions; **Preview as student** to see
   exactly what a learner sees. **Unpublish** hides it from students instantly;
   **delete** archives (soft — never orphans learner progress).

Everything is server-authoritative: the `/v1/admin/*` routes are Admin-only
(`403 FORBIDDEN_SCOPE` otherwise) and validate server-side; the UI is just an
affordance.

**Optional importer** (pre-load existing lessons as drafts):

```bash
# Levels 1–2 import full lesson bodies; Levels 3–6 import titles only.
# Accepts a .pdf (needs the optional `pdf-parse` dep) or a .txt/.md dump.
DATABASE_URL=postgres://nuru:nuru@localhost:6432/nuru \
  pnpm --filter @nuru/backend import:curriculum "./DISCIPLESHIP CLASSES - FULL COURSE.pdf"
```

Idempotent (upserts by level+sequence), imports everything as **draft**, and
fabricates **no** quizzes — an Admin reviews and publishes via the CMS. If the
source file is absent it prints guidance and exits 0.

## Prompt 6 — UI/UX & design system (deep blue · white · gold · black)

> Make both apps beautiful, calm, and effortless to navigate. The brand palette is
> DEEP BLUE, WHITE, GOLD, and BLACK. The governing principles are SPACE and RESTRAINT:
> generous whitespace, few elements per screen, gold used sparingly as an accent — never
> congested. Work phase by phase; keep typecheck/lint/test green throughout. Follow
> CLAUDE.md autonomous-operation rules.

```
Read CLAUDE.md and docs/NEXT_STEPS.md. GOAL: a polished, branded UI for the admin portal
(packages/admin-web) and the mobile app (packages/mobile), built on one shared design
language. No backend behavior changes.

================================================================================
PHASE A — Design tokens (single source of truth, shared by web + mobile)
1. Create a tokens module (e.g. packages/shared/src/design/tokens.ts, exported from
   @nuru/shared) defining the palette, type scale, spacing, radii, and shadows:
   PALETTE
     navy-950 #081C36   (app chrome: sidebar/header, mobile headers)
     navy-900 #0A2540   (deep blue — primary brand surface)
     navy-700 #133B6B   (hover/pressed on navy)
     blue-600 #1B5FAE   (primary actions, links)
     blue-100 #E8F0FA   (selected/active tints)
     gold-500 #C9A227   (accent: active indicators, highlights, progress, badges)
     gold-600 #A8860B   (gold that must sit on white — passes contrast at 14px+ bold)
     gold-100 #F7EFD4   (subtle gold tint backgrounds)
     ink-950  #0B0B0C   (black — primary text on white)
     ink-600  #4B5563   (secondary text)
     ink-300  #D1D5DB   (borders, dividers)
     white    #FFFFFF   (cards/surfaces)
     paper    #F7F9FC   (app background — slightly off-white so cards float)
   SEMANTIC (engagement bands & feedback — tuned to harmonize with the palette):
     thriving #1E7F4F · steady blue-600 · watch #B45309 · at_risk #B42318
     success #1E7F4F · warning #B45309 · error #B42318
   TYPE SCALE: one family (Inter on web; system SF/Roboto on mobile), weights 400/500/600/700;
     display 28/34, title 20/28, body 15/22, caption 12/16. Line length ≤ ~70ch for reading.
   SPACING: 8pt grid (4/8/12/16/24/32/48). RADII: 10 (controls), 14 (cards), 999 (pills).
   SHADOWS: one soft card shadow; never stack heavy shadows.
2. CONTRAST GUARDRAILS (non-negotiable, WCAG AA):
   - Body text is ink-950 on white/paper; on navy surfaces text is white.
   - Gold is an ACCENT: active-nav indicator, progress fill, badges, focus rings, small
     headings on navy. Never gold body text on white (use gold-600 only ≥14px semibold).
   - Every interactive element has a visible focus state (gold ring on navy, blue ring on white).
3. RESTRAINT RULES (what keeps it beautiful and uncongested):
   - One primary action per screen; everything else is secondary/ghost.
   - Cards over tables where content is small; tables get roomy 48px rows.
   - Max content width 1080px on web; min 24px screen padding on mobile, 24–32px section gaps.
   - Subtle motion only: 150–200ms ease on hover/press/page transitions; skeleton loaders,
     never spinners-on-white-void.

PHASE B — Admin portal shell & navigation (packages/admin-web)
4. Adopt Tailwind CSS, themed from the Phase A tokens (tailwind.config maps the palette;
   no raw hex in components). Add lucide-react for icons. Inter via @fontsource/inter.
5. App shell: a fixed left SIDEBAR in navy-950 — gold accent bar + blue-100 text-tint on the
   active item, white icons/labels, sections: Cohort, Reviews, Curriculum (Admin-only),
   collapsed-to-icons mode below 1100px. TOPBAR: white, page title, user chip (email + role
   pill), sign-out. Content area on `paper` with white cards.
6. Rebuild the existing screens on the new system WITHOUT changing behavior:
   - Cohort: roomy table in a card; band shown as a colored pill (semantic tokens) + score;
     Hᵢ/Cᵢ/Aᵢ as thin gold progress bars; skeleton rows while loading; friendly empty state;
     cursor pagination as "Load more".
   - Reviews: card list; reflection text in a readable serif-feel block (still Inter, larger
     leading); Approve (primary blue) / Reject (ghost danger) with confirm.
   - Curriculum CMS: two-pane layout — navy rail of levels/modules (gold dot = published,
     hollow = draft) and a clean editor canvas; markdown editor and preview in tabs on
     narrow screens, side-by-side ≥1280px; sticky save/publish bar with status chip
     (Draft/Published/version); quiz panel as collapsible cards, not a dense grid.
   - Dev login: centered card on navy-950 with the wordmark "Nuru Place · Pathway",
     gold keyline, single email field + one primary button.
7. States everywhere: loading skeletons, empty states (one-line message + gentle CTA),
   error banners with retry. Toasts (top-right, auto-dismiss) for save/publish/approve.
8. Keep all existing component tests green; update DOM assertions where markup changed.

PHASE C — Mobile app (packages/mobile)
9. Add @react-navigation/native + native-stack + bottom-tabs (pre-approved deps). Structure:
   - Bottom tabs: Pathway (home) · Give · Profile — navy-950 bar, gold active icon+label,
     ink-300 inactive; safe-area aware.
   - Native stack above tabs for Lesson → Quiz flows with default platform transitions.
10. Theme module (src/theme/tokens.ts) mirroring Phase A; a small set of primitives:
    Screen (paper bg + padding), Card, Button (primary navy / gold CTA / ghost), Pill,
    ProgressBar (gold fill on navy-100 track), SectionHeader. All screens compose these —
    no ad-hoc inline styles left.
11. Redesign screens, uncongested (one idea per screen):
    - PATHWAY (home): greeting + level name; a hero card with a gold progress bar
      ("Level 2 · 4 of 9 modules"); then the module list — white cards, lock icon and
      ink-600 for locked, gold check for completed, chevron for next-up. The next unlocked
      module gets a subtle gold "Continue" CTA.
    - LESSON: distraction-free reader — title, est. minutes pill, sanitized markdown at
      body 16/26 with 24px margins; sticky bottom "Mark complete" primary button;
      reflection prompt (when evaluation_kind=reflection) as a gold-tinted card with a
      text area.
    - QUIZ: one question per screen, large tap targets (≥48px), selected option fills
      blue-100 with blue-600 border; progress dots in gold; pass/fail result screen —
      gold laurel motif on pass, warm retry message on fail (never red-shaming).
    - GIVE: amount entry with big numerals, fund selector as segmented pills; the offline
      hard-block presented kindly ("Giving needs a connection — you're offline") on a
      navy info card. No card fields (Stripe sheet handles that later).
    - PROFILE: avatar circle (initials on navy), level badge with gold ring, sign out.
12. WIRE THE SCREENS TO THE REAL MACHINERY: remove HomeScreen's standalone
    InMemoryLocalStore; screens read through the app-wide store/sync engine and session
    (auth/session.ts). Render from cache instantly, reconcile in background (§1.3) — an
    unobtrusive "Syncing…" pill, never a blocking spinner.
13. Generate the native projects (npx react-native init shell or the community template,
    matching the RN version in package.json) so `pnpm ios` runs on a simulator. Add
    docs/NEXT_STEPS.md instructions: how to run iOS sim + Android emulator (10.0.2.2 note),
    dev-login email. If native generation can't complete in this environment, scaffold what
    you can, keep it compiling, and document the exact remaining manual steps.
14. Accessibility: accessibilityRole/labels on all touchables; dynamic-type friendly
    (no fixed text in pressables); contrast per Phase A.

PHASE D — Consistency & verification
15. A lightweight web /styleguide route (dev-only) rendering tokens, buttons, pills, cards,
    band colors — the living reference for future screens.
16. Tests: web component tests for shell nav (active state, admin-only Curriculum), band
    pill mapping, toast on save; mobile unit tests for theme mapping + quiz option state;
    everything existing stays green. Run pnpm build for admin-web to prove the Tailwind
    pipeline compiles.
17. Update README (a short "Design system" section pointing at tokens + styleguide) and
    docs/NEXT_STEPS.md (how to view the styleguide; mobile run steps).

OUT OF SCOPE: dark mode (tokens are structured to allow it later), logo design (use the
"Nuru Place · Pathway" wordmark; slot an SVG logo when provided), Stripe payment sheet UI.

DEFINITION OF DONE: pnpm typecheck, lint, test all green; admin-web builds; the portal
looks branded (navy sidebar, gold accents, white cards on paper) with no raw default-HTML
screens left; the mobile app compiles with the new navigation + themed screens wired to the
real store/sync.
```

## Prompt 7 — Features v2: Video, Calendar, Onboarding, Gamification

> Implements docs/FEATURES_V2_SPEC.md — read that file FIRST; it is the source of truth for
> these four subsystems (schema DDL, endpoint catalog, infra, security, and the §D deviations
> already decided). Work phase by phase, each green before the next. Follow CLAUDE.md
> autonomous-operation rules.

```
Read CLAUDE.md, docs/FEATURES_V2_SPEC.md (authoritative for this work), and skim
nuru-place-technical-spec.pdf §1.7/§1.9/§3.6/§5 for the guardrails it extends. Implement the
four subsystems exactly as specified. Keep typecheck, lint, test, openapi:lint green at every
phase. New deps pre-approved: rrule, chrono-node.

PHASE A — Migrations (one forward migration per subsystem, §2 conventions, full down-paths):
media_status enum + media_assets extensions + video_uploads + video_progress +
modules.media_asset_id (V.1); event_series/event_exceptions/events extensions/event_rsvps with
the RRULE allow-list noted in C.0 (C.1); onboarding_sessions/guardian_consents/
onboarding_assessments + cell_groups name trigram index (O.1); badges/user_badges/user_streaks/
gamification_events (G.1). Migration tests: apply + full down/up on embedded Postgres.

PHASE B — Video (V.2–V.4): VideoPipelineProvider interface with CloudinaryProvider +
HlsFfmpegProvider (FFmpeg invocation behind the interface; fake provider in tests); admin
upload-session endpoints; outbox `media.transcode` consumer in the worker (idempotent on
content_hash); gated GET /v1/media/{id}/manifest (hard-lock test: locked module's video manifest
→ 409); sync domains video_progress (push+pull, LWW documented) and the existing
interaction_events video kinds. Tests per V.2/V.4 incl. signed-URL expiry and replay idempotency.

PHASE C — Calendar (C.1–C.4): series/exception CRUD with RRULE allow-list validation (422 on
violation, expansion cap 500); projection endpoint GET /v1/calendar (rrule expansion in series
IANA timezone — add a DST regression test around a transition date); occurrence materializer
worker (advisory-locked, horizon 35d, per-occurrence qr_secret) on outbox `calendar.materialize`
+ daily cron; Redis-cached projections (in-memory fallback) with invalidation; RSVP endpoint +
sync domains (`calendar` pull window, `event_rsvps` push); reminders via the notifications
module; POST /v1/calendar/parse with chrono-node (rate-limited, leader+). Visibility-scoping
tests: cell member sees cell events, outsider 403, congregation events visible to its members.

PHASE D — Onboarding (O.1–O.4): resumable stepper endpoints (GET state + per-step PUTs +
finalize calling the existing onboard()); guardian-consent enforcement — finalize for an
is_minor user without unrevoked consent → 422 CONSENT_REQUIRED (test BOTH paths); consent
immutability (new row + revoke, audited); guardian_contact field-level encrypted like phone;
literacy quiz served + server-scored with client_mutation_id idempotency; directory search
endpoint (minimal fields, rate-limited); +48h incomplete-onboarding nudge via outbox. Migrate
the existing single-shot POST /v1/me/onboarding to delegate to the stepper finalize (keep the
route for backward compat).

PHASE E — Gamification (G.1–G.4): badge catalog admin CRUD with criteria validated against a
registered rule-schema; rules worker on outbox topics (module.completed, attendance.checked_in,
level.advanced, streak.tick) writing gamification_events + user_badges transactionally with
dedupe_key (test: replaying an outbox event never double-awards); nightly streak job
piggybacking the engagement batch, computed in each member's timezone (test across a timezone
boundary); /v1/me/achievements, /v1/badges, aggregate-only cell milestones with the k>=3
suppression (test), leader-scoped member view; achievements sync domain is PULL-ONLY — a push
attempt is rejected (test). Seed a starter badge catalog (first_module, level_1..6,
streak_7/30/90, attendance_10, scripture_30) as an idempotent seed.

PHASE F — Integration & polish: register all new sync domains in PULL_DOMAINS/push handlers
(replay no-op tests for each push domain); add the §X config keys to env.ts + .env.example;
update openapi.yaml for every new route and keep the route↔spec contract test green; extend the
dev seed so the portal/mobile show a populated calendar, a transcoded-fake video,
an in-progress onboarding, and a few awarded badges; update README (one paragraph per
subsystem) and docs/NEXT_STEPS.md run notes.

DEFINITION OF DONE: pnpm typecheck, lint, test, openapi:lint all green; every §D deviation in
docs/FEATURES_V2_SPEC.md respected (720p cap, timezone-aware RRULE, chrono-node, no public
individual leaderboards, pull-only achievements); no v1 guardrail weakened (hard-lock, money
never offline, idempotent replays, RBAC scoping, minors protection).
```

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
> *"Work through the build prompts in docs/NEXT_STEPS.md in order (Prompt 1 → 2 → 3 → 4).
> Complete each one and get it fully green (typecheck, lint, test, openapi:lint) before
> starting the next. Follow CLAUDE.md autonomous-operation rules — don't stop to ask;
> make the recommended choice and keep going. After each prompt, summarize what changed
> and the test result, then continue to the next."*

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

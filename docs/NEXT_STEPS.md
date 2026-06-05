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

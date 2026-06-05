# CLAUDE.md — operating guide for this repo

This file is loaded automatically. It encodes the decisions already made so you can build **without stopping to ask**. The human has authorized autonomous operation: make the recommended choice on every decision, add the standard dependencies a task needs, and keep going until tests pass.

## What this is

Nuru Place Discipleship Pathway — offline-first discipleship platform. Source of truth is `nuru-place-technical-spec.pdf` (architecture §1, schema §2, API §3, infra §4, security §5). Section references in code point back to it. The build plan and status live in `docs/NEXT_STEPS.md`.

## Stack & decisions (already settled — do not re-litigate)

- Monorepo: **pnpm workspaces + Turborepo**. Packages: `@nuru/shared`, `@nuru/backend`, `@nuru/admin-web`, `@nuru/mobile`.
- Backend: **modular monolith** (the 10 §1.5 services are modules under `packages/backend/src/modules/*`, mounted in `src/http/app.ts`).
- Migrations: **raw SQL via node-pg-migrate** (`packages/backend/migrations`), forward-only, timestamped. No ORM.
- Tests: **Vitest**. CI: **GitHub Actions** (`.github/workflows/ci.yml`).
- Money: integer minor units + ISO currency, never floats. TS strict everywhere.

## Autonomous-operation rules

- **Don't ask the human for routine decisions.** Pick the spec-aligned or industry-standard option and proceed. Only surface a blocker if it's a genuine spec contradiction or needs an external secret/credential you can't fake in tests.
- **Pre-approved dependency choices** (add as needed, no need to ask): `jsonwebtoken` + `@types/jsonwebtoken` (JWT), `argon2` (password hashing, §5.5), `stripe` (payments), `pino`/`pino-http` (logging), `zod` (validation), `vitest` (tests), `embedded-postgres` (test DB), `@react-navigation/native` + stack/tabs, `@reduxjs/toolkit`, `axios`, `react-native-keychain` (secure token vault, §5.7), an SQLCipher-capable RN SQLite lib (e.g. `op-sqlite` or `react-native-quick-sqlite`). Prefer well-maintained, widely-used libraries.
- External services (KingsChat OAuth, Stripe, Cloudinary, APNs/FCM) are **abstracted behind interfaces** with fakes for tests, so the suite runs with no network/secrets.

## Guardrails (keep intact — these are spec-critical)

- **Offline-first** sync engine; the client mutation queue is the mobile system of record (§1.7).
- **Server-authoritative** gating, scoring, money — the client never originates them (§1.1).
- **Hard-lock invariant** (§1.9): no API path returns higher-level content for a member whose `current_level` is lower. Gating checked on every content fetch.
- **Idempotency** keys on every offline-originated write; replays must be no-ops (§2.1, §3.6).
- **Money path is PCI SAQ-A** (§5.6): cards never touch the server (Stripe Elements tokenizes client-side); we store only Stripe ids, our ledger, and verified webhooks. Money is **never queued offline**.
- **RBAC + scoping** (§5.4): multipliers see only cells in their `leader_assignments`; enforce in the query layer, return `403 FORBIDDEN_SCOPE` out of scope.
- Secrets by name only, never committed (`.env` is git-ignored, §5.10).

## Known spec deviations already applied (see README "Flagged spec deviations")

1. `citext` extension added (spec used `CITEXT` without declaring it).
2. `users.is_minor` is a trigger-maintained boolean, not a generated column (Postgres rejects non-immutable generated expressions). May go stale until next write — open product decision in `docs/NEXT_STEPS.md`.
3. `interaction_events` keys widened to include `occurred_at` (partitioned-table requirement). Idempotency preserved via `(client_event_id, occurred_at)`.

## Commands

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm db:migrate && pnpm db:seed          # needs a local Postgres 16
pnpm --filter @nuru/backend dev
```

Backend tests boot an embedded Postgres automatically (no external DB needed for `pnpm --filter @nuru/backend test`). For manual dev, run Postgres via Docker:

```bash
docker run --name nuru-pg -e POSTGRES_USER=nuru -e POSTGRES_PASSWORD=nuru -e POSTGRES_DB=nuru -p 5432:5432 -d postgres:16
```

## Definition of done for a task

Typecheck clean, lint clean, new behavior covered by a passing Vitest test (backend tests run against real Postgres), and the OpenAPI doc updated if the wire contract changed (`pnpm openapi:lint` must pass). Then move to the next item in `docs/NEXT_STEPS.md`.

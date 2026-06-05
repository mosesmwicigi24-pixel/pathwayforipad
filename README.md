# Nuru Place · Discipleship Pathway

Offline-first discipleship platform — React Native mobile client, a React admin/multiplier web portal, and a Node/TypeScript backend over PostgreSQL + Redis, in one TypeScript monorepo.

This repository is the build-ready scaffold for the platform described in **Nuru Place Discipleship Ecosystem · Technical Architecture & Engineering Specification v1.0** (`nuru-place-technical-spec.pdf`). The spec is the source of truth for architecture (§1), schema (§2), API (§3), infrastructure (§4), and security (§5); section references throughout the code point back to it. **No feature code has been written yet** — this is structure, schema migrations, tooling, and contracts only.

## Layout

```
packages/
  shared/      @nuru/shared      Domain types, the OpenAPI contract, and the
                                 single-source-of-truth tunable constants (App. B.2).
  backend/     @nuru/backend     Node/TypeScript modular monolith. The ten logical
                                 services from §1.5 are internal modules with clean
                                 seams; SQL migrations live here.
  admin-web/   @nuru/admin-web   React + Vite multiplier/admin portal (online-only, §1.3).
  mobile/      @nuru/mobile      React Native client — the offline-first system of
                                 record (§1.3, §1.7). TypeScript source only; native
                                 ios/android projects are generated separately.
```

## Key decisions (made on top of the spec)

The spec fixed the stack (React Native, Node/TypeScript, 3NF PostgreSQL, Redis, SQLite, Cloudinary, Stripe, YouVersion, KingsChat). The net-new engineering choices in this scaffold — confirmed before building — are:

- **Backend topology:** modular monolith with the §1.5 service boundaries as module seams (`packages/backend/src/modules/*`). The spec's deployment note (§1.5) allows shipping these as one deployable now and splitting them later; the schema, API, and security models hold either way.
- **Monorepo tooling:** pnpm workspaces + Turborepo for cached `lint`/`typecheck`/`test`/`build` pipelines.
- **Migrations:** raw, forward-only, timestamped SQL files (§2.6) run by `node-pg-migrate`. No ORM — the schema stays the spec's literal DDL contract.
- **Tests + CI:** Vitest across packages; GitHub Actions for the §4.6 commit stage (lint, typecheck, test, OpenAPI + migration validation against an ephemeral Postgres).

## Database schema → migrations

The full §2 schema is translated verbatim into ordered migrations in `packages/backend/migrations/`, grouped by domain in dependency order: extensions/enums/org → identity/RBAC → curriculum → enrollment/progress/interactions → assessment/reflection → relationships/events/attendance/engagement → financial → certificates/notifications/media/sync/audit/outbox → indexes (§2.3) → initial partitions (§2.4) → functions (§2.5). The engagement aggregation query (§2.5) is kept verbatim as a versioned asset at `src/db/engagement-aggregation.sql`; partition provisioning/pruning helpers (§2.4, §5.9) are in `src/db/partition-maintenance.sql`. Seeds (`seeds/`) load the five levels and four core funds idempotently.

### ⚠️ Flagged spec deviations

The migrations follow §2 exactly except for three points where the DDL **as written would not compile or run on PostgreSQL**. Each is fixed minimally and flagged in-file:

1. **`citext` extension not declared (§2.2).** `users.email` is typed `CITEXT`, but the extensions block declares only `pgcrypto` and `pg_trgm`. Added `CREATE EXTENSION IF NOT EXISTS citext`.
2. **`users.is_minor` generated column (§2 identity).** The spec defines it as `GENERATED ALWAYS AS (date_of_birth > CURRENT_DATE - INTERVAL '18 years') STORED`. PostgreSQL rejects this because generated-column expressions must be `IMMUTABLE` and `CURRENT_DATE` is only `STABLE`. Implemented instead as a plain `BOOLEAN` maintained by a `BEFORE INSERT/UPDATE` trigger. **Trade-off:** the flag can go stale on the member's 18th birthday until the next write to the row; a nightly maintenance job (or computing minor status at query time) keeps it correct. Worth a product/security decision since §5.9 treats minors as protected data subjects.
3. **`interaction_events` keys on a partitioned table (§2.2/§2.4).** The table is `PARTITION BY RANGE (occurred_at)`, but PostgreSQL requires every unique/primary key on a partitioned table to include all partition-key columns. Widened the primary key to `(event_id, occurred_at)` and the offline-idempotency unique constraint to `(client_event_id, occurred_at)`. Replay safety is preserved because offline events carry a stable `occurred_at`.

One more item, not a deviation but an **open dependency:** §2.6 requires seeding all **45 modules** and a CI check asserting exactly 5 levels and 45 modules with contiguous sequence numbers. The per-module curriculum content lives in the **PRD curriculum appendix**, which is not part of this engineering spec and has not been provided. The 45-module seed (`seeds/03_modules.placeholder.sql`) and the contiguity test (`test/reference-integrity.test.ts`) are written but intentionally **not loaded / skipped** so CI stays green without fabricating curriculum. Supply the appendix to complete them.

## Getting started

Requires Node ≥ 20.11 and pnpm ≥ 9 (see `.nvmrc`).

```bash
pnpm install
cp .env.example .env          # fill in DATABASE_URL etc. (App. B.1)

# bring up a local Postgres 16, then:
pnpm db:migrate               # apply all §2 migrations
pnpm db:seed                  # load 5 levels + 4 funds

pnpm typecheck                # all packages
pnpm test                     # all packages
pnpm --filter @nuru/backend dev   # run the backend
```

Useful root scripts: `pnpm build`, `pnpm lint`, `pnpm format`, `pnpm openapi:lint`, `pnpm db:migrate:down`.

## Conventions held by the scaffold

- **Money** is always integer minor units + ISO currency (`{ amount_minor, currency }`), never floats (§2.1, §3.1).
- **Idempotency** keys on every offline-originated write (§2.1, §3.1); the offline mutation queue is the mobile system of record (§1.7).
- **Server-authoritative** gating, scoring, and money (§1.1) — the client never originates them.
- **Secrets** are referenced by name only and never committed (`.env` is git-ignored; §5.10).
- The **OpenAPI document** (`packages/shared/src/openapi/openapi.yaml`) is the versioned wire contract; CI lints it and it carries the full v1 endpoint catalog from §3.3.

## Status

Scaffold complete: tooling, the four packages, all §2 migrations, seeds, the OpenAPI contract, shared types/constants, and CI. Module bodies, screens, and the sync/engagement/gating implementations are the next phase and are stubbed as seams. See the open items above before wiring features.

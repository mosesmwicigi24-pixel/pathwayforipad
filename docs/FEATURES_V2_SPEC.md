# Nuru Pathway — Features v2 Specification

**Video · Calendar · Onboarding · Gamification**

This document extends `nuru-place-technical-spec.pdf` (v1.0) with four subsystems, in the same
four dimensions per feature: database schema, API specification, infrastructure design, and
security model. It incorporates the execution patterns from `System_Execution_Architecture_v1.pdf`
(uploaded 2026-06-06) where they fit the platform, and **flags every place they were adapted**
(§D). All v1 guardrails remain binding: offline-first sync (§1.7), server-authoritative truth
(§1.1), idempotency on every offline-originated write, money never offline, RBAC + cell scoping
(§5.4), minors as protected data subjects (§5.9), §2 DDL conventions (UUID PKs, TIMESTAMPTZ in
UTC, integer minor units, soft delete on user-facing entities).

Existing foundations these features build on (do not duplicate):
`media_assets` + signed-URL brokering (media module) · `events` + HMAC QR `attendance_logs`
(progress module) · `POST /v1/me/onboarding` single-shot intake (identity module) ·
`interaction_events` (Hᵢ signal) + engagement snapshot pipeline · the sync `PULL_DOMAINS`
registry and `domain:op` push handlers · the transactional outbox + worker.

---

## §V — Video (adaptive streaming pipeline)

### V.0 Decisions
- **ABR/HLS** delivery per the execution doc, but the rendition ladder is **capped at 720p/30fps**
  (PRD §7.3 thermal/battery cap). Ladder: 720p ≈ 2200 kbps · 480p ≈ 1100 kbps · 360p ≈ 600 kbps,
  AAC 96 kbps, 4-second segments, VOD playlists. The doc's 1080p tier is rejected (§D.1).
- **Provider-abstracted pipeline**: a `VideoPipelineProvider` interface with two adapters —
  `CloudinaryProvider` (default; managed ABR, matches v1 spec) and `HlsFfmpegProvider`
  (the doc's FFmpeg → object store → CDN flow) — selected by config. Same manifest contract
  either way, so the platform can migrate off Cloudinary without API changes.
- Playback telemetry stays **coarse** (`video_started`, `video_paused`, `video_75pct`) through the
  existing `interaction_events` table (§1.3) — no new telemetry table, no re-render storms.
- **Resume positions** sync across devices as a new offline domain (`video_progress`). Policy:
  last-writer-wins is acceptable here (convenience state, not "meaningful" §1.7 state) — documented.

### V.1 Database schema
```sql
CREATE TYPE media_status AS ENUM ('uploading','transcoding','ready','failed');

-- Extend the existing media_assets table (forward migration)
ALTER TABLE media_assets
  ADD COLUMN status            media_status NOT NULL DEFAULT 'ready',  -- existing rows are ready
  ADD COLUMN source_object_key VARCHAR(512),          -- raw upload location
  ADD COLUMN hls_master_key    VARCHAR(512),          -- master.m3u8 object key (self-managed path)
  ADD COLUMN ladder            JSONB,                 -- [{height:720,kbps:2200},...] as produced
  ADD COLUMN provider          VARCHAR(20) NOT NULL DEFAULT 'cloudinary', -- 'cloudinary'|'hls'
  ADD COLUMN content_hash      VARCHAR(64),           -- sha-256 of source (transcode idempotency)
  ADD COLUMN created_by        UUID REFERENCES users(user_id),
  ADD COLUMN error_detail      TEXT;

-- Direct-to-storage upload sessions (server never proxies video bytes, §4.5)
CREATE TABLE video_uploads (
  upload_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_asset_id UUID NOT NULL REFERENCES media_assets(media_asset_id),
  created_by     UUID NOT NULL REFERENCES users(user_id),
  put_url_expiry TIMESTAMPTZ NOT NULL,
  byte_size_max  BIGINT NOT NULL,
  mime_allowed   VARCHAR(60) NOT NULL DEFAULT 'video/mp4',
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cross-device resume positions (offline-synced; LWW by updated_at — documented policy)
CREATE TABLE video_progress (
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES media_assets(media_asset_id) ON DELETE CASCADE,
  position_sec   INT  NOT NULL DEFAULT 0 CHECK (position_sec >= 0),
  completed_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  client_mutation_id UUID,                 -- idempotent offline replay
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, media_asset_id)
);

-- modules link to managed assets (video_url kept as legacy fallback, §D.6)
ALTER TABLE modules ADD COLUMN media_asset_id UUID REFERENCES media_assets(media_asset_id);
```
Indexes: `video_progress(user_id, updated_at DESC)`; `media_assets(status)` partial
`WHERE status <> 'ready'` (worker poll).

### V.2 API specification
Member (gated — manifest issuance runs the same module-gating check as lesson content; §1.9
hard-lock extends to video):
| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/media/{id}/manifest` | Signed, expiring HLS master-manifest URL (TTL ≤ 10 min). 409 `GATE_LOCKED` if the owning module is locked; 404 if asset not `ready`. |
| sync push | domain `video_progress`, op `update` | `{media_asset_id, position_sec, completed_pct, client_mutation_id}` — idempotent; LWW on `updated_at`. |
| sync push | domain `interaction_events`, kinds `video_started/paused/video_75pct` | existing path; feeds Hᵢ. |

Admin (Admin+, audited):
| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/admin/media/uploads` | Create upload session → `{upload_id, signed_put_url, max_bytes}`. |
| POST | `/v1/admin/media/uploads/{id}/complete` | Marks uploaded; enqueues outbox `media.transcode`. Idempotent (re-complete is a no-op). |
| GET | `/v1/admin/media/{id}` | Status, ladder, duration, error_detail. |
| DELETE | `/v1/admin/media/{id}` | Archive (refused if referenced by a published module). |

### V.3 Infrastructure design
- **Transcode worker** consumes outbox topic `media.transcode` (at-least-once; idempotent on
  `(media_asset_id, content_hash)` — a replay on an already-`ready` asset is a no-op).
  - Cloudinary adapter: triggers eager ABR derivations; polls/webhooks completion.
  - HLS adapter: FFmpeg job (the doc's command, minus the 1080p tier) on the worker pool's
    CPU-heavy node group (§4.3), spot/low-priority capacity (§4.11); outputs `v{0..2}/*.ts` +
    `master.m3u8` to object storage.
- **CDN**: segments immutable — `Cache-Control: max-age=31536000, immutable`; master manifest
  heavily cached (VOD). The API never proxies video bytes (§4.5) — it only signs URLs.
- **Players**: iOS AVPlayer (native HLS); Android ExoPlayer with `DefaultTrackSelector`,
  initial bitrate ~800 kbps (last-mile-friendly start, climbs to 720p).
- **Offline lesson video (phase 2, flagged)**: optional pre-download of the 360p rendition into
  the app's encrypted storage (§5.7) with a 30-day license window. Not in this build round.

### V.4 Security model
- Signed expiring URLs for manifest and segments (path-scoped token; TTL ≤ 10 min); raw bucket
  never public; rotate signing secret via KMS (§5.5).
- Manifest issuance enforces gating + published-status server-side — a leaked asset id yields
  nothing without an in-scope, unlocked caller.
- Uploads: Admin-only; size cap + MIME allow-list enforced at session creation AND by storage
  policy; antivirus/content-scan hook before transcode; `created_by` + audit row.
- Rate limits: manifest endpoint per-user bucket (stricter than general reads); upload-session
  creation tightly limited.
- No PII in object keys or URLs; player telemetry carries ids only.

---

## §C — Calendar (recurrence, projection, scheduling)

### C.0 Decisions
- Adopt the execution doc's **master/exception RRULE projection model** (no instance bloat),
  reconciled with the existing `events` + `attendance_logs`: recurring **series** project into
  **materialized occurrence rows in the existing `events` table** within a rolling horizon, so
  QR attendance keeps its stable `event_id` idempotency (`UNIQUE(user_id, event_id)`).
- **Timezone correction to the doc (§D.2):** an RRULE anchored only in UTC drifts across DST and
  "wall-clock" expectations. Series store an IANA `timezone` and expand in that zone.
- **NLP quick-add:** in-process `chrono-node` (Node-native) instead of a Duckling service (§D.3);
  contract kept identical so an LLM/Duckling microservice can replace it later.
- RRULEs are **validated against an allow-list** (FREQ=DAILY|WEEKLY|MONTHLY; BYDAY; INTERVAL ≤ 4;
  COUNT ≤ 260 or UNTIL ≤ 18 months) — recurrence-expansion bombs are a DoS vector (§C.4).

### C.1 Database schema
```sql
CREATE TYPE event_visibility AS ENUM ('congregation','cell','leaders');
CREATE TYPE rsvp_status      AS ENUM ('going','maybe','declined');

CREATE TABLE event_series (
  series_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id),
  cell_group_id   UUID REFERENCES cell_groups(cell_group_id),   -- null = congregation-wide
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  location        VARCHAR(255),
  timezone        VARCHAR(64) NOT NULL,            -- IANA; expansion happens in this zone
  dtstart_local   TIMESTAMP NOT NULL,              -- wall-clock anchor in `timezone`
  duration_min    INT NOT NULL CHECK (duration_min BETWEEN 5 AND 720),
  rrule           TEXT,                            -- RFC 5545; NULL = one-off
  visibility      event_visibility NOT NULL DEFAULT 'cell',
  created_by      UUID NOT NULL REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE event_exceptions (
  exception_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id         UUID NOT NULL REFERENCES event_series(series_id) ON DELETE CASCADE,
  original_start_at TIMESTAMPTZ NOT NULL,          -- identifies the instance (UTC)
  is_cancelled      BOOLEAN NOT NULL DEFAULT FALSE,
  new_start_at      TIMESTAMPTZ,
  new_end_at        TIMESTAMPTZ,
  note              VARCHAR(255),
  UNIQUE (series_id, original_start_at)
);

-- Existing `events` rows become materialized occurrences
ALTER TABLE events
  ADD COLUMN series_id        UUID REFERENCES event_series(series_id) ON DELETE CASCADE,
  ADD COLUMN occurrence_start TIMESTAMPTZ,         -- the projected instance this row realizes
  ADD CONSTRAINT uq_series_occurrence UNIQUE (series_id, occurrence_start);

CREATE TABLE event_rsvps (
  rsvp_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           VARCHAR(100) NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status             rsvp_status NOT NULL,
  client_mutation_id UUID UNIQUE,                  -- idempotent offline replay
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
```
Indexes: `event_series(congregation_id) WHERE deleted_at IS NULL`; `event_series(cell_group_id)`;
`events(series_id, occurrence_start)`; `event_rsvps(user_id, updated_at DESC)`.

### C.2 API specification
| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/calendar?from&to` | Projected occurrences in range (≤ 92 days/request): expand visible series via rrule lib in series TZ → apply exceptions → overlay materialized rows. Cursorless; bounded window. |
| GET | `/v1/events/{id}` | One occurrence (details, RSVP counts, my RSVP). |
| POST | `/v1/events/{id}/rsvp` | `{status, client_mutation_id}` — idempotent upsert; offline-queueable (sync domain `event_rsvps`, op `set`). |
| POST | `/v1/events/{id}/attendance` | existing QR check-in, unchanged. |
| POST | `/v1/calendar/parse` | `{text, timezone}` → `{title, start_at, end_at?, confidence}` via chrono-node. Leader+ only; never auto-creates. |
| POST | `/v1/admin/events/series` | Create series (validated RRULE). Instructor may create for own cells; Admin congregation-wide. |
| PUT | `/v1/admin/events/series/{id}` | Edit master (future occurrences only). |
| POST | `/v1/admin/events/series/{id}/exceptions` | Cancel/reschedule one instance. |
| DELETE | `/v1/admin/events/series/{id}` | Soft-delete series (past materialized occurrences + attendance are preserved). |

Sync: pull domain `calendar` = materialized occurrences in `[now-7d, now+35d]` for the member's
visibility scope (so the schedule renders offline); push domain `event_rsvps`.

### C.3 Infrastructure design
- **Occurrence materializer** (worker, daily + on series write via outbox `calendar.materialize`):
  realizes instances within `now+35d` into `events` (advisory-locked, idempotent on
  `(series_id, occurrence_start)`), generating each occurrence's `qr_secret`.
- **Redis projection cache** per the doc: key `cal:{user_id}:{iso_week}`, TTL 10 min, invalidated
  by outbox consumers on series/exception/RSVP writes.
- Reminders: materializer schedules `notifications` rows (T-24h and T-1h, member quiet hours +
  `max_daily` respected — existing nudge machinery).
- `rrule` (npm) + `chrono-node` are pre-approved additions.

### C.4 Security model
- **Visibility scoping in the query layer** (§5.4): `cell` events only to members of that cell +
  its assigned leaders; `leaders` only to Instructor+ of scope; congregation events to its members.
  Out-of-scope ids → 403 `FORBIDDEN_SCOPE`.
- **RRULE validation allow-list** (C.0) → 422 on violation; projection capped (≤ 500 instances per
  expansion) — DoS guard.
- Creation rights: Instructor for assigned cells; Admin+ congregation-wide; all writes audited.
- Per-occurrence `qr_secret` (rotating) keeps attendance tokens unforgeable and unshareable
  across weeks; existing constant-time HMAC check unchanged.
- `/calendar/parse` is rate-limited (NLP CPU) and its output is a *suggestion* — creation always
  passes the validated series/exception endpoints.

---

## §O — Onboarding (guided first-run, consent, placement)

### O.0 Decisions
- Evolve the single-shot `POST /v1/me/onboarding` into a **resumable stepper** with server-held
  state — connection drops mid-onboarding (core constraint) must not lose progress.
- **Guardian consent becomes enforced**, not just flagged: a minor cannot finalize enrollment
  without a recorded consent (closes v1 open question C.2 / §5.9).
- The PRD's **literacy quiz** at intake gets a real home (`onboarding_assessments`).
- Steps: `profile → cell_selection → guardian_consent (minors) → literacy_quiz → notifications → done`.
  Finalize reuses the existing `onboard()` (enrollment at L1·M1) — no duplicate logic.

### O.1 Database schema
```sql
CREATE TYPE onboarding_step AS ENUM
  ('profile','cell_selection','guardian_consent','literacy_quiz','notifications','done');

CREATE TABLE onboarding_sessions (
  user_id        UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  current_step   onboarding_step NOT NULL DEFAULT 'profile',
  steps          JSONB NOT NULL DEFAULT '{}',   -- {step: {completed_at, payload_summary}}
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ
);

CREATE TABLE guardian_consents (
  consent_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  guardian_name     VARCHAR(255) NOT NULL,
  guardian_contact  VARCHAR(255) NOT NULL,       -- field-level encrypted like phone (§5.5)
  relationship      VARCHAR(60) NOT NULL,
  consent_text_version VARCHAR(20) NOT NULL,     -- which consent copy was shown
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by       UUID REFERENCES users(user_id),  -- self or assisting leader
  revoked_at        TIMESTAMPTZ                  -- revocation halts processing (§5.9)
);
CREATE INDEX idx_guardian_consent_user ON guardian_consents (user_id) WHERE revoked_at IS NULL;

CREATE TABLE onboarding_assessments (
  assessment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind               VARCHAR(30) NOT NULL DEFAULT 'literacy',
  score              NUMERIC(5,2),
  result             JSONB,                      -- per-question detail / band
  client_mutation_id UUID UNIQUE,
  attempted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### O.2 API specification
| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/onboarding` | Session state: current step, completed steps, what's required next (drives the stepper UI; resumable). |
| PUT | `/v1/onboarding/steps/profile` | DOB, phone, year of salvation, baptism (validates; writes users). |
| GET | `/v1/directory/cell-groups?congregation&search` | Minimal-field cell directory for selection (name, meeting cadence, area). |
| PUT | `/v1/onboarding/steps/cell_selection` | `{cell_group_id}` → derives congregation. |
| PUT | `/v1/onboarding/steps/guardian_consent` | Minors only: guardian fields + consent version. Immutable once granted; audited. |
| GET | `/v1/onboarding/literacy-quiz` | Serve the assessment items. |
| PUT | `/v1/onboarding/steps/literacy_quiz` | Answers → server-scored; `{client_mutation_id}` idempotent. |
| PUT | `/v1/onboarding/steps/notifications` | Quiet hours / opt-in → `notification_preferences`. |
| POST | `/v1/onboarding/finalize` | Validates all required steps (consent REQUIRED when `is_minor`) → calls existing `onboard()` → enrollment at L1. 422 `CONSENT_REQUIRED` if missing. |

Steps are individually idempotent (re-PUT replaces); the whole flow is resumable from `GET`.

### O.3 Infrastructure design
- Pure PostgreSQL state — no new infra. One outbox-scheduled nudge: `onboarding.incomplete`
  reminder at +48h (notifications module, quiet hours respected).
- Directory search hits the replica with a trigram index on `cell_groups.name` (extend §2.3).

### O.4 Security model
- **Minors:** finalize hard-blocked without an unrevoked consent row; consent rows are immutable
  (corrections create a new row + revoke the old), fully audited, `guardian_contact` field-level
  encrypted (§5.5). Consent revocation enqueues a processing-restriction flag (DPA posture, §5.9).
- Step payloads validated with strict zod schemas; `role`/`congregation_id` never client-writable
  through any step (mass-assignment guard, §5.8).
- Directory returns minimal fields, requires auth, is rate-limited (enumeration guard).
- Literacy results visible to the member and their assigned leaders only — never broadly.

---

## §G — Gamification (faithfulness, not competition)

### G.0 Principles (binding product/theology guardrails — §D.5)
- Celebrate **faithfulness and milestones**; never rank members' spirituality. **No public
  individual leaderboards.** Aggregate, cell-level encouragement only ("Cell A read scripture
  120 days together this month").
- **Server-authoritative end to end**: every award derives from already-verified events (server-
  scored quizzes, HMAC-verified attendance, server-ingested interaction events). Clients can
  never originate an award; awards arrive via sync pull.
- Metrics stay separate from ministry (§1.1): badges inform the member and their pastoral
  leaders; they are never inputs to gating, money, or public profiles.

### G.1 Database schema
```sql
CREATE TYPE badge_category AS ENUM ('journey','consistency','community','service');

CREATE TABLE badges (
  badge_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(60) UNIQUE NOT NULL,        -- 'first_module','streak_30','level_2',...
  name        VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  icon_key    VARCHAR(255),                       -- object-store icon (gold-on-navy set)
  category    badge_category NOT NULL,
  criteria    JSONB NOT NULL,                     -- rule descriptor, e.g. {"event":"module.completed","count":1}
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_badges (
  user_badge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  badge_id      UUID NOT NULL REFERENCES badges(badge_id),
  awarded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        JSONB NOT NULL,                   -- {event, ref ids} — provenance
  revoked_at    TIMESTAMPTZ,                      -- data-correction revocation, audited
  UNIQUE (user_id, badge_id)
);

CREATE TABLE user_streaks (
  user_id              UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  current_streak_days  INT NOT NULL DEFAULT 0,
  longest_streak_days  INT NOT NULL DEFAULT 0,
  last_active_date     DATE,                      -- in the MEMBER's timezone, not UTC
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only provenance ledger (auditable; dedupe key prevents double awards)
CREATE TABLE gamification_events (
  gevent_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind        VARCHAR(40) NOT NULL,               -- 'badge_awarded'|'streak_extended'|'streak_reset'
  ref         JSONB NOT NULL,
  dedupe_key  VARCHAR(120) UNIQUE NOT NULL,       -- e.g. 'badge:{user}:{code}' / 'streak:{user}:{date}'
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gevents_user ON gamification_events (user_id, occurred_at DESC);
```

### G.2 API specification
| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/me/achievements` | My badges (with category/icon), streak (current/longest), and aggregate stats. |
| GET | `/v1/badges` | Active catalog (so the app can show "what's possible"). |
| GET | `/v1/cells/{id}/milestones` | **Aggregate-only** cell encouragement (totals, collective streaks). Member of that cell or its leaders; never per-member rankings. |
| GET | `/v1/members/{id}/achievements` | Leader-scoped (via `leader_assignments`) pastoral view. |
| POST/PUT/DELETE | `/v1/admin/badges[...]` | Catalog CRUD (Admin+, audited). Deactivation never revokes earned badges. |
| POST | `/v1/admin/members/{id}/badges/{code}/revoke` | Data-correction revocation (audited, reason required). |

Sync: pull domain `achievements` (user_badges + streak rows via change_log) so awards appear
offline-first; **no push ops exist for this domain** — rejected with `FORBIDDEN_SCOPE`.
Award moments also emit a notification (existing cadence caps apply).

### G.3 Infrastructure design
- **Rules worker** consumes existing outbox topics (`module.completed`, `attendance.checked_in`,
  `level.advanced`, plus a new `streak.tick`): evaluates the badge catalog's `criteria` against
  the member's verified stats; inserts `gamification_events` (dedupe-keyed) + `user_badges` in
  one transaction; enqueues the award notification. At-least-once safe by construction.
- **Streak job**: piggybacks the nightly engagement batch (same scheduler/worker): computes
  active-days from `interaction_events` **in each member's stored timezone**, extends/resets
  streaks, writes `change_log` for sync. Incremental nudge on event ingest keeps "today" fresh.
- Redis caches `/me/achievements` (TTL 5 min; invalidated by award events).
- No new external services. Badge icons live in object storage behind the CDN.

### G.4 Security model
- Awards are **never client-writable** (no push handler; admin revoke is the only manual path,
  audited with reason). Provenance (`source`, ledger) makes every award explainable.
- Anti-gaming: criteria only reference server-verified signals — HMAC QR attendance, server-scored
  quizzes/exams, server-ingested interaction events (which are themselves idempotency-keyed).
  Streaks cap at 1 extension/day/member by `dedupe_key`.
- **Minors:** achievements are never exposed on any public surface (the public certificate-verify
  endpoint remains name/level only); visibility is member-self + assigned leaders, identical to
  engagement scoping (§5.4/§5.9).
- Cell milestones expose **aggregates only** (k-anonymity floor: suppress aggregates for cells
  with < 3 active members).
- Catalog changes are Admin+, audited; criteria JSON validated against a registered rule schema
  (no arbitrary expressions — interpreter only runs known rule kinds).

---

## §X — Cross-cutting integration

- **New sync domains:** `calendar` (pull, windowed), `event_rsvps` (push+pull), `video_progress`
  (push+pull), `achievements` (pull-only). Register in `PULL_DOMAINS` / push handler map; all
  push ops carry `client_mutation_id`; replays are no-ops (§3.6).
- **New outbox topics:** `media.transcode`, `calendar.materialize`, `streak.tick`,
  `onboarding.incomplete`, badge award notifications reuse `notification.schedule`.
- **Engagement interplay:** video 75% events already feed Hᵢ; RSVPs do NOT feed Eᵢ (attendance
  stays the verified Aᵢ signal); gamification reads the same events — no double-writing.
- **OpenAPI:** every endpoint above lands in `packages/shared/src/openapi/openapi.yaml`; the
  route↔spec contract test must stay green.
- **Config additions (App. B):** `VIDEO_PROVIDER` (cloudinary|hls), `VIDEO_MAX_HEIGHT=720`,
  `STORAGE_BUCKET_MEDIA`, `CDN_BASE_URL`, `CAL_MATERIALIZE_HORIZON_DAYS=35`,
  `CAL_MAX_INSTANCES=500`, `STREAK_GRACE=none(v1)`.
- **Mobile UI:** all four map onto the §Prompt-6 design system (player on the Lesson screen;
  Calendar gets a 4th tab or lives under Pathway — product call at build time; onboarding stepper
  per the Figma brief; achievements render on Profile with gold badge medallions).

## §D — Deviations & decisions vs. the uploaded execution doc
1. **720p cap retained** (PRD §7.3) — the doc's 1080p tier is dropped; ladder 720/480/360.
2. **Timezone-aware recurrence** — series store IANA timezone + local wall-clock anchor; the
   doc's UTC-only model would drift across DST.
3. **chrono-node over Duckling** — in-process NL date parsing; no extra service to operate.
   Contract is identical, so a Duckling/LLM service can replace it later.
4. **Real-time chat (doc §3) deferred** — polymorphic comments + WebSocket gateway + presence is
   a v3 subsystem (new stateful tier, moderation/minors implications). Not part of these four.
5. **No public individual leaderboards** — gamification is faithfulness-framed (§G.0); this is a
   deliberate product/theology decision, not an omission.
6. **`modules.video_url` deprecated** in favor of `media_asset_id`; kept as legacy fallback until
   content is migrated.
7. The doc's schemas referenced `users(id)`; this platform's PK is `users(user_id)` — all DDL
   here uses the real keys and §2 conventions.

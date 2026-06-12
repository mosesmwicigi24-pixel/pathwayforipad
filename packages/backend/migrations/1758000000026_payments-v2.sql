-- Migration 26 · Payments v2 (Contract Matrix B7)
-- ============================================================================
-- The Give tab's payment methods (M-Pesa / Airtel Money / Card / wallets) and
-- One-time / Weekly / Monthly frequency. Mobile money rides the SAME
-- intent → verified-callback → balanced-ledger flow as Stripe; guardrails are
-- unchanged: money is NEVER queued offline (§3.6), cards never touch our
-- servers (PCI SAQ-A, §5.6), settlement happens only on a verified webhook.
-- ============================================================================

-- Up Migration

-- Recurring giving: the server-side scheduler creates the intents (§1.1) —
-- the client only manages the schedule.
CREATE TABLE giving_schedules (
  schedule_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  fund_id         UUID NOT NULL REFERENCES funds(fund_id),
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        CHAR(3) NOT NULL,
  frequency       VARCHAR(10) NOT NULL CHECK (frequency IN ('weekly','monthly')),
  method          VARCHAR(10) NOT NULL DEFAULT 'card' CHECK (method IN ('card','mpesa','airtel')),
  status          VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  next_run_at     TIMESTAMPTZ NOT NULL,
  last_run_at     TIMESTAMPTZ,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at    TIMESTAMPTZ
);
CREATE INDEX idx_giving_schedules_due ON giving_schedules (next_run_at) WHERE status = 'active';
CREATE INDEX idx_giving_schedules_user ON giving_schedules (user_id, created_at DESC);

-- Provider-aware transactions. stripe_payment_intent stays for the Stripe path;
-- provider_ref carries the mobile-money checkout reference.
ALTER TABLE transactions
  ADD COLUMN provider     VARCHAR(20) NOT NULL DEFAULT 'stripe',
  ADD COLUMN provider_ref VARCHAR(255) UNIQUE,
  ADD COLUMN schedule_id  UUID REFERENCES giving_schedules(schedule_id);

-- Down Migration

ALTER TABLE transactions
  DROP COLUMN IF EXISTS schedule_id,
  DROP COLUMN IF EXISTS provider_ref,
  DROP COLUMN IF EXISTS provider;
DROP TABLE IF EXISTS giving_schedules;

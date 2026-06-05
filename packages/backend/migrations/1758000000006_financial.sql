-- Migration 06 · Financial — funds, transactions, double-entry ledger, products (spec §2.2, table 11)
-- ============================================================================

-- Up Migration

CREATE TABLE funds (
  fund_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code      VARCHAR(40) UNIQUE NOT NULL,                   -- 'tithe' | 'offering' | 'general' | 'media'
  name      VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE transactions (
  transaction_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(user_id),
  fund_id               UUID REFERENCES funds(fund_id),
  amount_minor          BIGINT NOT NULL CHECK (amount_minor > 0),  -- cents
  currency              CHAR(3) NOT NULL,                  -- ISO 4217
  status                txn_status NOT NULL DEFAULT 'processing',
  stripe_payment_intent VARCHAR(255) UNIQUE,
  idempotency_key       VARCHAR(255) UNIQUE NOT NULL,      -- client-supplied
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at            TIMESTAMPTZ
);

-- Double-entry: every transaction yields balanced debit/credit rows.
CREATE TABLE ledger_entries (
  entry_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
  account        VARCHAR(60) NOT NULL,                     -- 'cash:stripe' | 'fund:tithe' ...
  side           ledger_side NOT NULL,
  amount_minor   BIGINT NOT NULL CHECK (amount_minor > 0),
  currency       CHAR(3) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  product_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          VARCHAR(255) NOT NULL,
  price_minor    BIGINT NOT NULL,
  currency       CHAR(3) NOT NULL,
  media_asset_id UUID,                                     -- FK added in migration 07 (media_assets)
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE purchases (
  purchase_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(user_id),
  product_id     UUID NOT NULL REFERENCES products(product_id),
  transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

-- Webhook idempotency ledger (the PRD's truncated table, completed)
CREATE TABLE processed_webhooks (
  event_id     VARCHAR(255) PRIMARY KEY,                   -- provider event id
  provider     VARCHAR(50) NOT NULL,                       -- 'Stripe'
  payload_hash VARCHAR(64) NOT NULL,                       -- sha-256 of body, audit
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS processed_webhooks;
DROP TABLE IF EXISTS purchases;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS funds;

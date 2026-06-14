// Dev-only: seed a sample settled PayPal gift so the admin Finance page shows the
// Method column populated (PayPal, USD). Mirrors FinancialService.settle exactly —
// a succeeded transaction + a balanced double-entry post (debit fund, credit
// cash:paypal). Idempotent on the idempotency_key. Opt-in; not auto-loaded.
//   pnpm --filter @nuru/backend exec node -r dotenv/config scripts/seed-paypal-sample.mjs
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }
const pool = new pg.Pool({ connectionString: url });

const KEY = "paypal-sample-0001";
const AMOUNT_MINOR = 500; // US$5.00
const PROVIDER_REF = "PP_SAMPLE_3D2207";

try {
  const { rows: existing } = await pool.query("SELECT transaction_id FROM transactions WHERE idempotency_key = $1", [KEY]);
  if (existing[0]) {
    console.log("Sample PayPal transaction already present:", existing[0].transaction_id);
    process.exit(0);
  }

  const { rows: users } = await pool.query(
    "SELECT user_id, full_name FROM users WHERE role = 'Student' AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
  );
  if (!users[0]) { console.error("No Student user found — run a member seed first."); process.exit(1); }
  const { rows: funds } = await pool.query("SELECT fund_id, code FROM funds WHERE code = 'offering' AND is_active LIMIT 1");
  if (!funds[0]) { console.error("Fund 'offering' not found — run migrations."); process.exit(1); }

  const user = users[0];
  const fund = funds[0];

  const { rows: txnRows } = await pool.query(
    `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, settled_at)
     VALUES ($1, $2, $3, 'USD', 'succeeded', 'paypal', $4, $5, now())
     RETURNING transaction_id`,
    [user.user_id, fund.fund_id, AMOUNT_MINOR, PROVIDER_REF, KEY],
  );
  const txnId = txnRows[0].transaction_id;

  // Balanced double-entry, identical to settle(): debit fund:offering, credit cash:paypal.
  await pool.query(
    `INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency)
     VALUES ($1, 'fund:offering', 'debit', $2, 'USD'), ($1, 'cash:paypal', 'credit', $2, 'USD')`,
    [txnId, AMOUNT_MINOR],
  );

  console.log(`Seeded PayPal gift: US$${(AMOUNT_MINOR / 100).toFixed(2)} · offering · ${user.full_name} · txn ${txnId}`);
} finally {
  await pool.end();
}

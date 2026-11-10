// ---------------------------------------------------------------------------
// DATABASE TABLES
// The Worker creates these tables by itself the first time it runs, so there
// is no separate "set up the database" step. "IF NOT EXISTS" makes it safe to
// run again and again.
// All money columns are whole cents. All *_ts columns are Unix seconds.
// ---------------------------------------------------------------------------

export const SCHEMA: string[] = [
  // Small key/value store: sync status, cached shop info, the Claude briefing...
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

  // Owner settings (minimum profit, fee percentages).
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

  // The Etsy login tokens. Only ever one row (id = 1). Never sent to the browser.
  `CREATE TABLE IF NOT EXISTS oauth_tokens (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     access_token TEXT NOT NULL,
     refresh_token TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL)`,

  // Wrong-passcode counter, per visitor address.
  `CREATE TABLE IF NOT EXISTS login_attempts (
     ip TEXT PRIMARY KEY,
     count INTEGER NOT NULL,
     window_start INTEGER NOT NULL)`,

  // Current state of each listing.
  `CREATE TABLE IF NOT EXISTS listings (
     listing_id INTEGER PRIMARY KEY,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     state TEXT NOT NULL,
     url TEXT NOT NULL DEFAULT '',
     price_cents INTEGER NOT NULL,
     currency TEXT NOT NULL DEFAULT 'AUD',
     quantity INTEGER NOT NULL DEFAULT 0,
     views INTEGER NOT NULL DEFAULT 0,
     favorites INTEGER NOT NULL DEFAULT 0,
     tags TEXT NOT NULL DEFAULT '[]',
     created_ts INTEGER NOT NULL)`,

  // HISTORY: one row per listing per day (Etsy only gives running totals).
  `CREATE TABLE IF NOT EXISTS listing_snapshots (
     day TEXT NOT NULL,
     listing_id INTEGER NOT NULL,
     views INTEGER NOT NULL,
     favorites INTEGER NOT NULL,
     price_cents INTEGER NOT NULL,
     quantity INTEGER NOT NULL,
     tags TEXT NOT NULL DEFAULT '[]',
     PRIMARY KEY (day, listing_id))`,

  // Orders. No buyer name, email or address is stored. Only the country.
  `CREATE TABLE IF NOT EXISTS receipts (
     receipt_id INTEGER PRIMARY KEY,
     created_ts INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT '',
     country_iso TEXT NOT NULL DEFAULT '',
     currency TEXT NOT NULL DEFAULT 'AUD',
     total_price_cents INTEGER NOT NULL,
     discount_cents INTEGER NOT NULL,
     subtotal_cents INTEGER NOT NULL,
     shipping_cents INTEGER NOT NULL,
     tax_cents INTEGER NOT NULL,
     vat_cents INTEGER NOT NULL,
     grandtotal_cents INTEGER NOT NULL)`,

  // Item lines inside orders.
  `CREATE TABLE IF NOT EXISTS transactions (
     transaction_id INTEGER PRIMARY KEY,
     receipt_id INTEGER NOT NULL,
     listing_id INTEGER NOT NULL,
     title TEXT NOT NULL DEFAULT '',
     quantity INTEGER NOT NULL,
     price_cents INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_receipt ON transactions (receipt_id)`,

  // Etsy's bill: fees, sales, payouts.
  `CREATE TABLE IF NOT EXISTS ledger_entries (
     entry_id INTEGER PRIMARY KEY,
     created_ts INTEGER NOT NULL,
     amount_cents INTEGER NOT NULL,
     currency TEXT NOT NULL DEFAULT 'AUD',
     description TEXT NOT NULL DEFAULT '',
     ledger_type TEXT NOT NULL DEFAULT '',
     reference_type TEXT NOT NULL DEFAULT '',
     reference_id TEXT NOT NULL DEFAULT '')`,

  // Reviews (rating only, no reviewer details).
  `CREATE TABLE IF NOT EXISTS reviews (
     transaction_id INTEGER PRIMARY KEY,
     listing_id INTEGER NOT NULL,
     rating INTEGER NOT NULL,
     created_ts INTEGER NOT NULL)`,

  // Numbers typed in by hand, one row per week (week_start is a Monday).
  `CREATE TABLE IF NOT EXISTS weekly_manual (
     week_start TEXT PRIMARY KEY,
     ads_spend_cents INTEGER,
     visits INTEGER,
     src_search INTEGER,
     src_ads INTEGER,
     src_etsy_other INTEGER,
     src_social INTEGER,
     src_direct INTEGER,
     is_sample INTEGER NOT NULL DEFAULT 0)`,

  // Costs typed in by hand.
  `CREATE TABLE IF NOT EXISTS costs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     day TEXT NOT NULL,
     kind TEXT NOT NULL,
     label TEXT NOT NULL,
     amount_cents INTEGER NOT NULL,
     is_sample INTEGER NOT NULL DEFAULT 0)`,

  // Days read from an uploaded Etsy Stats CSV.
  `CREATE TABLE IF NOT EXISTS daily_stats (
     day TEXT PRIMARY KEY,
     visits INTEGER,
     views INTEGER,
     orders INTEGER,
     revenue_cents INTEGER)`,
];

/** Tables that hold Etsy data. They are emptied when real data replaces the sample data. */
export const ETSY_TABLES = ["listings", "listing_snapshots", "receipts", "transactions", "ledger_entries", "reviews"];

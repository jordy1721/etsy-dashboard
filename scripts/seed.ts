// ---------------------------------------------------------------------------
// npm run seed
// Resets your LOCAL test database to fresh SAMPLE data.
// (The deployed app seeds itself the first time it runs, so you only need
// this when testing on a computer.)
// It writes a .sql file and hands it to wrangler, Cloudflare's tool.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildSampleData } from "../src/server/sample";
import { ETSY_TABLES, SCHEMA } from "../src/server/schema";

/** Turn a value into safe SQL text. */
function q(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}
const row = (...values: (string | number | null)[]) => `(${values.map(q).join(", ")})`;

const sample = buildSampleData(Math.floor(Date.now() / 1000));
const sql: string[] = [];

// Tables first (as single lines), then empty everything that holds data.
for (const statement of SCHEMA) sql.push(statement.replace(/\s+/g, " ") + ";");
for (const table of [...ETSY_TABLES, "weekly_manual", "costs", "ad_stats", "daily_stats", "meta", "oauth_tokens", "login_attempts"]) sql.push(`DELETE FROM ${table};`);

for (const l of sample.listings) {
  sql.push(
    `INSERT INTO listings (listing_id, title, description, state, url, price_cents, currency, quantity, views, favorites, tags, created_ts) VALUES ${row(l.listingId, l.title, l.description, l.state, l.url, l.priceCents, l.currency, l.quantity, l.views, l.favorites, JSON.stringify(l.tags), l.createdTs)};`,
  );
}
for (const s of sample.snapshots) {
  sql.push(
    `INSERT INTO listing_snapshots (day, listing_id, views, favorites, price_cents, quantity, tags) VALUES ${row(s.day, s.listingId, s.views, s.favorites, s.priceCents, s.quantity, JSON.stringify(s.tags))};`,
  );
}
for (const r of sample.receipts) {
  sql.push(
    `INSERT INTO receipts (receipt_id, created_ts, status, country_iso, currency, total_price_cents, discount_cents, subtotal_cents, shipping_cents, tax_cents, vat_cents, grandtotal_cents) VALUES ${row(r.receiptId, r.createdTs, r.status, r.countryIso, r.currency, r.totalPriceCents, r.discountCents, r.subtotalCents, r.shippingCents, r.taxCents, r.vatCents, r.grandtotalCents)};`,
  );
  for (const t of r.transactions) {
    sql.push(
      `INSERT INTO transactions (transaction_id, receipt_id, listing_id, title, quantity, price_cents) VALUES ${row(t.transactionId, t.receiptId, t.listingId, t.title, t.quantity, t.priceCents)};`,
    );
  }
}
for (const e of sample.ledger) {
  sql.push(
    `INSERT INTO ledger_entries (entry_id, created_ts, amount_cents, currency, description, ledger_type, reference_type, reference_id) VALUES ${row(e.entryId, e.createdTs, e.amountCents, e.currency, e.description, e.ledgerType, e.referenceType, e.referenceId)};`,
  );
}
for (const w of sample.weekly) {
  sql.push(
    `INSERT INTO weekly_manual (week_start, ads_spend_cents, visits, src_search, src_ads, src_etsy_other, src_social, src_direct, is_sample) VALUES ${row(w.weekStart, w.adsSpendCents, w.visits, w.srcSearch, w.srcAds, w.srcEtsyOther, w.srcSocial, w.srcDirect, 1)};`,
  );
}
for (const c of sample.costs) {
  sql.push(`INSERT INTO costs (day, kind, label, amount_cents, is_sample) VALUES ${row(c.day, c.kind, c.label, c.amountCents, 1)};`);
}
sql.push(`INSERT INTO meta (key, value) VALUES ${row("shop", JSON.stringify(sample.shop))};`);
for (const a of sample.adStats) {
  sql.push(
    `INSERT INTO ad_stats (week_start, listing_id, views, clicks, orders, revenue_cents, spend_cents, is_sample) VALUES ${row(a.weekStart, a.listingId, a.views, a.clicks, a.orders, a.revenueCents, a.spendCents, 1)};`,
  );
}
sql.push(`INSERT INTO meta (key, value) VALUES ${row("data_mode", "sample")};`);
sql.push(`INSERT INTO meta (key, value) VALUES ${row("sample_version", "2")};`);

mkdirSync(".wrangler", { recursive: true });
writeFileSync(".wrangler/seed.sql", sql.join("\n") + "\n");
console.log(`Wrote ${sql.length} SQL statements. Loading them into the local database...`);

execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--file", ".wrangler/seed.sql"], { stdio: "inherit" });
console.log("Done. The local database now holds fresh SAMPLE data.");

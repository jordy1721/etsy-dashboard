// ---------------------------------------------------------------------------
// DATABASE ACCESS
// Every read and write to the D1 database goes through this file.
// We group statements into "batches" so one page load needs very few
// round trips (the free Cloudflare plan limits how many you can make).
// ---------------------------------------------------------------------------

import type { AdStat } from "../shared/ads";
import { DEFAULT_SETTINGS } from "../shared/types";
import type {
  Cost, CostKind, DailyStat, LedgerEntry, Listing, Receipt, Review, Settings, ShopInfo, Snapshot, Transaction, WeeklyManual,
} from "../shared/types";
import { nowSeconds, type Env } from "./env";
import { buildSampleData } from "./sample";
import { ETSY_TABLES, SCHEMA } from "./schema";

/** Remembered while this copy of the Worker stays warm, so we only check once. */
let ready = false;

/** Raise this number when the sample data changes, so sites still on sample data get the new version. */
const SAMPLE_VERSION = "2";

/** Make sure the tables exist, and load sample data into a brand-new database. */
export async function ensureReady(env: Env): Promise<void> {
  if (ready) return;
  await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
  const rows = await env.DB.prepare(`SELECT key, value FROM meta WHERE key IN ('data_mode', 'sample_version')`).all<{ key: string; value: string }>();
  const meta = new Map(rows.results.map((r) => [r.key, r.value]));
  const mode = meta.get("data_mode");
  // Brand-new database, or still on an older set of sample data: load the current sample data.
  if (!mode || (mode === "sample" && meta.get("sample_version") !== SAMPLE_VERSION)) await seedSampleData(env.DB, nowSeconds());
  ready = true;
}

/** Run many statements, at most 80 per round trip. */
export async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));
}

// ---------------------------------------------------------------------------
// Statements that insert or update rows ("upsert" = update if it exists,
// insert if it does not). Using Etsy's own IDs as keys means pulling the same
// order twice can never create a duplicate.
// ---------------------------------------------------------------------------

export function listingStatement(db: D1Database, l: Listing): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO listings (listing_id, title, description, state, url, price_cents, currency, quantity, views, favorites, tags, created_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (listing_id) DO UPDATE SET title = excluded.title, description = excluded.description, state = excluded.state,
         url = excluded.url, price_cents = excluded.price_cents, currency = excluded.currency, quantity = excluded.quantity,
         views = excluded.views, favorites = excluded.favorites, tags = excluded.tags, created_ts = excluded.created_ts`,
    )
    .bind(l.listingId, l.title, l.description, l.state, l.url, l.priceCents, l.currency, l.quantity, l.views, l.favorites, JSON.stringify(l.tags), l.createdTs);
}

export function snapshotStatement(db: D1Database, s: Snapshot): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO listing_snapshots (day, listing_id, views, favorites, price_cents, quantity, tags) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (day, listing_id) DO UPDATE SET views = excluded.views, favorites = excluded.favorites,
         price_cents = excluded.price_cents, quantity = excluded.quantity, tags = excluded.tags`,
    )
    .bind(s.day, s.listingId, s.views, s.favorites, s.priceCents, s.quantity, JSON.stringify(s.tags));
}

export function receiptStatements(db: D1Database, r: Receipt): D1PreparedStatement[] {
  const out = [
    db
      .prepare(
        `INSERT INTO receipts (receipt_id, created_ts, status, country_iso, currency, total_price_cents, discount_cents, subtotal_cents,
           shipping_cents, tax_cents, vat_cents, grandtotal_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (receipt_id) DO UPDATE SET created_ts = excluded.created_ts, status = excluded.status, country_iso = excluded.country_iso,
           currency = excluded.currency, total_price_cents = excluded.total_price_cents, discount_cents = excluded.discount_cents,
           subtotal_cents = excluded.subtotal_cents, shipping_cents = excluded.shipping_cents, tax_cents = excluded.tax_cents,
           vat_cents = excluded.vat_cents, grandtotal_cents = excluded.grandtotal_cents`,
      )
      .bind(r.receiptId, r.createdTs, r.status, r.countryIso, r.currency, r.totalPriceCents, r.discountCents, r.subtotalCents, r.shippingCents, r.taxCents, r.vatCents, r.grandtotalCents),
  ];
  for (const t of r.transactions) {
    out.push(
      db
        .prepare(
          `INSERT INTO transactions (transaction_id, receipt_id, listing_id, title, quantity, price_cents) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (transaction_id) DO UPDATE SET receipt_id = excluded.receipt_id, listing_id = excluded.listing_id,
             title = excluded.title, quantity = excluded.quantity, price_cents = excluded.price_cents`,
        )
        .bind(t.transactionId, t.receiptId, t.listingId, t.title, t.quantity, t.priceCents),
    );
  }
  return out;
}

export function ledgerStatement(db: D1Database, e: LedgerEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ledger_entries (entry_id, created_ts, amount_cents, currency, description, ledger_type, reference_type, reference_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (entry_id) DO UPDATE SET created_ts = excluded.created_ts, amount_cents = excluded.amount_cents, currency = excluded.currency,
         description = excluded.description, ledger_type = excluded.ledger_type, reference_type = excluded.reference_type,
         reference_id = excluded.reference_id`,
    )
    .bind(e.entryId, e.createdTs, e.amountCents, e.currency, e.description, e.ledgerType, e.referenceType, e.referenceId);
}

export function reviewStatement(db: D1Database, r: Review): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO reviews (transaction_id, listing_id, rating, created_ts) VALUES (?, ?, ?, ?)
       ON CONFLICT (transaction_id) DO UPDATE SET listing_id = excluded.listing_id, rating = excluded.rating, created_ts = excluded.created_ts`,
    )
    .bind(r.transactionId, r.listingId, r.rating, r.createdTs);
}

export function metaStatement(db: D1Database, key: string, value: string): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    .bind(key, value);
}

export async function setMeta(db: D1Database, values: Record<string, string>): Promise<void> {
  await db.batch(Object.entries(values).map(([k, v]) => metaStatement(db, k, v)));
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM meta WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/** Statements that wipe the sample data (used right before the first real data is saved). */
export function clearSampleStatements(db: D1Database): D1PreparedStatement[] {
  return [
    ...ETSY_TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)),
    db.prepare(`DELETE FROM weekly_manual WHERE is_sample = 1`),
    db.prepare(`DELETE FROM costs WHERE is_sample = 1`),
    db.prepare(`DELETE FROM ad_stats WHERE is_sample = 1`),
  ];
}

/** Fill the database with invented sample data and mark it as SAMPLE. */
export async function seedSampleData(db: D1Database, now: number): Promise<void> {
  const sample = buildSampleData(now);
  const statements: D1PreparedStatement[] = [
    ...clearSampleStatements(db),
    ...sample.listings.map((l) => listingStatement(db, l)),
    ...sample.snapshots.map((s) => snapshotStatement(db, s)),
    ...sample.receipts.flatMap((r) => receiptStatements(db, r)),
    ...sample.ledger.map((e) => ledgerStatement(db, e)),
    ...sample.weekly.map((w) => weeklyStatement(db, w, true)),
    ...sample.costs.map((c) =>
      db.prepare(`INSERT INTO costs (day, kind, label, amount_cents, is_sample) VALUES (?, ?, ?, ?, 1)`).bind(c.day, c.kind, c.label, c.amountCents),
    ),
    ...sample.adStats.map((a) => adStatStatement(db, a, true)),
    metaStatement(db, "shop", JSON.stringify(sample.shop)),
    metaStatement(db, "data_mode", "sample"),
    metaStatement(db, "sample_version", SAMPLE_VERSION),
  ];
  await runBatches(db, statements);
}

// ---------------------------------------------------------------------------
// Manual entries and settings
// ---------------------------------------------------------------------------

export function weeklyStatement(db: D1Database, w: WeeklyManual, isSample = false): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO weekly_manual (week_start, ads_spend_cents, visits, src_search, src_ads, src_etsy_other, src_social, src_direct, is_sample)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (week_start) DO UPDATE SET ads_spend_cents = excluded.ads_spend_cents, visits = excluded.visits,
         src_search = excluded.src_search, src_ads = excluded.src_ads, src_etsy_other = excluded.src_etsy_other,
         src_social = excluded.src_social, src_direct = excluded.src_direct, is_sample = excluded.is_sample`,
    )
    .bind(w.weekStart, w.adsSpendCents, w.visits, w.srcSearch, w.srcAds, w.srcEtsyOther, w.srcSocial, w.srcDirect, isSample ? 1 : 0);
}

const EMPTY_WEEK: Omit<WeeklyManual, "weekStart"> = {
  adsSpendCents: null, visits: null, srcSearch: null, srcAds: null, srcEtsyOther: null, srcSocial: null, srcDirect: null,
};

async function getWeekly(db: D1Database, weekStartDay: string): Promise<WeeklyManual> {
  const r = await db.prepare(`SELECT * FROM weekly_manual WHERE week_start = ?`).bind(weekStartDay).first<Row>();
  if (!r) return { weekStart: weekStartDay, ...EMPTY_WEEK };
  return {
    weekStart: weekStartDay,
    adsSpendCents: numOrNull(r.ads_spend_cents),
    visits: numOrNull(r.visits),
    srcSearch: numOrNull(r.src_search),
    srcAds: numOrNull(r.src_ads),
    srcEtsyOther: numOrNull(r.src_etsy_other),
    srcSocial: numOrNull(r.src_social),
    srcDirect: numOrNull(r.src_direct),
  };
}

/** A week with nothing in it is removed, so the list stays tidy. */
function dropEmptyWeek(db: D1Database, weekStartDay: string): D1PreparedStatement {
  return db
    .prepare(
      `DELETE FROM weekly_manual WHERE week_start = ? AND ads_spend_cents IS NULL AND visits IS NULL AND src_search IS NULL
         AND src_ads IS NULL AND src_etsy_other IS NULL AND src_social IS NULL AND src_direct IS NULL`,
    )
    .bind(weekStartDay);
}

/**
 * Save part of a week's numbers and keep the rest.
 * The Settings screen saves visits; the Ads screen saves ad spend. Neither wipes the other.
 */
export async function saveWeeklyPart(db: D1Database, weekStartDay: string, part: Partial<Omit<WeeklyManual, "weekStart">>): Promise<void> {
  const merged = { ...(await getWeekly(db, weekStartDay)), ...part };
  await db.batch([weeklyStatement(db, merged), dropEmptyWeek(db, weekStartDay)]);
}

// ---- Ad campaign numbers ----

export function adStatStatement(db: D1Database, a: AdStat, isSample = false): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ad_stats (week_start, listing_id, views, clicks, orders, revenue_cents, spend_cents, is_sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (week_start, listing_id) DO UPDATE SET views = excluded.views, clicks = excluded.clicks, orders = excluded.orders,
         revenue_cents = excluded.revenue_cents, spend_cents = excluded.spend_cents, is_sample = excluded.is_sample`,
    )
    .bind(a.weekStart, a.listingId, a.views, a.clicks, a.orders, a.revenueCents, a.spendCents, isSample ? 1 : 0);
}

/** Replace everything typed for one week of ads (whole shop + each listing) and its ad spend. */
export async function saveAdWeek(db: D1Database, weekStartDay: string, spendCents: number | null, rows: AdStat[]): Promise<void> {
  const merged = { ...(await getWeekly(db, weekStartDay)), adsSpendCents: spendCents };
  await db.batch([
    db.prepare(`DELETE FROM ad_stats WHERE week_start = ?`).bind(weekStartDay),
    ...rows.map((r) => adStatStatement(db, r)),
    weeklyStatement(db, merged),
    dropEmptyWeek(db, weekStartDay),
  ]);
}

export async function deleteAdWeek(db: D1Database, weekStartDay: string): Promise<void> {
  await saveAdWeek(db, weekStartDay, null, []);
}

export async function addCost(db: D1Database, c: { day: string; kind: CostKind; label: string; amountCents: number }): Promise<void> {
  await db.prepare(`INSERT INTO costs (day, kind, label, amount_cents, is_sample) VALUES (?, ?, ?, ?, 0)`).bind(c.day, c.kind, c.label, c.amountCents).run();
}

export async function deleteCost(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM costs WHERE id = ?`).bind(id).run();
}

export async function saveSettings(db: D1Database, values: Partial<Settings>): Promise<void> {
  const statements = Object.entries(values).map(([k, v]) =>
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(k, String(v)),
  );
  if (statements.length > 0) await db.batch(statements);
}

export async function saveDailyStats(db: D1Database, rows: DailyStat[]): Promise<void> {
  await runBatches(
    db,
    rows.map((r) =>
      db
        .prepare(
          `INSERT INTO daily_stats (day, visits, views, orders, revenue_cents) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (day) DO UPDATE SET visits = excluded.visits, views = excluded.views, orders = excluded.orders, revenue_cents = excluded.revenue_cents`,
        )
        .bind(r.day, r.visits, r.views, r.orders, r.revenueCents),
    ),
  );
}

// ---------------------------------------------------------------------------
// Etsy login tokens (server side only)
// ---------------------------------------------------------------------------

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function getTokens(db: D1Database): Promise<StoredTokens | null> {
  const row = await db
    .prepare(`SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE id = 1`)
    .first<{ access_token: string; refresh_token: string; expires_at: number }>();
  return row ? { accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at } : null;
}

export async function saveTokens(db: D1Database, t: StoredTokens): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_tokens (id, access_token, refresh_token, expires_at, updated_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    )
    .bind(t.accessToken, t.refreshToken, t.expiresAt, nowSeconds())
    .run();
}

export async function deleteTokens(db: D1Database): Promise<void> {
  await db.prepare(`DELETE FROM oauth_tokens`).run();
}

// ---------------------------------------------------------------------------
// Read everything the dashboard needs, in ONE round trip.
// ---------------------------------------------------------------------------

export interface AllData {
  shop: ShopInfo | null;
  listings: Listing[];
  snapshots: Snapshot[];
  receipts: Receipt[];
  ledger: LedgerEntry[];
  reviews: Review[];
  weekly: WeeklyManual[];
  costs: Cost[];
  dailyStats: DailyStat[];
  adStats: AdStat[];
  settings: Settings;
  meta: Map<string, string>;
  etsyConnected: boolean;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));

function parseTags(v: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(str(v) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function settingsFromRows(rows: Row[]): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  const numericKeys = ["minProfitCents", "transactionFeePct", "processingPct", "processingFixedCents", "listingFeeCents", "feeTaxPct", "reviewAfterSales"] as const;
  for (const row of rows) {
    const key = str(row.key);
    const value = Number(row.value);
    for (const k of numericKeys) if (k === key && Number.isFinite(value)) s[k] = value;
  }
  return s;
}

export async function loadAll(db: D1Database): Promise<AllData> {
  const results = await db.batch<Row>([
    db.prepare(`SELECT * FROM listings`),
    // 400 days of history is plenty for the charts and keeps the read small.
    db.prepare(`SELECT * FROM listing_snapshots WHERE day >= date('now', '-400 days') ORDER BY day`),
    db.prepare(`SELECT * FROM receipts ORDER BY created_ts`),
    db.prepare(`SELECT * FROM transactions`),
    db.prepare(`SELECT * FROM ledger_entries ORDER BY created_ts`),
    db.prepare(`SELECT * FROM reviews`),
    db.prepare(`SELECT * FROM weekly_manual ORDER BY week_start`),
    db.prepare(`SELECT * FROM costs ORDER BY day DESC, id DESC`),
    db.prepare(`SELECT * FROM daily_stats ORDER BY day`),
    db.prepare(`SELECT * FROM settings`),
    db.prepare(`SELECT * FROM meta`),
    db.prepare(`SELECT COUNT(*) AS n FROM oauth_tokens`),
    db.prepare(`SELECT * FROM ad_stats ORDER BY week_start`),
  ]);
  const rows = (i: number): Row[] => results[i]?.results ?? [];

  const txByReceipt = new Map<number, Transaction[]>();
  for (const r of rows(3)) {
    const t: Transaction = {
      transactionId: num(r.transaction_id),
      receiptId: num(r.receipt_id),
      listingId: num(r.listing_id),
      title: str(r.title),
      quantity: num(r.quantity),
      priceCents: num(r.price_cents),
    };
    const list = txByReceipt.get(t.receiptId) ?? [];
    list.push(t);
    txByReceipt.set(t.receiptId, list);
  }

  const meta = new Map(rows(10).map((r) => [str(r.key), str(r.value)]));
  let shop: ShopInfo | null;
  try {
    shop = JSON.parse(meta.get("shop") ?? "null") as ShopInfo | null;
  } catch {
    shop = null;
  }

  return {
    shop,
    listings: rows(0).map((r) => ({
      listingId: num(r.listing_id),
      title: str(r.title),
      description: str(r.description),
      state: str(r.state),
      url: str(r.url),
      priceCents: num(r.price_cents),
      currency: str(r.currency),
      quantity: num(r.quantity),
      views: num(r.views),
      favorites: num(r.favorites),
      tags: parseTags(r.tags),
      createdTs: num(r.created_ts),
    })),
    snapshots: rows(1).map((r) => ({
      day: str(r.day),
      listingId: num(r.listing_id),
      views: num(r.views),
      favorites: num(r.favorites),
      priceCents: num(r.price_cents),
      quantity: num(r.quantity),
      tags: parseTags(r.tags),
    })),
    receipts: rows(2).map((r) => ({
      receiptId: num(r.receipt_id),
      createdTs: num(r.created_ts),
      status: str(r.status),
      countryIso: str(r.country_iso),
      currency: str(r.currency),
      totalPriceCents: num(r.total_price_cents),
      discountCents: num(r.discount_cents),
      subtotalCents: num(r.subtotal_cents),
      shippingCents: num(r.shipping_cents),
      taxCents: num(r.tax_cents),
      vatCents: num(r.vat_cents),
      grandtotalCents: num(r.grandtotal_cents),
      transactions: txByReceipt.get(num(r.receipt_id)) ?? [],
    })),
    ledger: rows(4).map((r) => ({
      entryId: num(r.entry_id),
      createdTs: num(r.created_ts),
      amountCents: num(r.amount_cents),
      currency: str(r.currency),
      description: str(r.description),
      ledgerType: str(r.ledger_type),
      referenceType: str(r.reference_type),
      referenceId: str(r.reference_id),
    })),
    reviews: rows(5).map((r) => ({
      transactionId: num(r.transaction_id),
      listingId: num(r.listing_id),
      rating: num(r.rating),
      createdTs: num(r.created_ts),
    })),
    weekly: rows(6).map((r) => ({
      weekStart: str(r.week_start),
      adsSpendCents: numOrNull(r.ads_spend_cents),
      visits: numOrNull(r.visits),
      srcSearch: numOrNull(r.src_search),
      srcAds: numOrNull(r.src_ads),
      srcEtsyOther: numOrNull(r.src_etsy_other),
      srcSocial: numOrNull(r.src_social),
      srcDirect: numOrNull(r.src_direct),
    })),
    costs: rows(7).map((r) => ({
      id: num(r.id),
      day: str(r.day),
      kind: str(r.kind) as CostKind,
      label: str(r.label),
      amountCents: num(r.amount_cents),
    })),
    dailyStats: rows(8).map((r) => ({
      day: str(r.day),
      visits: numOrNull(r.visits),
      views: numOrNull(r.views),
      orders: numOrNull(r.orders),
      revenueCents: numOrNull(r.revenue_cents),
    })),
    adStats: rows(12).map((r) => ({
      weekStart: str(r.week_start),
      listingId: num(r.listing_id),
      views: numOrNull(r.views),
      clicks: numOrNull(r.clicks),
      orders: numOrNull(r.orders),
      revenueCents: numOrNull(r.revenue_cents),
      spendCents: numOrNull(r.spend_cents),
    })),
    settings: settingsFromRows(rows(9)),
    meta,
    etsyConnected: num(rows(11)[0]?.n) > 0,
  };
}

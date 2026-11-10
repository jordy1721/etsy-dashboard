// ---------------------------------------------------------------------------
// THE DAILY PULL
// Reads shop, listings, orders, the bill (ledger) and reviews from Etsy, then
// saves them. Runs once a day from the Cron Trigger, and from "Refresh now".
//
// Read-only: this file only calls client.get / client.getAll.
// ---------------------------------------------------------------------------

import { dayKey } from "../../shared/dates";
import type { LedgerEntry, Listing, Receipt, Review, ShopInfo, Snapshot } from "../../shared/types";
import { clearSampleStatements, ledgerStatement, listingStatement, metaStatement, receiptStatements, reviewStatement, runBatches, snapshotStatement } from "../db";
import type { Env } from "../env";
import { EtsyClient } from "./client";
import { mapLedgerEntry, mapListing, mapReceipt, mapReview, mapShop } from "./mapping";
import { getAccessToken } from "./oauth";

type Json = Record<string, unknown>;
const DAY = 86_400;

/** Limits per run, so one pull stays small (well inside Etsy's and Cloudflare's limits). */
export const LIMITS = {
  listingPages: 3,
  receiptPages: 8,
  ledgerWindowDays: 30, // Etsy only allows about a month per ledger request
  ledgerWindowsPerRun: 4,
  ledgerPagesPerWindow: 3,
  reviewPages: 2,
  /** Re-read this much recent history each run to catch late changes (refunds, status). */
  receiptOverlapDays: 14,
  ledgerOverlapDays: 3,
};

export interface FetchedData {
  shop: ShopInfo;
  listings: Listing[];
  receipts: Receipt[];
  ledger: LedgerEntry[];
  reviews: Review[];
  /** Where to continue from next time. */
  receiptsCursor: number;
  ledgerCursor: number;
  /** Plain-language notes, e.g. "more history will be read on the next run". */
  notes: string[];
}

/** Split a time range into windows of at most `windowDays`. */
export function ledgerWindows(from: number, to: number, windowDays: number): { min: number; max: number }[] {
  const out: { min: number; max: number }[] = [];
  for (let start = from; start < to; start += windowDays * DAY) out.push({ min: start, max: Math.min(to, start + windowDays * DAY) });
  return out;
}

/** Step 1: read everything from Etsy. No database access in here, so it is easy to test. */
export async function fetchFromEtsy(
  client: EtsyClient,
  shopId: string,
  cursors: { receipts: number | null; ledger: number | null },
  now: number,
): Promise<FetchedData> {
  const notes: string[] = [];
  const base = `/shops/${shopId}`;

  const shop = mapShop(await client.get<Json>(base, {}, true));

  const listingPages = await client.getAll<Json>(`${base}/listings`, { state: "active" }, true, LIMITS.listingPages);
  const listings = listingPages.results.map(mapListing);
  if (!listingPages.complete) notes.push("More than 300 active listings: only the first 300 were read.");

  // Orders: everything the first time, then only recent ones (with an overlap).
  const receiptsFrom = cursors.receipts === null ? undefined : Math.max(0, cursors.receipts - LIMITS.receiptOverlapDays * DAY);
  const receiptPages = await client.getAll<Json>(
    `${base}/receipts`,
    { min_created: receiptsFrom, sort_on: "created", sort_order: "asc" },
    true,
    LIMITS.receiptPages,
  );
  const receipts = receiptPages.results.map(mapReceipt);
  let receiptsCursor = now;
  if (!receiptPages.complete) {
    // Too many for one run: continue from the newest one we got, next time.
    receiptsCursor = receipts.reduce((max, r) => Math.max(max, r.createdTs), receiptsFrom ?? 0);
    notes.push("There are more orders to read. The next run continues where this one stopped.");
  }

  // The bill: Etsy needs a start and end time, about a month at most per request.
  const ledgerStart = cursors.ledger === null ? shop.createdTs || now - 90 * DAY : cursors.ledger - LIMITS.ledgerOverlapDays * DAY;
  const windows = ledgerWindows(Math.max(0, ledgerStart), now, LIMITS.ledgerWindowDays);
  const ledger: LedgerEntry[] = [];
  let ledgerCursor = cursors.ledger ?? ledgerStart;
  for (const [i, w] of windows.entries()) {
    if (i >= LIMITS.ledgerWindowsPerRun) {
      notes.push("There is more billing history to read. The next run continues where this one stopped.");
      break;
    }
    const page = await client.getAll<Json>(
      `${base}/payment-account/ledger-entries`,
      { min_created: w.min, max_created: w.max },
      true,
      LIMITS.ledgerPagesPerWindow,
    );
    ledger.push(...page.results.map(mapLedgerEntry));
    if (!page.complete) {
      notes.push("A very busy month in the bill was only partly read.");
    }
    ledgerCursor = w.max;
  }

  // Reviews are public, but the token does no harm.
  const reviewPages = await client.getAll<Json>(`${base}/reviews`, {}, true, LIMITS.reviewPages);
  const reviews = reviewPages.results.map(mapReview).filter((r) => r.transactionId > 0);

  return { shop, listings, receipts, ledger, reviews, receiptsCursor, ledgerCursor, notes };
}

/** Today's history row for each listing. */
export function snapshotsFor(listings: Listing[], day: string): Snapshot[] {
  return listings.map((l) => ({
    day,
    listingId: l.listingId,
    views: l.views,
    favorites: l.favorites,
    priceCents: l.priceCents,
    quantity: l.quantity,
    tags: l.tags,
  }));
}

/** Step 2: save it. Sample data is wiped the first time real data arrives. */
export async function saveToDatabase(db: D1Database, data: FetchedData, now: number, wasSample: boolean, timeZone: string): Promise<void> {
  const today = dayKey(now, timeZone);
  const statements: D1PreparedStatement[] = [
    ...(wasSample ? clearSampleStatements(db) : []),
    // Listings that are no longer active are marked, not deleted (their sales history still matters).
    db.prepare(`UPDATE listings SET state = 'inactive' WHERE state = 'active'`),
    ...data.listings.map((l) => listingStatement(db, l)),
    ...snapshotsFor(data.listings, today).map((s) => snapshotStatement(db, s)),
    ...data.receipts.flatMap((r) => receiptStatements(db, r)),
    ...data.ledger.map((e) => ledgerStatement(db, e)),
    ...data.reviews.map((r) => reviewStatement(db, r)),
    metaStatement(db, "shop", JSON.stringify(data.shop)),
    metaStatement(db, "data_mode", "real"),
    metaStatement(db, "receipts_cursor", String(data.receiptsCursor)),
    metaStatement(db, "ledger_cursor", String(data.ledgerCursor)),
  ];
  await runBatches(db, statements);
}

export interface SyncResult {
  ok: boolean;
  message: string;
}

/** The whole pull: read from Etsy, save, and record how it went. Never throws. */
export async function runSync(env: Env, now: number, timeZone: string): Promise<SyncResult> {
  let result: SyncResult;
  try {
    if (!env.ETSY_KEYSTRING) throw new Error("The ETSY_KEYSTRING secret is not set in Cloudflare.");

    const metaRows = await env.DB.prepare(`SELECT key, value FROM meta WHERE key IN ('data_mode', 'receipts_cursor', 'ledger_cursor')`).all<{ key: string; value: string }>();
    const meta = new Map(metaRows.results.map((r) => [r.key, r.value]));
    const wasSample = meta.get("data_mode") !== "real";
    const cursor = (key: string): number | null => (wasSample || !meta.has(key) ? null : Number(meta.get(key)));

    const client = new EtsyClient({
      keystring: env.ETSY_KEYSTRING,
      sharedSecret: env.ETSY_SHARED_SECRET,
      baseUrl: env.ETSY_API_BASE,
      getToken: (force) => getAccessToken(env, force),
    });
    const data = await fetchFromEtsy(client, env.ETSY_SHOP_ID, { receipts: cursor("receipts_cursor"), ledger: cursor("ledger_cursor") }, now);
    await saveToDatabase(env.DB, data, now, wasSample, timeZone);

    const summary = `Read ${data.listings.length} listings, ${data.receipts.length} orders, ${data.ledger.length} bill lines and ${data.reviews.length} reviews using ${client.requestCount} Etsy requests.`;
    result = { ok: true, message: [summary, ...data.notes].join(" ") };
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  // Record the outcome so the Settings screen can show it.
  try {
    await env.DB.batch([
      metaStatement(env.DB, "last_sync_at", String(now)),
      metaStatement(env.DB, "last_sync_ok", result.ok ? "1" : "0"),
      metaStatement(env.DB, "last_sync_message", result.message),
    ]);
  } catch {
    // If even this fails there is nothing more we can do here.
  }
  return result;
}

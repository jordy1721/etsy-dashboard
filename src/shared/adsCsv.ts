// ---------------------------------------------------------------------------
// ETSY ADS CSV IMPORT
// Reads a CSV downloaded from Etsy > Marketing > Etsy Ads and turns it into
// weekly ad numbers (whole shop, and per listing when the file has listings).
//
// Etsy does not publish this file's format, so the reader:
//  - finds columns by NAME, not position (Views, Clicks, Orders, Revenue, Spend...)
//  - copes with extra lines above the header row
//  - adds daily rows up into weeks (Monday to Sunday)
//  - if the file has no dates at all, puts everything into one week you choose
//  - explains in plain words what it could not read
// ---------------------------------------------------------------------------

import type { AdStat } from "./ads";
import { CsvError, parseCsv, parseDateCell } from "./csv";
import { isDay, weekStart } from "./dates";

export interface AdsCsvWeek {
  weekStart: string;
  /** Whole-shop totals for the week. */
  shop: AdStat;
  /** Ad spend for the week, or null when the file has no spend column. */
  spendCents: number | null;
  listings: AdStat[];
}

export interface AdsCsvResult {
  weeks: AdsCsvWeek[];
  columnsUsed: string[];
  skippedRows: number;
  /** Listing names in the file that match no listing in the shop. */
  unmatchedListings: string[];
  /** True when the file had no dates and everything went into the chosen week. */
  usedChosenWeek: boolean;
  hasListings: boolean;
}

type ColumnKey = "date" | "listingId" | "title" | "views" | "clicks" | "orders" | "revenue" | "spend";

/** Words that mark a column as a ratio (click rate, cost per click, ROAS...), which we never add up. */
const RATIO_WORDS = /\bper\b|rate|ratio|roas|%|average|avg|ctr|cpc/;

const COLUMN_RULES: { key: ColumnKey; test: (h: string) => boolean }[] = [
  { key: "date", test: (h) => /\b(date|day)\b/.test(h) && !/range/.test(h) },
  { key: "listingId", test: (h) => /listing\s*id|\blisting_id\b/.test(h) },
  { key: "title", test: (h) => /\b(listing|title|item|product)\b/.test(h) && !/id\b/.test(h) && !RATIO_WORDS.test(h) && !/view|click|order|revenue|sales|spen|cost|budget/.test(h) },
  { key: "views", test: (h) => /view|impression/.test(h) && !RATIO_WORDS.test(h) },
  { key: "clicks", test: (h) => /click/.test(h) && !RATIO_WORDS.test(h) },
  { key: "orders", test: (h) => /order|purchase/.test(h) && !RATIO_WORDS.test(h) && !/value|revenue|sales/.test(h) },
  { key: "revenue", test: (h) => /revenue|sales/.test(h) && !RATIO_WORDS.test(h) },
  { key: "spend", test: (h) => /spen[dt]|cost/.test(h) && !RATIO_WORDS.test(h) && !/budget/.test(h) },
];

/** Match each header cell to the kind of column it is. First match wins. */
export function mapAdColumns(header: string[]): Partial<Record<ColumnKey, number>> {
  const found: Partial<Record<ColumnKey, number>> = {};
  header.forEach((cell, index) => {
    const h = cell.trim().toLowerCase();
    if (h === "") return;
    for (const rule of COLUMN_RULES) {
      if (found[rule.key] === undefined && rule.test(h)) {
        found[rule.key] = index;
        return;
      }
    }
  });
  return found;
}

/** Does this CSV text look like an Etsy Ads export (it has Clicks or Spend columns)? */
export function looksLikeAdsCsv(text: string): boolean {
  return findHeader(parseCsv(text.slice(0, 20_000))) !== null;
}

/** The header is the first of the top 15 rows that has ad columns in it. */
function findHeader(table: string[][]): { index: number; columns: Partial<Record<ColumnKey, number>> } | null {
  for (let i = 0; i < Math.min(15, table.length); i++) {
    const columns = mapAdColumns(table[i] ?? []);
    if (columns.clicks !== undefined || columns.spend !== undefined) return { index: i, columns };
  }
  return null;
}

/** "1,234" -> 1234. Empty or not a number -> null. */
function parseCount(cell: string | undefined): number | null {
  const t = (cell ?? "").replace(/[,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** "A$12.50", "US$ 1,234.5", "12.5" -> cents. Empty or not a number -> null. */
export function parseMoneyCell(cell: string | undefined): number | null {
  const t = (cell ?? "").replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Find the shop listing a row is about, by ID if the file has one, otherwise by title. */
function matchListing(idCell: string | undefined, titleCell: string | undefined, listings: { listingId: number; title: string }[]): number | null {
  const id = Number((idCell ?? "").replace(/\D/g, ""));
  if (id > 0 && listings.some((l) => l.listingId === id)) return id;
  const title = norm(titleCell ?? "");
  if (title === "") return null;
  const exact = listings.find((l) => norm(l.title) === title);
  if (exact) return exact.listingId;
  // Etsy sometimes cuts long titles short, so accept "starts with" either way round.
  const partial = listings.filter((l) => norm(l.title).startsWith(title) || title.startsWith(norm(l.title)));
  return partial.length === 1 ? (partial[0]?.listingId ?? null) : null;
}

/** Add b into a, keeping "unknown" (null) only while neither side has a number. */
const add = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

export function parseAdsCsv(
  text: string,
  options: { listings: { listingId: number; title: string }[]; chosenWeek?: string },
): AdsCsvResult {
  if (text.trim() === "") throw new CsvError("The file is empty.");
  if (text.length > 2_000_000) throw new CsvError("The file is too big (over 2 MB). Is this the Etsy Ads CSV?");
  const table = parseCsv(text);
  const head = findHeader(table);
  if (!head) {
    const first = (table[0] ?? []).filter((c) => c.trim() !== "").join(", ") || "(none)";
    throw new CsvError(`This does not look like an Etsy Ads file: no "Clicks" or "Spend" column was found. Columns in your file: ${first}.`);
  }
  const col = head.columns;
  const header = table[head.index] ?? [];
  const rows = table.slice(head.index + 1);
  if (rows.length === 0) throw new CsvError("The file has column names but no rows of numbers.");

  const hasDates = col.date !== undefined && rows.some((r) => parseDateCell(r[col.date ?? -1] ?? "") !== null);
  const hasListings = col.title !== undefined || col.listingId !== undefined;
  let fallbackWeek: string | null = null;
  if (!hasDates) {
    if (!isDay(options.chosenWeek)) {
      throw new CsvError("This file has no dates in it, so the app cannot tell which week it covers. Pick the week on the Ads screen and upload it there.");
    }
    fallbackWeek = weekStart(options.chosenWeek);
  }

  const cell = (r: string[], key: ColumnKey) => (col[key] === undefined ? undefined : r[col[key] ?? -1]);
  const weeks = new Map<string, { shop: AdStat; listings: Map<number, AdStat> }>();
  const unmatched = new Set<string>();
  let skipped = 0;

  for (const r of rows) {
    const ws = hasDates ? (() => {
      const day = parseDateCell(cell(r, "date") ?? "");
      return day ? weekStart(day) : null;
    })() : fallbackWeek;
    const nums = {
      views: parseCount(cell(r, "views")),
      clicks: parseCount(cell(r, "clicks")),
      orders: parseCount(cell(r, "orders")),
      revenueCents: parseMoneyCell(cell(r, "revenue")),
      spendCents: parseMoneyCell(cell(r, "spend")),
    };
    const titleText = (cell(r, "title") ?? "").trim();
    // Skip rows without a week, without numbers, and "Total" summary rows (they would double the sums).
    if (!ws || Object.values(nums).every((v) => v === null) || /^(grand )?totals?$/i.test(titleText) || /^(grand )?totals?$/i.test((r[0] ?? "").trim())) {
      skipped++;
      continue;
    }

    const week = weeks.get(ws) ?? {
      shop: { weekStart: ws, listingId: 0, views: null, clicks: null, orders: null, revenueCents: null, spendCents: null },
      listings: new Map<number, AdStat>(),
    };
    weeks.set(ws, week);
    const addInto = (target: AdStat) => {
      target.views = add(target.views, nums.views);
      target.clicks = add(target.clicks, nums.clicks);
      target.orders = add(target.orders, nums.orders);
      target.revenueCents = add(target.revenueCents, nums.revenueCents);
      target.spendCents = add(target.spendCents, nums.spendCents);
    };
    addInto(week.shop);

    if (hasListings) {
      const listingId = matchListing(cell(r, "listingId"), titleText, options.listings);
      if (listingId === null) {
        if (titleText !== "") unmatched.add(titleText);
      } else {
        const row = week.listings.get(listingId) ?? { weekStart: ws, listingId, views: null, clicks: null, orders: null, revenueCents: null, spendCents: null };
        addInto(row);
        week.listings.set(listingId, row);
      }
    }
  }

  if (weeks.size === 0) {
    throw new CsvError(`Found the columns (${header.filter((h) => h.trim() !== "").join(", ")}) but no rows with numbers that could be read.`);
  }

  const used = (Object.keys(col) as ColumnKey[]).map((k) => (header[col[k] ?? -1] ?? "").trim()).filter((h) => h !== "");
  return {
    weeks: [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ws, w]) => {
        const spendCents = w.shop.spendCents;
        // Whole-shop spend is stored with the weekly numbers, not on the stat row.
        return { weekStart: ws, shop: { ...w.shop, spendCents: null }, spendCents, listings: [...w.listings.values()] };
      }),
    columnsUsed: used,
    skippedRows: skipped,
    unmatchedListings: [...unmatched].slice(0, 20),
    usedChosenWeek: !hasDates,
    hasListings,
  };
}

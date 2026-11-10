// ---------------------------------------------------------------------------
// ETSY STATS CSV PARSER
// Reads the CSV file you can download from Etsy's Stats page and pulls out
// one row per day: visits, views, orders, revenue.
// Etsy does not publish the exact format, so this parser looks for column
// NAMES (not positions) and gives a clear error if it cannot find them.
// ---------------------------------------------------------------------------

import { isDay } from "./dates";
import { parseDollarsToCents } from "./money";
import type { DailyStat } from "./types";

export class CsvError extends Error {}

/** Split CSV text into rows of cells. Handles quotes and commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  // Some files start with an invisible "BOM" character (code 0xFEFF). Remove it.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Understand a few common date styles and return "YYYY-MM-DD", or null. */
export function parseDateCell(cell: string): string | null {
  const t = cell.trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) {
    const day = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
    return isDay(day) ? day : null;
  }
  // 10 Nov 2026  or  Nov 10, 2026
  m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*,?\s+(\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS[(m[2] ?? "").toLowerCase()];
    if (!month) return null;
    const day = `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`;
    return isDay(day) ? day : null;
  }
  m = /^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS[(m[1] ?? "").toLowerCase()];
    if (!month) return null;
    const day = `${m[3]}-${pad(month)}-${pad(Number(m[2]))}`;
    return isDay(day) ? day : null;
  }
  // 10/11/2026 - Australian order: day/month/year
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const day = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    return isDay(day) ? day : null;
  }
  return null;
}

function parseCount(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const t = cell.replace(/[,\s]/g, "");
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : null;
}

export interface StatsCsvResult {
  rows: DailyStat[];
  /** Which columns we used, so the screen can confirm it. */
  columnsUsed: string[];
  skippedRows: number;
}

/**
 * Parse an Etsy Stats CSV into one row per day.
 * Throws CsvError with a plain-English message when the file is not usable.
 */
export function parseStatsCsv(text: string): StatsCsvResult {
  if (text.trim() === "") throw new CsvError("The file is empty.");
  if (text.length > 2_000_000) throw new CsvError("The file is too big (over 2 MB). Is this the Stats CSV?");
  const table = parseCsv(text);
  if (table.length < 2) throw new CsvError("The file has a header but no data rows.");

  const header = (table[0] ?? []).map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());
  const find = (...needles: string[]) => lower.findIndex((h) => needles.some((n) => h === n || h.includes(n)));

  const dateCol = find("date", "day");
  const visitsCol = find("visits", "visit");
  const viewsCol = find("views", "view");
  const ordersCol = find("orders", "order");
  const revenueCol = find("revenue", "sales");

  const foundList = header.filter((h) => h !== "").join(", ") || "(none)";
  if (dateCol === -1) {
    throw new CsvError(
      `No "Date" column found. This needs a CSV with one row per day. Columns in your file: ${foundList}.`,
    );
  }
  if (visitsCol === -1 && viewsCol === -1 && ordersCol === -1 && revenueCol === -1) {
    throw new CsvError(
      `No "Visits", "Views", "Orders" or "Revenue" column found. Columns in your file: ${foundList}.`,
    );
  }

  const byDay = new Map<string, DailyStat>();
  let skipped = 0;
  for (const cells of table.slice(1)) {
    const day = parseDateCell(cells[dateCol] ?? "");
    if (!day) {
      skipped++;
      continue;
    }
    const revenueText = revenueCol === -1 ? "" : (cells[revenueCol] ?? "");
    byDay.set(day, {
      day,
      visits: visitsCol === -1 ? null : parseCount(cells[visitsCol]),
      views: viewsCol === -1 ? null : parseCount(cells[viewsCol]),
      orders: ordersCol === -1 ? null : parseCount(cells[ordersCol]),
      revenueCents: revenueText.trim() === "" ? null : parseDollarsToCents(revenueText.replace(/[^0-9.,-]/g, "")),
    });
  }
  if (byDay.size === 0) {
    throw new CsvError(
      `Found a "${header[dateCol]}" column but could not read any dates in it. Expected dates like 2026-11-10 or 10 Nov 2026.`,
    );
  }

  const used = [dateCol, visitsCol, viewsCol, ordersCol, revenueCol].filter((i) => i !== -1).map((i) => header[i] ?? "");
  return { rows: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)), columnsUsed: used, skippedRows: skipped };
}

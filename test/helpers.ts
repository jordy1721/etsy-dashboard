// Small builders so each test only states the numbers it cares about.
import { computeMetrics, type MetricsInput } from "../src/shared/metrics";
import { buildSuggestions, type SuggestionContext } from "../src/shared/suggestions";
import { DEFAULT_SETTINGS, type LedgerEntry, type Listing, type Receipt } from "../src/shared/types";

/** Midday UTC on 10 Nov 2026 = 10 Nov in Sydney too. */
export const NOW = Math.floor(Date.parse("2026-11-10T02:00:00Z") / 1000);
export const DAY = 86_400;

export function listing(over: Partial<Listing> = {}): Listing {
  return {
    listingId: 1,
    title: "Test Listing",
    description: "A plain description.",
    state: "active",
    url: "",
    priceCents: 1299,
    currency: "AUD",
    quantity: 10,
    views: 100,
    favorites: 0,
    tags: ["one a", "two b", "three c", "four d", "five e", "six f", "seven g", "eight h", "nine i", "ten j", "eleven k", "twelve l", "thirteen m"],
    createdTs: NOW - 30 * DAY,
    ...over,
  };
}

let nextId = 1000;
export function receipt(over: Partial<Receipt> & { listingId?: number; priceCents?: number; quantity?: number } = {}): Receipt {
  const receiptId = over.receiptId ?? nextId++;
  const price = over.priceCents ?? 390;
  const quantity = over.quantity ?? 1;
  const total = over.totalPriceCents ?? price * quantity;
  const discount = over.discountCents ?? 0;
  return {
    receiptId,
    createdTs: NOW - 2 * DAY,
    status: "Completed",
    countryIso: "US",
    currency: "AUD",
    totalPriceCents: total,
    discountCents: discount,
    subtotalCents: total - discount,
    shippingCents: 0,
    taxCents: 0,
    vatCents: 0,
    grandtotalCents: total - discount,
    transactions: [
      { transactionId: receiptId + 500_000, receiptId, listingId: over.listingId ?? 1, title: "Test Listing", quantity, priceCents: price },
    ],
    ...over,
  };
}

export function ledgerLine(over: Partial<LedgerEntry>): LedgerEntry {
  return {
    entryId: nextId++,
    createdTs: NOW - 2 * DAY,
    amountCents: 0,
    currency: "AUD",
    description: "",
    ledgerType: "",
    referenceType: "",
    referenceId: "",
    ...over,
  };
}

export function input(over: Partial<MetricsInput> = {}): MetricsInput {
  return {
    now: NOW,
    shop: null,
    listings: [listing()],
    snapshots: [],
    receipts: [],
    ledger: [],
    weekly: [],
    costs: [],
    dailyStats: [],
    settings: DEFAULT_SETTINGS,
    ...over,
  };
}

/** Run the metrics and build the context the suggestion rules need. */
export function context(over: Partial<MetricsInput> = {}, reviewCount = 0): SuggestionContext {
  const inp = input(over);
  const m = computeMetrics(inp);
  return {
    today: m.today,
    listings: inp.listings,
    rows: m.listings,
    sales: m.sales,
    money: m.money,
    thisWeek: m.thisWeek,
    weekly: inp.weekly,
    reviewCount,
    settings: inp.settings,
  };
}

export { buildSuggestions };

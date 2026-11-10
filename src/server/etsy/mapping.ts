// ---------------------------------------------------------------------------
// ETSY -> OUR ROWS
// Turns Etsy's JSON into the simple rows we store. Buyer names, emails and
// addresses are dropped HERE and never reach the database.
// These functions are pure, so they are tested against example responses.
// ---------------------------------------------------------------------------

import { etsyMoneyToCents, type EtsyMoney } from "../../shared/money";
import type { LedgerEntry, Listing, Receipt, Review, ShopInfo } from "../../shared/types";

type Json = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const money = (v: unknown): number => etsyMoneyToCents(v as EtsyMoney | null | undefined);
/** Etsy has renamed timestamp fields over time, so accept any of the known names. */
const firstNum = (o: Json, ...keys: string[]): number => {
  for (const k of keys) if (typeof o[k] === "number") return o[k];
  return 0;
};

export function mapShop(j: Json): ShopInfo {
  return {
    shopId: num(j.shop_id),
    shopName: str(j.shop_name),
    currency: str(j.currency_code) || "AUD",
    createdTs: firstNum(j, "created_timestamp", "create_date"),
    numFavorers: num(j.num_favorers),
    reviewCount: num(j.review_count),
    reviewAverage: typeof j.review_average === "number" ? j.review_average : null,
    soldCount: num(j.transaction_sold_count),
    activeListings: num(j.listing_active_count),
  };
}

export function mapListing(j: Json): Listing {
  const price = j.price as (EtsyMoney & { currency_code?: string }) | undefined;
  return {
    listingId: num(j.listing_id),
    title: str(j.title),
    description: str(j.description),
    state: str(j.state) || "active",
    url: str(j.url),
    priceCents: money(price),
    currency: str(price?.currency_code) || "AUD",
    quantity: num(j.quantity),
    views: num(j.views),
    favorites: num(j.num_favorers),
    tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
    createdTs: firstNum(j, "original_creation_timestamp", "creation_timestamp", "created_timestamp"),
  };
}

export function mapReceipt(j: Json): Receipt {
  const receiptId = num(j.receipt_id);
  const grand = j.grandtotal as { currency_code?: string } | undefined;
  const lines = Array.isArray(j.transactions) ? (j.transactions as Json[]) : [];
  return {
    receiptId,
    createdTs: firstNum(j, "created_timestamp", "create_timestamp"),
    status: str(j.status),
    // The ONLY buyer detail we keep.
    countryIso: str(j.country_iso).toUpperCase(),
    currency: str(grand?.currency_code) || "AUD",
    totalPriceCents: money(j.total_price),
    discountCents: money(j.discount_amt),
    subtotalCents: money(j.subtotal),
    shippingCents: money(j.total_shipping_cost),
    taxCents: money(j.total_tax_cost),
    vatCents: money(j.total_vat_cost),
    grandtotalCents: money(j.grandtotal),
    transactions: lines.map((t) => ({
      transactionId: num(t.transaction_id),
      receiptId,
      listingId: num(t.listing_id),
      title: str(t.title),
      quantity: Math.max(1, num(t.quantity)),
      priceCents: money(t.price),
    })),
  };
}

export function mapLedgerEntry(j: Json): LedgerEntry {
  // Ledger amounts are whole numbers in the smallest unit (cents). Just in
  // case Etsy ever sends {amount, divisor} here too, handle that as well.
  const amount = typeof j.amount === "object" && j.amount !== null ? money(j.amount) : Math.round(num(j.amount));
  return {
    entryId: num(j.entry_id),
    createdTs: firstNum(j, "created_timestamp", "create_date"),
    amountCents: amount,
    currency: str(j.currency) || "AUD",
    description: str(j.description),
    ledgerType: str(j.ledger_type),
    referenceType: str(j.reference_type),
    referenceId: str(j.reference_id),
  };
}

export function mapReview(j: Json): Review {
  return {
    transactionId: num(j.transaction_id),
    listingId: num(j.listing_id),
    rating: num(j.rating),
    createdTs: firstNum(j, "created_timestamp", "create_timestamp"),
  };
}

// ---------------------------------------------------------------------------
// FEES
// 1) Sort Etsy ledger ("bill") lines into plain categories.
// 2) Work out the real revenue of an order (no tax, no VAT, no shipping).
// 3) Estimate Etsy's fees for an order when the bill does not tell us.
// ---------------------------------------------------------------------------

import { percentOf } from "./money";
import type { LedgerEntry, Receipt, Settings } from "./types";

export type LedgerCategory =
  | "sale" // money in from a sale
  | "transaction_fee"
  | "processing_fee"
  | "listing_fee"
  | "fee_tax" // GST/VAT that Etsy charges on its own fees
  | "ads" // PROBABLE Etsy Ads / Offsite Ads lines
  | "refund"
  | "payout" // money sent to the bank
  | "tax_other" // sales tax / VAT passing through
  | "other";

/** Categories that count as "Etsy fees" on the Money screen. */
export const FEE_CATEGORIES: LedgerCategory[] = ["transaction_fee", "processing_fee", "listing_fee", "fee_tax"];

export const CATEGORY_LABELS: Record<LedgerCategory, string> = {
  sale: "Sales",
  transaction_fee: "Transaction fees",
  processing_fee: "Payment processing fees",
  listing_fee: "Listing and renewal fees",
  fee_tax: "Tax on Etsy fees (GST/VAT)",
  ads: "Probable ad fees",
  refund: "Refunds",
  payout: "Payouts to bank",
  tax_other: "Tax passing through",
  other: "Other lines",
};

/**
 * Decide what a ledger line is, by looking for key words in its type and
 * description. Etsy does not publish a fixed list of types, so this is a
 * careful best guess. Anything we do not recognise becomes "other" and is
 * shown on the Money screen so nothing is hidden.
 */
export function classifyLedgerEntry(entry: Pick<LedgerEntry, "ledgerType" | "description" | "amountCents">): LedgerCategory {
  const text = `${entry.ledgerType} ${entry.description}`.toLowerCase().replace(/[_-]+/g, " ");
  const has = (re: RegExp) => re.test(text);

  // Order matters: the most specific checks come first.
  if (has(/prolist|promoted|etsy ads|offsite ads|onsite ads|advertis|\bads?\b/)) return "ads";
  if (has(/refund/)) return "refund";
  if (has(/disburse|payout|deposit(?! fee)|bank transfer/)) return "payout";
  if (has(/processing/)) return "processing_fee";
  if (has(/\b(vat|gst|tax)\b/)) {
    // Tax charged on Etsy's own fees mentions fees / seller services.
    if (has(/fee|seller|service|listing|transaction|renew/)) return "fee_tax";
    return "tax_other";
  }
  if (has(/listing|renew/)) return "listing_fee";
  if (has(/transaction|shipping fee/)) return "transaction_fee";
  if (has(/payment|sale|order/) && entry.amountCents > 0) return "sale";
  return "other";
}

/**
 * Revenue for one order = what buyers paid for the ITEMS after discounts.
 * It never includes sales tax, VAT or shipping.
 *
 * Etsy documents "subtotal" as total_price minus coupon discounts. To be safe
 * we also work it out ourselves (total_price - discount_amt) and use the
 * LOWER of the two, so a discount can never be counted as income.
 */
export function receiptRevenueCents(r: Pick<Receipt, "totalPriceCents" | "discountCents" | "subtotalCents">): number {
  const computed = Math.max(0, r.totalPriceCents - r.discountCents);
  if (r.subtotalCents > 0 && r.subtotalCents < computed) return r.subtotalCents;
  // If Etsy sent no total_price at all, fall back to its subtotal.
  if (r.totalPriceCents === 0 && r.subtotalCents > 0) return r.subtotalCents;
  return computed;
}

/** Money Etsy collected for someone else: tax and VAT (shipping is listed separately). */
export function receiptTaxCollectedCents(r: Pick<Receipt, "taxCents" | "vatCents">): number {
  return r.taxCents + r.vatCents;
}

export interface FeeParts {
  transaction: number;
  processing: number;
  listing: number;
  feeTax: number;
}

/**
 * ESTIMATE the fees for one order using the fee settings.
 *  - transaction fee: % of (items after discount + shipping)
 *  - processing fee:  % of everything the buyer paid (items + shipping + tax + VAT) + a fixed amount
 *  - listing fee:     one renewal fee per item sold
 *  - fee tax:         GST/VAT on top of those fees
 */
export function estimateReceiptFees(
  r: Pick<Receipt, "shippingCents" | "taxCents" | "vatCents">,
  revenueCents: number,
  itemCount: number,
  s: Settings,
): FeeParts {
  const transaction = percentOf(revenueCents + r.shippingCents, s.transactionFeePct);
  const buyerPaid = revenueCents + r.shippingCents + r.taxCents + r.vatCents;
  const processing = percentOf(buyerPaid, s.processingPct) + s.processingFixedCents;
  const listing = s.listingFeeCents * Math.max(1, itemCount);
  const feeTax = percentOf(transaction + processing + listing, s.feeTaxPct);
  return { transaction, processing, listing, feeTax };
}

export function feePartsTotal(p: FeeParts): number {
  return p.transaction + p.processing + p.listing + p.feeTax;
}

/**
 * The lowest price at which a sale still earns `targetProfitCents`
 * after Etsy fees and this sale's share of ads and costs.
 *
 *   price - fees(price) - overhead = target
 * where fees(price) = (price x (transaction% + processing%) + fixed fees) x (1 + feeTax%)
 */
export function priceForTargetProfit(targetProfitCents: number, overheadPerSaleCents: number, s: Settings): number {
  const taxFactor = 1 + s.feeTaxPct / 100;
  const pctPart = ((s.transactionFeePct + s.processingPct) / 100) * taxFactor;
  const fixedPart = (s.processingFixedCents + s.listingFeeCents) * taxFactor;
  if (pctPart >= 1) return Number.MAX_SAFE_INTEGER; // fees eat everything; no price works
  return Math.ceil((targetProfitCents + overheadPerSaleCents + fixedPart) / (1 - pctPart));
}

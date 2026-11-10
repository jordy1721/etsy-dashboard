import { describe, expect, it } from "vitest";
import { classifyLedgerEntry, estimateReceiptFees, feePartsTotal, priceForTargetProfit, receiptRevenueCents, receiptTaxCollectedCents } from "../src/shared/fees";
import { DEFAULT_SETTINGS } from "../src/shared/types";

const line = (ledgerType: string, description: string, amountCents = -10) => ({ ledgerType, description, amountCents });

describe("revenue and VAT handling", () => {
  it("revenue is the item subtotal after discounts", () => {
    expect(receiptRevenueCents({ totalPriceCents: 3999, discountCents: 2799, subtotalCents: 1200 })).toBe(1200);
    expect(receiptRevenueCents({ totalPriceCents: 390, discountCents: 0, subtotalCents: 390 })).toBe(390);
  });
  it("never counts a discount as income, even if Etsy's subtotal is before discounts", () => {
    expect(receiptRevenueCents({ totalPriceCents: 1299, discountCents: 909, subtotalCents: 1299 })).toBe(390);
  });
  it("uses the lower subtotal if Etsy reports one", () => {
    expect(receiptRevenueCents({ totalPriceCents: 1299, discountCents: 0, subtotalCents: 390 })).toBe(390);
  });
  it("falls back to the subtotal when total_price is missing", () => {
    expect(receiptRevenueCents({ totalPriceCents: 0, discountCents: 0, subtotalCents: 390 })).toBe(390);
  });
  it("a discount bigger than the price cannot make revenue negative", () => {
    expect(receiptRevenueCents({ totalPriceCents: 390, discountCents: 500, subtotalCents: 0 })).toBe(0);
  });
  it("VAT and sales tax are collected for someone else, never revenue", () => {
    expect(receiptTaxCollectedCents({ taxCents: 0, vatCents: 86 })).toBe(86);
    expect(receiptTaxCollectedCents({ taxCents: 31, vatCents: 0 })).toBe(31);
  });
});

describe("estimated Etsy fees", () => {
  it("A$3.90 sale with no tax", () => {
    const f = estimateReceiptFees({ shippingCents: 0, taxCents: 0, vatCents: 0 }, 390, 1, DEFAULT_SETTINGS);
    expect(f.transaction).toBe(25); // 6.5% of 3.90
    expect(f.processing).toBe(37); // 3% of 3.90 = 12c, plus 25c fixed
    expect(f.listing).toBe(31);
    expect(f.feeTax).toBe(9); // 10% GST on 93c of fees
    expect(feePartsTotal(f)).toBe(102);
  });
  it("processing fee is charged on the VAT too, but VAT is not revenue", () => {
    const f = estimateReceiptFees({ shippingCents: 0, taxCents: 0, vatCents: 264 }, 1200, 1, DEFAULT_SETTINGS);
    expect(f.transaction).toBe(78); // VAT not included
    expect(f.processing).toBe(69); // 3% of (12.00 + 2.64) = 44c, plus 25c
  });
  it("charges a listing fee for each item sold", () => {
    const f = estimateReceiptFees({ shippingCents: 0, taxCents: 0, vatCents: 0 }, 780, 2, DEFAULT_SETTINGS);
    expect(f.listing).toBe(62);
  });
});

describe("break-even price", () => {
  it("earns exactly the target (within a cent) at the price it returns", () => {
    for (const [target, overhead] of [[0, 0], [200, 0], [200, 150], [0, 321]] as const) {
      const price = priceForTargetProfit(target, overhead, DEFAULT_SETTINGS);
      const fees = feePartsTotal(estimateReceiptFees({ shippingCents: 0, taxCents: 0, vatCents: 0 }, price, 1, DEFAULT_SETTINGS));
      const profit = price - fees - overhead;
      expect(profit).toBeGreaterThanOrEqual(target - 1);
      expect(profit).toBeLessThanOrEqual(target + 3);
    }
  });
  it("needs a higher price when ads and costs per sale are higher", () => {
    expect(priceForTargetProfit(0, 300, DEFAULT_SETTINGS)).toBeGreaterThan(priceForTargetProfit(0, 0, DEFAULT_SETTINGS));
  });
});

describe("ledger line sorting", () => {
  it("recognises the common fee lines", () => {
    expect(classifyLedgerEntry(line("transaction", "Transaction fee"))).toBe("transaction_fee");
    expect(classifyLedgerEntry(line("transaction_quantity", ""))).toBe("transaction_fee");
    expect(classifyLedgerEntry(line("PAYMENT_PROCESSING_FEE", "Processing fee"))).toBe("processing_fee");
    expect(classifyLedgerEntry(line("listing", "Listing fee"))).toBe("listing_fee");
    expect(classifyLedgerEntry(line("renew_sold_auto", ""))).toBe("listing_fee");
    expect(classifyLedgerEntry(line("vat_seller_services", "GST on seller fees"))).toBe("fee_tax");
  });
  it("labels ad-looking lines as probable ads", () => {
    expect(classifyLedgerEntry(line("prolist", ""))).toBe("ads");
    expect(classifyLedgerEntry(line("", "Etsy Ads"))).toBe("ads");
    expect(classifyLedgerEntry(line("offsite_ads_fee", "Offsite Ads fee"))).toBe("ads");
  });
  it("does not mistake other words for ads", () => {
    expect(classifyLedgerEntry(line("", "Download fee"))).toBe("other");
    expect(classifyLedgerEntry(line("", "Address change"))).toBe("other");
  });
  it("recognises money in, payouts and refunds", () => {
    expect(classifyLedgerEntry(line("PAYMENT_GROSS", "Sale", 390))).toBe("sale");
    expect(classifyLedgerEntry(line("DISBURSE2", "Payout to bank account", -2500))).toBe("payout");
    expect(classifyLedgerEntry(line("REFUND", "Refund to buyer", -390))).toBe("refund");
    expect(classifyLedgerEntry(line("sales_tax", "Sales tax paid by buyer", 30))).toBe("tax_other");
  });
  it("puts anything unknown in 'other' so it stays visible", () => {
    expect(classifyLedgerEntry(line("mystery_type", "Something new"))).toBe("other");
  });
});

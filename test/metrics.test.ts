import { describe, expect, it } from "vitest";
import { addDays } from "../src/shared/dates";
import { buildAdsByDay, computeMetrics } from "../src/shared/metrics";
import { sum } from "../src/shared/money";
import { buildSampleData } from "../src/server/sample";
import { DEFAULT_SETTINGS } from "../src/shared/types";
import { DAY, NOW, input, ledgerLine, listing, receipt } from "./helpers";

describe("revenue, tax and VAT", () => {
  it("does not count VAT, sales tax or shipping as revenue", () => {
    const m = computeMetrics(
      input({
        receipts: [
          receipt({ priceCents: 1200, vatCents: 264, grandtotalCents: 1464, countryIso: "IT" }),
          receipt({ priceCents: 390, taxCents: 31, shippingCents: 100, grandtotalCents: 521 }),
        ],
      }),
    );
    expect(m.money.revenueCents).toBe(1590);
    expect(m.money.taxCollectedCents).toBe(295);
    expect(m.money.shippingCollectedCents).toBe(100);
  });

  it("takes coupon discounts off revenue and shows list price vs price paid", () => {
    const m = computeMetrics(
      input({
        listings: [listing({ priceCents: 1299 })],
        receipts: [receipt({ priceCents: 1299, discountCents: 909 })],
      }),
    );
    const sale = m.sales[0]!;
    expect(sale.paidCents).toBe(390);
    expect(sale.listCents).toBe(1299);
    expect(sale.discountPct).toBe(70);
    expect(m.money.revenueCents).toBe(390);
  });

  it("ignores cancelled orders", () => {
    const m = computeMetrics(input({ receipts: [receipt({}), receipt({ status: "Canceled" })] }));
    expect(m.money.orders).toBe(1);
  });

  it("splits a two-item order without losing a cent", () => {
    const r = receipt({ receiptId: 77, totalPriceCents: 1590, discountCents: 159 });
    r.transactions = [
      { transactionId: 1, receiptId: 77, listingId: 1, title: "A", quantity: 1, priceCents: 1200 },
      { transactionId: 2, receiptId: 77, listingId: 1, title: "B", quantity: 1, priceCents: 390 },
    ];
    const m = computeMetrics(input({ receipts: [r] }));
    expect(m.sales).toHaveLength(2);
    expect(sum(m.sales.map((x) => x.paidCents))).toBe(1431);
    expect(m.money.orders).toBe(1);
    expect(m.money.items).toBe(2);
  });
});

describe("profit per sale", () => {
  it("profit = price paid - Etsy fees - share of ads and costs", () => {
    const m = computeMetrics(
      input({
        receipts: [receipt({ priceCents: 390 }), receipt({ priceCents: 390 })],
        costs: [{ id: 1, day: "2026-11-08", kind: "tool", label: "Tool", amountCents: 100 }],
      }),
    );
    // Fees per A$3.90 sale are 102c (see fees.test.ts). Costs of 100c shared by 2 sales = 50c each.
    for (const sale of m.sales) {
      expect(sale.feesCents).toBe(102);
      expect(sale.overheadCents).toBe(50);
      expect(sale.profitCents).toBe(390 - 102 - 50);
      expect(sale.feesEstimated).toBe(true);
    }
    expect(m.money.profitCents).toBe(780 - 204 - 100);
    expect(m.money.feesSource).toBe("estimated");
  });

  it("flags sales below the minimum profit (default A$2.00)", () => {
    const m = computeMetrics(
      input({
        receipts: [receipt({ priceCents: 390 }), receipt({ priceCents: 1200 })],
        costs: [{ id: 1, day: "2026-11-08", kind: "other", label: "x", amountCents: 300 }],
      }),
    );
    const cheap = m.sales.find((x) => x.paidCents === 390)!;
    const dear = m.sales.find((x) => x.paidCents === 1200)!;
    expect(cheap.profitCents).toBe(390 - 102 - 150);
    expect(cheap.belowMinimum).toBe(true);
    expect(dear.belowMinimum).toBe(false);
    expect(m.money.salesBelowMinimum).toBe(1);
  });

  it("respects a different minimum profit setting", () => {
    const m = computeMetrics(
      input({ receipts: [receipt({ priceCents: 390 })], settings: { ...DEFAULT_SETTINGS, minProfitCents: 500 } }),
    );
    expect(m.sales[0]!.belowMinimum).toBe(true);
  });

  it("uses real fee lines from Etsy's bill when they point at the order", () => {
    const r = receipt({ receiptId: 42, priceCents: 390 });
    const tx = String(r.transactions[0]!.transactionId);
    const m = computeMetrics(
      input({
        receipts: [r],
        ledger: [
          ledgerLine({ amountCents: -30, ledgerType: "transaction", referenceId: tx }),
          ledgerLine({ amountCents: -40, ledgerType: "PAYMENT_PROCESSING_FEE", referenceId: "42" }),
          ledgerLine({ amountCents: -31, ledgerType: "renew_sold_auto", referenceId: tx }),
          ledgerLine({ amountCents: -10, ledgerType: "vat_seller_services", description: "GST on seller fees", referenceId: "42" }),
        ],
      }),
    );
    expect(m.sales[0]!.feesCents).toBe(111);
    expect(m.sales[0]!.feesEstimated).toBe(false);
    expect(m.money.feesSource).toBe("ledger");
    expect(m.money.feesCents).toBe(111);
  });

  it("per-sale profits add up to the shop profit", () => {
    const sample = buildSampleData(NOW);
    const m = computeMetrics(
      input({ ...sample, costs: sample.costs.map((c, i) => ({ ...c, id: i + 1 })), dailyStats: [] }),
    );
    expect(sum(m.sales.map((x) => x.profitCents))).toBe(m.money.profitCents);
  });
});

describe("ads: Etsy's bill first, typed-in numbers second", () => {
  it("uses the bill for weeks that have ad lines and manual numbers for other weeks", () => {
    const { byDay, source } = buildAdsByDay(
      [{ day: "2026-11-03", amountCents: -120 }],
      [
        { weekStart: "2026-11-02", adsSpendCents: 999, visits: null, srcSearch: null, srcAds: null, srcEtsyOther: null, srcSocial: null, srcDirect: null },
        { weekStart: "2026-10-26", adsSpendCents: 700, visits: null, srcSearch: null, srcAds: null, srcEtsyOther: null, srcSocial: null, srcDirect: null },
      ],
    );
    expect(source).toBe("mixed");
    expect(byDay.get("2026-11-03")).toBe(120); // bill wins, the 999 is ignored
    expect(sum([...byDay.values()])).toBe(820);
    expect(byDay.get("2026-10-26")).toBe(100); // 700 spread over 7 days
  });

  it("reports probable ad fees found in the bill", () => {
    const m = computeMetrics(input({ ledger: [ledgerLine({ amountCents: -150, description: "Etsy Ads" })] }));
    expect(m.money.probableAdFees).toHaveLength(1);
    expect(m.money.probableAdFees[0]!.cents).toBe(150);
    expect(m.money.adsCents).toBe(150);
    expect(m.money.adsSource).toBe("ledger");
  });
});

describe("history and week-on-week numbers", () => {
  it("works out daily views from running totals", () => {
    const l = listing({ views: 30, createdTs: NOW - 40 * DAY });
    const m = computeMetrics(
      input({
        listings: [l],
        snapshots: [
          { day: "2026-11-08", listingId: 1, views: 10, favorites: 0, priceCents: 1299, quantity: 1, tags: [] },
          { day: "2026-11-09", listingId: 1, views: 18, favorites: 0, priceCents: 1299, quantity: 1, tags: [] },
          { day: "2026-11-10", listingId: 1, views: 30, favorites: 0, priceCents: 1299, quantity: 1, tags: [] },
        ],
      }),
    );
    const byDay = new Map(m.days.map((d) => [d.day, d.views]));
    expect(byDay.get("2026-11-07")).toBeNull(); // before history starts: unknown, not zero
    expect(byDay.get("2026-11-08")).toBe(0); // first snapshot of an old listing: views not attributable
    expect(byDay.get("2026-11-09")).toBe(8);
    expect(byDay.get("2026-11-10")).toBe(12);
    expect(m.thisWeek.views).toBeNull(); // not a full week of history -> missing, not invented
  });

  it("compares the last 7 days with the 7 days before", () => {
    const m = computeMetrics(
      input({
        receipts: [
          receipt({ priceCents: 1200, createdTs: NOW - 1 * DAY }),
          receipt({ priceCents: 390, createdTs: NOW - 9 * DAY }),
        ],
      }),
    );
    expect(m.thisWeek.revenueCents).toBe(1200);
    expect(m.lastWeek.revenueCents).toBe(390);
    expect(m.thisWeek.from).toBe(addDays(m.today, -6));
    expect(m.thisWeek.conversionBasis).toBe("none"); // no visits, no view history
    expect(m.thisWeek.conversionPct).toBeNull();
  });

  it("uses typed-in visits for conversion when the whole week is covered", () => {
    const week = (weekStart: string, visits: number) => ({
      weekStart, visits, adsSpendCents: null, srcSearch: null, srcAds: null, srcEtsyOther: null, srcSocial: null, srcDirect: null,
    });
    const m = computeMetrics(
      input({
        receipts: [receipt({ createdTs: NOW - 1 * DAY })],
        weekly: [week("2026-11-02", 70), week("2026-11-09", 70)],
      }),
    );
    expect(m.thisWeek.visits).toBe(70);
    expect(m.thisWeek.conversionBasis).toBe("visits");
    expect(m.thisWeek.conversionPct).toBe(1.4);
  });
});

describe("sample data matches the real shop facts", () => {
  const sample = buildSampleData(NOW);
  const m = computeMetrics(input({ ...sample, costs: sample.costs.map((c, i) => ({ ...c, id: i + 1 })) }));

  it("has 5 listings, 174 views and 11 sales", () => {
    expect(m.listings).toHaveLength(5);
    expect(sum(m.listings.map((l) => l.views))).toBe(174);
    expect(m.money.orders).toBe(11);
    expect(sum(m.listings.map((l) => l.sales))).toBe(11);
  });
  it("every sale was at about 70% off", () => {
    for (const s of m.sales) expect(s.discountPct).toBeCloseTo(70, 0);
    expect(m.money.revenueCents).toBe(5 * 1200 + 6 * 390);
  });
  it("buyers are in the right countries", () => {
    const by = Object.fromEntries(m.countries.map((c) => [c.country, c.orders]));
    expect(by).toEqual({ IT: 4, US: 3, DE: 1, RO: 1, SE: 1, ES: 1 });
  });
  it("labels the listings sensibly", () => {
    const status = Object.fromEntries(m.listings.map((l) => [l.listingId, l.status]));
    expect(status[4594983295]).toBe("Working");
    expect(status[4594399190]).toBe("Working");
    expect(status[4595002480]).toBe("Needs traffic");
    expect(status[4611933994]).toBe("Not enough data yet");
  });
  it("contains no buyer names, emails or addresses", () => {
    // Orders carry a country code only. Check the order rows have no personal fields at all.
    expect(JSON.stringify(sample.receipts)).not.toMatch(/@|name|street|address|email|city|zip/i);
    const allowed = ["receiptId", "createdTs", "status", "countryIso", "currency", "totalPriceCents", "discountCents",
      "subtotalCents", "shippingCents", "taxCents", "vatCents", "grandtotalCents", "transactions"];
    for (const r of sample.receipts) expect(Object.keys(r).sort()).toEqual([...allowed].sort());
  });
});

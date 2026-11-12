import { describe, expect, it } from "vitest";
import { adTotals, adVerdict, adsByListing, breakEvenRoas, buildAdsWeeks, totalAds, weeksInRange, type AdStat } from "../src/shared/ads";
import { buildSampleData } from "../src/server/sample";
import { ruleAdListingNoOrders, ruleAdLowClickRate, ruleAdsLosingMoney, ruleAdsNoNumbers } from "../src/shared/suggestions";
import type { AdsData, WeeklyManual } from "../src/shared/types";
import { NOW, context } from "./helpers";

const week = (weekStart: string, adsSpendCents: number | null): WeeklyManual => ({
  weekStart, adsSpendCents, visits: null, srcSearch: null, srcAds: null, srcEtsyOther: null, srcSocial: null, srcDirect: null,
});
const stat = (weekStart: string, listingId: number, views: number | null, clicks: number | null, orders: number | null, revenueCents: number | null, spendCents: number | null = null): AdStat => ({
  weekStart, listingId, views, clicks, orders, revenueCents, spendCents,
});
/** Build the ads data the rules read, from typed spend and stats. Today in these tests is Tue 10 Nov 2026. */
function adsData(weekly: WeeklyManual[], stats: AdStat[], feeSharePct = 20): AdsData {
  return { weeks: buildAdsWeeks([], weekly, stats), listingStats: stats.filter((s) => s.listingId !== 0), feeSharePct, breakEvenRoas: breakEvenRoas(feeSharePct) };
}

describe("ad ratios", () => {
  const t = adTotals({ weeks: 1, spendCents: 1000, views: 500, clicks: 20, orders: 2, revenueCents: 2400 }, 20);
  it("click rate = clicks per 100 views", () => expect(t.clickRatePct).toBe(4));
  it("ROAS = ad revenue divided by ad spend", () => expect(t.roas).toBe(2.4));
  it("cost per click and per order", () => {
    expect(t.costPerClickCents).toBe(50);
    expect(t.costPerOrderCents).toBe(500);
  });
  it("profit after ads = revenue minus Etsy's share minus spend", () => {
    expect(t.profitCents).toBe(2400 * 0.8 - 1000);
  });
  it("shows unknown, not zero, when numbers are missing", () => {
    const blank = adTotals({ weeks: 1, spendCents: 1000, views: null, clicks: null, orders: null, revenueCents: null }, 20);
    expect(blank.clickRatePct).toBeNull();
    expect(blank.roas).toBeNull();
    expect(blank.profitCents).toBeNull();
    expect(blank.costPerClickCents).toBeNull();
  });
  it("never divides by zero", () => {
    const zero = adTotals({ weeks: 1, spendCents: 0, views: 0, clicks: 0, orders: 0, revenueCents: 0 }, 20);
    expect(zero.clickRatePct).toBeNull();
    expect(zero.roas).toBeNull();
    expect(zero.costPerOrderCents).toBeNull();
  });
});

describe("break-even ROAS", () => {
  it("is 1.25 when Etsy keeps 20% of each sale", () => expect(breakEvenRoas(20)).toBe(1.25));
  it("is 1.00 with no fees", () => expect(breakEvenRoas(0)).toBe(1));
  it("at break-even ROAS the profit is zero", () => {
    expect(adTotals({ weeks: 1, spendCents: 800, views: null, clicks: null, orders: null, revenueCents: 1000 }, 20).profitCents).toBe(0);
  });
});

describe("weeks of ad data", () => {
  it("takes spend from Etsy's bill when it has ad lines, and typed spend otherwise", () => {
    const weeks = buildAdsWeeks(
      [{ day: "2026-11-03", amountCents: -120 }, { day: "2026-11-05", amountCents: -80 }],
      [week("2026-11-02", 999), week("2026-10-26", 700)],
      [stat("2026-11-02", 0, 400, 12, 1, 390)],
    );
    expect(weeks.map((w) => [w.weekStart, w.spendCents, w.spendSource])).toEqual([
      ["2026-10-26", 700, "typed"],
      ["2026-11-02", 200, "bill"], // the typed 999 is ignored: no double counting
    ]);
    expect(weeks[1]!.typedSpendCents).toBe(999);
    expect(weeks[1]!.clicks).toBe(12);
    expect(weeks[0]!.clicks).toBeNull();
  });
  it("includes a week that has typed results but no spend", () => {
    const weeks = buildAdsWeeks([], [], [stat("2026-11-02", 0, 100, 3, 0, 0)]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.spendSource).toBe("none");
  });
  it("adds weeks up, treating missing numbers as unknown", () => {
    const weeks = buildAdsWeeks([], [week("2026-10-26", 500), week("2026-11-02", 500)], [stat("2026-11-02", 0, 400, 10, 1, 1200)]);
    const t = totalAds(weeks, 20);
    expect(t.spendCents).toBe(1000);
    expect(t.clicks).toBe(10);
    expect(t.roas).toBe(1.2);
  });
  it("filters to the last N weeks", () => {
    const weeks = buildAdsWeeks([], [week("2026-09-07", 100), week("2026-10-26", 100), week("2026-11-09", 100)], []);
    expect(weeksInRange(weeks, "2026-11-10", 1).map((w) => w.weekStart)).toEqual(["2026-11-09"]);
    expect(weeksInRange(weeks, "2026-11-10", 4).map((w) => w.weekStart)).toEqual(["2026-10-26", "2026-11-09"]);
    expect(weeksInRange(weeks, "2026-11-10", null)).toHaveLength(3);
  });
});

describe("is an ad paying off?", () => {
  const verdictOf = (spend: number, clicks: number | null, orders: number | null, revenue: number | null) =>
    adVerdict(adTotals({ weeks: 1, spendCents: spend, views: 1000, clicks, orders, revenueCents: revenue }, 20), 20).verdict;
  it("Earning when ROAS is at or above break-even", () => expect(verdictOf(1000, 40, 2, 1300)).toBe("Earning"));
  it("Losing money when ROAS is below break-even", () => expect(verdictOf(1000, 40, 1, 1200)).toBe("Losing money"));
  it("does not judge on a handful of clicks", () => expect(verdictOf(300, 12, 0, 0)).toBe("Not enough clicks yet"));
  it("says so when nothing was typed in", () => expect(verdictOf(300, null, null, null)).toBe("No numbers yet"));
});

describe("advertised listings", () => {
  const stats = [stat("2026-11-02", 0, 900, 40, 2, 1590), stat("2026-11-02", 7, 500, 30, 2, 1590, 400), stat("2026-11-09", 7, 100, 5, 0, 0, 100), stat("2026-11-02", 8, 400, 35, 0, 0, 600)];
  const rows = adsByListing(stats, new Map([[7, "Seven"], [8, "Eight"]]), 20);
  it("adds a listing's weeks together and ignores the whole-shop row", () => {
    expect(rows).toHaveLength(2);
    const seven = rows.find((r) => r.listingId === 7)!;
    expect(seven).toMatchObject({ title: "Seven", views: 600, clicks: 35, orders: 2, revenueCents: 1590, spendCents: 500, weeks: 2 });
    expect(seven.roas).toBe(3.18);
    expect(seven.verdict).toBe("Earning");
  });
  it("puts the biggest spender first and flags the loser", () => {
    expect(rows[0]!.listingId).toBe(8);
    expect(rows[0]!.verdict).toBe("Losing money");
  });
  it("can be limited to chosen weeks", () => {
    const only = adsByListing(stats, new Map(), 20, new Set(["2026-11-09"]));
    expect(only).toHaveLength(1);
    expect(only[0]!.clicks).toBe(5);
  });
});

describe("ad rules for the to-do list", () => {
  it("flags ads that bring back less than they cost", () => {
    const ads = adsData([week("2026-11-02", 1000)], [stat("2026-11-02", 0, 800, 40, 1, 900)]);
    const out = ruleAdsLosingMoney({ ...context(), ads });
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain("lost A$2.80"); // 9.00 x 0.8 - 10.00
    expect(out[0]!.numbers).toContain("ROAS 0.90");
  });
  it("stays quiet when ads earn, when spend is tiny, or when revenue was not typed in", () => {
    expect(ruleAdsLosingMoney({ ...context(), ads: adsData([week("2026-11-02", 1000)], [stat("2026-11-02", 0, 800, 40, 3, 3000)]) })).toHaveLength(0);
    expect(ruleAdsLosingMoney({ ...context(), ads: adsData([week("2026-11-02", 300)], [stat("2026-11-02", 0, 800, 40, 0, 0)]) })).toHaveLength(0);
    expect(ruleAdsLosingMoney({ ...context(), ads: adsData([week("2026-11-02", 1000)], []) })).toHaveLength(0);
    expect(ruleAdsLosingMoney(context())).toHaveLength(0);
  });
  it("flags an advertised listing with 30+ clicks and no orders", () => {
    const ads = adsData([], [stat("2026-11-02", 5, 900, 31, 0, 0, 700), stat("2026-11-02", 6, 900, 29, 0, 0, 700)]);
    const out = ruleAdListingNoOrders({ ...context(), ads, titles: new Map([[5, "Five"]]) });
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain("Five");
    expect(out[0]!.numbers).toContain("31 ad clicks, 0 orders");
  });
  it("flags a low click rate only with enough views", () => {
    const ads = adsData([], [stat("2026-11-02", 5, 1000, 6, 0, 0, 100), stat("2026-11-02", 6, 200, 1, 0, 0, 50), stat("2026-11-02", 7, 1000, 30, 0, 0, 100)]);
    const out = ruleAdLowClickRate({ ...context(), ads });
    expect(out.map((s) => s.listingId)).toEqual([5]);
    expect(out[0]!.numbers).toContain("click rate 0.6%");
  });
  it("asks for ad results when there is spend but nothing typed in", () => {
    expect(ruleAdsNoNumbers({ ...context(), ads: adsData([week("2026-11-02", 600)], []) })).toHaveLength(1);
    expect(ruleAdsNoNumbers({ ...context(), ads: adsData([week("2026-11-02", 600)], [stat("2026-11-02", 0, 300, 9, 0, 0)]) })).toHaveLength(0);
  });
});

describe("sample ad data", () => {
  const sample = buildSampleData(NOW);
  it("has whole-shop and per-listing rows that make sense", () => {
    expect(sample.adStats.some((a) => a.listingId === 0)).toBe(true);
    expect(sample.adStats.some((a) => a.listingId !== 0)).toBe(true);
    for (const a of sample.adStats) {
      expect(a.clicks ?? 0).toBeLessThanOrEqual(a.views ?? 0);
      expect(a.orders ?? 0).toBeLessThanOrEqual(Math.max(1, a.clicks ?? 0));
    }
  });
});

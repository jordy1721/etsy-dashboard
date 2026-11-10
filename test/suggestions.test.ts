import { describe, expect, it } from "vitest";
import {
  buildSuggestions, missingProductMentions, pickNextSteps, ruleAdsEatingProfit, ruleDeepDiscount, ruleFewTags, ruleLowProfit,
  ruleLowTraffic, ruleMissingProduct, ruleMissingVisits, ruleNoReviews, ruleTagsRepeatTitle, ruleViewsNoSales, ruleZeroViews,
  tagsRepeatingTitle,
} from "../src/shared/suggestions";
import { listingStatus } from "../src/shared/status";
import { buildSampleData } from "../src/server/sample";
import { DAY, NOW, context, ledgerLine, listing, receipt } from "./helpers";

const old = { createdTs: NOW - 30 * DAY };

describe("listing status labels", () => {
  it("Working: sells well for its views", () => {
    expect(listingStatus({ views: 89, sales: 5, ageDays: 28 }).status).toBe("Working");
  });
  it("Needs traffic: few views after 14 days", () => {
    expect(listingStatus({ views: 14, sales: 1, ageDays: 27 }).status).toBe("Needs traffic");
  });
  it("Not enough data yet: few views but still new", () => {
    expect(listingStatus({ views: 4, sales: 0, ageDays: 11 }).status).toBe("Not enough data yet");
  });
  it("Needs a better listing: 50+ views and no sales", () => {
    expect(listingStatus({ views: 60, sales: 0, ageDays: 20 }).status).toBe("Needs a better listing");
  });
  it("Needs a better listing: lots of views, very few sales", () => {
    expect(listingStatus({ views: 400, sales: 2, ageDays: 60 }).status).toBe("Needs a better listing");
  });
  it("Not enough data yet: 20-49 views and no sales", () => {
    expect(listingStatus({ views: 30, sales: 0, ageDays: 20 }).status).toBe("Not enough data yet");
  });
});

describe("rule: low traffic (under 20 views after 14 days)", () => {
  it("fires and quotes the numbers", () => {
    const out = ruleLowTraffic(context({ listings: [listing({ ...old, views: 14 })] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.numbers).toContain("14 views in 30 days");
    expect(out[0]!.what).toContain("The listing is not the problem yet");
  });
  it("stays quiet for new listings and for listings with enough views", () => {
    expect(ruleLowTraffic(context({ listings: [listing({ views: 14, createdTs: NOW - 5 * DAY })] }))).toHaveLength(0);
    expect(ruleLowTraffic(context({ listings: [listing({ ...old, views: 25 })] }))).toHaveLength(0);
  });
});

describe("rule: zero views", () => {
  it("flags a listing nobody has found", () => {
    const out = ruleZeroViews(context({ listings: [listing({ views: 0, createdTs: NOW - 11 * DAY })] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain("0 views");
  });
  it("gives a brand-new listing a day or two", () => {
    expect(ruleZeroViews(context({ listings: [listing({ views: 0, createdTs: NOW - 1 * DAY })] }))).toHaveLength(0);
  });
});

describe("rule: 50+ views and 0 sales", () => {
  it("suggests checking price, first photo and title", () => {
    const out = ruleViewsNoSales(context({ listings: [listing({ ...old, views: 55 })] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.what).toMatch(/price.*first photo.*title/s);
    expect(out[0]!.numbers).toContain("55 views");
  });
  it("stays quiet once there is a sale or under 50 views", () => {
    expect(ruleViewsNoSales(context({ listings: [listing({ ...old, views: 55 })], receipts: [receipt({})] }))).toHaveLength(0);
    expect(ruleViewsNoSales(context({ listings: [listing({ ...old, views: 49 })] }))).toHaveLength(0);
  });
});

describe("rule: tags", () => {
  it("flags fewer than 13 tags", () => {
    const out = ruleFewTags(context({ listings: [listing({ tags: ["a b", "c d"] })] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.what).toContain("Add 11 more tags");
    expect(ruleFewTags(context({ listings: [listing()] }))).toHaveLength(0);
  });
  it("finds tags that only repeat title words", () => {
    expect(tagsRepeatingTitle("54 YouTube Subscribe Button Animations", ["subscribe button", "youtube animations", "green screen"])).toEqual([
      "subscribe button",
      "youtube animations",
    ]);
  });
  it("flags listings where 2 or more tags repeat the title", () => {
    const l = listing({ title: "YouTube Subscribe Button Animations", tags: ["subscribe button", "youtube animations", "green screen"] });
    const out = ruleTagsRepeatTitle(context({ listings: [l] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.numbers).toContain("2 of 3 tags");
    expect(ruleTagsRepeatTitle(context({ listings: [listing()] }))).toHaveLength(0);
  });
});

describe("rule: average discount over 50%", () => {
  it("warns and shows the break-even price", () => {
    const ctx = context({ listings: [listing({ priceCents: 1299 })], receipts: [receipt({ priceCents: 1299, discountCents: 909 })] });
    const out = ruleDeepDiscount(ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain("70% off");
    expect(out[0]!.numbers).toContain("break-even");
    expect(out[0]!.what).toMatch(/A\$\d+\.\d\d \(break-even\)/);
  });
  it("stays quiet at 50% or less", () => {
    const ctx = context({ listings: [listing({ priceCents: 1000 })], receipts: [receipt({ priceCents: 1000, discountCents: 500 })] });
    expect(ruleDeepDiscount(ctx)).toHaveLength(0);
  });
});

describe("rule: description mentions a product that is not for sale", () => {
  it("finds a 'Mega Bundle' that no listing matches", () => {
    expect(missingProductMentions("Grab the Mega Bundle in our shop.", ["254 YouTube Sound Effects Bundle"])).toEqual(["Mega Bundle"]);
  });
  it("accepts a bundle that really exists", () => {
    expect(missingProductMentions("See our Sound Effects Bundle too.", ["254 YouTube Sound Effects Bundle"])).toEqual([]);
  });
  it("creates a to-do item", () => {
    const out = ruleMissingProduct(context({ listings: [listing({ description: "Want more? Get the Mega Bundle." })] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain("Mega Bundle");
  });
});

describe("rule: no reviews after N sales", () => {
  const five = [1, 2, 3, 4, 5].map(() => receipt({}));
  it("suggests a review request after 5 orders with 0 reviews", () => {
    const out = ruleNoReviews(context({ receipts: five }));
    expect(out).toHaveLength(1);
    expect(out[0]!.numbers).toContain("5 orders, 0 reviews");
  });
  it("stays quiet with fewer sales or once a review exists", () => {
    expect(ruleNoReviews(context({ receipts: five.slice(0, 4) }))).toHaveLength(0);
    expect(ruleNoReviews(context({ receipts: five }, 1))).toHaveLength(0);
  });
});

describe("rule: profit per sale below the minimum", () => {
  it("flags a listing whose sales earn under A$2.00", () => {
    const ctx = context({
      receipts: [receipt({ priceCents: 390 })],
      costs: [{ id: 1, day: "2026-11-08", kind: "other", label: "x", amountCents: 150 }],
    });
    const out = ruleLowProfit(ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.numbers).toContain("1 of 1 sales below A$2.00");
  });
  it("says so plainly when each sale loses money", () => {
    const ctx = context({
      receipts: [receipt({ priceCents: 390 })],
      costs: [{ id: 1, day: "2026-11-08", kind: "other", label: "x", amountCents: 900 }],
    });
    expect(ruleLowProfit(ctx)[0]!.title).toContain("You lose money");
  });
  it("stays quiet when profit is fine", () => {
    expect(ruleLowProfit(context({ receipts: [receipt({ priceCents: 1200 })] }))).toHaveLength(0);
  });
});

describe("rule: ads eating the profit", () => {
  it("fires when ads are 25% or more of revenue", () => {
    const ctx = context({ receipts: [receipt({ priceCents: 1200 })], ledger: [ledgerLine({ amountCents: -400, description: "Etsy Ads" })] });
    const out = ruleAdsEatingProfit(ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain("33%");
  });
  it("stays quiet with small or no ad spend", () => {
    expect(ruleAdsEatingProfit(context({ receipts: [receipt({ priceCents: 1200 })] }))).toHaveLength(0);
  });
});

describe("rule: missing visits", () => {
  it("asks for visits when none were typed in", () => {
    expect(ruleMissingVisits(context())).toHaveLength(1);
  });
});

describe("the full list", () => {
  it("is sorted most important first and every item has all three parts", () => {
    const sample = buildSampleData(NOW);
    const ctx = context({ ...sample, costs: sample.costs.map((c, i) => ({ ...c, id: i + 1 })) });
    const all = buildSuggestions(ctx);
    expect(all.length).toBeGreaterThan(4);
    for (let i = 1; i < all.length; i++) expect(all[i - 1]!.score).toBeGreaterThanOrEqual(all[i]!.score);
    for (const s of all) {
      expect(s.what.length).toBeGreaterThan(10);
      expect(s.consider.length).toBeGreaterThan(10);
      expect(s.expect.length).toBeGreaterThan(10);
      expect(s.numbers.length).toBeGreaterThan(5);
    }
    // The sample shop should trigger the rules its facts call for.
    const rules = new Set(all.map((s) => s.rule));
    for (const r of ["deep-discount", "zero-views", "low-traffic", "no-reviews", "missing-product", "few-tags", "low-profit"]) {
      expect(rules.has(r), r).toBe(true);
    }
  });
  it("next steps are the top 3, one per kind of problem", () => {
    const sample = buildSampleData(NOW);
    const all = buildSuggestions(context({ ...sample, costs: sample.costs.map((c, i) => ({ ...c, id: i + 1 })) }));
    const next = pickNextSteps(all);
    expect(next).toHaveLength(3);
    expect(new Set(next.map((s) => s.rule)).size).toBe(3);
    expect(next[0]).toBe(all[0]);
  });
});

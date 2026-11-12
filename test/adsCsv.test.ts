import { describe, expect, it } from "vitest";
import { looksLikeAdsCsv, mapAdColumns, parseAdsCsv, parseMoneyCell } from "../src/shared/adsCsv";
import { CsvError } from "../src/shared/csv";

const listings = [
  { listingId: 4594983295, title: "254 YouTube Sound Effects Bundle" },
  { listingId: 4594399190, title: "54 YouTube Subscribe Button Animations" },
];

describe("finding the columns", () => {
  it("matches columns by name and ignores ratio columns", () => {
    const cols = mapAdColumns(["Date", "Views", "Clicks", "Click rate", "Orders", "Revenue", "Spend", "ROAS", "Cost per click"]);
    expect(cols).toEqual({ date: 0, views: 1, clicks: 2, orders: 4, revenue: 5, spend: 6 });
  });
  it("understands other wording", () => {
    expect(mapAdColumns(["Listing ID", "Listing title", "Impressions", "Clicks", "Purchases", "Sales", "Amount spent"])).toEqual({
      listingId: 0, title: 1, views: 2, clicks: 3, orders: 4, revenue: 5, spend: 6,
    });
  });
  it("tells an ads file from a stats file", () => {
    expect(looksLikeAdsCsv("Date,Views,Clicks,Orders,Revenue,Spend\n2026-11-02,10,1,0,0,0.5\n")).toBe(true);
    expect(looksLikeAdsCsv("Date,Visits,Views,Orders,Revenue\n2026-11-02,10,12,0,0\n")).toBe(false);
  });
  it("reads money with currency signs", () => {
    expect(parseMoneyCell("A$12.50")).toBe(1250);
    expect(parseMoneyCell("US$ 1,234.5")).toBe(123450);
    expect(parseMoneyCell("")).toBeNull();
    expect(parseMoneyCell("n/a")).toBeNull();
  });
});

describe("a daily ads file", () => {
  const csv = [
    "Etsy Ads report",
    "",
    "Date,Views,Clicks,Click rate,Orders,Revenue,Spend,ROAS",
    "2026-11-02,100,4,4%,1,A$12.00,A$1.10,10.9",
    "2026-11-03,150,6,4%,0,A$0.00,A$0.90,0",
    "2026-11-09,80,2,2.5%,0,A$0.00,A$0.50,0",
    "Total,330,12,3.6%,1,A$12.00,A$2.50,4.8",
  ].join("\n");
  const res = parseAdsCsv(csv, { listings });

  it("skips lines above the header and adds days up into weeks", () => {
    expect(res.weeks.map((w) => w.weekStart)).toEqual(["2026-11-02", "2026-11-09"]);
    expect(res.weeks[0]!.shop).toMatchObject({ listingId: 0, views: 250, clicks: 10, orders: 1, revenueCents: 1200 });
    expect(res.weeks[0]!.spendCents).toBe(200);
    expect(res.weeks[1]!.spendCents).toBe(50);
  });
  it("does not count the Total row twice", () => {
    expect(res.skippedRows).toBe(1);
    expect(res.weeks.reduce((n, w) => n + (w.shop.views ?? 0), 0)).toBe(330);
  });
  it("reports which columns it used, without the ratio columns", () => {
    expect(res.columnsUsed).toEqual(["Date", "Views", "Clicks", "Orders", "Revenue", "Spend"]);
    expect(res.usedChosenWeek).toBe(false);
  });
});

describe("a per-listing file with no dates", () => {
  const csv = [
    "Listing,Views,Clicks,Orders,Revenue,Spend",
    '"254 YouTube Sound Effects Bundle",445,14,1,12.00,5.20',
    "54 YouTube Subscribe Button Anim,346,11,1,3.90,3.80", // title cut short by Etsy
    "Some Deleted Listing,50,1,0,0,0.40",
  ].join("\n");

  it("needs to be told which week it covers", () => {
    expect(() => parseAdsCsv(csv, { listings })).toThrow(/no dates/);
  });
  it("puts everything into the chosen week and matches listings by title", () => {
    const res = parseAdsCsv(csv, { listings, chosenWeek: "2026-11-05" });
    expect(res.usedChosenWeek).toBe(true);
    expect(res.weeks).toHaveLength(1);
    const week = res.weeks[0]!;
    expect(week.weekStart).toBe("2026-11-02"); // snapped to Monday
    expect(week.listings.map((l) => [l.listingId, l.clicks, l.spendCents])).toEqual([
      [4594983295, 14, 520],
      [4594399190, 11, 380],
    ]);
    // Whole-shop totals include the listing that could not be matched.
    expect(week.shop.clicks).toBe(26);
    expect(week.spendCents).toBe(940);
    expect(res.unmatchedListings).toEqual(["Some Deleted Listing"]);
  });
});

describe("a dated per-listing file", () => {
  it("keeps listings separate per week and matches by listing ID", () => {
    const csv = "Date,Listing ID,Title,Impressions,Clicks,Orders,Sales,Cost\n10 Nov 2026,4594399190,whatever,200,5,0,0,1.50\n11 Nov 2026,4594399190,whatever,100,3,1,3.90,0.90\n";
    const res = parseAdsCsv(csv, { listings });
    expect(res.weeks[0]!.listings).toEqual([{ weekStart: "2026-11-09", listingId: 4594399190, views: 300, clicks: 8, orders: 1, revenueCents: 390, spendCents: 240 }]);
  });
});

describe("clear errors", () => {
  it("explains what is wrong", () => {
    expect(() => parseAdsCsv("", { listings })).toThrow(/empty/);
    expect(() => parseAdsCsv("Date,Visits\n2026-11-02,5\n", { listings })).toThrow(/does not look like an Etsy Ads file.*Date, Visits/);
    expect(() => parseAdsCsv("Date,Clicks,Spend\n", { listings })).toThrow(/no rows/);
    expect(() => parseAdsCsv("Date,Clicks,Spend\n2026-11-02,abc,xyz\n", { listings })).toThrow(/no rows with numbers/);
    expect(() => parseAdsCsv("", { listings })).toThrow(CsvError);
  });
});

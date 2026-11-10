import { describe, expect, it } from "vitest";
import { CsvError, parseCsv, parseDateCell, parseStatsCsv } from "../src/shared/csv";

describe("CSV basics", () => {
  it("handles quotes, commas inside quotes and Windows line endings", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
  it("reads common date styles", () => {
    expect(parseDateCell("2026-11-10")).toBe("2026-11-10");
    expect(parseDateCell("10 Nov 2026")).toBe("2026-11-10");
    expect(parseDateCell("Nov 10, 2026")).toBe("2026-11-10");
    expect(parseDateCell("10/11/2026")).toBe("2026-11-10");
    expect(parseDateCell("Total")).toBeNull();
  });
});

describe("Etsy Stats CSV", () => {
  it("reads one row per day by column name", () => {
    const res = parseStatsCsv('Date,Visits,Views,Orders,Revenue\n2026-11-09,12,20,1,"A$12.00"\n10 Nov 2026,8,15,0,0\nTotal,20,35,1,12\n');
    expect(res.rows).toEqual([
      { day: "2026-11-09", visits: 12, views: 20, orders: 1, revenueCents: 1200 },
      { day: "2026-11-10", visits: 8, views: 15, orders: 0, revenueCents: 0 },
    ]);
    expect(res.skippedRows).toBe(1);
    expect(res.columnsUsed).toContain("Visits");
  });
  it("copes with columns in a different order and missing columns", () => {
    const res = parseStatsCsv("Total Views,Day\n33,2026-11-01\n");
    expect(res.rows[0]).toEqual({ day: "2026-11-01", visits: null, views: 33, orders: null, revenueCents: null });
  });
  it("gives clear errors", () => {
    expect(() => parseStatsCsv("")).toThrow(/empty/);
    expect(() => parseStatsCsv("Date,Visits\n")).toThrow(/no data rows/);
    expect(() => parseStatsCsv("Listing,Favourites\nA,1\n")).toThrow(/No "Date" column.*Listing, Favourites/);
    expect(() => parseStatsCsv("Date,Notes\n2026-11-01,hi\n")).toThrow(/No "Visits"/);
    expect(() => parseStatsCsv("Date,Visits\nyesterday,3\n")).toThrow(/could not read any dates/);
    expect(() => parseStatsCsv("")).toThrow(CsvError);
  });
});

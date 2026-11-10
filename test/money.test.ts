import { describe, expect, it } from "vitest";
import { allocate, discountPercent, etsyMoneyToCents, formatAud, parseDollarsToCents, percentOf, ratePercent } from "../src/shared/money";

describe("etsyMoneyToCents (Etsy's amount / divisor)", () => {
  it("handles the usual divisor of 100", () => {
    expect(etsyMoneyToCents({ amount: 1299, divisor: 100 })).toBe(1299);
    expect(etsyMoneyToCents({ amount: 3999, divisor: 100, currency_code: "AUD" })).toBe(3999);
  });
  it("handles other divisors", () => {
    expect(etsyMoneyToCents({ amount: 12, divisor: 1 })).toBe(1200);
    expect(etsyMoneyToCents({ amount: 12990, divisor: 1000 })).toBe(1299);
    expect(etsyMoneyToCents({ amount: 39, divisor: 10 })).toBe(390);
  });
  it("rounds to the nearest cent instead of drifting", () => {
    expect(etsyMoneyToCents({ amount: 12995, divisor: 1000 })).toBe(1300);
    expect(etsyMoneyToCents({ amount: 1, divisor: 3 })).toBe(33);
  });
  it("treats missing or broken money as zero", () => {
    expect(etsyMoneyToCents(null)).toBe(0);
    expect(etsyMoneyToCents(undefined)).toBe(0);
    expect(etsyMoneyToCents({ amount: 500, divisor: 0 })).toBe(0);
    expect(etsyMoneyToCents({ amount: Number.NaN, divisor: 100 })).toBe(0);
  });
  it("keeps negative amounts negative", () => {
    expect(etsyMoneyToCents({ amount: -78, divisor: 100 })).toBe(-78);
  });
});

describe("formatAud", () => {
  it("formats cents as Australian dollars", () => {
    expect(formatAud(1200)).toBe("A$12.00");
    expect(formatAud(390)).toBe("A$3.90");
    expect(formatAud(5)).toBe("A$0.05");
    expect(formatAud(0)).toBe("A$0.00");
    expect(formatAud(-35)).toBe("-A$0.35");
    expect(formatAud(123456789)).toBe("A$1,234,567.89");
  });
});

describe("parseDollarsToCents (typed-in amounts)", () => {
  it("reads plain and decorated numbers exactly", () => {
    expect(parseDollarsToCents("12")).toBe(1200);
    expect(parseDollarsToCents("12.5")).toBe(1250);
    expect(parseDollarsToCents("A$12.50")).toBe(1250);
    expect(parseDollarsToCents("1,234.56")).toBe(123456);
    expect(parseDollarsToCents("0.07")).toBe(7);
    // The classic floating point trap: 19.99 * 100 = 1998.9999999999998
    expect(parseDollarsToCents("19.99")).toBe(1999);
  });
  it("rejects things that are not money", () => {
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("1.234")).toBeNull();
  });
});

describe("discount maths", () => {
  it("works out the real shop discounts", () => {
    expect(discountPercent(3999, 1200)).toBe(70); // A$39.99 pack sold for A$12.00
    expect(discountPercent(1299, 390)).toBe(70); // A$12.99 pack sold for A$3.90
  });
  it("handles no discount and unknown list price", () => {
    expect(discountPercent(1299, 1299)).toBe(0);
    expect(discountPercent(null, 390)).toBeNull();
    expect(discountPercent(0, 390)).toBeNull();
  });
  it("percentOf rounds to the cent", () => {
    expect(percentOf(1200, 6.5)).toBe(78);
    expect(percentOf(390, 6.5)).toBe(25); // 25.35 -> 25
    expect(percentOf(390, 22)).toBe(86); // 85.8 -> 86
  });
  it("ratePercent gives one decimal and survives zero", () => {
    expect(ratePercent(5, 89)).toBe(5.6);
    expect(ratePercent(1, 0)).toBeNull();
  });
});

describe("allocate (sharing money without losing a cent)", () => {
  it("always adds back up to the total", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [1200, 390]).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(allocate(7, [1, 1, 1, 1, 1, 1, 1])).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(allocate(400, [1, 1, 1, 1, 1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(400);
  });
  it("shares equally when there are no weights, and handles empty lists", () => {
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
    expect(allocate(10, [])).toEqual([]);
  });
});

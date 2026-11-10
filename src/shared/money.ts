// ---------------------------------------------------------------------------
// MONEY HELPERS
//
// Rule number one: inside this app every amount is a whole number of CENTS
// (so A$12.00 is stored as 1200). We never do maths on decimal dollars,
// because computers get decimals slightly wrong (0.1 + 0.2 is not 0.3).
// ---------------------------------------------------------------------------

/** How Etsy sends money: amount / divisor = the real value. e.g. 1299 / 100 = 12.99 */
export interface EtsyMoney {
  amount: number;
  divisor: number;
  currency_code?: string;
}

/**
 * Turn Etsy's {amount, divisor} into whole cents.
 * Etsy usually uses divisor 100, but we never assume that.
 *   {amount: 1299, divisor: 100}  -> 1299 cents
 *   {amount: 12,   divisor: 1}    -> 1200 cents
 *   {amount: 12990, divisor: 1000} -> 1299 cents
 * Missing or broken values count as 0 so one bad field cannot crash a sync.
 */
export function etsyMoneyToCents(money: EtsyMoney | null | undefined): number {
  if (!money) return 0;
  const { amount, divisor } = money;
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor <= 0) return 0;
  return Math.round((amount * 100) / divisor);
}

/** Format cents as Australian dollars, e.g. 1200 -> "A$12.00", -35 -> "-A$0.35". */
export function formatAud(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  // Add thousands separators to the dollar part: 1234567 -> 1,234,567
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}A$${withCommas}.${rest}`;
}

/** Turn what a person types ("12", "12.5", "$12.50") into cents. Returns null if it is not a number. */
export function parseDollarsToCents(text: string): number | null {
  const cleaned = text.replace(/[A$,\s]/gi, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole = "0", frac = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** A percentage of an amount, rounded to the nearest cent. percentOf(1200, 6.5) -> 78 */
export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}

/**
 * How deep was the discount, as a percentage of the list price?
 * discountPercent(3999, 1200) -> 70 (the buyer paid 70% less than list price).
 * Returns null when we do not know the list price.
 */
export function discountPercent(listCents: number | null, paidCents: number): number | null {
  if (listCents === null || listCents <= 0) return null;
  const pct = ((listCents - paidCents) / listCents) * 100;
  return Math.round(pct * 10) / 10; // one decimal place
}

/** part / whole as a percentage with one decimal, or null when whole is 0. */
export function ratePercent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Split a total between several lines in proportion to their weights,
 * WITHOUT losing or inventing a cent. (Plain rounding can be off by 1c.)
 * allocate(100, [1, 1, 1]) -> [34, 33, 33]
 */
export function allocate(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  // If there are no weights to go by, share equally.
  const safe = weightSum > 0 ? weights.map((w) => Math.max(0, w)) : weights.map(() => 1);
  const sum = safe.reduce((a, b) => a + b, 0);
  const sign = totalCents < 0 ? -1 : 1;
  const total = Math.abs(totalCents);

  const exact = safe.map((w) => (total * w) / sum);
  const floors = exact.map((x) => Math.floor(x));
  let leftover = total - floors.reduce((a, b) => a + b, 0);

  // Hand the leftover cents to the lines with the biggest remainders.
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    leftover--;
  }
  return floors.map((x) => x * sign);
}

/** Add up a list of numbers. */
export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

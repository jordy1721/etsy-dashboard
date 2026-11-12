// ---------------------------------------------------------------------------
// AD CAMPAIGN MATHS
// Etsy's API does not share ad statistics (views, clicks, orders from ads).
// So the numbers on the Ads screen are typed in by hand each week from
// Etsy > Marketing > Etsy Ads. Ad SPEND is taken from Etsy's bill when the
// bill shows ad lines for that week, otherwise from the typed number.
//
// This file only does sums and ratios. No database, no network.
// ---------------------------------------------------------------------------

import { addDays, weekStart as weekStartOf } from "./dates";
import { buildAdsByDay } from "./metrics";
import type { WeeklyManual } from "./types";

/** One week of typed-in ad numbers. listingId 0 = the whole shop. null = not entered. */
export interface AdStat {
  weekStart: string;
  listingId: number;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  revenueCents: number | null;
  /** Only used for single listings. The whole-shop spend lives with the weekly numbers. */
  spendCents: number | null;
}

export interface AdsWeek {
  weekStart: string;
  spendCents: number;
  /** "bill" = read from Etsy's bill. "typed" = entered by hand. "none" = no spend known. */
  spendSource: "bill" | "typed" | "none";
  /** What was typed for this week, kept so we can show both when the bill wins. */
  typedSpendCents: number | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  revenueCents: number | null;
}

export interface AdsTotals {
  weeks: number;
  spendCents: number;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  revenueCents: number | null;
  /** Clicks per 100 views. */
  clickRatePct: number | null;
  /** Return on ad spend: revenue from ads divided by ad spend. 2.0 = A$2 back per A$1 spent. */
  roas: number | null;
  costPerClickCents: number | null;
  costPerOrderCents: number | null;
  /** Ad revenue minus Etsy's fees on those sales minus ad spend. An estimate. */
  profitCents: number | null;
}

export type AdVerdict = "Earning" | "Losing money" | "Not enough clicks yet" | "No numbers yet";

export interface AdsListingRow extends AdsTotals {
  listingId: number;
  title: string;
  verdict: AdVerdict;
  verdictWhy: string;
}

/** Below this many clicks, one lucky or unlucky order decides everything. Do not judge yet. */
export const MIN_CLICKS_TO_JUDGE = 30;

/** Add numbers that may be missing. If none are known the total is "unknown" (null), not zero. */
function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The ROAS at which ads neither make nor lose money.
 * If Etsy keeps 20% of each sale in fees, you keep 80c of every ad dollar of
 * revenue, so you need 1 / 0.8 = 1.25 back for every 1 spent just to break even.
 */
export function breakEvenRoas(feeSharePct: number): number {
  const keep = 1 - Math.min(95, Math.max(0, feeSharePct)) / 100;
  return round2(1 / keep);
}

/** Work out the ratios for a set of summed numbers. */
export function adTotals(
  input: { weeks: number; spendCents: number; views: number | null; clicks: number | null; orders: number | null; revenueCents: number | null },
  feeSharePct: number,
): AdsTotals {
  const { spendCents, views, clicks, orders, revenueCents } = input;
  return {
    ...input,
    clickRatePct: views !== null && clicks !== null && views > 0 ? round1((clicks / views) * 100) : null,
    roas: revenueCents !== null && spendCents > 0 ? round2(revenueCents / spendCents) : null,
    costPerClickCents: clicks !== null && clicks > 0 && spendCents > 0 ? Math.round(spendCents / clicks) : null,
    costPerOrderCents: orders !== null && orders > 0 && spendCents > 0 ? Math.round(spendCents / orders) : null,
    profitCents: revenueCents !== null ? Math.round(revenueCents * (1 - feeSharePct / 100)) - spendCents : null,
  };
}

/** One row per week that has any ad spend or any typed ad numbers. Oldest first. */
export function buildAdsWeeks(adEntries: { day: string; amountCents: number }[], weekly: WeeklyManual[], stats: AdStat[]): AdsWeek[] {
  // Same rule as the Money screen: the bill wins for a week, typed spend fills the gaps.
  const { byDay } = buildAdsByDay(adEntries, weekly);
  const spendByWeek = new Map<string, number>();
  for (const [day, cents] of byDay) spendByWeek.set(weekStartOf(day), (spendByWeek.get(weekStartOf(day)) ?? 0) + cents);
  const billWeeks = new Set(adEntries.filter((e) => e.amountCents < 0).map((e) => weekStartOf(e.day)));
  const typed = new Map(weekly.map((w) => [w.weekStart, w.adsSpendCents]));
  const shopStats = new Map(stats.filter((s) => s.listingId === 0).map((s) => [s.weekStart, s]));

  const weeks = new Set<string>([...spendByWeek.keys(), ...shopStats.keys()]);
  return [...weeks].sort().map((ws) => {
    const spend = spendByWeek.get(ws) ?? 0;
    const st = shopStats.get(ws);
    return {
      weekStart: ws,
      spendCents: spend,
      spendSource: spend <= 0 ? "none" : billWeeks.has(ws) ? "bill" : "typed",
      typedSpendCents: typed.get(ws) ?? null,
      views: st?.views ?? null,
      clicks: st?.clicks ?? null,
      orders: st?.orders ?? null,
      revenueCents: st?.revenueCents ?? null,
    };
  });
}

/** Add up a list of weeks. */
export function totalAds(weeks: AdsWeek[], feeSharePct: number): AdsTotals {
  return adTotals(
    {
      weeks: weeks.length,
      spendCents: weeks.reduce((n, w) => n + w.spendCents, 0),
      views: sumKnown(weeks.map((w) => w.views)),
      clicks: sumKnown(weeks.map((w) => w.clicks)),
      orders: sumKnown(weeks.map((w) => w.orders)),
      revenueCents: sumKnown(weeks.map((w) => w.revenueCents)),
    },
    feeSharePct,
  );
}

/** Is a campaign (or one advertised listing) paying for itself? */
export function adVerdict(t: AdsTotals, feeSharePct: number): { verdict: AdVerdict; why: string } {
  const need = breakEvenRoas(feeSharePct);
  if (t.clicks === null && t.revenueCents === null) return { verdict: "No numbers yet", why: "Type in the views, clicks, orders and revenue from Etsy Ads." };
  if (t.clicks !== null && t.clicks < MIN_CLICKS_TO_JUDGE && (t.orders ?? 0) === 0) {
    return { verdict: "Not enough clicks yet", why: `Only ${t.clicks} clicks. Wait for ${MIN_CLICKS_TO_JUDGE} before judging.` };
  }
  if (t.roas === null) return { verdict: "No numbers yet", why: "Ad spend or ad revenue is missing, so there is nothing to compare." };
  if (t.roas >= need) return { verdict: "Earning", why: `ROAS ${t.roas.toFixed(2)}. You need ${need.toFixed(2)} to break even after Etsy fees.` };
  return { verdict: "Losing money", why: `ROAS ${t.roas.toFixed(2)}. You need ${need.toFixed(2)} just to break even after Etsy fees.` };
}

/** One row per advertised listing, summed over the given weeks. Biggest spend first. */
export function adsByListing(stats: AdStat[], titles: Map<number, string>, feeSharePct: number, onlyWeeks?: Set<string>): AdsListingRow[] {
  const groups = new Map<number, AdStat[]>();
  for (const s of stats) {
    if (s.listingId === 0) continue;
    if (onlyWeeks && !onlyWeeks.has(s.weekStart)) continue;
    groups.set(s.listingId, [...(groups.get(s.listingId) ?? []), s]);
  }
  const rows = [...groups.entries()].map(([listingId, list]) => {
    const totals = adTotals(
      {
        weeks: new Set(list.map((s) => s.weekStart)).size,
        spendCents: list.reduce((n, s) => n + (s.spendCents ?? 0), 0),
        views: sumKnown(list.map((s) => s.views)),
        clicks: sumKnown(list.map((s) => s.clicks)),
        orders: sumKnown(list.map((s) => s.orders)),
        revenueCents: sumKnown(list.map((s) => s.revenueCents)),
      },
      feeSharePct,
    );
    const v = adVerdict(totals, feeSharePct);
    return { ...totals, listingId, title: titles.get(listingId) ?? `Listing ${listingId}`, verdict: v.verdict, verdictWhy: v.why };
  });
  return rows.sort((a, b) => b.spendCents - a.spendCents || (b.clicks ?? 0) - (a.clicks ?? 0));
}

/** The weeks inside a range like "last 4 weeks" (counted back from the current week). */
export function weeksInRange(weeks: AdsWeek[], today: string, lastN: number | null): AdsWeek[] {
  if (lastN === null) return weeks;
  const from = addDays(weekStartOf(today), -7 * (lastN - 1));
  return weeks.filter((w) => w.weekStart >= from);
}

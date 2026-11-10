// ---------------------------------------------------------------------------
// METRICS
// Takes the raw rows from the database and works out every number the
// dashboard shows. This file has NO database or network code, so it is easy
// to test: same input in, same numbers out.
// ---------------------------------------------------------------------------

import { addDays, dayKey, dayRange, daysBetween, weekStart } from "./dates";
import {
  CATEGORY_LABELS,
  FEE_CATEGORIES,
  classifyLedgerEntry,
  estimateReceiptFees,
  priceForTargetProfit,
  receiptRevenueCents,
  type LedgerCategory,
} from "./fees";
import { allocate, discountPercent, formatAud, percentOf, ratePercent, sum } from "./money";
import { listingStatus } from "./status";
import type {
  AdsSource,
  Cost,
  DailyStat,
  DayPoint,
  LedgerEntry,
  Listing,
  ListingRow,
  MoneySummary,
  PeriodSummary,
  Receipt,
  SaleRow,
  Settings,
  ShopInfo,
  Snapshot,
  WeeklyManual,
} from "./types";

export interface MetricsInput {
  /** "Now" as Unix seconds. Passed in (not read from the clock) so tests are repeatable. */
  now: number;
  shop: ShopInfo | null;
  listings: Listing[];
  snapshots: Snapshot[];
  receipts: Receipt[];
  ledger: LedgerEntry[];
  weekly: WeeklyManual[];
  costs: Cost[];
  dailyStats: DailyStat[];
  settings: Settings;
}

export interface Metrics {
  today: string;
  days: DayPoint[];
  sales: SaleRow[];
  listings: ListingRow[];
  money: MoneySummary;
  thisWeek: PeriodSummary;
  lastWeek: PeriodSummary;
  countries: { country: string; orders: number; revenueCents: number }[];
  dataNotes: string[];
  trafficSources: { weekStart: string; sources: { label: string; visits: number }[] } | null;
  /** Each sale's share of ads, manual costs and fees not tied to one sale. */
  overheadPerSaleCents: number;
  firstSnapshotDay: string | null;
}

type ClassifiedEntry = LedgerEntry & { category: LedgerCategory; day: string };

/** Add to a number stored in a Map. */
function bump(map: Map<string, number>, key: string, by: number): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

// ---------------------------------------------------------------------------
// Ads: use Etsy's bill when it shows ad lines for a week, otherwise the number
// typed in by hand for that week (spread evenly over its 7 days).
// ---------------------------------------------------------------------------
export function buildAdsByDay(
  adEntries: { day: string; amountCents: number }[],
  weekly: WeeklyManual[],
): { byDay: Map<string, number>; source: AdsSource } {
  const byDay = new Map<string, number>();
  const ledgerByWeek = new Map<string, number>();
  for (const e of adEntries) bump(ledgerByWeek, weekStart(e.day), -e.amountCents);

  let usedLedger = false;
  let usedManual = false;

  // Weeks where the bill shows ads: use the real, dated lines.
  for (const e of adEntries) {
    if ((ledgerByWeek.get(weekStart(e.day)) ?? 0) > 0) {
      bump(byDay, e.day, -e.amountCents);
      usedLedger = true;
    }
  }
  // Other weeks: use the manual number, if one was typed in.
  for (const w of weekly) {
    if (w.adsSpendCents === null || w.adsSpendCents <= 0) continue;
    if ((ledgerByWeek.get(w.weekStart) ?? 0) > 0) continue; // the bill wins, no double counting
    const perDay = allocate(w.adsSpendCents, [1, 1, 1, 1, 1, 1, 1]);
    perDay.forEach((cents, i) => bump(byDay, addDays(w.weekStart, i), cents));
    usedManual = true;
  }

  const source: AdsSource = usedLedger && usedManual ? "mixed" : usedLedger ? "ledger" : usedManual ? "manual" : "none";
  return { byDay, source };
}

// ---------------------------------------------------------------------------
// Views per day. Etsy only gives a running total, so a day's views are
// "today's total minus yesterday's total" from our daily snapshots.
// ---------------------------------------------------------------------------
export function buildViewsByDay(
  snapshots: Snapshot[],
  listings: Listing[],
  timeZone: string,
): { byDay: Map<string, number>; firstSnapshotDay: string | null } {
  const byDay = new Map<string, number>();
  const createdDay = new Map(listings.map((l) => [l.listingId, dayKey(l.createdTs, timeZone)]));
  const perListing = new Map<number, Snapshot[]>();
  for (const s of snapshots) {
    const list = perListing.get(s.listingId) ?? [];
    list.push(s);
    perListing.set(s.listingId, list);
  }
  let first: string | null = null;
  for (const [listingId, list] of perListing) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    list.forEach((snap, i) => {
      if (first === null || snap.day < first) first = snap.day;
      const prev = list[i - 1];
      if (prev) {
        bump(byDay, snap.day, Math.max(0, snap.views - prev.views));
      } else {
        // First snapshot: only count its views if the listing was brand new
        // that day. Otherwise we do not know when those views happened.
        const created = createdDay.get(listingId);
        if (created && daysBetween(created, snap.day) <= 1) bump(byDay, snap.day, snap.views);
      }
    });
  }
  return { byDay, firstSnapshotDay: first };
}

/** Visits per day: an uploaded CSV day wins; otherwise the weekly number spread over 7 days. */
export function buildVisitsByDay(dailyStats: DailyStat[], weekly: WeeklyManual[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const w of weekly) {
    if (w.visits === null) continue;
    allocate(w.visits, [1, 1, 1, 1, 1, 1, 1]).forEach((v, i) => byDay.set(addDays(w.weekStart, i), v));
  }
  for (const d of dailyStats) if (d.visits !== null) byDay.set(d.day, d.visits);
  return byDay;
}

/** Add up a stretch of days. */
export function summarisePeriod(days: DayPoint[], from: string, to: string): PeriodSummary {
  const inRange = days.filter((d) => d.day >= from && d.day <= to);
  const expectedDays = daysBetween(from, to) + 1;
  const total = (pick: (d: DayPoint) => number) => sum(inRange.map(pick));

  // Views and visits are only a real total if we have them for every day.
  const complete = (pick: (d: DayPoint) => number | null) =>
    inRange.length === expectedDays && inRange.every((d) => pick(d) !== null);
  const views = complete((d) => d.views) ? total((d) => d.views ?? 0) : null;
  const visits = complete((d) => d.visits) ? total((d) => d.visits ?? 0) : null;

  const orders = total((d) => d.orders);
  const feesCents = total((d) => d.feesCents);
  const adsCents = total((d) => d.adsCents);
  const costsCents = total((d) => d.costsCents);
  const revenueCents = total((d) => d.revenueCents);

  let conversionPct: number | null = null;
  let conversionBasis: PeriodSummary["conversionBasis"] = "none";
  if (visits !== null && visits > 0) {
    conversionPct = ratePercent(orders, visits);
    conversionBasis = "visits";
  } else if (views !== null && views > 0) {
    conversionPct = ratePercent(orders, views);
    conversionBasis = "views";
  }

  return {
    from,
    to,
    revenueCents,
    orders,
    items: total((d) => d.items),
    feesCents,
    adsCents,
    costsCents,
    spendCents: feesCents + adsCents + costsCents,
    profitCents: revenueCents - feesCents - adsCents - costsCents,
    views,
    visits,
    conversionPct,
    conversionBasis,
  };
}

// ---------------------------------------------------------------------------
// The main function.
// ---------------------------------------------------------------------------
export function computeMetrics(input: MetricsInput): Metrics {
  const s = input.settings;
  const tz = s.timezone;
  const today = dayKey(input.now, tz);
  const notes: string[] = [];

  // Cancelled orders are not sales.
  const receipts = input.receipts.filter((r) => !/cancel/i.test(r.status));

  // ----- Etsy's bill (ledger), sorted into categories -----
  const ledger: ClassifiedEntry[] = input.ledger.map((e) => ({
    ...e,
    category: classifyLedgerEntry(e),
    day: dayKey(e.createdTs, tz),
  }));
  const feeEntries = ledger.filter((e) => FEE_CATEGORIES.includes(e.category));
  const hasLedgerFees = feeEntries.length > 0;
  const feeEntriesByRef = new Map<string, ClassifiedEntry[]>();
  for (const e of feeEntries) {
    if (!e.referenceId) continue;
    const list = feeEntriesByRef.get(e.referenceId) ?? [];
    list.push(e);
    feeEntriesByRef.set(e.referenceId, list);
  }

  // ----- List price history, to compare "list price" with "price paid" -----
  const snapsByListing = new Map<number, Snapshot[]>();
  for (const snap of input.snapshots) {
    const list = snapsByListing.get(snap.listingId) ?? [];
    list.push(snap);
    snapsByListing.set(snap.listingId, list);
  }
  for (const list of snapsByListing.values()) list.sort((a, b) => a.day.localeCompare(b.day));
  const listingById = new Map(input.listings.map((l) => [l.listingId, l]));

  function listPriceOn(listingId: number, day: string): { cents: number | null; estimated: boolean } {
    const snaps = snapsByListing.get(listingId) ?? [];
    let found: Snapshot | undefined;
    for (const snap of snaps) if (snap.day <= day) found = snap;
    if (found) return { cents: found.priceCents, estimated: false };
    // No history for that day: best guess is the earliest price we have, or today's price.
    const fallback = snaps[0]?.priceCents ?? listingById.get(listingId)?.priceCents ?? null;
    return { cents: fallback, estimated: true };
  }

  // ----- One row per item sold -----
  const sales: SaleRow[] = [];
  const saleFeesByDay = new Map<string, number>();
  const estParts = { transaction: 0, processing: 0, listing: 0, feeTax: 0 };
  let anyFeesEstimated = false;
  let taxCollected = 0;
  let shippingCollected = 0;
  let nonAud = false;

  for (const r of receipts) {
    if (r.currency && r.currency !== "AUD") nonAud = true;
    const day = dayKey(r.createdTs, tz);
    const revenue = receiptRevenueCents(r);
    taxCollected += r.taxCents + r.vatCents;
    shippingCollected += r.shippingCents;

    // An order normally has item lines. If Etsy sent none, treat the order as one line.
    const lines =
      r.transactions.length > 0
        ? r.transactions
        : [{ transactionId: r.receiptId, receiptId: r.receiptId, listingId: 0, title: "(order)", quantity: 1, priceCents: revenue }];
    const itemCount = sum(lines.map((t) => t.quantity));

    // Share the order's revenue and collected tax between its lines.
    const linePaid = allocate(revenue, lines.map((t) => t.priceCents * t.quantity));
    const lineTax = allocate(r.taxCents + r.vatCents + r.shippingCents, linePaid);

    // Fees: use real lines from Etsy's bill when they point at this order,
    // and fill any gaps with an estimate from the fee settings.
    const refs = new Set<string>([String(r.receiptId), ...lines.map((t) => String(t.transactionId))]);
    const actual = new Map<LedgerCategory, number>();
    for (const ref of refs) {
      for (const e of feeEntriesByRef.get(ref) ?? []) actual.set(e.category, (actual.get(e.category) ?? 0) - e.amountCents);
    }
    const est = estimateReceiptFees(r, revenue, itemCount, s);
    const transaction = actual.get("transaction_fee") ?? est.transaction;
    const processing = actual.get("processing_fee") ?? est.processing;
    const listing = actual.get("listing_fee") ?? est.listing;
    const feeTax = actual.get("fee_tax") ?? percentOf(transaction + processing + listing, s.feeTaxPct);
    const estimated = !(
      actual.has("transaction_fee") &&
      actual.has("processing_fee") &&
      actual.has("listing_fee") &&
      actual.has("fee_tax")
    );
    if (estimated) anyFeesEstimated = true;
    estParts.transaction += transaction;
    estParts.processing += processing;
    estParts.listing += listing;
    estParts.feeTax += feeTax;

    const feesTotal = transaction + processing + listing + feeTax;
    bump(saleFeesByDay, day, feesTotal);
    const lineFees = allocate(feesTotal, linePaid);

    lines.forEach((t, i) => {
      const paid = linePaid[i] ?? 0;
      const list = listPriceOn(t.listingId, day);
      let listCents = list.cents === null ? null : list.cents * t.quantity;
      // A list price below the price paid makes no sense (the price was changed later).
      if (listCents !== null && listCents < paid) listCents = paid;
      sales.push({
        transactionId: t.transactionId,
        receiptId: r.receiptId,
        day,
        ts: r.createdTs,
        listingId: t.listingId,
        title: t.title,
        quantity: t.quantity,
        country: r.countryIso || "??",
        listCents,
        listEstimated: list.estimated,
        paidCents: paid,
        discountPct: discountPercent(listCents, paid),
        taxCollectedCents: lineTax[i] ?? 0,
        feesCents: lineFees[i] ?? 0,
        feesEstimated: estimated,
        overheadCents: 0, // filled in below
        profitCents: 0, // filled in below
        belowMinimum: false, // filled in below
      });
    });
  }
  sales.sort((a, b) => b.ts - a.ts || b.transactionId - a.transactionId);

  // ----- Shop totals -----
  const revenueCents = sum(sales.map((x) => x.paidCents));
  const saleFeesTotal = sum(sales.map((x) => x.feesCents));
  const ledgerFeesTotal = -sum(feeEntries.map((e) => e.amountCents));
  const feesCents = hasLedgerFees ? ledgerFeesTotal : saleFeesTotal;

  const adEntries = ledger.filter((e) => e.category === "ads");
  const ads = buildAdsByDay(adEntries, input.weekly);
  const adsCents = sum([...ads.byDay.values()]);
  const costsCents = sum(input.costs.map((c) => c.amountCents));
  const refundsCents = Math.max(0, -sum(ledger.filter((e) => e.category === "refund").map((e) => e.amountCents)));

  // Fees on the bill that do not belong to one sale (for example the first
  // listing fee) are shared between all sales, like ads and costs.
  const unallocatedFees = hasLedgerFees ? Math.max(0, ledgerFeesTotal - saleFeesTotal) : 0;
  const overheadTotal = adsCents + costsCents + unallocatedFees;
  const overheadShares = allocate(overheadTotal, sales.map(() => 1));
  sales.forEach((row, i) => {
    row.overheadCents = overheadShares[i] ?? 0;
    row.profitCents = row.paidCents - row.feesCents - row.overheadCents;
    row.belowMinimum = row.profitCents < s.minProfitCents * row.quantity;
  });
  const items = sum(sales.map((x) => x.quantity));
  const overheadPerSaleCents = sales.length > 0 ? Math.round(overheadTotal / sales.length) : 0;

  // ----- Day by day -----
  const views = buildViewsByDay(input.snapshots, input.listings, tz);
  const visitsByDay = buildVisitsByDay(input.dailyStats, input.weekly);

  const revenueByDay = new Map<string, number>();
  const ordersByDay = new Map<string, number>();
  const itemsByDay = new Map<string, number>();
  const seenReceipts = new Set<number>();
  for (const row of sales) {
    bump(revenueByDay, row.day, row.paidCents);
    bump(itemsByDay, row.day, row.quantity);
    if (!seenReceipts.has(row.receiptId)) {
      seenReceipts.add(row.receiptId);
      bump(ordersByDay, row.day, 1);
    }
  }
  const feesByDay = new Map<string, number>();
  if (hasLedgerFees) for (const e of feeEntries) bump(feesByDay, e.day, -e.amountCents);
  else for (const [d, v] of saleFeesByDay) feesByDay.set(d, v);
  const costsByDay = new Map<string, number>();
  for (const c of input.costs) bump(costsByDay, c.day, c.amountCents);

  // The chart starts at the first day we know anything about (at most ~13 months back).
  const candidates = [
    input.shop ? dayKey(input.shop.createdTs, tz) : null,
    views.firstSnapshotDay,
    ...sales.map((x) => x.day),
    ...ledger.map((e) => e.day),
  ].filter((d): d is string => !!d);
  let firstDay = candidates.length > 0 ? candidates.reduce((a, b) => (a < b ? a : b)) : addDays(today, -27);
  if (firstDay > addDays(today, -13)) firstDay = addDays(today, -13);
  if (firstDay < addDays(today, -400)) firstDay = addDays(today, -400);

  const days: DayPoint[] = dayRange(firstDay, today).map((day) => {
    const rev = revenueByDay.get(day) ?? 0;
    const fee = feesByDay.get(day) ?? 0;
    const ad = ads.byDay.get(day) ?? 0;
    const cost = costsByDay.get(day) ?? 0;
    return {
      day,
      revenueCents: rev,
      orders: ordersByDay.get(day) ?? 0,
      items: itemsByDay.get(day) ?? 0,
      feesCents: fee,
      adsCents: ad,
      costsCents: cost,
      profitCents: rev - fee - ad - cost,
      views: views.firstSnapshotDay !== null && day >= views.firstSnapshotDay ? (views.byDay.get(day) ?? 0) : null,
      visits: visitsByDay.get(day) ?? null,
    };
  });

  const thisWeek = summarisePeriod(days, addDays(today, -6), today);
  const lastWeek = summarisePeriod(days, addDays(today, -13), addDays(today, -7));

  // ----- Per listing -----
  const listingRows: ListingRow[] = input.listings.map((l) => {
    const rows = sales.filter((x) => x.listingId === l.listingId);
    const sold = sum(rows.map((x) => x.quantity));
    const revenue = sum(rows.map((x) => x.paidCents));
    const withList = rows.filter((x) => x.listCents !== null);
    const listTotal = sum(withList.map((x) => x.listCents ?? 0));
    const paidWithList = sum(withList.map((x) => x.paidCents));
    const profit = sum(rows.map((x) => x.profitCents));
    const ageDays = Math.max(0, daysBetween(dayKey(l.createdTs, tz), today));

    // Views in the last 7 days = total now minus the total a week ago.
    const weekAgo = addDays(today, -7);
    let weekAgoSnap: Snapshot | undefined;
    for (const snap of snapsByListing.get(l.listingId) ?? []) if (snap.day <= weekAgo) weekAgoSnap = snap;
    const views7d = weekAgoSnap ? Math.max(0, l.views - weekAgoSnap.views) : ageDays <= 7 ? l.views : null;

    const st = listingStatus({ views: l.views, sales: sold, ageDays });
    return {
      listingId: l.listingId,
      title: l.title,
      url: l.url,
      state: l.state,
      priceCents: l.priceCents,
      views: l.views,
      favorites: l.favorites,
      tags: l.tags,
      ageDays,
      sales: sold,
      revenueCents: revenue,
      avgPaidCents: sold > 0 ? Math.round(revenue / sold) : null,
      avgDiscountPct: withList.length > 0 ? discountPercent(listTotal, paidWithList) : null,
      viewsToSalesPct: ratePercent(sold, l.views),
      views7d,
      profitCents: profit,
      avgProfitCents: sold > 0 ? Math.round(profit / sold) : null,
      breakEvenPriceCents: priceForTargetProfit(0, overheadPerSaleCents, s),
      minProfitPriceCents: priceForTargetProfit(s.minProfitCents, overheadPerSaleCents, s),
      status: st.status,
      statusWhy: st.why,
    };
  });
  listingRows.sort((a, b) => b.revenueCents - a.revenueCents || b.views - a.views);

  // ----- Money screen -----
  const feeBreakdown: { label: string; cents: number }[] = [];
  if (hasLedgerFees) {
    for (const cat of FEE_CATEGORIES) {
      const cents = -sum(feeEntries.filter((e) => e.category === cat).map((e) => e.amountCents));
      if (cents !== 0) feeBreakdown.push({ label: CATEGORY_LABELS[cat], cents });
    }
  } else if (sales.length > 0) {
    feeBreakdown.push(
      { label: CATEGORY_LABELS.transaction_fee, cents: estParts.transaction },
      { label: CATEGORY_LABELS.processing_fee, cents: estParts.processing },
      { label: CATEGORY_LABELS.listing_fee, cents: estParts.listing },
      { label: CATEGORY_LABELS.fee_tax, cents: estParts.feeTax },
    );
  }

  const withList = sales.filter((x) => x.listCents !== null);
  const listValue = withList.length > 0 ? sum(withList.map((x) => x.listCents ?? 0)) : null;
  const profitCents = revenueCents - feesCents - adsCents - costsCents - refundsCents;
  const fixedSpend = adsCents + costsCents;
  const avgContribution = items > 0 ? Math.round((revenueCents - feesCents) / items) : null;

  const money: MoneySummary = {
    revenueCents,
    taxCollectedCents: taxCollected,
    shippingCollectedCents: shippingCollected,
    listValueCents: listValue,
    avgDiscountPct: listValue !== null ? discountPercent(listValue, sum(withList.map((x) => x.paidCents))) : null,
    feesCents,
    feesSource: hasLedgerFees ? "ledger" : "estimated",
    feeBreakdown,
    adsCents,
    adsSource: ads.source,
    costsCents,
    refundsCents,
    profitCents,
    orders: seenReceipts.size,
    items,
    avgProfitPerSaleCents: items > 0 ? Math.round(sum(sales.map((x) => x.profitCents)) / items) : null,
    salesBelowMinimum: sales.filter((x) => x.belowMinimum).length,
    fixedSpendCents: fixedSpend,
    avgContributionCents: avgContribution,
    salesToBreakEven: avgContribution !== null && avgContribution > 0 ? Math.ceil(fixedSpend / avgContribution) : null,
    probableAdFees: adEntries
      .map((e) => ({ day: e.day, description: e.description || e.ledgerType, cents: -e.amountCents }))
      .sort((a, b) => b.day.localeCompare(a.day)),
    otherLedgerLines: ledger
      .filter((e) => e.category === "other")
      .map((e) => ({ day: e.day, description: e.description || e.ledgerType, cents: e.amountCents }))
      .sort((a, b) => b.day.localeCompare(a.day)),
  };

  // ----- Countries -----
  const countryMap = new Map<string, { orders: Set<number>; revenueCents: number }>();
  for (const row of sales) {
    const c = countryMap.get(row.country) ?? { orders: new Set<number>(), revenueCents: 0 };
    c.orders.add(row.receiptId);
    c.revenueCents += row.paidCents;
    countryMap.set(row.country, c);
  }
  const countries = [...countryMap.entries()]
    .map(([country, v]) => ({ country, orders: v.orders.size, revenueCents: v.revenueCents }))
    .sort((a, b) => b.orders - a.orders || b.revenueCents - a.revenueCents);

  // ----- Honest notes about estimated or missing numbers -----
  if (!hasLedgerFees && sales.length > 0) {
    notes.push("Etsy fees are estimated from the fee settings, because no fee lines were found in Etsy's bill yet.");
  } else if (anyFeesEstimated) {
    notes.push(
      "Total fees come from Etsy's bill. Fees shown per sale are partly estimated, because the bill does not link every fee to one order.",
    );
  }
  if (ads.source === "none") {
    notes.push(
      "No ad spend was found in Etsy's bill and none was typed in, so ads count as " +
        formatAud(0) +
        ". If you run Etsy Ads, enter the weekly spend under Manual entries.",
    );
  } else if (ads.source !== "ledger") {
    notes.push("Some ad spend is typed in by hand and spread evenly over the week. Treat it as an estimate.");
  }
  if (views.firstSnapshotDay === null) {
    notes.push("No daily view history yet. Daily views appear after the first daily data pull.");
  } else if (thisWeek.views === null || lastWeek.views === null) {
    notes.push(
      `Daily view history starts on ${views.firstSnapshotDay}. Week-on-week views need two full weeks of history.`,
    );
  }
  if (thisWeek.visits === null) {
    notes.push(
      "Shop visits, traffic sources and search terms are not available from Etsy's API. Type weekly visits under Manual entries, or upload the Stats CSV.",
    );
  }
  if (nonAud) notes.push("Some orders are not in AUD. They are shown without currency conversion.");

  // ----- Latest traffic sources typed in by hand -----
  let trafficSources: Metrics["trafficSources"] = null;
  const withSources = input.weekly
    .filter((w) => [w.srcSearch, w.srcAds, w.srcEtsyOther, w.srcSocial, w.srcDirect].some((v) => v !== null))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
  if (withSources) {
    trafficSources = {
      weekStart: withSources.weekStart,
      sources: [
        { label: "Etsy search", visits: withSources.srcSearch ?? 0 },
        { label: "Etsy Ads", visits: withSources.srcAds ?? 0 },
        { label: "Other Etsy pages", visits: withSources.srcEtsyOther ?? 0 },
        { label: "Social media", visits: withSources.srcSocial ?? 0 },
        { label: "Direct and other", visits: withSources.srcDirect ?? 0 },
      ],
    };
  }

  return {
    today,
    days,
    sales,
    listings: listingRows,
    money,
    thisWeek,
    lastWeek,
    countries,
    dataNotes: notes,
    trafficSources,
    overheadPerSaleCents,
    firstSnapshotDay: views.firstSnapshotDay,
  };
}

// ---------------------------------------------------------------------------
// Builds the one big JSON answer the phone app needs.
// Database rows in -> worked-out numbers and suggestions out.
// ---------------------------------------------------------------------------

import { breakEvenRoas, buildAdsWeeks } from "../shared/ads";
import { dayKey } from "../shared/dates";
import { classifyLedgerEntry } from "../shared/fees";
import { computeMetrics } from "../shared/metrics";
import { buildSuggestions, pickNextSteps } from "../shared/suggestions";
import type { AdsData, Briefing, DashboardData, SyncStatus } from "../shared/types";
import { loadAll, type AllData } from "./db";
import type { Env } from "./env";

/** "Refresh now" may be used once every 10 minutes. */
export const REFRESH_COOLDOWN_SECONDS = 10 * 60;

export function buildStatus(all: AllData, env: Env, now: number): SyncStatus {
  const metaNum = (key: string): number | null => (all.meta.has(key) ? Number(all.meta.get(key)) : null);
  const lastRefreshAt = metaNum("last_refresh_at");
  const days = new Set(all.snapshots.map((s) => s.day));
  return {
    dataMode: all.meta.get("data_mode") === "real" ? "real" : "sample",
    etsyConfigured: !!env.ETSY_KEYSTRING,
    etsyConnected: all.etsyConnected,
    lastSyncAt: metaNum("last_sync_at"),
    lastSyncOk: all.meta.has("last_sync_ok") ? all.meta.get("last_sync_ok") === "1" : null,
    lastSyncMessage: all.meta.get("last_sync_message") ?? null,
    lastRefreshAt,
    refreshWaitSeconds: lastRefreshAt === null ? 0 : Math.max(0, lastRefreshAt + REFRESH_COOLDOWN_SECONDS - now),
    snapshotDays: days.size,
    firstSnapshotDay: all.snapshots[0]?.day ?? null,
  };
}

/** Read saved JSON text. Returns null if it is missing or broken. */
function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function buildDashboardFrom(all: AllData, env: Env, now: number): DashboardData {
  // Suggestions and the Listings screen are about listings that are live now.
  const listings = all.listings.filter((l) => l.state === "active");
  const metrics = computeMetrics({
    now,
    shop: all.shop,
    listings,
    snapshots: all.snapshots,
    receipts: all.receipts,
    ledger: all.ledger,
    weekly: all.weekly,
    costs: all.costs,
    dailyStats: all.dailyStats,
    settings: all.settings,
  });

  // Ad campaigns: spend from Etsy's bill (or typed in), the rest typed in from Etsy Ads.
  const adEntries = all.ledger
    .filter((e) => classifyLedgerEntry(e) === "ads")
    .map((e) => ({ day: dayKey(e.createdTs, all.settings.timezone), amountCents: e.amountCents }));
  // Roughly how much of each sale Etsy keeps. Falls back to 20% before there are any sales.
  const feeSharePct = metrics.money.revenueCents > 0 ? Math.round((metrics.money.feesCents / metrics.money.revenueCents) * 1000) / 10 : 20;
  const ads: AdsData = {
    weeks: buildAdsWeeks(adEntries, all.weekly, all.adStats),
    listingStats: all.adStats.filter((a) => a.listingId !== 0),
    feeSharePct,
    breakEvenRoas: breakEvenRoas(feeSharePct),
  };

  const suggestions = buildSuggestions({
    ads,
    titles: new Map(all.listings.map((l) => [l.listingId, l.title])),
    today: metrics.today,
    listings,
    rows: metrics.listings,
    sales: metrics.sales,
    money: metrics.money,
    thisWeek: metrics.thisWeek,
    weekly: all.weekly,
    reviewCount: Math.max(all.reviews.length, all.shop?.reviewCount ?? 0),
    settings: all.settings,
  });

  const briefing = parseJson<Briefing>(all.meta.get("briefing"));

  return {
    generatedAt: now,
    today: metrics.today,
    shop: all.shop,
    status: buildStatus(all, env, now),
    settings: all.settings,
    thisWeek: metrics.thisWeek,
    lastWeek: metrics.lastWeek,
    days: metrics.days,
    sales: metrics.sales,
    listings: metrics.listings,
    money: metrics.money,
    countries: metrics.countries,
    suggestions,
    nextSteps: pickNextSteps(suggestions),
    weekly: all.weekly,
    costs: all.costs,
    reviewCount: Math.max(all.reviews.length, all.shop?.reviewCount ?? 0),
    dataNotes: metrics.dataNotes,
    briefing,
    trafficSources: metrics.trafficSources,
    ads,
  };
}

export async function buildDashboard(env: Env, now: number): Promise<DashboardData> {
  return buildDashboardFrom(await loadAll(env.DB), env, now);
}

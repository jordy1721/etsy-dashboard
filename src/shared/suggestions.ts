// ---------------------------------------------------------------------------
// SUGGESTION ENGINE (rule based)
// Each rule is a small function. It looks at the numbers, and if something is
// wrong it returns a to-do item that says:
//   What to do / What to consider / What to expect
// and quotes the numbers it used, so you can check it yourself.
// Higher score = more important. The list is sorted by score.
// ---------------------------------------------------------------------------

import { MIN_CLICKS_TO_JUDGE, adsByListing, totalAds, weeksInRange } from "./ads";
import { formatAud } from "./money";
import { STATUS_RULES } from "./status";
import type { AdsData, Listing, ListingRow, MoneySummary, PeriodSummary, SaleRow, Settings, Suggestion, WeeklyManual } from "./types";

export interface SuggestionContext {
  today: string;
  /** Raw listings (we need the description and tags). */
  listings: Listing[];
  /** Listings with their worked-out numbers. */
  rows: ListingRow[];
  sales: SaleRow[];
  money: MoneySummary;
  thisWeek: PeriodSummary;
  weekly: WeeklyManual[];
  reviewCount: number;
  settings: Settings;
  /** Ad campaign numbers (typed in). Optional so older callers and tests still work. */
  ads?: AdsData;
  /** Listing titles by ID, for naming advertised listings. */
  titles?: Map<number, string>;
}

/** Shorten long listing titles so cards stay readable on a phone. */
export function shortTitle(title: string, max = 42): string {
  return title.length <= max ? title : `${title.slice(0, max - 1).trimEnd()}…`;
}

// --- Rule: a listing with zero views is not being found at all -------------
export function ruleZeroViews(ctx: SuggestionContext): Suggestion[] {
  return ctx.rows
    .filter((l) => l.views === 0 && l.ageDays >= 2)
    .map((l) => ({
      id: `zero-views-${l.listingId}`,
      rule: "zero-views",
      score: 78,
      listingId: l.listingId,
      title: `"${shortTitle(l.title)}" has 0 views. Nobody is finding it.`,
      what: "Open the listing on Etsy and check it is active. Then rewrite the title and tags using the exact words a buyer would type into search. Share the link once yourself to confirm it loads.",
      consider: "Zero views is a visibility problem, not a price problem. Do not discount it. A discount on a listing nobody sees changes nothing.",
      expect: "After fixing title and tags, the first views usually show within 3 to 7 days. If it still has 0 after a week, the search words are wrong or too competitive.",
      numbers: `0 views, 0 sales, listed ${l.ageDays} days ago.`,
    }));
}

// --- Rule: under 20 views after 14 days = traffic problem ------------------
export function ruleLowTraffic(ctx: SuggestionContext): Suggestion[] {
  const R = STATUS_RULES;
  return ctx.rows
    .filter((l) => l.views > 0 && l.views < R.minViewsToJudge && l.ageDays >= R.graceDays)
    .map((l) => ({
      id: `low-traffic-${l.listingId}`,
      rule: "low-traffic",
      score: 70,
      listingId: l.listingId,
      title: `Not enough traffic on "${shortTitle(l.title)}".`,
      what: "Get visitors. The listing is not the problem yet. Post it on your own social accounts, and swap weak tags for phrases buyers search for.",
      consider: `With under ${R.minViewsToJudge} views you cannot tell if the price or photos work. Changing them now is guessing.`,
      expect: `Aim for ${R.viewsWithNoSales} views. Only then judge the listing. At your shop's current pace that could take weeks without outside traffic.`,
      numbers: `${l.views} views in ${l.ageDays} days (rule: under ${R.minViewsToJudge} views after ${R.graceDays} days).`,
    }));
}

// --- Rule: 50+ views and 0 sales = listing problem -------------------------
export function ruleViewsNoSales(ctx: SuggestionContext): Suggestion[] {
  const R = STATUS_RULES;
  return ctx.rows
    .filter((l) => l.views >= R.viewsWithNoSales && l.sales === 0)
    .map((l) => ({
      id: `views-no-sales-${l.listingId}`,
      rule: "views-no-sales",
      score: 82,
      listingId: l.listingId,
      title: `"${shortTitle(l.title)}" gets looked at but nobody buys.`,
      what: "Check three things in this order: 1) the price against similar listings, 2) the first photo (does it show exactly what the buyer gets?), 3) the title (is it clear in the first 40 characters?). Change ONE thing, then wait.",
      consider: "If you change everything at once you will not know what worked. Traffic is fine here. The listing is what needs work.",
      expect: `Give each change about ${R.viewsWithNoSales} more views. A healthy digital listing turns roughly 1 to 3 of every 100 views into a sale.`,
      numbers: `${l.views} views, ${l.favorites} favourites, 0 sales (rule: ${R.viewsWithNoSales}+ views with 0 sales).`,
    }));
}

// --- Rule: fewer than 13 tags ----------------------------------------------
export function ruleFewTags(ctx: SuggestionContext): Suggestion[] {
  return ctx.listings
    .filter((l) => l.tags.length < 13)
    .map((l) => ({
      id: `few-tags-${l.listingId}`,
      rule: "few-tags",
      score: 50,
      listingId: l.listingId,
      title: `"${shortTitle(l.title)}" uses only ${l.tags.length} of 13 tags.`,
      what: `Add ${13 - l.tags.length} more tags. Use phrases of 2 to 3 words that a buyer would search, not single words.`,
      consider: "Every empty tag is a free chance to show up in search that you are not using. It costs nothing.",
      expect: "A small lift in views over 1 to 2 weeks. Tags alone will not fix a listing nobody wants.",
      numbers: `${l.tags.length} tags used, 13 allowed.`,
    }));
}

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "your", "you", "a", "an", "of", "to", "in", "on"]);
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/** Tags whose every word is already in the title (they add nothing new to search). */
export function tagsRepeatingTitle(title: string, tags: string[]): string[] {
  const titleWords = new Set(words(title));
  return tags.filter((tag) => {
    const w = words(tag);
    return w.length > 0 && w.every((x) => titleWords.has(x));
  });
}

// --- Rule: tags that only repeat the title ---------------------------------
export function ruleTagsRepeatTitle(ctx: SuggestionContext): Suggestion[] {
  const out: Suggestion[] = [];
  for (const l of ctx.listings) {
    const repeats = tagsRepeatingTitle(l.title, l.tags);
    if (repeats.length < 2) continue;
    out.push({
      id: `tags-repeat-${l.listingId}`,
      rule: "tags-repeat-title",
      score: 42,
      listingId: l.listingId,
      title: `${repeats.length} tags on "${shortTitle(l.title)}" just repeat the title.`,
      what: `Replace these tags with different search phrases: ${repeats.slice(0, 5).join(", ")}. Think of who uses the product and what for.`,
      consider: "Etsy already reads your title. A tag that repeats it does not reach any new search.",
      expect: "More ways to be found. Expect a slow, small rise in views, not a jump.",
      numbers: `${repeats.length} of ${l.tags.length} tags use only words that are already in the title.`,
    });
  }
  return out;
}

// --- Rule: average discount over 50% ---------------------------------------
export function ruleDeepDiscount(ctx: SuggestionContext): Suggestion[] {
  const out: Suggestion[] = [];
  for (const l of ctx.rows) {
    if (l.avgDiscountPct === null || l.avgDiscountPct <= 50 || l.sales === 0) continue;
    const below = l.avgPaidCents !== null && l.avgPaidCents < l.minProfitPriceCents;
    out.push({
      id: `deep-discount-${l.listingId}`,
      rule: "deep-discount",
      score: below ? 88 : 72,
      listingId: l.listingId,
      title: `"${shortTitle(l.title)}" sells at ${l.avgDiscountPct.toFixed(0)}% off. Fees and ads may eat the profit.`,
      what: `Do not sell this below ${formatAud(l.breakEvenPriceCents)} (break-even). To earn your minimum profit, charge at least ${formatAud(l.minProfitPriceCents)}. Test a smaller discount (for example 40 to 50% off) for two weeks.`,
      consider: "Every sale so far was on a deep sale price, so you do not know yet if buyers would pay more. A permanent 70% off also makes the list price look fake.",
      expect: "Fewer sales but more profit on each one. If sales stop completely at the higher price, the product needs more value, not a bigger discount.",
      numbers: `List price ${formatAud(l.priceCents)}, average paid ${formatAud(l.avgPaidCents ?? 0)}, average discount ${l.avgDiscountPct.toFixed(1)}%, average profit per sale ${formatAud(l.avgProfitCents ?? 0)}, break-even ${formatAud(l.breakEvenPriceCents)}.`,
    });
  }
  return out;
}

/**
 * Find product names in a description (like "Mega Bundle") that do not match
 * any active listing title. Returns the names found.
 */
export function missingProductMentions(description: string, activeTitles: string[]): string[] {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const titles = activeTitles.map(norm);
  // Capitalised words followed by Bundle / Pack / Kit / Collection.
  const re = /\b((?:[A-Z0-9][A-Za-z0-9']*\s+){1,3}(?:Bundle|Pack|Kit|Collection))\b/g;
  const found = new Set<string>();
  for (const m of description.matchAll(re)) {
    const phrase = (m[1] ?? "").trim();
    // Drop leading filler words such as "The" or "Our".
    const cleaned = phrase.replace(/^(?:The|Our|My|This|That|Get|Full|In|See)\s+/i, "");
    if (!titles.some((t) => t.includes(norm(cleaned)))) found.add(cleaned);
  }
  return [...found];
}

// --- Rule: description mentions a product that is not for sale -------------
export function ruleMissingProduct(ctx: SuggestionContext): Suggestion[] {
  const titles = ctx.listings.filter((l) => l.state === "active").map((l) => l.title);
  const out: Suggestion[] = [];
  for (const l of ctx.listings) {
    const missing = missingProductMentions(l.description, titles);
    if (missing.length === 0) continue;
    out.push({
      id: `missing-product-${l.listingId}`,
      rule: "missing-product",
      score: 58,
      listingId: l.listingId,
      title: `"${shortTitle(l.title)}" mentions "${missing[0]}", which is not in your shop.`,
      what: `Either remove the mention of ${missing.map((m) => `"${m}"`).join(", ")} from the description, or create that listing and link to it.`,
      consider: "A buyer who looks for a product you mention and cannot find it loses trust, and may leave without buying anything.",
      expect: "No big jump in sales. This removes a reason to doubt the shop, which matters most while you have 0 reviews.",
      numbers: `Description mentions ${missing.map((m) => `"${m}"`).join(", ")}. No active listing title contains it.`,
    });
  }
  return out;
}

// --- Rule: no reviews after N sales ----------------------------------------
export function ruleNoReviews(ctx: SuggestionContext): Suggestion[] {
  const n = ctx.settings.reviewAfterSales;
  if (ctx.reviewCount > 0 || ctx.money.orders < n) return [];
  return [
    {
      id: "no-reviews",
      rule: "no-reviews",
      score: 64,
      title: `${ctx.money.orders} orders and 0 reviews. Ask for reviews.`,
      what: "Send each past buyer one short, polite Etsy message: thank them, ask if the files worked, and say an honest review would help a new shop. Add the same line to your download note for future buyers.",
      consider: "Ask once only, and never offer anything in return for a review. That breaks Etsy's rules. Do not ask for a 5-star review, ask for an honest one.",
      expect: "Roughly 1 in 10 to 1 in 5 buyers leave a review when asked. Even 2 or 3 reviews make a new shop look much safer to buy from.",
      numbers: `${ctx.money.orders} orders, ${ctx.reviewCount} reviews (rule: no reviews after ${n} sales).`,
    },
  ];
}

// --- Rule: profit per sale below the minimum -------------------------------
export function ruleLowProfit(ctx: SuggestionContext): Suggestion[] {
  const min = ctx.settings.minProfitCents;
  const out: Suggestion[] = [];
  for (const l of ctx.rows) {
    const rows = ctx.sales.filter((x) => x.listingId === l.listingId);
    const below = rows.filter((x) => x.belowMinimum);
    if (below.length === 0 || l.avgProfitCents === null) continue;
    out.push({
      id: `low-profit-${l.listingId}`,
      rule: "low-profit",
      score: l.avgProfitCents < 0 ? 95 : 90,
      listingId: l.listingId,
      title:
        l.avgProfitCents < 0
          ? `You lose money on each "${shortTitle(l.title)}" sale.`
          : `"${shortTitle(l.title)}" earns under your ${formatAud(min)} minimum per sale.`,
      what: `Raise the price actually paid to at least ${formatAud(l.minProfitPriceCents)}, or cut the cost per sale (ads are usually the biggest part).`,
      consider: "More sales at this price do not help. Each one earns almost nothing after Etsy fees and your share of ads and costs.",
      expect: `At ${formatAud(l.minProfitPriceCents)} you keep about ${formatAud(min)} per sale. You may sell fewer, but each sale is worth making.`,
      numbers: `${below.length} of ${rows.length} sales below ${formatAud(min)}. Average paid ${formatAud(l.avgPaidCents ?? 0)}, average profit ${formatAud(l.avgProfitCents)}.`,
    });
  }
  return out;
}

// --- Rule: ads cost a big slice of what the shop earns ---------------------
export function ruleAdsEatingProfit(ctx: SuggestionContext): Suggestion[] {
  const m = ctx.money;
  if (m.adsCents <= 0 || m.revenueCents <= 0) return [];
  const share = (m.adsCents / m.revenueCents) * 100;
  if (share < 25) return [];
  return [
    {
      id: "ads-eating-profit",
      rule: "ads-eating-profit",
      score: m.profitCents < 0 ? 93 : 86,
      title: `Ads cost ${share.toFixed(0)}% of your revenue.`,
      what: "Lower the daily Etsy Ads budget to the minimum, and advertise only the listings marked Working. Turn ads off for listings with no sales.",
      consider: "With a 70% discount, each sale leaves very little room to pay for ads. You cannot see which sales came from ads through the API, so check Etsy's Ads page.",
      expect: "Fewer views straight away. Profit per sale should rise within a week. If sales drop to zero without ads, the shop depends on paid traffic and needs free traffic.",
      numbers: `Ad spend ${formatAud(m.adsCents)} against revenue ${formatAud(m.revenueCents)}. Net profit ${formatAud(m.profitCents)}.`,
    },
  ];
}

// --- Rule: ads bring back less than they cost (last 4 weeks) ---------------
export function ruleAdsLosingMoney(ctx: SuggestionContext): Suggestion[] {
  if (!ctx.ads) return [];
  const t = totalAds(weeksInRange(ctx.ads.weeks, ctx.today, 4), ctx.ads.feeSharePct);
  // Needs real spend and typed-in ad revenue, otherwise there is nothing to compare.
  if (t.spendCents < 500 || t.roas === null || t.profitCents === null || t.roas >= ctx.ads.breakEvenRoas) return [];
  return [
    {
      id: "ads-losing-money",
      rule: "ads-losing-money",
      score: 92,
      title: `Your ads lost ${formatAud(-t.profitCents)} in the last 4 weeks.`,
      what: "Open Etsy Ads and turn off advertising for every listing marked Losing money on the Ads screen. Drop the daily budget to the minimum for the rest.",
      consider: `For every A$1.00 of ads you got A$${t.roas.toFixed(2)} of sales back, and Etsy still takes its fees from that. You need A$${ctx.ads.breakEvenRoas.toFixed(2)} back just to break even.`,
      expect: "Fewer views and maybe fewer sales, but the sales you keep will be profitable. Check again after two weeks.",
      numbers: `Last 4 weeks: ad spend ${formatAud(t.spendCents)}, sales from ads ${formatAud(t.revenueCents ?? 0)}, ROAS ${t.roas.toFixed(2)}, break-even ROAS ${ctx.ads.breakEvenRoas.toFixed(2)}.`,
    },
  ];
}

// --- Rule: an advertised listing gets clicks but no orders -----------------
export function ruleAdListingNoOrders(ctx: SuggestionContext): Suggestion[] {
  if (!ctx.ads) return [];
  return adsByListing(ctx.ads.listingStats, ctx.titles ?? new Map<number, string>(), ctx.ads.feeSharePct)
    .filter((l) => (l.clicks ?? 0) >= MIN_CLICKS_TO_JUDGE && (l.orders ?? 0) === 0)
    .map((l) => ({
      id: `ad-no-orders-${l.listingId}`,
      rule: "ad-no-orders",
      score: 84,
      listingId: l.listingId,
      title: `Ads for "${shortTitle(l.title)}" get clicks but no orders.`,
      what: "Turn off ads for this listing in Etsy Ads. Fix the listing first (price, first photo, description), then test ads again.",
      consider: "People clicked, so the ad works. They did not buy, so the listing page is where they change their mind.",
      expect: "You stop paying for clicks that do not convert. Nothing is lost: it was earning nothing from ads.",
      numbers: `${l.clicks} ad clicks, 0 orders, ${formatAud(l.spendCents)} spent (rule: ${MIN_CLICKS_TO_JUDGE}+ clicks with 0 orders).`,
    }));
}

// --- Rule: an advertised listing is shown a lot but rarely clicked ---------
export function ruleAdLowClickRate(ctx: SuggestionContext): Suggestion[] {
  if (!ctx.ads) return [];
  return adsByListing(ctx.ads.listingStats, ctx.titles ?? new Map<number, string>(), ctx.ads.feeSharePct)
    .filter((l) => (l.views ?? 0) >= 300 && l.clickRatePct !== null && l.clickRatePct < 1)
    .map((l) => ({
      id: `ad-low-click-rate-${l.listingId}`,
      rule: "ad-low-click-rate",
      score: 54,
      listingId: l.listingId,
      title: `Few people click the ad for "${shortTitle(l.title)}".`,
      what: "Change the first photo and the first words of the title. In search results that is all a shopper sees of your ad.",
      consider: "A low click rate costs little directly (you pay per click), but it means the ad is shown to people who scroll past.",
      expect: "A click rate above 1% is a reasonable first target. Change one thing and compare after a week.",
      numbers: `${l.views} ad views, ${l.clicks ?? 0} clicks, click rate ${l.clickRatePct?.toFixed(1)}% (rule: 300+ views and under 1%).`,
    }));
}

// --- Rule: paying for ads but the ad numbers were never typed in -----------
export function ruleAdsNoNumbers(ctx: SuggestionContext): Suggestion[] {
  if (!ctx.ads) return [];
  const recent = weeksInRange(ctx.ads.weeks, ctx.today, 4);
  const blind = recent.filter((w) => w.spendCents > 0 && w.clicks === null && w.revenueCents === null);
  if (blind.length === 0) return [];
  const spend = blind.reduce((n, w) => n + w.spendCents, 0);
  return [
    {
      id: "ads-no-numbers",
      rule: "ads-no-numbers",
      score: 34,
      title: `You paid ${formatAud(spend)} for ads with no results typed in.`,
      what: "Open Etsy > Marketing > Etsy Ads, and copy the views, clicks, orders and revenue for each week into the Ads screen here.",
      consider: "Etsy does not share ad results through its API. Without them this app can see what ads cost, but not what they earned.",
      expect: "Two minutes a week. In return you see if ads make or lose money, per listing.",
      numbers: `${blind.length} week${blind.length === 1 ? "" : "s"} in the last 4 with ad spend but no clicks or revenue entered.`,
    },
  ];
}

// --- Rule: no weekly visits typed in ---------------------------------------
export function ruleMissingVisits(ctx: SuggestionContext): Suggestion[] {
  if (ctx.thisWeek.visits !== null) return [];
  return [
    {
      id: "missing-visits",
      rule: "missing-visits",
      score: 20,
      title: "Your visit numbers are missing.",
      what: "Once a week, open Etsy > Shop Manager > Stats, and type the visits (and traffic sources) into Manual entries here. It takes 2 minutes.",
      consider: "Etsy does not share visits or traffic sources through its API. Without them the conversion rate here is only a rough guess based on listing views.",
      expect: "A true conversion rate, and a clear view of where buyers come from, so you know which traffic is worth chasing.",
      numbers: "No visits entered for the last 7 days.",
    },
  ];
}

/** Every rule, in one list. Add new rules here. */
export const ALL_RULES: ((ctx: SuggestionContext) => Suggestion[])[] = [
  ruleLowProfit,
  ruleAdsLosingMoney,
  ruleAdListingNoOrders,
  ruleAdsEatingProfit,
  ruleDeepDiscount,
  ruleViewsNoSales,
  ruleZeroViews,
  ruleLowTraffic,
  ruleNoReviews,
  ruleMissingProduct,
  ruleFewTags,
  ruleTagsRepeatTitle,
  ruleAdLowClickRate,
  ruleAdsNoNumbers,
  ruleMissingVisits,
];

/** Run every rule and sort the results, most important first. */
export function buildSuggestions(ctx: SuggestionContext): Suggestion[] {
  const all = ALL_RULES.flatMap((rule) => rule(ctx));
  return all.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Rules that give the same kind of advice share a topic. */
const TOPIC: Record<string, string> = { "low-profit": "price", "deep-discount": "price", "ads-losing-money": "ads", "ads-eating-profit": "ads", "ad-no-orders": "ads" };

/**
 * The 3 most valuable actions this week.
 * We take the top items but only ONE per topic, so the list is not three
 * versions of the same advice (for example "raise the price" three times).
 */
export function pickNextSteps(suggestions: Suggestion[], count = 3): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const sug of suggestions) {
    const topic = TOPIC[sug.rule] ?? sug.rule;
    if (seen.has(topic)) continue;
    seen.add(topic);
    out.push(sug);
    if (out.length >= count) break;
  }
  return out;
}

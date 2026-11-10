// ---------------------------------------------------------------------------
// LISTING STATUS LABELS
// One clear label per listing, with the reason in plain words.
// ---------------------------------------------------------------------------

import type { ListingStatus } from "./types";

export const STATUS_RULES = {
  /** Under this many views we cannot judge the listing itself. */
  minViewsToJudge: 20,
  /** A new listing gets this many days before we say "Needs traffic". */
  graceDays: 14,
  /** This many views with zero sales means the listing is the problem. */
  viewsWithNoSales: 50,
  /** Sales per 100 views that counts as healthy. */
  goodRatePct: 2,
  /** Sales per 100 views that counts as weak. */
  weakRatePct: 1,
};

export function listingStatus(input: { views: number; sales: number; ageDays: number }): {
  status: ListingStatus;
  why: string;
} {
  const { views, sales, ageDays } = input;
  const R = STATUS_RULES;
  const rate = views > 0 ? (sales / views) * 100 : null;
  const rateText = rate === null ? "" : `${rate.toFixed(1)}% of views turn into a sale`;

  const seen = views === 0 ? "No views" : `Only ${views} view${views === 1 ? "" : "s"}`;

  // Not many eyes on it yet: the listing itself cannot be judged.
  if (views < R.minViewsToJudge) {
    if (ageDays < R.graceDays) {
      return {
        status: "Not enough data yet",
        why: `${seen} in ${ageDays} days. Too new to judge. Check again after day ${R.graceDays}.`,
      };
    }
    return {
      status: "Needs traffic",
      why: `${seen} in ${ageDays} days. People are not finding it. The listing is not the problem yet.`,
    };
  }

  if (sales === 0) {
    if (views >= R.viewsWithNoSales) {
      return {
        status: "Needs a better listing",
        why: `${views} views and 0 sales. People look but do not buy. Check price, first photo and title.`,
      };
    }
    return {
      status: "Not enough data yet",
      why: `${views} views and 0 sales. Wait for ${R.viewsWithNoSales} views before changing the listing.`,
    };
  }

  if (rate !== null && rate >= R.goodRatePct) {
    return { status: "Working", why: `${sales} sales from ${views} views. ${rateText}.` };
  }
  if (rate !== null && rate < R.weakRatePct) {
    return {
      status: "Needs a better listing",
      why: `${sales} sales from ${views} views. Only ${rateText}. Improve photo, title or price.`,
    };
  }
  return { status: "Not enough data yet", why: `${sales} sales from ${views} views. ${rateText}. Keep watching.` };
}

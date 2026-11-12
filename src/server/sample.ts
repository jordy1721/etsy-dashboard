// ---------------------------------------------------------------------------
// SAMPLE DATA
// Realistic but INVENTED data shaped like the real shop, so every screen works
// before Etsy is connected. No real buyer details: orders only carry a country
// code, and all order / fee numbers are made up.
//
// Everything is placed relative to "now": the sample shop opened 28 days ago.
// ---------------------------------------------------------------------------

import { addDays, dayKey, dayRange, weekStart } from "../shared/dates";
import { percentOf } from "../shared/money";
import type { AdStat } from "../shared/ads";
import type { Cost, LedgerEntry, Listing, Receipt, ShopInfo, Snapshot, WeeklyManual } from "../shared/types";

export interface SampleData {
  shop: ShopInfo;
  listings: Listing[];
  snapshots: Snapshot[];
  receipts: Receipt[];
  ledger: LedgerEntry[];
  weekly: WeeklyManual[];
  costs: Omit<Cost, "id">[];
  adStats: AdStat[];
}

const TZ = "Australia/Sydney";
const SHOP_AGE_DAYS = 28;

/** Unix seconds for midday (Sydney-ish) on a given day, plus some minutes so orders differ. */
function tsOn(day: string, minutes = 0): number {
  return Math.floor(Date.parse(`${day}T02:00:00Z`) / 1000) + minutes * 60;
}

interface ListingSeed {
  listingId: number;
  title: string;
  priceCents: number;
  views: number;
  favorites: number;
  /** Listed this many days after the shop opened. */
  createdOffset: number;
  tags: string[];
  description: string;
}

const LISTING_SEEDS: ListingSeed[] = [
  {
    listingId: 4594983295,
    title: "254 YouTube Sound Effects Bundle",
    priceCents: 3999,
    views: 89,
    favorites: 4,
    createdOffset: 0,
    tags: [
      "sound effects", "youtube sfx", "video editing", "whoosh sounds", "creator pack", "podcast sounds",
      "transition sfx", "editing pack", "streamer sounds", "meme sounds", "vlog audio", "gaming sfx", "audio pack",
    ],
    description:
      "254 royalty-free sound effects for YouTube videos. Whooshes, pops, risers, clicks and more. Instant digital download. WAV and MP3 included.",
  },
  {
    listingId: 4594399190,
    title: "54 YouTube Subscribe Button Animations",
    priceCents: 1299,
    views: 67,
    favorites: 7,
    createdOffset: 0,
    tags: [
      "subscribe button", "youtube animations", "subscribe animations", "youtube subscribe", "button animations",
      "green screen", "video overlay", "channel branding", "like and subscribe",
    ],
    description:
      "54 animated subscribe buttons with transparent background. Drag and drop into any editor. Want everything? Grab the Mega Bundle in our shop and save.",
  },
  {
    listingId: 4595002480,
    title: "50 YouTube Sound Effects",
    priceCents: 1299,
    views: 14,
    favorites: 0,
    createdOffset: 1,
    tags: [
      "sound effects", "youtube sound", "youtube effects", "sfx starter", "video editor gift", "whoosh pack",
      "pop sounds", "click sounds", "riser sfx", "editing sounds", "creator audio", "shorts sounds", "reels audio",
    ],
    description: "A starter pack of 50 sound effects for YouTube creators. Instant digital download.",
  },
  {
    listingId: 4611933994,
    title: "54 Instagram Reels Follow Animations",
    priceCents: 1299,
    views: 0,
    favorites: 0,
    createdOffset: 17,
    tags: ["instagram reels", "follow animations", "reels overlay", "instagram follow", "follow button", "social overlay"],
    description: "54 animated follow buttons made for Instagram Reels. Transparent background. Instant digital download.",
  },
  {
    listingId: 4611934116,
    title: "54 TikTok Follow Animations",
    priceCents: 1299,
    views: 4,
    favorites: 0,
    createdOffset: 17,
    tags: [
      "tiktok overlay", "follow button", "creator graphics", "video stickers", "green screen", "short video",
      "social media kit", "influencer pack", "animated button", "transparent video", "editing assets", "content creator",
      "viral video",
    ],
    description: "54 animated follow buttons made for TikTok videos. Transparent background. Instant digital download.",
  },
];

/** [days after opening, index into LISTING_SEEDS, buyer country, tax rate % collected by Etsy] */
const SALE_SEEDS: [number, number, string, number][] = [
  [3, 1, "US", 0],
  [5, 0, "IT", 22],
  [8, 1, "IT", 22],
  [10, 0, "DE", 19],
  [13, 1, "US", 8],
  [16, 0, "IT", 22],
  [18, 2, "RO", 21],
  [20, 1, "SE", 25],
  [22, 0, "US", 0],
  [24, 1, "IT", 22],
  [26, 0, "ES", 21],
];

/** Every sale so far was at roughly 70% off: A$39.99 -> A$12.00 and A$12.99 -> A$3.90. */
function salePrice(listCents: number): number {
  return listCents === 3999 ? 1200 : 390;
}

export function buildSampleData(nowSeconds: number): SampleData {
  const today = dayKey(nowSeconds, TZ);
  const openDay = addDays(today, -SHOP_AGE_DAYS);

  // ----- Listings -----
  const listings: Listing[] = LISTING_SEEDS.map((l) => ({
    listingId: l.listingId,
    title: l.title,
    description: l.description,
    state: "active",
    url: `https://www.etsy.com/listing/${l.listingId}`,
    priceCents: l.priceCents,
    currency: "AUD",
    quantity: 999,
    views: l.views,
    favorites: l.favorites,
    tags: l.tags,
    createdTs: tsOn(addDays(openDay, l.createdOffset)),
  }));

  // ----- Daily history: views and favourites grow steadily to today's totals -----
  const snapshots: Snapshot[] = [];
  for (const l of LISTING_SEEDS) {
    const days = dayRange(addDays(openDay, l.createdOffset), today);
    days.forEach((day, i) => {
      const progress = days.length > 1 ? i / (days.length - 1) : 1;
      snapshots.push({
        day,
        listingId: l.listingId,
        views: Math.round(l.views * progress),
        favorites: Math.round(l.favorites * progress),
        priceCents: l.priceCents,
        quantity: 999,
        tags: l.tags,
      });
    });
  }

  // ----- Orders and Etsy's bill -----
  const receipts: Receipt[] = [];
  const ledger: LedgerEntry[] = [];
  let entryId = 9_100_000_001;
  const addLedger = (ts: number, amountCents: number, ledgerType: string, description: string, refType = "", refId = "") =>
    ledger.push({
      entryId: entryId++,
      createdTs: ts,
      amountCents,
      currency: "AUD",
      description,
      ledgerType,
      referenceType: refType,
      referenceId: refId,
    });

  // The first listing fee for each listing.
  for (const l of listings) {
    addLedger(l.createdTs, -31, "listing", "Listing fee", "listing", String(l.listingId));
    addLedger(l.createdTs + 1, -3, "vat_seller_services", "GST on seller fees");
  }

  SALE_SEEDS.forEach(([offset, listingIndex, country, taxRate], i) => {
    const seed = LISTING_SEEDS[listingIndex];
    if (!seed) return;
    const receiptId = 3_900_000_001 + i;
    const transactionId = 4_700_000_001 + i;
    const ts = tsOn(addDays(openDay, offset), 17 * i);
    const paid = salePrice(seed.priceCents);
    const tax = percentOf(paid, taxRate);
    const isVat = country !== "US";

    receipts.push({
      receiptId,
      createdTs: ts,
      status: "Completed",
      countryIso: country,
      currency: "AUD",
      totalPriceCents: paid,
      discountCents: 0,
      subtotalCents: paid,
      shippingCents: 0,
      taxCents: isVat ? 0 : tax,
      vatCents: isVat ? tax : 0,
      grandtotalCents: paid + tax,
      transactions: [{ transactionId, receiptId, listingId: seed.listingId, title: seed.title, quantity: 1, priceCents: paid }],
    });

    // Etsy's fees for this sale, as lines on the bill.
    const transactionFee = percentOf(paid, 6.5);
    const processingFee = percentOf(paid + tax, 3) + 25;
    const renewFee = 31;
    addLedger(ts, paid, "PAYMENT_GROSS", "Sale", "receipt", String(receiptId));
    addLedger(ts + 1, -transactionFee, "transaction", "Transaction fee", "transaction", String(transactionId));
    addLedger(ts + 2, -processingFee, "PAYMENT_PROCESSING_FEE", "Processing fee", "receipt", String(receiptId));
    addLedger(ts + 3, -renewFee, "renew_sold_auto", "Auto-renew sold listing", "transaction", String(transactionId));
    addLedger(ts + 4, -percentOf(transactionFee + processingFee + renewFee, 10), "vat_seller_services", "GST on seller fees");
  });

  // Etsy Ads lines for the last 10 days (about A$0.90 a day).
  const adAmounts = [80, 95, 70, 110, 90, 85, 100, 75, 105, 90];
  adAmounts.forEach((cents, i) => {
    const day = addDays(today, -(adAmounts.length - i));
    addLedger(tsOn(day, 600), -cents, "prolist", "Etsy Ads");
  });

  // One payout to the bank.
  addLedger(tsOn(addDays(today, -7), 700), -2500, "DISBURSE2", "Payout to bank account");

  // ----- Numbers typed in by hand -----
  const visitsByWeek = [22, 41, 48, 55, 30];
  const weekStarts = [...new Set(dayRange(openDay, today).map(weekStart))];
  const weekly: WeeklyManual[] = weekStarts.map((ws, i) => {
    const visits = visitsByWeek[i] ?? 30;
    return {
      weekStart: ws,
      // One early week of ad spend typed in by hand (before the bill showed ad lines).
      adsSpendCents: i === 1 ? 400 : null,
      visits,
      srcSearch: Math.round(visits * 0.45),
      srcAds: Math.round(visits * 0.25),
      srcEtsyOther: Math.round(visits * 0.15),
      srcSocial: Math.round(visits * 0.1),
      srcDirect: Math.round(visits * 0.05),
    };
  });

  const costs: Omit<Cost, "id">[] = [
    { day: addDays(openDay, 2), kind: "tool", label: "Thumbnail template", amountCents: 300 },
  ];

  // Ad campaign numbers, as if read off Etsy Ads. [views, clicks, orders, revenue] per week.
  const shopAds: Record<number, [number, number, number, number]> = { 1: [310, 9, 1, 390], 3: [520, 17, 1, 1200], 4: [410, 12, 1, 390] };
  // Per listing: [listing index, share of that week's views/clicks, orders, revenue, spend]
  const listingAds: Record<number, [number, number, number, number, number][]> = {
    3: [[0, 0.5, 1, 1200, 290], [1, 0.35, 0, 0, 180], [2, 0.15, 0, 0, 80]],
    4: [[0, 0.45, 0, 0, 230], [1, 0.4, 1, 390, 200], [2, 0.15, 0, 0, 90]],
  };
  const adStats: AdStat[] = [];
  weekStarts.forEach((ws, i) => {
    const shopRow = shopAds[i];
    if (!shopRow) return;
    const [views, clicks, orders, revenue] = shopRow;
    adStats.push({ weekStart: ws, listingId: 0, views, clicks, orders, revenueCents: revenue, spendCents: null });
    for (const [index, share, o, rev, spend] of listingAds[i] ?? []) {
      const seed = LISTING_SEEDS[index];
      if (!seed) continue;
      adStats.push({ weekStart: ws, listingId: seed.listingId, views: Math.round(views * share), clicks: Math.round(clicks * share), orders: o, revenueCents: rev, spendCents: spend });
    }
  });

  const shop: ShopInfo = {
    shopId: 68560946,
    shopName: "AllYourBuys",
    currency: "AUD",
    createdTs: tsOn(openDay),
    numFavorers: 1,
    reviewCount: 0,
    reviewAverage: null,
    soldCount: receipts.length,
    activeListings: listings.length,
  };

  return { shop, listings, snapshots, receipts, ledger, weekly, costs, adStats };
}

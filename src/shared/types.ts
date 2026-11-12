// ---------------------------------------------------------------------------
// SHARED TYPES
// The shapes of the data used by the server, the phone app and the tests.
// All money is whole cents (AUD). All "Ts" fields are Unix seconds.
// ---------------------------------------------------------------------------

export interface ShopInfo {
  shopId: number;
  shopName: string;
  currency: string;
  createdTs: number;
  numFavorers: number;
  reviewCount: number;
  reviewAverage: number | null;
  soldCount: number;
  activeListings: number;
}

export interface Listing {
  listingId: number;
  title: string;
  description: string;
  state: string;
  url: string;
  priceCents: number;
  currency: string;
  quantity: number;
  views: number;
  favorites: number;
  tags: string[];
  createdTs: number;
}

/** One row per listing per day. Etsy only gives running totals, so we save them daily. */
export interface Snapshot {
  day: string;
  listingId: number;
  views: number;
  favorites: number;
  priceCents: number;
  quantity: number;
  tags: string[];
}

/** One item line inside an order. */
export interface Transaction {
  transactionId: number;
  receiptId: number;
  listingId: number;
  title: string;
  quantity: number;
  /** Price of ONE unit, as Etsy reports it. */
  priceCents: number;
}

/** One order. We deliberately do NOT store buyer names, emails or addresses. */
export interface Receipt {
  receiptId: number;
  createdTs: number;
  status: string;
  countryIso: string;
  currency: string;
  /** Sum of item price x quantity, before coupon discounts. */
  totalPriceCents: number;
  discountCents: number;
  /** Etsy's "subtotal": items after coupon discounts, no tax or shipping. */
  subtotalCents: number;
  shippingCents: number;
  /** Sales tax collected by Etsy (not the seller's money). */
  taxCents: number;
  /** VAT collected by Etsy (not the seller's money). */
  vatCents: number;
  grandtotalCents: number;
  transactions: Transaction[];
}

/** One line of the Etsy payment account ledger (the "bill"). Negative = money out. */
export interface LedgerEntry {
  entryId: number;
  createdTs: number;
  amountCents: number;
  currency: string;
  description: string;
  ledgerType: string;
  referenceType: string;
  referenceId: string;
}

export interface Review {
  transactionId: number;
  listingId: number;
  rating: number;
  createdTs: number;
}

/** Numbers typed in by hand for one week (week starts on Monday). null = not entered. */
export interface WeeklyManual {
  weekStart: string;
  adsSpendCents: number | null;
  visits: number | null;
  srcSearch: number | null;
  srcAds: number | null;
  srcEtsyOther: number | null;
  srcSocial: number | null;
  srcDirect: number | null;
}

export type CostKind = "product" | "tool" | "other";

/** A cost typed in by hand (a tool subscription, product cost, anything else). */
export interface Cost {
  id: number;
  day: string;
  kind: CostKind;
  label: string;
  amountCents: number;
}

/** A day of numbers from an uploaded Etsy Stats CSV. */
export interface DailyStat {
  day: string;
  visits: number | null;
  views: number | null;
  orders: number | null;
  revenueCents: number | null;
}

/** Things the owner can change on the Settings screen. */
export interface Settings {
  /** Flag any sale that earns less than this. Default A$2.00. */
  minProfitCents: number;
  /** Etsy transaction fee, % of item price + shipping. */
  transactionFeePct: number;
  /** Etsy Payments processing fee, % of the full amount the buyer paid. */
  processingPct: number;
  /** Etsy Payments fixed fee per order. */
  processingFixedCents: number;
  /** Listing / auto-renew fee per item sold (US$0.20, roughly A$0.31). */
  listingFeeCents: number;
  /** Tax (GST/VAT) Etsy adds on top of its own fees, in %. */
  feeTaxPct: number;
  /** Suggest asking for reviews after this many sales with no review. */
  reviewAfterSales: number;
  timezone: string;
}

export const DEFAULT_SETTINGS: Settings = {
  minProfitCents: 200,
  transactionFeePct: 6.5,
  processingPct: 3,
  processingFixedCents: 25,
  listingFeeCents: 31,
  feeTaxPct: 10,
  reviewAfterSales: 5,
  timezone: "Australia/Sydney",
};

// ---------------------------------------------------------------------------
// What the server sends to the phone app (already calculated).
// ---------------------------------------------------------------------------

export type ListingStatus = "Working" | "Needs traffic" | "Needs a better listing" | "Not enough data yet";

/** One item sold, with all its money worked out. */
export interface SaleRow {
  transactionId: number;
  receiptId: number;
  day: string;
  ts: number;
  listingId: number;
  title: string;
  quantity: number;
  country: string;
  /** List price x quantity on the day of the sale, or null if unknown. */
  listCents: number | null;
  /** True when the list price is a best guess (no price history for that day). */
  listEstimated: boolean;
  /** What the buyer paid for the item after discounts (no tax, no shipping). */
  paidCents: number;
  discountPct: number | null;
  /** Tax, VAT and shipping collected on this line. Not the seller's money. */
  taxCollectedCents: number;
  feesCents: number;
  /** True when some of the fees are worked out from the fee settings, not read from Etsy's bill. */
  feesEstimated: boolean;
  /** This sale's share of ads and manual costs. Always an estimate. */
  overheadCents: number;
  profitCents: number;
  belowMinimum: boolean;
}

export interface ListingRow {
  listingId: number;
  title: string;
  url: string;
  state: string;
  priceCents: number;
  views: number;
  favorites: number;
  tags: string[];
  ageDays: number;
  sales: number;
  revenueCents: number;
  avgPaidCents: number | null;
  avgDiscountPct: number | null;
  /** Sales divided by views, in %. null when there are no views. */
  viewsToSalesPct: number | null;
  views7d: number | null;
  profitCents: number;
  avgProfitCents: number | null;
  /** Lowest price that still covers fees plus this shop's ads and costs per sale. */
  breakEvenPriceCents: number;
  /** Lowest price that earns the minimum profit. */
  minProfitPriceCents: number;
  status: ListingStatus;
  statusWhy: string;
}

export interface DayPoint {
  day: string;
  revenueCents: number;
  orders: number;
  items: number;
  feesCents: number;
  adsCents: number;
  costsCents: number;
  profitCents: number;
  /** Listing views gained that day (from daily snapshots). null = no history for that day. */
  views: number | null;
  /** Shop visits (typed in or from CSV). null = not entered. */
  visits: number | null;
}

/** Totals for a stretch of days (used for "this week vs last week"). */
export interface PeriodSummary {
  from: string;
  to: string;
  revenueCents: number;
  orders: number;
  items: number;
  feesCents: number;
  adsCents: number;
  costsCents: number;
  spendCents: number;
  profitCents: number;
  views: number | null;
  visits: number | null;
  /** Orders divided by visits (or by listing views when visits are missing), in %. */
  conversionPct: number | null;
  conversionBasis: "visits" | "views" | "none";
}

export type AdsSource = "ledger" | "manual" | "mixed" | "none";

export interface MoneySummary {
  revenueCents: number;
  /** Tax + VAT collected by Etsy. Not the seller's money. */
  taxCollectedCents: number;
  shippingCollectedCents: number;
  listValueCents: number | null;
  avgDiscountPct: number | null;
  feesCents: number;
  /** "ledger" = read from Etsy's bill. "estimated" = worked out from the fee settings. */
  feesSource: "ledger" | "estimated";
  feeBreakdown: { label: string; cents: number }[];
  adsCents: number;
  adsSource: AdsSource;
  costsCents: number;
  refundsCents: number;
  profitCents: number;
  orders: number;
  items: number;
  avgProfitPerSaleCents: number | null;
  salesBelowMinimum: number;
  /** Break-even view */
  fixedSpendCents: number;
  avgContributionCents: number | null;
  salesToBreakEven: number | null;
  /** Ledger lines that look like Etsy Ads. Probable, not certain. */
  probableAdFees: { day: string; description: string; cents: number }[];
  /** Fee lines we could not classify. */
  otherLedgerLines: { day: string; description: string; cents: number }[];
}

export interface Suggestion {
  id: string;
  rule: string;
  /** Higher = more important. */
  score: number;
  title: string;
  what: string;
  consider: string;
  expect: string;
  /** The numbers the rule used, in plain words. */
  numbers: string;
  listingId?: number;
}

export interface SyncStatus {
  dataMode: "sample" | "real";
  etsyConfigured: boolean;
  etsyConnected: boolean;
  lastSyncAt: number | null;
  lastSyncOk: boolean | null;
  lastSyncMessage: string | null;
  lastRefreshAt: number | null;
  /** Seconds until "Refresh now" may be used again (0 = allowed). */
  refreshWaitSeconds: number;
  snapshotDays: number;
  firstSnapshotDay: string | null;
}

export interface Briefing {
  text: string;
  createdAt: number;
}

/** Everything the Ads screen needs. The screen adds it up for the chosen range. */
export interface AdsData {
  weeks: import("./ads").AdsWeek[];
  /** Typed-in numbers per advertised listing, per week. */
  listingStats: import("./ads").AdStat[];
  /** Roughly how much of each sale Etsy keeps in fees, in %. Used for "profit after ads". */
  feeSharePct: number;
  breakEvenRoas: number;
}

export interface DashboardData {
  generatedAt: number;
  today: string;
  shop: ShopInfo | null;
  status: SyncStatus;
  settings: Settings;
  thisWeek: PeriodSummary;
  lastWeek: PeriodSummary;
  days: DayPoint[];
  sales: SaleRow[];
  listings: ListingRow[];
  money: MoneySummary;
  countries: { country: string; orders: number; revenueCents: number }[];
  suggestions: Suggestion[];
  nextSteps: Suggestion[];
  weekly: WeeklyManual[];
  costs: Cost[];
  reviewCount: number;
  /** Plain-language notes about numbers that are estimated or missing. */
  dataNotes: string[];
  briefing: Briefing | null;
  /** Latest visits by traffic source typed in by hand, if any. */
  trafficSources: { weekStart: string; sources: { label: string; visits: number }[] } | null;
  ads: AdsData;
}

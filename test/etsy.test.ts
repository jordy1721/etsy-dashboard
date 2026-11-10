// Tests for the Etsy client, the JSON mapping and the daily pull.
// No real network: every Etsy answer here is a hand-written fake.
import { describe, expect, it } from "vitest";
import { EtsyClient, EtsyError } from "../src/server/etsy/client";
import { mapLedgerEntry, mapListing, mapReceipt, mapReview, mapShop } from "../src/server/etsy/mapping";
import { ETSY_SCOPES, buildAuthUrl, pkceChallenge, randomToken } from "../src/server/etsy/oauth";
import { fetchFromEtsy, ledgerWindows, snapshotsFor } from "../src/server/etsy/sync";

type Call = { url: URL; headers: Record<string, string>; method: string };

/** Build a fake fetch that answers from a list of handlers and records every call. */
function fakeFetch(handler: (url: URL, n: number) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, method: init?.method ?? "GET" });
    return handler(url, calls.length);
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(fetchFn: typeof fetch, extra: Partial<ConstructorParameters<typeof EtsyClient>[0]> = {}) {
  const sleeps: number[] = [];
  const c = new EtsyClient({
    keystring: "TESTKEY",
    baseUrl: "https://etsy.test/v3/application",
    fetchFn,
    sleep: async (ms) => void sleeps.push(ms),
    getToken: async () => "123.token",
    ...extra,
  });
  return { c, sleeps };
}

describe("Etsy client", () => {
  it("sends the key header, and the token only for private calls", async () => {
    const { fn, calls } = fakeFetch(() => json({ ok: true }));
    const { c } = client(fn);
    await c.get("/shops/1", {}, false);
    await c.get("/shops/1/receipts", { limit: 100 }, true);
    expect(calls[0]!.headers["x-api-key"]).toBe("TESTKEY");
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(calls[1]!.headers.authorization).toBe("Bearer 123.token");
    expect(calls[1]!.url.searchParams.get("limit")).toBe("100");
  });

  it("only ever sends GET requests (read-only)", async () => {
    const { fn, calls } = fakeFetch(() => json({ count: 0, results: [] }));
    const { c } = client(fn);
    await c.get("/shops/1", {}, true);
    await c.getAll("/shops/1/listings", {}, true, 2);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    // The class has no post/put/patch/delete methods at all.
    const methods = Object.getOwnPropertyNames(EtsyClient.prototype);
    expect(methods.filter((m) => /post|put|patch|delete|update|create/i.test(m))).toEqual([]);
  });

  it("sends keystring:secret when a shared secret is set", async () => {
    const { fn, calls } = fakeFetch(() => json({}));
    const { c } = client(fn, { sharedSecret: "SECRET" });
    await c.get("/shops/1");
    expect(calls[0]!.headers["x-api-key"]).toBe("TESTKEY:SECRET");
  });

  it("waits and retries on 429, honouring Retry-After", async () => {
    const { fn, calls } = fakeFetch((_url, n) => (n === 1 ? json({ error: "slow down" }, 429, { "retry-after": "2" }) : json({ fine: true })));
    const { c, sleeps } = client(fn);
    expect(await c.get("/shops/1")).toEqual({ fine: true });
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(2000);
  });

  it("backs off 1s, 2s, 4s... and gives up after 4 tries", async () => {
    const { fn, calls } = fakeFetch(() => json({ error: "slow down" }, 429));
    const { c, sleeps } = client(fn);
    await expect(c.get("/shops/1")).rejects.toThrow(EtsyError);
    expect(calls).toHaveLength(4);
    expect(sleeps.filter((ms) => ms >= 1000)).toEqual([1000, 2000, 4000, 8000]);
  });

  it("does not retry a plain error like 404", async () => {
    const { fn, calls } = fakeFetch(() => json({ error: "not found" }, 404));
    const { c } = client(fn);
    await expect(c.get("/shops/1")).rejects.toThrow(/404/);
    expect(calls).toHaveLength(1);
  });

  it("gets a fresh token once when Etsy says 401", async () => {
    const forced: boolean[] = [];
    const { fn } = fakeFetch((_url, n) => (n === 1 ? json({ error: "invalid_token" }, 401) : json({ fine: true })));
    const { c } = client(fn, { getToken: async (force) => (forced.push(force), "t") });
    expect(await c.get("/x", {}, true)).toEqual({ fine: true });
    expect(forced).toContain(true);
  });

  it("pages through results 100 at a time", async () => {
    const { fn, calls } = fakeFetch((url) => {
      const offset = Number(url.searchParams.get("offset"));
      const size = offset === 200 ? 30 : 100;
      return json({ count: 230, results: Array.from({ length: size }, (_, i) => ({ id: offset + i })) });
    });
    const { c } = client(fn);
    const res = await c.getAll<{ id: number }>("/list", {}, false, 10);
    expect(res.results).toHaveLength(230);
    expect(res.complete).toBe(true);
    expect(calls.map((x) => x.url.searchParams.get("offset"))).toEqual(["0", "100", "200"]);
  });

  it("stops at the page limit and says it is not complete", async () => {
    const { fn, calls } = fakeFetch(() => json({ count: 100000, results: Array.from({ length: 100 }, () => ({})) }));
    const { c } = client(fn);
    const res = await c.getAll("/list", {}, false, 3);
    expect(calls).toHaveLength(3);
    expect(res.complete).toBe(false);
  });
});

// ---- Example answers shaped like Etsy's v3 API ----
const SHOP = { shop_id: 68560946, shop_name: "AllYourBuys", currency_code: "AUD", create_date: 1791800000, num_favorers: 1, review_count: 0, review_average: null, transaction_sold_count: 11, listing_active_count: 5 };
const LISTING = {
  listing_id: 4594983295, title: "254 YouTube Sound Effects Bundle", description: "desc", state: "active", url: "https://www.etsy.com/listing/4594983295",
  price: { amount: 3999, divisor: 100, currency_code: "AUD" }, quantity: 999, views: 89, num_favorers: 4, tags: ["sound effects", "sfx"], original_creation_timestamp: 1791800500,
};
const RECEIPT = {
  receipt_id: 111, status: "Completed", country_iso: "it", create_timestamp: 1792000000,
  name: "INVENTED NAME", buyer_email: "invented@example.com", first_line: "1 Invented Street", city: "Nowhere", zip: "ZIP-INVENTED",
  total_price: { amount: 3999, divisor: 100, currency_code: "AUD" },
  discount_amt: { amount: 2799, divisor: 100, currency_code: "AUD" },
  subtotal: { amount: 1200, divisor: 100, currency_code: "AUD" },
  total_shipping_cost: { amount: 0, divisor: 100, currency_code: "AUD" },
  total_tax_cost: { amount: 0, divisor: 100, currency_code: "AUD" },
  total_vat_cost: { amount: 264, divisor: 100, currency_code: "AUD" },
  grandtotal: { amount: 1464, divisor: 100, currency_code: "AUD" },
  transactions: [{ transaction_id: 222, listing_id: 4594983295, title: "254 YouTube Sound Effects Bundle", quantity: 1, price: { amount: 3999, divisor: 100, currency_code: "AUD" } }],
};
const LEDGER = { entry_id: 333, ledger_id: 9, amount: -78, currency: "AUD", description: "Transaction fee", ledger_type: "transaction", reference_type: "transaction", reference_id: 222, create_date: 1792000001 };
const REVIEW = { shop_id: 68560946, listing_id: 4594983295, transaction_id: 222, buyer_user_id: 999, rating: 5, review: "Great", create_timestamp: 1792100000 };

describe("mapping Etsy JSON to our rows", () => {
  it("maps the shop", () => {
    expect(mapShop(SHOP)).toMatchObject({ shopId: 68560946, shopName: "AllYourBuys", currency: "AUD", createdTs: 1791800000, soldCount: 11 });
  });
  it("maps a listing and converts price with the divisor", () => {
    expect(mapListing(LISTING)).toMatchObject({ listingId: 4594983295, priceCents: 3999, views: 89, favorites: 4, tags: ["sound effects", "sfx"], createdTs: 1791800500 });
    expect(mapListing({ ...LISTING, price: { amount: 3999, divisor: 1000, currency_code: "AUD" } }).priceCents).toBe(400);
  });
  it("maps an order with its money fields", () => {
    const r = mapReceipt(RECEIPT);
    expect(r).toMatchObject({ receiptId: 111, countryIso: "IT", totalPriceCents: 3999, discountCents: 2799, subtotalCents: 1200, vatCents: 264, taxCents: 0, grandtotalCents: 1464, createdTs: 1792000000 });
    expect(r.transactions[0]).toMatchObject({ transactionId: 222, receiptId: 111, listingId: 4594983295, quantity: 1, priceCents: 3999 });
  });
  it("drops every buyer detail except the country", () => {
    const text = JSON.stringify(mapReceipt(RECEIPT));
    expect(text).not.toMatch(/INVENTED|invented@|Street|Nowhere|ZIP/);
  });
  it("maps a ledger line (amount is already in cents)", () => {
    expect(mapLedgerEntry(LEDGER)).toEqual({
      entryId: 333, createdTs: 1792000001, amountCents: -78, currency: "AUD", description: "Transaction fee", ledgerType: "transaction", referenceType: "transaction", referenceId: "222",
    });
  });
  it("maps a review without the reviewer or the text", () => {
    expect(mapReview(REVIEW)).toEqual({ transactionId: 222, listingId: 4594983295, rating: 5, createdTs: 1792100000 });
  });
});

describe("the daily pull against a fake Etsy", () => {
  const NOW = 1794000000;
  function fakeEtsy() {
    return fakeFetch((url) => {
      const p = url.pathname;
      if (p.endsWith("/shops/68560946")) return json(SHOP);
      if (p.endsWith("/listings")) return json({ count: 1, results: [LISTING] });
      if (p.endsWith("/receipts")) return json({ count: 1, results: [RECEIPT] });
      if (p.endsWith("/ledger-entries")) return json({ count: 1, results: [{ ...LEDGER, entry_id: 333 + Number(url.searchParams.get("min_created")) }] });
      if (p.endsWith("/reviews")) return json({ count: 1, results: [REVIEW] });
      return json({ error: "unexpected path" }, 404);
    });
  }

  it("reads shop, listings, orders, bill and reviews", async () => {
    const { fn, calls } = fakeEtsy();
    const { c } = client(fn);
    const data = await fetchFromEtsy(c, "68560946", { receipts: null, ledger: null }, NOW);
    expect(data.shop.shopName).toBe("AllYourBuys");
    expect(data.listings).toHaveLength(1);
    expect(data.receipts).toHaveLength(1);
    expect(data.reviews).toHaveLength(1);
    expect(data.receiptsCursor).toBe(NOW);
    expect(data.ledgerCursor).toBe(NOW);
    // Ledger requests always carry both time limits.
    const ledgerCalls = calls.filter((x) => x.url.pathname.endsWith("/ledger-entries"));
    expect(ledgerCalls.length).toBeGreaterThan(0);
    for (const call of ledgerCalls) {
      expect(call.url.searchParams.get("min_created")).toBeTruthy();
      expect(call.url.searchParams.get("max_created")).toBeTruthy();
    }
    // A full first pull of a young shop stays tiny.
    expect(c.requestCount).toBeLessThan(12);
  });

  it("only asks for recent orders and bill lines after the first pull", async () => {
    const { fn, calls } = fakeEtsy();
    const { c } = client(fn);
    await fetchFromEtsy(c, "68560946", { receipts: NOW - 86400, ledger: NOW - 86400 }, NOW);
    const receiptCall = calls.find((x) => x.url.pathname.endsWith("/receipts"))!;
    expect(Number(receiptCall.url.searchParams.get("min_created"))).toBe(NOW - 86400 - 14 * 86400);
    expect(calls.filter((x) => x.url.pathname.endsWith("/ledger-entries"))).toHaveLength(1);
  });

  it("splits long billing history into windows of 30 days", () => {
    const w = ledgerWindows(0, 70 * 86400, 30);
    expect(w).toEqual([
      { min: 0, max: 30 * 86400 },
      { min: 30 * 86400, max: 60 * 86400 },
      { min: 60 * 86400, max: 70 * 86400 },
    ]);
  });

  it("makes one dated snapshot row per listing", () => {
    expect(snapshotsFor([mapListing(LISTING)], "2026-11-10")).toEqual([
      { day: "2026-11-10", listingId: 4594983295, views: 89, favorites: 4, priceCents: 3999, quantity: 999, tags: ["sound effects", "sfx"] },
    ]);
  });
});

describe("Etsy login helpers", () => {
  it("only asks for read permissions", () => {
    expect(ETSY_SCOPES).toEqual(["shops_r", "listings_r", "transactions_r"]);
    expect(ETSY_SCOPES.every((s) => s.endsWith("_r"))).toBe(true);
  });
  it("builds the Etsy login link with PKCE", async () => {
    const url = new URL(buildAuthUrl({ clientId: "KEY", redirectUri: "https://x.workers.dev/auth/callback", state: "st", challenge: "ch" }));
    expect(url.origin + url.pathname).toBe("https://www.etsy.com/oauth/connect");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("KEY");
    expect(url.searchParams.get("scope")).toBe("shops_r listings_r transactions_r");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.workers.dev/auth/callback");
  });
  it("PKCE challenge matches the official example", async () => {
    // Test vector from the PKCE standard (RFC 7636, appendix B).
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("random tokens are long and different each time", () => {
    const a = randomToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).not.toBe(randomToken());
  });
});

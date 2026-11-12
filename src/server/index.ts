// ---------------------------------------------------------------------------
// THE WORKER
// One small server that does everything:
//   - checks the passcode on every page and every API call
//   - serves the phone app (the files in ./dist)
//   - answers the app's data requests (/api/...)
//   - handles the Etsy login (/auth/start and /auth/callback)
//   - pulls fresh data from Etsy once a day (the "scheduled" function)
// ---------------------------------------------------------------------------

import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { looksLikeAdsCsv, parseAdsCsv } from "../shared/adsCsv";
import { CsvError, parseStatsCsv } from "../shared/csv";
import { isDay, weekStart } from "../shared/dates";
import { parseDollarsToCents } from "../shared/money";
import type { AdStat } from "../shared/ads";
import type { CostKind, Settings } from "../shared/types";
import {
  SESSION_COOKIE, SESSION_SECONDS, checkRateLimit, clearAttempts, createSessionValue, passcodeMatches, recordFailedAttempt, verifySessionValue,
} from "./auth";
import { maybeWriteBriefing } from "./briefing";
import { REFRESH_COOLDOWN_SECONDS, buildDashboard } from "./dashboard";
import { addCost, importAdWeeks, deleteAdWeek, deleteCost, deleteTokens, ensureReady, getMeta, saveAdWeek, saveDailyStats, saveSettings, saveWeeklyPart, setMeta } from "./db";
import { nowSeconds, type Env } from "./env";
import { buildAuthUrl, exchangeCode, pkceChallenge, randomToken } from "./etsy/oauth";
import { runSync } from "./etsy/sync";
import { loginPage, messagePage, notConfiguredPage } from "./pages";
import { DEFAULT_TIMEZONE } from "../shared/dates";

type AppContext = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

/** Things anyone may load without the passcode: the login screen and the app icon files. */
function isPublicPath(path: string): boolean {
  return (
    path === "/login" ||
    path === "/api/login" ||
    path === "/auth/callback" ||
    path === "/manifest.webmanifest" ||
    path === "/sw.js" ||
    path === "/favicon.ico" ||
    path.startsWith("/icons/")
  );
}

/** Was the page opened over https? (Plain http only happens on your own computer.) */
function isSecure(c: AppContext): boolean {
  return new URL(c.req.url).protocol === "https:";
}

// ---- Safety headers on every answer -----------------------------------------
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", "noindex, nofollow");
  const path = new URL(c.req.url).pathname;
  // Never let private data sit in a shared cache.
  if (path.startsWith("/api/") || path.startsWith("/auth/") || path === "/login") c.header("Cache-Control", "no-store");
});

// ---- The gate: passcode needed for everything that is not public ------------
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Block form posts coming from other websites.
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Request blocked." }, 403);
  }

  if (isPublicPath(path)) return next();

  if (!c.env.DASHBOARD_PASSCODE) {
    return path.startsWith("/api/") ? c.json({ error: "DASHBOARD_PASSCODE is not set." }, 503) : c.html(notConfiguredPage(), 503);
  }
  const ok = await verifySessionValue(getCookie(c, SESSION_COOKIE), c.env.DASHBOARD_PASSCODE, nowSeconds());
  if (!ok) return path.startsWith("/api/") ? c.json({ error: "Please log in again." }, 401) : c.redirect("/login");

  await ensureReady(c.env);
  return next();
});

// ---- Login / logout ---------------------------------------------------------
app.get("/login", async (c) => {
  if (!c.env.DASHBOARD_PASSCODE) return c.html(notConfiguredPage(), 503);
  if (await verifySessionValue(getCookie(c, SESSION_COOKIE), c.env.DASHBOARD_PASSCODE, nowSeconds())) return c.redirect("/");
  return c.html(loginPage());
});

app.post("/api/login", async (c) => {
  const real = c.env.DASHBOARD_PASSCODE;
  if (!real) return c.json({ error: "No passcode is set yet. See SETUP.md." }, 503);
  await ensureReady(c.env);

  const now = nowSeconds();
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const limit = await checkRateLimit(c.env.DB, ip, now);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfter / 60);
    c.header("Retry-After", String(limit.retryAfter));
    return c.json({ error: `Too many wrong tries. Wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.` }, 429);
  }

  const body = await readJson(c);
  const typed = typeof body.passcode === "string" ? body.passcode : "";
  if (!(await passcodeMatches(typed, real))) {
    await recordFailedAttempt(c.env.DB, ip, now);
    return c.json({ error: "Wrong passcode." }, 401);
  }

  await clearAttempts(c.env.DB, ip);
  setCookie(c, SESSION_COOKIE, await createSessionValue(real, now), {
    httpOnly: true,
    secure: isSecure(c), // always true on the real site (https)
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---- Etsy login (works from a phone, nothing to install) --------------------
app.get("/auth/start", async (c) => {
  if (!c.env.ETSY_KEYSTRING) {
    return c.html(messagePage("Etsy key missing", "Add the <code>ETSY_KEYSTRING</code> secret in Cloudflare first. SETUP.md step 4 shows how.", "Back to dashboard"), 400);
  }
  const state = randomToken();
  const verifier = randomToken(48);
  // Remember the one-time values for 10 minutes so /auth/callback can check them.
  await setMeta(c.env.DB, { oauth_pending: JSON.stringify({ state, verifier, expires: nowSeconds() + 600 }) });
  const redirectUri = `${new URL(c.req.url).origin}/auth/callback`;
  return c.redirect(
    buildAuthUrl({ authUrl: c.env.ETSY_AUTH_URL, clientId: c.env.ETSY_KEYSTRING, redirectUri, state, challenge: await pkceChallenge(verifier) }),
  );
});

// Etsy sends the browser back here. The session cookie is NOT sent on this
// hop (it is SameSite=Strict), so this route is protected by the one-time
// "state" value instead: only a login that was started from inside the
// dashboard in the last 10 minutes can finish here.
app.get("/auth/callback", async (c) => {
  await ensureReady(c.env);
  const fail = (why: string) => c.html(messagePage("Etsy was not connected", `${why}<br><br>Open the dashboard, go to Settings and tap Connect Etsy to try again.`), 400);

  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return fail("Etsy said no (you may have pressed Cancel).");
  if (!code || !state) return fail("The answer from Etsy was incomplete.");

  let pending: { state?: string; verifier?: string; expires?: number } = {};
  try {
    pending = JSON.parse((await getMeta(c.env.DB, "oauth_pending")) ?? "{}") as typeof pending;
  } catch {
    pending = {};
  }
  // One use only: forget the pending login whatever happens next.
  await setMeta(c.env.DB, { oauth_pending: "{}" });
  if (!pending.state || !pending.verifier || pending.state !== state || (pending.expires ?? 0) < nowSeconds()) {
    return fail("This login link is old or was not started from your dashboard.");
  }

  try {
    await exchangeCode(c.env, code, pending.verifier, `${url.origin}/auth/callback`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Etsy refused the login.");
  }

  // Pull the real data straight away so the dashboard is ready when it opens.
  const sync = await runSync(c.env, nowSeconds(), DEFAULT_TIMEZONE);
  const detail = sync.ok
    ? "Your real shop data is loaded. From now on it updates by itself once a day."
    : `The login worked, but the first data pull failed: ${sync.message.replace(/[<>&]/g, "")}. Try "Refresh now" in Settings in a few minutes.`;
  return c.html(messagePage("Etsy connected", detail));
});

app.post("/api/etsy/disconnect", async (c) => {
  await deleteTokens(c.env.DB);
  return c.json({ ok: true });
});

// ---- Data for the app -------------------------------------------------------
app.get("/api/dashboard", async (c) => c.json(await buildDashboard(c.env, nowSeconds())));

app.post("/api/refresh", async (c) => {
  const now = nowSeconds();
  const data = await buildDashboard(c.env, now);
  if (!data.status.etsyConnected) return c.json({ error: "Etsy is not connected yet. Tap Connect Etsy first." }, 400);
  if (data.status.refreshWaitSeconds > 0) {
    const minutes = Math.ceil(data.status.refreshWaitSeconds / 60);
    return c.json({ error: `You can refresh once every ${REFRESH_COOLDOWN_SECONDS / 60} minutes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, 429);
  }
  // Start the 10 minute timer BEFORE the pull, so double taps cannot start two.
  await setMeta(c.env.DB, { last_refresh_at: String(now) });
  const result = await runSync(c.env, now, data.settings.timezone);
  return c.json(result, result.ok ? 200 : 502);
});

// ---- Manual entries ---------------------------------------------------------
// Weekly visits and traffic sources. (Ad spend is saved from the Ads screen and is kept as it is.)
app.post("/api/weekly", async (c) => {
  const body = await readJson(c);
  if (!isDay(body.weekStart)) return c.json({ error: "Pick a week first." }, 400);

  const counts: Record<string, number | null> = {};
  for (const key of ["visits", "srcSearch", "srcAds", "srcEtsyOther", "srcSocial", "srcDirect"]) {
    const value = optionalCount(body[key]);
    if (value === "bad") return c.json({ error: "Visits must be whole numbers (or left empty)." }, 400);
    counts[key] = value;
  }
  // weekStart() snaps any day to its Monday.
  await saveWeeklyPart(c.env.DB, weekStart(body.weekStart), {
    visits: counts.visits ?? null,
    srcSearch: counts.srcSearch ?? null,
    srcAds: counts.srcAds ?? null,
    srcEtsyOther: counts.srcEtsyOther ?? null,
    srcSocial: counts.srcSocial ?? null,
    srcDirect: counts.srcDirect ?? null,
  });
  return c.json({ ok: true });
});

app.delete("/api/weekly/:weekStart", async (c) => {
  const day = c.req.param("weekStart");
  if (!isDay(day)) return c.json({ error: "Unknown week." }, 400);
  await saveWeeklyPart(c.env.DB, day, { visits: null, srcSearch: null, srcAds: null, srcEtsyOther: null, srcSocial: null, srcDirect: null });
  return c.json({ ok: true });
});

// ---- Ad campaigns (typed in from Etsy Ads) -----------------------------------
app.post("/api/ads", async (c) => {
  const body = await readJson(c);
  if (!isDay(body.weekStart)) return c.json({ error: "Pick a week first." }, 400);
  const week = weekStart(body.weekStart);

  // Read one set of ad numbers (the whole shop, or one listing).
  const readRow = (src: Record<string, unknown>, listingId: number): AdStat | string => {
    const views = optionalCount(src.views);
    const clicks = optionalCount(src.clicks);
    const orders = optionalCount(src.orders);
    const revenue = optionalMoney(src.revenue);
    const spend = optionalMoney(src.spend);
    if (views === "bad" || clicks === "bad" || orders === "bad") return "Views, clicks and orders must be whole numbers (or left empty).";
    if (revenue === "bad" || spend === "bad") return "Amounts must look like 12.50 (or be left empty).";
    if (views !== null && clicks !== null && clicks > views) return "Clicks cannot be higher than views. Check the two numbers.";
    if (clicks !== null && orders !== null && orders > clicks) return "Orders cannot be higher than clicks. Check the two numbers.";
    return { weekStart: week, listingId, views, clicks, orders, revenueCents: revenue, spendCents: spend };
  };

  const shop = readRow(body, 0);
  if (typeof shop === "string") return c.json({ error: shop }, 400);
  const shopSpend = shop.spendCents;
  shop.spendCents = null; // the whole-shop spend is stored with the weekly numbers

  const rows: AdStat[] = [];
  const hasNumbers = (r: AdStat) => [r.views, r.clicks, r.orders, r.revenueCents, r.spendCents].some((v) => v !== null);
  if (hasNumbers(shop)) rows.push(shop);

  const listings = Array.isArray(body.listings) ? (body.listings as unknown[]).slice(0, 200) : [];
  for (const item of listings) {
    if (!item || typeof item !== "object") continue;
    const src = item as Record<string, unknown>;
    const listingId = Number(src.listingId);
    if (!Number.isInteger(listingId) || listingId <= 0) return c.json({ error: "Unknown listing." }, 400);
    const row = readRow(src, listingId);
    if (typeof row === "string") return c.json({ error: row }, 400);
    if (hasNumbers(row)) rows.push(row);
  }
  if (rows.length === 0 && shopSpend === null) return c.json({ error: "Type at least one number for this week." }, 400);

  await saveAdWeek(c.env.DB, week, shopSpend, rows);
  return c.json({ ok: true });
});

app.delete("/api/ads/:weekStart", async (c) => {
  const day = c.req.param("weekStart");
  if (!isDay(day)) return c.json({ error: "Unknown week." }, 400);
  await deleteAdWeek(c.env.DB, day);
  return c.json({ ok: true });
});

app.post("/api/costs", async (c) => {
  const body = await readJson(c);
  const amount = typeof body.amount === "string" ? parseDollarsToCents(body.amount) : null;
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
  const kind = body.kind;
  if (!isDay(body.day)) return c.json({ error: "Pick a date." }, 400);
  if (kind !== "product" && kind !== "tool" && kind !== "other") return c.json({ error: "Pick a type of cost." }, 400);
  if (label === "") return c.json({ error: "Give the cost a short name." }, 400);
  if (amount === null || amount <= 0 || amount > 10_000_000) return c.json({ error: "Amount must be a number above 0, like 15 or 15.50" }, 400);
  await addCost(c.env.DB, { day: body.day, kind: kind as CostKind, label, amountCents: amount });
  return c.json({ ok: true });
});

app.delete("/api/costs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Unknown cost." }, 400);
  await deleteCost(c.env.DB, id);
  return c.json({ ok: true });
});

app.post("/api/settings", async (c) => {
  const body = await readJson(c);
  const out: Partial<Settings> = {};

  // Amounts typed as dollars.
  for (const [field, key] of [["minProfit", "minProfitCents"], ["processingFixed", "processingFixedCents"], ["listingFee", "listingFeeCents"]] as const) {
    if (body[field] === undefined) continue;
    const cents = typeof body[field] === "string" ? parseDollarsToCents(body[field]) : null;
    if (cents === null || cents < 0 || cents > 100_000) return c.json({ error: "Amounts must look like 2 or 2.50" }, 400);
    out[key] = cents;
  }
  // Percentages.
  for (const key of ["transactionFeePct", "processingPct", "feeTaxPct"] as const) {
    if (body[key] === undefined) continue;
    const pct = Number(body[key]);
    if (body[key] === "" || !Number.isFinite(pct) || pct < 0 || pct > 50) return c.json({ error: "Percentages must be between 0 and 50." }, 400);
    out[key] = pct;
  }
  if (body.reviewAfterSales !== undefined) {
    const n = Number(body.reviewAfterSales);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return c.json({ error: "Review reminder must be a whole number of sales." }, 400);
    out.reviewAfterSales = n;
  }
  await saveSettings(c.env.DB, out);
  return c.json({ ok: true });
});

/** Read an Etsy Ads CSV and save it as weekly ad numbers. Used by both upload boxes. */
async function importAdsCsv(c: AppContext, text: string, chosenWeek: string | undefined) {
  try {
    const listings = await c.env.DB.prepare(`SELECT listing_id, title FROM listings`).all<{ listing_id: number; title: string }>();
    const parsed = parseAdsCsv(text, { chosenWeek, listings: listings.results.map((l) => ({ listingId: l.listing_id, title: l.title })) });
    if (parsed.weeks.length > 60) return c.json({ error: "This file covers more than 60 weeks. Download a shorter date range from Etsy and try again." }, 400);
    await importAdWeeks(c.env.DB, parsed.weeks);
    return c.json({
      ok: true,
      kind: "ads",
      weeks: parsed.weeks.length,
      from: parsed.weeks[0]?.weekStart,
      to: parsed.weeks[parsed.weeks.length - 1]?.weekStart,
      listingRows: parsed.weeks.reduce((n, w) => n + w.listings.length, 0),
      columnsUsed: parsed.columnsUsed,
      skippedRows: parsed.skippedRows,
      unmatchedListings: parsed.unmatchedListings,
      usedChosenWeek: parsed.usedChosenWeek,
    });
  } catch (err) {
    if (err instanceof CsvError) return c.json({ error: err.message }, 400);
    throw err;
  }
}

// Etsy Ads CSV, uploaded on the Ads screen. ?week=YYYY-MM-DD is only used when the file has no dates.
app.post("/api/ads-csv", async (c) => importAdsCsv(c, await c.req.text(), c.req.query("week")));

app.post("/api/stats-csv", async (c) => {
  const text = await c.req.text();
  // An Etsy Ads file dropped into the Stats box is sent to the Ads import instead of being misread.
  if (looksLikeAdsCsv(text)) return importAdsCsv(c, text, c.req.query("week"));
  try {
    const parsed = parseStatsCsv(text);
    await saveDailyStats(c.env.DB, parsed.rows);
    return c.json({
      ok: true,
      kind: "stats",
      days: parsed.rows.length,
      from: parsed.rows[0]?.day,
      to: parsed.rows[parsed.rows.length - 1]?.day,
      columnsUsed: parsed.columnsUsed,
      skippedRows: parsed.skippedRows,
    });
  } catch (err) {
    if (err instanceof CsvError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

// ---- Everything else: the built phone app -----------------------------------
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  console.error("Request failed:", err);
  const path = new URL(c.req.url).pathname;
  return path.startsWith("/api/") ? c.json({ error: "Something went wrong on the server. Try again." }, 500) : c.text("Something went wrong. Try again.", 500);
});

// ---- Small helpers for reading what the app sends ---------------------------
async function readJson(c: AppContext): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** "" or missing -> null (not entered). "12.50" -> 1250. Anything else -> "bad". */
function optionalMoney(value: unknown): number | null | "bad" {
  if (value === undefined || value === null || value === "") return null;
  const cents = typeof value === "string" ? parseDollarsToCents(value) : null;
  return cents === null || cents < 0 || cents > 10_000_000 ? "bad" : cents;
}

function optionalCount(value: unknown): number | null | "bad" {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 10_000_000 ? n : "bad";
}

export default {
  fetch: app.fetch,

  /** Runs once a day (see "triggers" in wrangler.jsonc). */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await ensureReady(env);
        const now = nowSeconds();
        const before = await buildDashboard(env, now);
        // Only talk to Etsy once it has been connected. Until then the sample data stays.
        if (before.status.etsyConnected) {
          const result = await runSync(env, now, before.settings.timezone);
          console.log("Daily Etsy pull:", result.ok ? "ok" : "FAILED", result.message);
        }
        // Optional weekly Claude briefing. Does nothing without ANTHROPIC_API_KEY.
        await maybeWriteBriefing(env, await buildDashboard(env, nowSeconds()), nowSeconds());
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

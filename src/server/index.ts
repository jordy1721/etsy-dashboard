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
import { CsvError, parseStatsCsv } from "../shared/csv";
import { isDay, weekStart } from "../shared/dates";
import { parseDollarsToCents } from "../shared/money";
import type { CostKind, Settings, WeeklyManual } from "../shared/types";
import {
  SESSION_COOKIE, SESSION_SECONDS, checkRateLimit, clearAttempts, createSessionValue, passcodeMatches, recordFailedAttempt, verifySessionValue,
} from "./auth";
import { maybeWriteBriefing } from "./briefing";
import { REFRESH_COOLDOWN_SECONDS, buildDashboard } from "./dashboard";
import { addCost, deleteCost, deleteTokens, deleteWeekly, ensureReady, getMeta, saveDailyStats, saveSettings, saveWeekly, setMeta } from "./db";
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
app.post("/api/weekly", async (c) => {
  const body = await readJson(c);
  if (!isDay(body.weekStart)) return c.json({ error: "Pick a week first." }, 400);

  const ads = optionalMoney(body.adsSpend);
  if (ads === "bad") return c.json({ error: "Ad spend must be an amount like 12.50" }, 400);
  const counts: Record<string, number | null> = {};
  for (const key of ["visits", "srcSearch", "srcAds", "srcEtsyOther", "srcSocial", "srcDirect"]) {
    const value = optionalCount(body[key]);
    if (value === "bad") return c.json({ error: "Visits must be whole numbers (or left empty)." }, 400);
    counts[key] = value;
  }
  const row: WeeklyManual = {
    weekStart: weekStart(body.weekStart), // snap any day to its Monday
    adsSpendCents: ads,
    visits: counts.visits ?? null,
    srcSearch: counts.srcSearch ?? null,
    srcAds: counts.srcAds ?? null,
    srcEtsyOther: counts.srcEtsyOther ?? null,
    srcSocial: counts.srcSocial ?? null,
    srcDirect: counts.srcDirect ?? null,
  };
  await saveWeekly(c.env.DB, row);
  return c.json({ ok: true });
});

app.delete("/api/weekly/:weekStart", async (c) => {
  const day = c.req.param("weekStart");
  if (!isDay(day)) return c.json({ error: "Unknown week." }, 400);
  await deleteWeekly(c.env.DB, day);
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

app.post("/api/stats-csv", async (c) => {
  const text = await c.req.text();
  try {
    const parsed = parseStatsCsv(text);
    await saveDailyStats(c.env.DB, parsed.rows);
    return c.json({
      ok: true,
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

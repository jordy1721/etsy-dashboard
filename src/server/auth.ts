// ---------------------------------------------------------------------------
// PASSCODE LOGIN
// - The passcode is a Cloudflare secret (DASHBOARD_PASSCODE). It is never in code.
// - After a correct passcode we set a SIGNED cookie that lasts 30 days.
//   "Signed" means the server can tell if anyone tampered with it.
// - Wrong attempts are counted, and too many locks the door for 15 minutes.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "session";
export const SESSION_DAYS = 30;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

/** How many wrong passcodes one visitor may try in a 15 minute window. */
export const MAX_ATTEMPTS = 5;
/** Safety net across ALL visitors together, in the same window. */
export const MAX_ATTEMPTS_GLOBAL = 40;
export const ATTEMPT_WINDOW_SECONDS = 15 * 60;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let text = "";
  for (const b of new Uint8Array(bytes)) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HMAC-SHA256: a keyed fingerprint. Only someone who knows the key can make it. */
async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
}

/** Compare two strings without leaking, through timing, how much of them matched. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Is the typed passcode correct? Both sides are fingerprinted first so lengths do not leak. */
export async function passcodeMatches(typed: string, real: string): Promise<boolean> {
  if (!real) return false;
  const [a, b] = await Promise.all([hmac("passcode-check", typed), hmac("passcode-check", real)]);
  return safeEqual(a, b);
}

/**
 * Make the cookie value: "v1.<expiry time>.<signature>".
 * The signing key comes from the passcode, so changing the passcode logs every device out.
 */
export async function createSessionValue(passcode: string, now: number): Promise<string> {
  const expires = now + SESSION_SECONDS;
  const signature = await hmac(`session-key:${passcode}`, `v1.${expires}`);
  return `v1.${expires}.${signature}`;
}

/** Check a cookie value: right shape, not expired, and the signature is ours. */
export async function verifySessionValue(value: string | undefined, passcode: string | undefined, now: number): Promise<boolean> {
  if (!value || !passcode) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expires = Number(parts[1]);
  if (!Number.isInteger(expires) || expires <= now) return false;
  const expected = await hmac(`session-key:${passcode}`, `v1.${expires}`);
  return safeEqual(expected, parts[2] ?? "");
}

// ---------------------------------------------------------------------------
// Rate limiting of wrong passcodes (stored in the database)
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the visitor may try again. */
  retryAfter: number;
}

/** Pure rule: given the stored counter, may this visitor try now? */
export function evaluateAttempts(row: { count: number; window_start: number } | null, limit: number, now: number): RateLimitResult {
  if (!row) return { allowed: true, retryAfter: 0 };
  const windowEnds = row.window_start + ATTEMPT_WINDOW_SECONDS;
  if (now >= windowEnds) return { allowed: true, retryAfter: 0 }; // old window, start fresh
  if (row.count >= limit) return { allowed: false, retryAfter: windowEnds - now };
  return { allowed: true, retryAfter: 0 };
}

type AttemptRow = { ip: string; count: number; window_start: number };

export async function checkRateLimit(db: D1Database, ip: string, now: number): Promise<RateLimitResult> {
  const { results } = await db.prepare(`SELECT ip, count, window_start FROM login_attempts WHERE ip IN (?, '*')`).bind(ip).all<AttemptRow>();
  const own = evaluateAttempts(results.find((r) => r.ip === ip) ?? null, MAX_ATTEMPTS, now);
  if (!own.allowed) return own;
  return evaluateAttempts(results.find((r) => r.ip === "*") ?? null, MAX_ATTEMPTS_GLOBAL, now);
}

/** Count one wrong attempt for this visitor and for everyone together ("*"). */
export async function recordFailedAttempt(db: D1Database, ip: string, now: number): Promise<void> {
  const cutoff = now - ATTEMPT_WINDOW_SECONDS;
  const sql = `INSERT INTO login_attempts (ip, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT (ip) DO UPDATE SET
       count = CASE WHEN login_attempts.window_start <= ?3 THEN 1 ELSE login_attempts.count + 1 END,
       window_start = CASE WHEN login_attempts.window_start <= ?3 THEN ?2 ELSE login_attempts.window_start END`;
  await db.batch([
    db.prepare(sql).bind(ip, now, cutoff),
    db.prepare(sql).bind("*", now, cutoff),
    // Tidy up old counters so the table stays tiny.
    db.prepare(`DELETE FROM login_attempts WHERE window_start <= ?`).bind(cutoff - ATTEMPT_WINDOW_SECONDS),
  ]);
}

export async function clearAttempts(db: D1Database, ip: string): Promise<void> {
  await db.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
}

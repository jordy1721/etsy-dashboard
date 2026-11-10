// Everything the Worker is given by Cloudflare: the database, the built
// phone app, plain settings and secrets. Secrets are optional in the type
// because the app must explain nicely when one is missing.
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /** Public shop number (set in wrangler.jsonc). */
  ETSY_SHOP_ID: string;

  // ---- Secrets (set in the Cloudflare dashboard, never in code) ----
  DASHBOARD_PASSCODE?: string;
  ETSY_KEYSTRING?: string;
  ETSY_SHARED_SECRET?: string;
  ANTHROPIC_API_KEY?: string;

  // ---- Only used by tests, to point at a fake Etsy ----
  ETSY_API_BASE?: string;
  ETSY_AUTH_URL?: string;
  ETSY_TOKEN_URL?: string;
}

/** Current time as Unix seconds. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

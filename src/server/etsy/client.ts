// ---------------------------------------------------------------------------
// ETSY API CLIENT (read-only)
// This client can only send GET requests. There is no code path that can
// change anything in the shop.
//
// It is polite to Etsy:
//  - requests go one at a time with a short pause between them
//  - on "429 Too Many Requests" it waits (as long as Etsy asks) and retries
//  - it gives up after a few tries instead of hammering
// ---------------------------------------------------------------------------

export const ETSY_API_BASE = "https://api.etsy.com/v3/application";

export class EtsyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface EtsyClientOptions {
  /** The app keystring. Server side only. */
  keystring: string;
  /** Etsy now also wants the shared secret in the key header ("keystring:secret"). */
  sharedSecret?: string;
  baseUrl?: string;
  /** Returns a valid OAuth access token. `force` = get a brand new one. */
  getToken?: (force: boolean) => Promise<string>;
  /** Swappable for tests. */
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Pause between requests, in milliseconds. */
  gapMs?: number;
  maxAttempts?: number;
}

export type Params = Record<string, string | number | undefined>;

export interface Page<T> {
  count: number;
  results: T[];
}

export class EtsyClient {
  /** How many requests this client has sent (handy for logs and tests). */
  requestCount = 0;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly gapMs: number;
  private readonly maxAttempts: number;
  private readonly baseUrl: string;
  private useCombinedKey: boolean;
  private keyFormatSwitched = false;

  constructor(private readonly opts: EtsyClientOptions) {
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.gapMs = opts.gapMs ?? 250;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.baseUrl = (opts.baseUrl ?? ETSY_API_BASE).replace(/\/$/, "");
    this.useCombinedKey = !!opts.sharedSecret;
  }

  private apiKeyHeader(): string {
    return this.useCombinedKey && this.opts.sharedSecret ? `${this.opts.keystring}:${this.opts.sharedSecret}` : this.opts.keystring;
  }

  /** GET one Etsy URL and return the JSON. `auth` adds the OAuth token for private shop data. */
  async get<T>(path: string, params: Params = {}, auth = false): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

    let refreshedToken = false;
    let lastError = "unknown error";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (this.requestCount > 0) await this.sleep(this.gapMs);
      this.requestCount++;

      const headers: Record<string, string> = { "x-api-key": this.apiKeyHeader(), accept: "application/json" };
      if (auth) {
        if (!this.opts.getToken) throw new EtsyError(401, "Etsy is not connected.");
        headers.authorization = `Bearer ${await this.opts.getToken(false)}`;
      }

      let res: Response;
      try {
        res = await this.fetchFn(url.toString(), { method: "GET", headers });
      } catch (err) {
        lastError = `network error: ${err instanceof Error ? err.message : String(err)}`;
        await this.sleep(1000 * 2 ** (attempt - 1));
        continue;
      }

      if (res.ok) return (await res.json()) as T;
      const body = (await res.text()).slice(0, 300);
      lastError = `Etsy answered ${res.status}: ${body}`;

      // Too many requests: wait as long as Etsy asks (max 15s), otherwise 1s, 2s, 4s...
      if (res.status === 429) {
        const asked = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 15) * 1000 : 1000 * 2 ** (attempt - 1);
        await this.sleep(waitMs);
        continue;
      }
      // Etsy had a hiccup: retry after a pause.
      if (res.status >= 500) {
        await this.sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      // Etsy changed how the key header looks in 2025. If the key is refused,
      // try the other format once ("keystring" <-> "keystring:secret").
      if ((res.status === 401 || res.status === 403) && /api.?key|keystring|shared secret/i.test(body) && this.opts.sharedSecret && !this.keyFormatSwitched) {
        this.keyFormatSwitched = true;
        this.useCombinedKey = !this.useCombinedKey;
        continue;
      }
      // Token expired early: get a new one, once.
      if (res.status === 401 && auth && this.opts.getToken && !refreshedToken) {
        refreshedToken = true;
        await this.opts.getToken(true);
        continue;
      }
      throw new EtsyError(res.status, lastError);
    }
    throw new EtsyError(429, `Gave up after ${this.maxAttempts} tries. Last problem: ${lastError}`);
  }

  /**
   * Read every page of a list (Etsy returns at most 100 rows per request).
   * Stops at `maxPages` so one sync can never run away. `complete` tells
   * the caller whether everything was read.
   */
  async getAll<T>(path: string, params: Params, auth: boolean, maxPages: number): Promise<{ results: T[]; complete: boolean }> {
    const limit = 100;
    const results: T[] = [];
    for (let page = 0; page < maxPages; page++) {
      const data = await this.get<Page<T>>(path, { ...params, limit, offset: page * limit }, auth);
      const rows = Array.isArray(data.results) ? data.results : [];
      results.push(...rows);
      const total = typeof data.count === "number" ? data.count : results.length;
      if (rows.length < limit || results.length >= total) return { results, complete: true };
    }
    return { results, complete: false };
  }
}

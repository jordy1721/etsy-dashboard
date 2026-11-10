// ---------------------------------------------------------------------------
// ETSY LOGIN (OAuth 2 with PKCE)
// How it works, in plain words:
//  1. /auth/start  sends you to Etsy with a one-time secret puzzle (PKCE).
//  2. You press "Allow" on Etsy. We only ask for READ permissions.
//  3. Etsy sends you back to /auth/callback with a short code.
//  4. The Worker swaps the code for tokens and stores them in the database.
//  5. Access tokens last 1 hour. The Worker renews them by itself using the
//     refresh token. You only repeat the login if it is unused for ~90 days.
// The tokens stay on the server. They are never sent to the browser.
// ---------------------------------------------------------------------------

import { getTokens, saveTokens, type StoredTokens } from "../db";
import { nowSeconds, type Env } from "../env";

export const ETSY_AUTH_URL = "https://www.etsy.com/oauth/connect";
export const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

/** Read-only permissions: shop info, listings, and orders/payments. Nothing ends in _w (write). */
export const ETSY_SCOPES = ["shops_r", "listings_r", "transactions_r"];

function base64Url(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A long random string nobody can guess. */
export function randomToken(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** PKCE: the "challenge" is the SHA-256 fingerprint of the secret "verifier". */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function buildAuthUrl(opts: { authUrl?: string; clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(opts.authUrl ?? ETSY_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", ETSY_SCOPES.join(" "));
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Ask Etsy's token address for tokens. Used for both the first login and renewals. */
export async function requestTokens(env: Env, form: Record<string, string>, fetchFn: typeof fetch = fetch): Promise<StoredTokens> {
  const res = await fetchFn(env.ETSY_TOKEN_URL ?? ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  let data: TokenResponse = {};
  try {
    data = (await res.json()) as TokenResponse;
  } catch {
    // Not JSON. Handled below.
  }
  if (!res.ok || !data.access_token || !data.refresh_token) {
    const why = data.error_description ?? data.error ?? `status ${res.status}`;
    throw new Error(`Etsy refused the login (${why}).`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: nowSeconds() + (data.expires_in ?? 3600),
  };
}

/** Swap the code from /auth/callback for tokens, and store them. */
export async function exchangeCode(env: Env, code: string, verifier: string, redirectUri: string): Promise<void> {
  const tokens = await requestTokens(env, {
    grant_type: "authorization_code",
    client_id: env.ETSY_KEYSTRING ?? "",
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
  });
  await saveTokens(env.DB, tokens);
}

/**
 * Get an access token that works right now.
 * Renews it automatically when it has expired (or is about to), and saves the
 * new pair, because Etsy gives a NEW refresh token on every renewal.
 */
export async function getAccessToken(env: Env, force = false, fetchFn: typeof fetch = fetch): Promise<string> {
  const stored = await getTokens(env.DB);
  if (!stored) throw new Error("Etsy is not connected yet. Open Settings and tap Connect Etsy.");
  if (!force && stored.expiresAt - 120 > nowSeconds()) return stored.accessToken;

  const fresh = await requestTokens(
    env,
    { grant_type: "refresh_token", client_id: env.ETSY_KEYSTRING ?? "", refresh_token: stored.refreshToken },
    fetchFn,
  );
  await saveTokens(env.DB, fresh);
  return fresh.accessToken;
}

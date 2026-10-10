/**
 * Cloudflare Turnstile, checked on the server. The browser widget gives a token; `siteverify`
 * says if a person solved it. A token works once. Every doubt refuses: only `success: true` from
 * Cloudflare, for our action and our hostname, passes.
 */

/** Cloudflare's published test keys (https://developers.cloudflare.com/turnstile/troubleshooting/testing/). */
export const TURNSTILE_TEST_KEYS = {
  sitePass: "1x00000000000000000000AA",
  siteFail: "2x00000000000000000000AB",
  secretPass: "1x0000000000000000000000000000000AA",
  secretFail: "2x0000000000000000000000000000000AA",
} as const;

const TEST_SECRETS = new Set<string>([TURNSTILE_TEST_KEYS.secretPass, TURNSTILE_TEST_KEYS.secretFail]);

/** The widget's `action`. Siteverify gives it back, so a token from another form does not pass. */
export const TURNSTILE_ACTION = "submit";

export interface TurnstileConfig {
  siteKey: string;
  secret: string;
  /** Cloudflare's siteverify, or the local stand-in of the e2e tests (see `verifyUrl`). */
  verifyUrl: string;
}

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type Env = Record<string, string | undefined>;

/**
 * `TURNSTILE_SITEVERIFY_URL` replaces siteverify for the e2e tests (the stand-in in
 * e2e/host-server.mjs), so they need no network. Only off Vercel, and only an http URL on
 * localhost: no deployment setting can turn the check off.
 */
function verifyUrl(env: Env): string {
  const value = env.TURNSTILE_SITEVERIFY_URL?.trim();
  if (!value || env.VERCEL) return SITEVERIFY_URL;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "http:" && local ? url.toString() : SITEVERIFY_URL;
  } catch {
    return SITEVERIFY_URL;
  }
}

/**
 * The keys from `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Cloudflare's always-pass test keys
 * only with the explicit opt-in `TURNSTILE_TEST_KEYS=1`, and never on Vercel (local `pnpm dev`).
 * Anything else gives null: the form is closed, never open without the check.
 */
export function turnstileConfig(env: Env): TurnstileConfig | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const secret = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (siteKey && secret) return { siteKey, secret, verifyUrl: verifyUrl(env) };
  if (siteKey || secret) return null;
  if (env.TURNSTILE_TEST_KEYS?.trim() === "1" && !env.VERCEL) {
    return { siteKey: TURNSTILE_TEST_KEYS.sitePass, secret: TURNSTILE_TEST_KEYS.secretPass, verifyUrl: verifyUrl(env) };
  }
  return null;
}

/**
 * The hostname that a good token names: the host of `AUTH_URL`, else the request host (without
 * its port). `AUTH_URL` comes first because it is configuration: off Vercel a client can set the
 * `Host` header, and `AUTH_URL` already names the app origin for the magic links and the email
 * links. The request host is the fallback when `AUTH_URL` is not set (Vercel sets the host itself,
 * also on a preview deployment). Null when neither gives a host: then no token passes.
 */
export function expectedHostname(env: Env, requestHost: string | null): string | null {
  if (env.AUTH_URL) {
    try {
      return new URL(env.AUTH_URL).hostname;
    } catch {
      // Fall through to the request host.
    }
  }
  if (!requestHost) return null;
  try {
    return new URL(`http://${requestHost}`).hostname;
  } catch {
    return null;
  }
}

export type TurnstileVerdict = "passed" | "refused" | "error";

function field(answer: object, key: string): unknown {
  return (answer as Record<string, unknown>)[key];
}

export async function verifyTurnstile(
  token: string,
  ip: string | null,
  {
    secret,
    hostname,
    url = SITEVERIFY_URL,
    fetch = globalThis.fetch,
    timeoutMs = 8000,
  }: {
    secret: string;
    /** From {@link expectedHostname}. */
    hostname: string | null;
    url?: string;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
  },
): Promise<TurnstileVerdict> {
  if (token === "" || token.length > 2048) return "refused";
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const response = await fetch(url, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return "error";
    const answer: unknown = await response.json();
    if (typeof answer !== "object" || answer === null || !("success" in answer)) return "error";
    if (answer.success !== true) return "refused";
    // Cloudflare answers a test secret with a dummy (no real action or hostname); it passes anyway.
    // The e2e stand-in gives real fields, so there the check applies.
    if (TEST_SECRETS.has(secret) && url === SITEVERIFY_URL) return "passed";
    const bound = field(answer, "action") === TURNSTILE_ACTION && hostname !== null && field(answer, "hostname") === hostname;
    return bound ? "passed" : "refused";
  } catch {
    return "error";
  }
}

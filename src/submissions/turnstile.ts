/**
 * Cloudflare Turnstile, checked on the server. The browser widget gives a token; `siteverify`
 * says if a person solved it. A token works once. Every doubt refuses: only `success: true` from
 * Cloudflare passes.
 */

/** Cloudflare's published test keys (https://developers.cloudflare.com/turnstile/troubleshooting/testing/). */
export const TURNSTILE_TEST_KEYS = {
  sitePass: "1x00000000000000000000AA",
  siteFail: "2x00000000000000000000AB",
  secretPass: "1x0000000000000000000000000000000AA",
  secretFail: "2x0000000000000000000000000000000AA",
} as const;

export interface TurnstileConfig {
  siteKey: string;
  secret: string;
  /** Cloudflare's siteverify, or the local stand-in of the e2e tests (see `verifyUrl`). */
  verifyUrl: string;
}

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * `TURNSTILE_SITEVERIFY_URL` replaces siteverify for the e2e tests (the stand-in in
 * e2e/host-server.mjs), so they need no network. Only off Vercel, and only an http URL on
 * localhost: no deployment setting can turn the check off.
 */
function verifyUrl(env: Record<string, string | undefined>): string {
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
 * The keys from `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. With neither set off Vercel
 * (local development, tests), the always-pass test keys. On Vercel, a missing value gives null:
 * the form is closed, never open without the check.
 */
export function turnstileConfig(env: Record<string, string | undefined>): TurnstileConfig | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const secret = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (siteKey && secret) return { siteKey, secret, verifyUrl: verifyUrl(env) };
  if (env.VERCEL) return null;
  if (siteKey || secret) return null;
  return { siteKey: TURNSTILE_TEST_KEYS.sitePass, secret: TURNSTILE_TEST_KEYS.secretPass, verifyUrl: verifyUrl(env) };
}

export type TurnstileVerdict = "passed" | "refused" | "error";

export async function verifyTurnstile(
  token: string,
  ip: string | null,
  {
    secret,
    url = SITEVERIFY_URL,
    fetch = globalThis.fetch,
    timeoutMs = 8000,
  }: { secret: string; url?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number },
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
    return answer.success === true ? "passed" : "refused";
  } catch {
    return "error";
  }
}

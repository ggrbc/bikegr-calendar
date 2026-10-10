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
}

/**
 * The keys from `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. With neither set off Vercel
 * (local development, tests), the always-pass test keys. On Vercel, a missing value gives null:
 * the form is closed, never open without the check.
 */
export function turnstileConfig(env: Record<string, string | undefined>): TurnstileConfig | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const secret = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (siteKey && secret) return { siteKey, secret };
  if (env.VERCEL) return null;
  if (siteKey || secret) return null;
  return { siteKey: TURNSTILE_TEST_KEYS.sitePass, secret: TURNSTILE_TEST_KEYS.secretPass };
}

export type TurnstileVerdict = "passed" | "refused" | "error";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  token: string,
  ip: string | null,
  {
    secret,
    fetch = globalThis.fetch,
    timeoutMs = 8000,
  }: { secret: string; fetch?: typeof globalThis.fetch; timeoutMs?: number },
): Promise<TurnstileVerdict> {
  if (token === "" || token.length > 2048) return "refused";
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const response = await fetch(SITEVERIFY, {
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

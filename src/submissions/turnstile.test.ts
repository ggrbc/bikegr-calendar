import { describe, expect, it, vi } from "vitest";
import { TURNSTILE_TEST_KEYS, turnstileConfig, verifyTurnstile } from "./turnstile";

function fakeFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe("turnstileConfig", () => {
  it("uses the keys from the environment", () => {
    expect(turnstileConfig({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" })).toEqual({
      siteKey: "site",
      secret: "secret",
    });
  });

  it("with no keys off Vercel, uses Cloudflare's always-pass test keys", () => {
    expect(turnstileConfig({})).toEqual({ siteKey: TURNSTILE_TEST_KEYS.sitePass, secret: TURNSTILE_TEST_KEYS.secretPass });
  });

  it("on Vercel, a missing key or secret closes the form", () => {
    expect(turnstileConfig({ VERCEL: "1" })).toBeNull();
    expect(turnstileConfig({ VERCEL: "1", TURNSTILE_SITE_KEY: "site" })).toBeNull();
    expect(turnstileConfig({ VERCEL: "1", TURNSTILE_SECRET_KEY: "secret" })).toBeNull();
  });
});

describe("verifyTurnstile", () => {
  it("sends the secret, the token, and the IP to siteverify; success passes", async () => {
    const fetch = fakeFetch({ success: true });
    expect(await verifyTurnstile("token-1", "203.0.113.9", { secret: TURNSTILE_TEST_KEYS.secretPass, fetch })).toBe("passed");
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("secret")).toBe(TURNSTILE_TEST_KEYS.secretPass);
    expect(body.get("response")).toBe("token-1");
    expect(body.get("remoteip")).toBe("203.0.113.9");
  });

  it("the always-fail answer refuses", async () => {
    const fetch = fakeFetch({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile("token", null, { secret: TURNSTILE_TEST_KEYS.secretFail, fetch })).toBe("refused");
    expect(new URLSearchParams(String(fetch.mock.calls[0][1]?.body)).has("remoteip")).toBe(false);
  });

  it("an empty token refuses without a network call", async () => {
    const fetch = fakeFetch({ success: true });
    expect(await verifyTurnstile("", null, { secret: "s", fetch })).toBe("refused");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a network error, a bad status, or a bad answer is an error, never a pass", async () => {
    const throwing = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await verifyTurnstile("t", null, { secret: "s", fetch: throwing })).toBe("error");
    expect(await verifyTurnstile("t", null, { secret: "s", fetch: fakeFetch({ success: true }, 500) })).toBe("error");
    expect(await verifyTurnstile("t", null, { secret: "s", fetch: fakeFetch("junk") })).toBe("error");
  });
});

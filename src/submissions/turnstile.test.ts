import { describe, expect, it, vi } from "vitest";
import {
  expectedHostname,
  SITEVERIFY_URL,
  TURNSTILE_ACTION,
  TURNSTILE_TEST_KEYS,
  turnstileConfig,
  verifyTurnstile,
} from "./turnstile";

function fakeFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

const SECRET = "real-secret";
const bound = { success: true, action: TURNSTILE_ACTION, hostname: "calendar.bikegr.org" };

describe("turnstileConfig", () => {
  it("uses the keys from the environment", () => {
    expect(turnstileConfig({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" })).toEqual({
      siteKey: "site",
      secret: "secret",
      verifyUrl: SITEVERIFY_URL,
    });
  });

  it("uses Cloudflare's always-pass test keys only with TURNSTILE_TEST_KEYS=1, off Vercel", () => {
    expect(turnstileConfig({ TURNSTILE_TEST_KEYS: "1" })).toEqual({
      siteKey: TURNSTILE_TEST_KEYS.sitePass,
      secret: TURNSTILE_TEST_KEYS.secretPass,
      verifyUrl: SITEVERIFY_URL,
    });
    expect(turnstileConfig({ TURNSTILE_TEST_KEYS: "1", VERCEL: "1" })).toBeNull();
    expect(turnstileConfig({ TURNSTILE_TEST_KEYS: "true" })).toBeNull();
  });

  it("with no keys and no opt-in, the form is closed, also off Vercel", () => {
    expect(turnstileConfig({})).toBeNull();
    expect(turnstileConfig({ VERCEL: "1" })).toBeNull();
  });

  it("only one of the two keys closes the form", () => {
    expect(turnstileConfig({ TURNSTILE_SITE_KEY: "site" })).toBeNull();
    expect(turnstileConfig({ TURNSTILE_SECRET_KEY: "secret", TURNSTILE_TEST_KEYS: "1" })).toBeNull();
    expect(turnstileConfig({ VERCEL: "1", TURNSTILE_SECRET_KEY: "secret" })).toBeNull();
  });

  it("the local siteverify stand-in works only off Vercel, only over http on localhost", () => {
    const local = "http://localhost:4100/turnstile/siteverify";
    const keys = { TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "k" };
    expect(turnstileConfig({ ...keys, TURNSTILE_SITEVERIFY_URL: local })?.verifyUrl).toBe(local);
    expect(turnstileConfig({ ...keys, VERCEL: "1", TURNSTILE_SITEVERIFY_URL: local })?.verifyUrl).toBe(SITEVERIFY_URL);
    expect(turnstileConfig({ ...keys, TURNSTILE_SITEVERIFY_URL: "https://other.example/ok" })?.verifyUrl).toBe(
      SITEVERIFY_URL,
    );
    expect(turnstileConfig({ ...keys, TURNSTILE_SITEVERIFY_URL: "not a url" })?.verifyUrl).toBe(SITEVERIFY_URL);
  });
});

describe("expectedHostname", () => {
  it("is the AUTH_URL host, else the request host without its port", () => {
    expect(expectedHostname({ AUTH_URL: "https://calendar.bikegr.org" }, "attacker.example")).toBe("calendar.bikegr.org");
    expect(expectedHostname({}, "preview-abc.vercel.app")).toBe("preview-abc.vercel.app");
    expect(expectedHostname({}, "localhost:3000")).toBe("localhost");
    expect(expectedHostname({ AUTH_URL: "not a url" }, "localhost:3000")).toBe("localhost");
    expect(expectedHostname({}, null)).toBeNull();
  });
});

describe("verifyTurnstile", () => {
  const options = { secret: SECRET, hostname: "calendar.bikegr.org" };

  it("sends the secret, the token, and the IP to siteverify; a bound success passes", async () => {
    const fetch = fakeFetch(bound);
    expect(await verifyTurnstile("token-1", "203.0.113.9", { ...options, fetch })).toBe("passed");
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("secret")).toBe(SECRET);
    expect(body.get("response")).toBe("token-1");
    expect(body.get("remoteip")).toBe("203.0.113.9");
  });

  it("a success for another action or another hostname refuses", async () => {
    expect(await verifyTurnstile("t", null, { ...options, fetch: fakeFetch({ ...bound, action: "login" }) })).toBe("refused");
    expect(await verifyTurnstile("t", null, { ...options, fetch: fakeFetch({ ...bound, action: undefined }) })).toBe("refused");
    expect(await verifyTurnstile("t", null, { ...options, fetch: fakeFetch({ ...bound, hostname: "other.example" }) })).toBe(
      "refused",
    );
    expect(await verifyTurnstile("t", null, { ...options, hostname: null, fetch: fakeFetch(bound) })).toBe("refused");
  });

  it("with Cloudflare's test secret, the dummy answer (no real action or hostname) passes", async () => {
    const dummy = { success: true, action: "", hostname: "example.com" };
    expect(
      await verifyTurnstile("t", null, { secret: TURNSTILE_TEST_KEYS.secretPass, hostname: "localhost", fetch: fakeFetch(dummy) }),
    ).toBe("passed");
  });

  it("with the test secret and the local stand-in, the action and the hostname are checked", async () => {
    const standIn = { secret: TURNSTILE_TEST_KEYS.secretPass, hostname: "localhost", url: "http://localhost:4100/turnstile/siteverify" };
    expect(await verifyTurnstile("t", null, { ...standIn, fetch: fakeFetch({ ...bound, hostname: "localhost" }) })).toBe("passed");
    expect(await verifyTurnstile("t", null, { ...standIn, fetch: fakeFetch({ ...bound, hostname: "other.example" }) })).toBe(
      "refused",
    );
  });

  it("the always-fail answer refuses", async () => {
    const fetch = fakeFetch({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile("token", null, { secret: TURNSTILE_TEST_KEYS.secretFail, hostname: "x", fetch })).toBe(
      "refused",
    );
    expect(new URLSearchParams(String(fetch.mock.calls[0][1]?.body)).has("remoteip")).toBe(false);
  });

  it("an empty token refuses without a network call", async () => {
    const fetch = fakeFetch(bound);
    expect(await verifyTurnstile("", null, { ...options, fetch })).toBe("refused");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a network error, a bad status, or a bad answer is an error, never a pass", async () => {
    const throwing = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await verifyTurnstile("t", null, { ...options, fetch: throwing })).toBe("error");
    expect(await verifyTurnstile("t", null, { ...options, fetch: fakeFetch(bound, 500) })).toBe("error");
    expect(await verifyTurnstile("t", null, { ...options, fetch: fakeFetch("junk") })).toBe("error");
  });
});

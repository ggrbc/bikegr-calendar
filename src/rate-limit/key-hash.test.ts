import { describe, expect, it } from "vitest";
import { hashRateLimitKey } from "./key-hash";

const env = { AUTH_SECRET: "test-secret-for-rate-limit-key-hash" };

describe("hashRateLimitKey", () => {
  it("is not the raw key and does not contain it", () => {
    const hash = hashRateLimitKey("magic-link:email", "jeremy@bikegr.org", env);
    expect(hash).not.toContain("jeremy");
    expect(hash).not.toContain("bikegr");
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("the same input gives the same hash; another bucket gives another", () => {
    const a = hashRateLimitKey("magic-link:ip", "203.0.113.7", env);
    expect(hashRateLimitKey("magic-link:ip", "203.0.113.7", env)).toBe(a);
    expect(hashRateLimitKey("submission:ip", "203.0.113.7", env)).not.toBe(a);
    expect(hashRateLimitKey("magic-link:ip", "203.0.113.8", env)).not.toBe(a);
  });

  it("another AUTH_SECRET gives another hash", () => {
    const a = hashRateLimitKey("magic-link:ip", "203.0.113.7", env);
    expect(hashRateLimitKey("magic-link:ip", "203.0.113.7", { AUTH_SECRET: "other" })).not.toBe(a);
  });

  it("bucket and key cannot run together", () => {
    expect(hashRateLimitKey("a", "b\nc", env)).not.toBe(hashRateLimitKey("a\nb", "c", env));
  });

  it("works with no AUTH_SECRET outside Vercel (dev-only key)", () => {
    expect(hashRateLimitKey("magic-link:ip", "203.0.113.7", {})).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("on Vercel with no AUTH_SECRET, it throws", () => {
    expect(() => hashRateLimitKey("magic-link:ip", "203.0.113.7", { VERCEL: "1" })).toThrow(/AUTH_SECRET/);
  });
});

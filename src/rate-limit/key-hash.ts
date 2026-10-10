/**
 * The stored rate-limit key: an HMAC, never a raw IP or email.
 *
 * The repo is public, so a pepper in the code would be known to everyone, and all IPv4 addresses
 * (2^32) are easy to hash again. So the HMAC key is derived from `AUTH_SECRET`, which every
 * environment already has. One derived sub-key keeps these hashes separate from every other use of
 * the secret. Rotating `AUTH_SECRET` resets all counters; that is harmless.
 */
import { createHmac } from "node:crypto";

const SUB_KEY_LABEL = "bikegr-calendar rate-limit v1";
/** Only where `AUTH_SECRET` is not set and `VERCEL` is not set: Vitest and a first local run. */
const DEV_ONLY_SECRET = "bikegr-calendar dev-only rate-limit secret";

type Env = Record<string, string | undefined>;

function subKey(env: Env): Buffer {
  const secret = env.AUTH_SECRET;
  if (!secret && env.VERCEL) {
    throw new Error("AUTH_SECRET is not set. The rate limit needs it on Vercel.");
  }
  return createHmac("sha256", secret || DEV_ONLY_SECRET).update(SUB_KEY_LABEL).digest();
}

/** base64url HMAC-SHA256 (43 characters) of the bucket and the key. */
export function hashRateLimitKey(bucket: string, key: string, env: Env = process.env): string {
  // JSON keeps the two parts apart: ("a", "b\nc") and ("a\nb", "c") give different input.
  return createHmac("sha256", subKey(env)).update(JSON.stringify([bucket, key])).digest("base64url");
}

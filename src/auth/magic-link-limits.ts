/**
 * Rate limits on magic-link requests (docs/plans/magic-link-rate-limit.md). The `signIn` callback
 * uses them at `email.verificationRequest`; a limited request gets the same answer as a sent link.
 */
import { describeError } from "@/agenda/describe-error";
import type { Db } from "@/db/types";
import { hitRateLimit, type RateLimitRule } from "@/rate-limit";

/** Every request from one client (IP, or IPv6 /64), Editor or not. */
export const MAGIC_LINK_IP_RULE: RateLimitRule = { bucket: "magic-link:ip", limit: 20, windowSeconds: 3600 };
/** Requests for one active Editor's email. Non-Editors get no email, so they are not counted. */
export const MAGIC_LINK_EMAIL_RULE: RateLimitRule = { bucket: "magic-link:email", limit: 5, windowSeconds: 3600 };

export type MagicLinkLimit = "ip" | "email";

export interface MagicLinkLimiter {
  /** True when the request may go on. Logs one line when it is limited. */
  allows(limit: MagicLinkLimit, key: string): Promise<boolean>;
}

/**
 * One limiter for one link request. **Fails open:** if the rate limit cannot run (for example the
 * `rate_limits` table is missing, or the connection fails), the request is allowed, and one line
 * logs the error class and code. Then the limiter can never lock out all Editors. After a failure,
 * the request skips its other limits, so it logs only that one line.
 *
 * No log line holds the email or the IP.
 */
export function magicLinkLimiter(db: Db): MagicLinkLimiter {
  let failed = false;
  return {
    async allows(limit, key) {
      if (failed) return true;
      try {
        const rule = limit === "ip" ? MAGIC_LINK_IP_RULE : MAGIC_LINK_EMAIL_RULE;
        const { allowed } = await hitRateLimit(db, rule, key);
        if (!allowed) console.warn(`[auth] Magic link not sent: rate limit (${limit}).`);
        return allowed;
      } catch (error) {
        failed = true;
        console.error(`[auth] Magic-link rate limit failed; request allowed: ${describeError(error)}`);
        return true;
      }
    },
  };
}

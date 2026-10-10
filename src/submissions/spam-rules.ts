/**
 * Spam control values for the public form (decided 2026-10-10, Q50). The rate limit itself is the
 * shared Postgres module `src/rate-limit` (stream `magic-link-rate-limit`); these types are the same
 * shape as its contract, so its functions fit `SubmitDeps` as they are.
 */

export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const HOUR = 3600;
const DAY = 86400;

/** Per IP: 3 an hour and 10 a day. Checked in this order; the first refusal stops. */
export const SUBMISSION_IP_RULES: RateLimitRule[] = [
  { bucket: "submission-ip-hour", limit: 3, windowSeconds: HOUR },
  { bucket: "submission-ip-day", limit: 10, windowSeconds: DAY },
];

/**
 * All Submissions together: 20 a day. Each one sends an email to the Editors, and the magic-link
 * login uses the same Resend quota, so a flood must never use it up. Counted only after a Turnstile
 * pass (Q51 = A), so bots with no pass cannot close the form for real Submitters.
 */
export const SUBMISSION_GLOBAL_RULE: RateLimitRule = { bucket: "submission-all-day", limit: 20, windowSeconds: DAY };
export const GLOBAL_KEY = "all";

/** The key for a request with no client IP. All such requests share one bucket. */
export const UNKNOWN_IP_KEY = "unknown";

/**
 * The honeypot field: hidden from people and from screen readers, so only a bot fills it. Its name
 * and label hold no word that browser autofill knows ("website", "url", "name", …), so a real
 * Submitter's browser never fills it by mistake.
 */
export const HONEYPOT_FIELD = "bgr_hp_field";
export const HONEYPOT_LABEL = "Leave this empty";

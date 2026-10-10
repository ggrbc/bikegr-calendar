/**
 * A fixed-window rate limit in Postgres. One row per (bucket, key): the window start and the hit
 * count, changed by one atomic upsert. Reasons and trade-offs: docs/plans/magic-link-rate-limit.md.
 */
import { inArray, lt, sql } from "drizzle-orm";
import { describeError } from "@/agenda/describe-error";
import { rateLimits } from "@/db/schema";
import type { Db } from "@/db/types";
import { hashRateLimitKey } from "./key-hash";

export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** 0 when allowed; else the whole seconds to the window end (at least 1). */
  retryAfterSeconds: number;
}

/** At most this many expired rows are deleted in one call, so one call stays fast. */
const PRUNE_BATCH = 500;
/**
 * Only rows that expired at least this long ago are pruned, so a server whose clock is ahead does
 * not delete rows that are still live for the other servers.
 */
const PRUNE_GRACE_MS = 60_000;

/**
 * Counts one hit for `key` in `rule.bucket` and tells whether it is allowed.
 *
 * - Exact under concurrent calls: Postgres locks the row for `ON CONFLICT DO UPDATE`, so each hit
 *   gets a different count and exactly `limit` hits in a window are allowed.
 * - A refused hit still counts (capped at `limit + 1`), so retrying does not help.
 * - Windows are aligned to the epoch. A late hit from an instance with an older clock counts in the
 *   current window. A stored window more than one window after the database clock (a far-future
 *   clock) is reset; `now` cannot cause that reset, so a far-past clock cannot reset a live row.
 * - When a key starts a new window, the call also deletes up to 500 rows that expired more than
 *   60 s ago.
 * - Strict: a database error throws. The caller decides to fail open or closed.
 */
export async function hitRateLimit(
  db: Db,
  rule: RateLimitRule,
  key: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  checkRule(rule);
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const windowEnd = new Date(windowStart.getTime() + windowMs);
  // The database clock decides "in the future", so a hit from a server whose clock is far behind
  // cannot reset a live row (its `now` would make every live row look like the future).
  const reset = sql`(${rateLimits.windowStart} < excluded.window_start
    OR ${rateLimits.windowStart} > now() + make_interval(secs => ${rule.windowSeconds}::int))`;

  const [row] = await db
    .insert(rateLimits)
    .values({
      bucket: rule.bucket,
      keyHash: hashRateLimitKey(rule.bucket, key),
      windowStart,
      hits: 1,
      expiresAt: windowEnd,
    })
    .onConflictDoUpdate({
      target: [rateLimits.bucket, rateLimits.keyHash],
      // `reset`: the stored window is older than this hit's window (a new window began), or it
      // starts more than one window after the database's `now()` (it came from a far-future clock
      // and would lock the key). A window one ahead (a clock a little ahead) is kept, and the hit
      // counts in it; so does a hit from a clock that is behind.
      set: {
        hits: sql`CASE WHEN ${reset} THEN 1 ELSE LEAST(${rateLimits.hits} + 1, ${rule.limit + 1}::int) END`,
        windowStart: sql`CASE WHEN ${reset} THEN excluded.window_start ELSE ${rateLimits.windowStart} END`,
        expiresAt: sql`CASE WHEN ${reset} THEN excluded.expires_at ELSE ${rateLimits.expiresAt} END`,
      },
    })
    .returning({ hits: rateLimits.hits, windowStart: rateLimits.windowStart });

  if (row.hits === 1) await pruneExpired(db, now);

  if (row.hits <= rule.limit) return { allowed: true, retryAfterSeconds: 0 };
  const msLeft = row.windowStart.getTime() + windowMs - now.getTime();
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(msLeft / 1000)) };
}

function checkRule(rule: RateLimitRule) {
  if (!rule.bucket) throw new Error("Rate limit: bucket must not be empty.");
  if (!Number.isInteger(rule.limit) || rule.limit < 1) {
    throw new Error("Rate limit: limit must be a whole number of 1 or more.");
  }
  if (!Number.isInteger(rule.windowSeconds) || rule.windowSeconds < 1) {
    throw new Error("Rate limit: windowSeconds must be a whole number of 1 or more.");
  }
}

/** Old rows only. A failure here does not change the hit result, so it logs and continues. */
async function pruneExpired(db: Db, now: Date) {
  try {
    const expired = db
      .select({ ctid: sql`ctid` })
      .from(rateLimits)
      .where(lt(rateLimits.expiresAt, new Date(now.getTime() - PRUNE_GRACE_MS)))
      .limit(PRUNE_BATCH);
    await db.delete(rateLimits).where(inArray(sql`ctid`, expired));
  } catch (error) {
    console.error(`[rate-limit] Prune failed: ${describeError(error)}`);
  }
}

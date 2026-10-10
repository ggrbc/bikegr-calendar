/** hitRateLimit on PGlite with the real migrations. */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rateLimits } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { hitRateLimit, type RateLimitRule } from "./index";

const RULE: RateLimitRule = { bucket: "test:ip", limit: 3, windowSeconds: 60 };
/** Exactly at the start of a 60-second window (epoch-aligned). */
const T0 = new Date("2026-10-10T12:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe("hitRateLimit", () => {
  let db: Db;
  let close: () => Promise<void>;

  async function rows() {
    return db.select().from(rateLimits);
  }

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await db.delete(rateLimits);
  });

  it("the first `limit` hits are allowed and the next is refused", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hitRateLimit(db, RULE, "203.0.113.7", at(i)));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.slice(0, 3).every((r) => r.retryAfterSeconds === 0)).toBe(true);
  });

  it("a refused hit gives the seconds to the window end, rounded up", async () => {
    for (let i = 0; i < 3; i++) await hitRateLimit(db, RULE, "k", at(0));
    expect(await hitRateLimit(db, RULE, "k", at(10.2))).toEqual({ allowed: false, retryAfterSeconds: 50 });
    expect(await hitRateLimit(db, RULE, "k", at(59.9))).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("a refused hit still counts, capped at limit + 1", async () => {
    for (let i = 0; i < 10; i++) await hitRateLimit(db, RULE, "k", at(1));
    const [row] = await rows();
    expect(row.hits).toBe(RULE.limit + 1);
  });

  it("a new window allows again and reuses the row", async () => {
    for (let i = 0; i < 4; i++) await hitRateLimit(db, RULE, "k", at(1));
    expect(await hitRateLimit(db, RULE, "k", at(60))).toEqual({ allowed: true, retryAfterSeconds: 0 });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ hits: 1, windowStart: at(60), expiresAt: at(120) });
  });

  it("a late hit with an older clock counts in the current window", async () => {
    await hitRateLimit(db, RULE, "k", at(61));
    await hitRateLimit(db, RULE, "k", at(59)); // another instance, a little behind
    const [row] = await rows();
    expect(row).toMatchObject({ hits: 2, windowStart: at(60) });
  });

  it("buckets are separate for the same key", async () => {
    for (let i = 0; i < 3; i++) await hitRateLimit(db, RULE, "k", at(1));
    const other = { ...RULE, bucket: "test:email" };
    expect((await hitRateLimit(db, other, "k", at(1))).allowed).toBe(true);
    expect((await hitRateLimit(db, RULE, "k", at(1))).allowed).toBe(false);
  });

  it("keys are separate in the same bucket", async () => {
    for (let i = 0; i < 3; i++) await hitRateLimit(db, RULE, "a", at(1));
    expect((await hitRateLimit(db, RULE, "b", at(1))).allowed).toBe(true);
  });

  it("concurrent: 25 hits at once with limit 10 give exactly 10 allowed", async () => {
    const rule = { ...RULE, limit: 10 };
    const results = await Promise.all(Array.from({ length: 25 }, () => hitRateLimit(db, rule, "k", at(1))));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].hits).toBe(11);
  });

  it("the stored row has no raw key", async () => {
    await hitRateLimit(db, { ...RULE, bucket: "magic-link:email" }, "jeremy@bikegr.org", at(1));
    await hitRateLimit(db, RULE, "203.0.113.7", at(1));
    const dump = JSON.stringify(await rows());
    expect(dump).not.toContain("jeremy");
    expect(dump).not.toContain("203.0.113");
    expect(dump).toContain("magic-link:email");
  });

  it("expired rows are deleted when a new window starts, and live rows stay", async () => {
    await hitRateLimit(db, RULE, "old", at(1)); // expires at(60)
    await hitRateLimit(db, { ...RULE, windowSeconds: 3600 }, "long", at(1)); // expires at(3600)
    await hitRateLimit(db, RULE, "new", at(61)); // a new window: prunes
    const keys = (await rows()).map((r) => r.expiresAt.getTime()).sort();
    expect(keys).toEqual([at(120).getTime(), at(3600).getTime()]);
  });

  it("no prune when the hit is not the first in its window", async () => {
    await hitRateLimit(db, RULE, "k", at(61)); // first in its window; nothing to prune yet
    await db.execute(sql`
      INSERT INTO rate_limits (bucket, key_hash, window_start, hits, expires_at)
      VALUES ('test:old', 'h', ${T0.toISOString()}::timestamptz, 1, ${at(60).toISOString()}::timestamptz)`);
    await hitRateLimit(db, RULE, "k", at(62)); // second hit: no prune
    expect((await rows()).map((r) => r.bucket).sort()).toEqual(["test:ip", "test:old"]);
  });

  it("the prune deletes at most 500 rows in one call", async () => {
    await db.execute(sql`
      INSERT INTO rate_limits (bucket, key_hash, window_start, hits, expires_at)
      SELECT 'test:old', 'h' || n, ${T0.toISOString()}::timestamptz, 1, ${at(60).toISOString()}::timestamptz
      FROM generate_series(1, 600) AS n`);
    await hitRateLimit(db, RULE, "new", at(61));
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(rateLimits)
      .where(sql`${rateLimits.bucket} = 'test:old'`);
    expect(n).toBe(100);
  });

  it("refuses a rule that is not positive whole numbers", async () => {
    await expect(hitRateLimit(db, { ...RULE, limit: 0 }, "k")).rejects.toThrow(/limit/);
    await expect(hitRateLimit(db, { ...RULE, windowSeconds: 1.5 }, "k")).rejects.toThrow(/windowSeconds/);
    await expect(hitRateLimit(db, { ...RULE, bucket: "" }, "k")).rejects.toThrow(/bucket/);
  });

  it("throws when the table is missing (the caller decides)", async () => {
    const fresh = await createTestDb();
    await fresh.db.execute(sql`DROP TABLE rate_limits`);
    await expect(hitRateLimit(fresh.db, RULE, "k")).rejects.toThrow();
    await fresh.close();
  });
});

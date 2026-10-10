/**
 * hitRateLimit under real concurrency: a real Postgres server with 10 connections. PGlite runs one
 * query at a time, so it cannot test the row lock.
 *
 * Runs only when TEST_DATABASE_URL is a localhost URL (for example a throwaway Docker Postgres).
 * It never reads DATABASE_URL, so it cannot reach Neon. It applies the migrations to that database.
 */
import { like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { hitRateLimit } from "./index";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const url = process.env.TEST_DATABASE_URL;

function isLocal(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

describe.runIf(url && !isLocal(url))("TEST_DATABASE_URL guard", () => {
  it("TEST_DATABASE_URL must be a localhost URL", () => {
    throw new Error("TEST_DATABASE_URL must point at localhost. This test never uses a remote database.");
  });
});

describe.runIf(url && isLocal(url))("hitRateLimit on a real Postgres server", () => {
  let client: postgres.Sql;
  let db: Db;
  const now = new Date("2025-01-01T12:00:01.000Z"); // in the past: the database clock decides the future

  beforeAll(async () => {
    client = postgres(url!, { max: 10, onnotice: () => {} });
    const postgresDb = drizzle({ client, schema });
    await migrate(postgresDb, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
    db = postgresDb;
  });
  afterAll(async () => {
    await db.delete(schema.rateLimits).where(like(schema.rateLimits.bucket, "pgtest:%"));
    await client.end();
  });
  beforeEach(async () => {
    await db.delete(schema.rateLimits).where(like(schema.rateLimits.bucket, "pgtest:%"));
  });

  it("concurrent: 50 hits on 10 connections with limit 10 give exactly 10 allowed", async () => {
    const rule = { bucket: "pgtest:ip", limit: 10, windowSeconds: 60 };
    const results = await Promise.all(Array.from({ length: 50 }, () => hitRateLimit(db, rule, "k", now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    const rows = await db.select().from(schema.rateLimits).where(like(schema.rateLimits.bucket, "pgtest:%"));
    expect(rows).toHaveLength(1);
    expect(rows[0].hits).toBe(11);
  });

  it("concurrent first hits on 20 new keys make one row each", async () => {
    const rule = { bucket: "pgtest:email", limit: 1, windowSeconds: 60 };
    const keys = Array.from({ length: 20 }, (_, i) => `key-${i}`);
    const results = await Promise.all(
      keys.flatMap((key) => [hitRateLimit(db, rule, key, now), hitRateLimit(db, rule, key, now)]),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
    const rows = await db.select().from(schema.rateLimits).where(like(schema.rateLimits.bucket, "pgtest:%"));
    expect(rows).toHaveLength(20);
  });
});

/**
 * Opens a database connection with the right driver. No Next.js imports here, so scripts (seed)
 * can use it. App code uses `getDb()` from `@/db` instead.
 *
 * - A `*.neon.tech` host uses the Neon WebSocket `Pool` (`drizzle-orm/neon-serverless`). It supports
 *   interactive transactions. Node 24 has a global `WebSocket`, so the driver needs no `ws` package.
 * - Every other host (Docker Postgres) uses postgres-js over TCP. It also supports transactions.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Db } from "./types";

export type Driver = "neon" | "postgres-js";

export function driverFor(databaseUrl: string): Driver {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  return host.endsWith(".neon.tech") ? "neon" : "postgres-js";
}

export interface OpenDb {
  db: Db;
  /** Ends the pool or client. Call it when the request or script is done. */
  close: () => Promise<void>;
}

export function openDb(databaseUrl: string, options: { max?: number } = {}): OpenDb {
  if (driverFor(databaseUrl) === "neon") {
    const pool = new Pool({ connectionString: databaseUrl, max: options.max });
    return { db: drizzleNeon({ client: pool, schema }), close: () => pool.end() };
  }
  const client = postgres(databaseUrl, { max: options.max ?? 5 });
  return { db: drizzlePostgres({ client, schema }), close: () => client.end() };
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

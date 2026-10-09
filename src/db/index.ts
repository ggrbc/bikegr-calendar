import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { openDb, requireDatabaseUrl } from "./client";
import type { Db } from "./types";

export type { Db } from "./types";

// One database handle per server instance. `globalThis` keeps it across dev hot reloads.
const instance = globalThis as unknown as { __bikegrDb?: Db };

/**
 * The app's database. Nothing connects until the first call, so `next build` needs no database.
 *
 * - Neon (production, and local dev with a Neon URL): one module-scope WebSocket `Pool`, attached
 *   with `attachDatabasePool` (Vercel Fluid compute guidance). Vercel keeps the function instance
 *   alive until idle connections are closed, and requests on the same instance share the Pool.
 *   Outside Vercel, `attachDatabasePool` does nothing.
 * - postgres-js (Docker): one client for the life of the server.
 */
export function getDb(): Db {
  if (instance.__bikegrDb) return instance.__bikegrDb;
  const opened = openDb(requireDatabaseUrl());
  if (opened.neonPool) attachDatabasePool(opened.neonPool);
  instance.__bikegrDb = opened.db;
  return opened.db;
}

/**
 * The database handle for the proxy (src/proxy.ts). Not `getDb()` from `@/db`: that module imports
 * `server-only`, which refuses to load outside the React server bundle. Same rules otherwise: one
 * handle per instance, nothing connects until the first call, and the Neon Pool is attached to the
 * Vercel function life cycle.
 */
import { attachDatabasePool } from "@vercel/functions";
import { openDb, requireDatabaseUrl } from "@/db/client";
import type { Db } from "@/db/types";

const holder = globalThis as unknown as { __bikegrProxyDb?: Db };

export function proxyDb(): Db {
  if (holder.__bikegrProxyDb) return holder.__bikegrProxyDb;
  const opened = openDb(requireDatabaseUrl(), { max: 2 });
  if (opened.neonPool) attachDatabasePool(opened.neonPool);
  holder.__bikegrProxyDb = opened.db;
  return opened.db;
}

import "server-only";
import { after } from "next/server";
import { cache } from "react";
import { driverFor, openDb, requireDatabaseUrl } from "./client";
import type { Db } from "./types";

export type { Db } from "./types";

// postgres-js (Docker) keeps one client for the life of the dev server. `globalThis` keeps it
// across hot reloads.
const local = globalThis as unknown as { __bikegrLocalDb?: Db };

/**
 * The database for the current request. Nothing connects until the first call, so `next build`
 * needs no database.
 *
 * On Neon, this follows Neon's serverless guidance: one `Pool` per request, ended with `after()`
 * when the response is done. React `cache` makes the calls in one request share that Pool.
 */
export const getDb = cache((): Db => {
  const url = requireDatabaseUrl();
  if (driverFor(url) === "neon") {
    const { db, close } = openDb(url);
    after(close);
    return db;
  }
  local.__bikegrLocalDb ??= openDb(url).db;
  return local.__bikegrLocalDb;
});

/**
 * Test helper: a fresh in-process Postgres (PGlite) with the real migrations applied.
 * Use only in tests.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";
import type { Db } from "./types";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}

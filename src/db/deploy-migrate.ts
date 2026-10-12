/**
 * Applies the migrations in `drizzle/` during a Vercel Production build (`vercel.json` runs it after
 * `next build`). Preview and local builds skip it: they must never change the production schema.
 * A failed migration fails the build, so the deploy is not promoted.
 */
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { fileURLToPath } from "node:url";
import { openDb, requireDatabaseUrl } from "./client";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function shouldMigrate(env: Record<string, string | undefined>): boolean {
  return env.VERCEL_ENV === "production";
}

async function main(): Promise<void> {
  if (!shouldMigrate(process.env)) {
    console.log("[migrate] Not a Vercel Production build; skipping migrations.");
    return;
  }
  const { db, driver, close } = openDb(requireDatabaseUrl(), { max: 1 });
  try {
    console.log(`[migrate] Applying migrations (${driver})...`);
    if (driver === "neon") await migrateNeon(db as unknown as NeonDatabase, { migrationsFolder });
    else await migratePostgres(db as unknown as PostgresJsDatabase, { migrationsFolder });
    console.log("[migrate] Done.");
  } finally {
    await close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: Error & { code?: string }) => {
    // Log only the code and name: the message can contain the connection string.
    console.error("[migrate] Failed:", error.code ?? error.name);
    process.exit(1);
  });
}

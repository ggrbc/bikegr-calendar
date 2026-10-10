/**
 * `pnpm db:smoke` — read-only check of the production driver path: an interactive transaction and
 * a rollback through `drizzle-orm/neon-serverless` against DATABASE_URL (from the environment or
 * `.env.local`). Never prints the URL.
 */
import { sql } from "drizzle-orm";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { driverFor, openDb, requireDatabaseUrl } from "./client";
import { loadLocalEnv } from "./load-env";

async function main() {
  loadLocalEnv();
  const url = requireDatabaseUrl();
  if (driverFor(url) !== "neon") {
    throw new Error("DATABASE_URL is not a Neon host. The smoke check tests the Neon driver only.");
  }

  const { db, close } = openDb(url, { max: 1 });
  try {
    let selected: unknown;
    let rolledBack = false;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set transaction read only`);
        const result = (await tx.execute(sql`select 1 as one`)) as unknown as { rows: { one: number }[] };
        selected = result.rows[0]?.one;
        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
      rolledBack = true;
    }
    if (selected !== 1) throw new Error(`select 1 returned ${String(selected)}`);
    if (!rolledBack) throw new Error("The transaction did not roll back.");
    console.log("Neon smoke check passed: driver neon-serverless, transaction, select 1, rollback.");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`Neon smoke check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

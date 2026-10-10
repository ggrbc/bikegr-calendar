/**
 * `pnpm db:seed` — inserts the first Admins into the database at DATABASE_URL (from the
 * environment or `.env.local`). Safe to run again.
 */
import { openDb, requireDatabaseUrl } from "./client";
import { loadLocalEnv } from "./load-env";
import { seedAdmins } from "./seed-admins";

async function main() {
  loadLocalEnv();
  const { db, close } = openDb(requireDatabaseUrl(), { max: 1 });
  try {
    const count = await seedAdmins(db);
    console.log(`Seed done: ${count} new Admin(s).`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

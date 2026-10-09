import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** The database handle that all callers use, whatever the driver (Neon, postgres-js, PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

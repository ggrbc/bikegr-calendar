import { defineConfig } from "drizzle-kit";
import { loadLocalEnv } from "./src/db/load-env";

loadLocalEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});

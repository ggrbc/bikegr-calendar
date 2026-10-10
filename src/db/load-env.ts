import { existsSync } from "node:fs";

/**
 * Loads `.env.local` for scripts that run outside Next.js (drizzle-kit, the seed). Next.js loads it
 * itself for the app. Values already in the environment win.
 */
export function loadLocalEnv(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
}

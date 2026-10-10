/**
 * Playwright smoke tests for the public side and the Embed. Local only: they need the local e2e
 * Postgres (see e2e/global-setup.ts). `pnpm test:e2e` builds the app, starts it on port 3100, and
 * serves the Embed test host pages on port 4100 (a second origin).
 */
import { defineConfig, devices } from "@playwright/test";
import { APP, APP_PORT, E2E_DATABASE_URL, HOST, HOST_PORT } from "./e2e/fixture";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: APP, ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: `pnpm build && pnpm start -p ${APP_PORT}`,
      // embed.js needs no database, so the readiness check does not fill the cache before the seed.
      url: `${APP}/embed.js`,
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        EMBED_EXTRA_FRAME_ANCESTORS: HOST,
      },
    },
    {
      command: `node e2e/host-server.mjs ${HOST_PORT}`,
      url: HOST,
      reuseExistingServer: false,
    },
  ],
});

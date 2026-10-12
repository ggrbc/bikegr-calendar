import { describe, expect, it } from "vitest";
import { shouldMigrate } from "./deploy-migrate";

describe("shouldMigrate", () => {
  it("migrates only on a Vercel Production build", () => {
    expect(shouldMigrate({ VERCEL_ENV: "production" })).toBe(true);
    expect(shouldMigrate({ VERCEL_ENV: "preview" })).toBe(false);
    expect(shouldMigrate({ VERCEL_ENV: "development" })).toBe(false);
    expect(shouldMigrate({})).toBe(false);
  });
});

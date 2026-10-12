import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { failureCode, shouldMigrate } from "./deploy-migrate";

describe("shouldMigrate", () => {
  it("migrates only on a Vercel Production build", () => {
    expect(shouldMigrate({ VERCEL_ENV: "production" })).toBe(true);
    expect(shouldMigrate({ VERCEL_ENV: "preview" })).toBe(false);
    expect(shouldMigrate({ VERCEL_ENV: "development" })).toBe(false);
    expect(shouldMigrate({})).toBe(false);
  });
});

describe("failureCode", () => {
  it("logs the Postgres code from a wrapped query error", () => {
    const cause = Object.assign(new Error('column "x" already exists'), { code: "42701" });
    expect(failureCode(new DrizzleQueryError("ALTER TABLE ...", [], cause))).toBe("42701");
  });

  it("falls back to the error's own code, then its name", () => {
    const refused = Object.assign(new Error("connect postgres://u:secret@host"), { code: "ECONNREFUSED" });
    expect(failureCode(refused)).toBe("ECONNREFUSED");
    expect(failureCode(new TypeError("postgres://u:secret@host"))).toBe("TypeError");
    expect(failureCode("boom")).toBe("unknown error");
  });
});

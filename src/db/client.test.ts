import { describe, expect, it } from "vitest";
import { driverFor } from "./client";

describe("driverFor", () => {
  it("picks the Neon WebSocket driver for a Neon host", () => {
    expect(
      driverFor("postgresql://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"),
    ).toBe("neon");
  });

  it("picks postgres-js for localhost and other hosts", () => {
    expect(driverFor("postgres://bikegr:bikegr@localhost:5432/bikegr")).toBe("postgres-js");
    expect(driverFor("postgres://u:p@db.example.com/x")).toBe("postgres-js");
  });

  it("does not match a host that only contains neon.tech", () => {
    expect(driverFor("postgres://u:p@neon.tech.example.com/x")).toBe("postgres-js");
  });

  it("refuses a value that is not a URL", () => {
    expect(() => driverFor("not a url")).toThrow(/DATABASE_URL/);
  });
});

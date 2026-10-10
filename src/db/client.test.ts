import { describe, expect, it, vi } from "vitest";
import { driverFor, openDb } from "./client";

describe("openDb", () => {
  const neonUrl = "postgresql://u:npg_secret@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb";

  it("handles Neon Pool errors, so an idle-connection error does not crash the process", async () => {
    const opened = openDb(neonUrl);
    expect(opened.neonPool?.listenerCount("error")).toBeGreaterThan(0);
    await opened.close();
  });

  it("logs a Pool error without the connection string", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const opened = openDb(neonUrl);
    opened.neonPool?.emit("error", Object.assign(new Error(`bad ${neonUrl}`), { code: "28P01" }));
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("28P01");
    expect(logged).not.toContain("npg_secret");
    log.mockRestore();
    await opened.close();
  });
});

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

import { describe, expect, it } from "vitest";
import { localDateTimeFromDriver, localDateTimeToDriver } from "./columns";

describe("localDateTime column", () => {
  it("writes a LocalDateTime as a Postgres timestamp literal", () => {
    expect(localDateTimeToDriver("2026-05-05T18:00")).toBe("2026-05-05 18:00:00");
  });

  it("refuses a value with an offset or seconds", () => {
    expect(() => localDateTimeToDriver("2026-05-05T18:00Z")).toThrow(/LocalDateTime/);
    expect(() => localDateTimeToDriver("2026-05-05T18:00:30")).toThrow(/LocalDateTime/);
    expect(() => localDateTimeToDriver("2026-05-05")).toThrow(/LocalDateTime/);
  });

  it("reads the space form that Postgres drivers return", () => {
    expect(localDateTimeFromDriver("2026-05-05 18:00:00")).toBe("2026-05-05T18:00");
  });

  it("reads the T form and fractional seconds", () => {
    expect(localDateTimeFromDriver("2026-11-03T18:00:00")).toBe("2026-11-03T18:00");
    expect(localDateTimeFromDriver("2026-11-03 18:00:00.000")).toBe("2026-11-03T18:00");
  });

  it("refuses a Date object, because its zone is unknown", () => {
    expect(() => localDateTimeFromDriver(new Date() as unknown as string)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { icsUtc, isoWithOffset, wallClockToUtc } from "./utc";

const utc = (local: string) => wallClockToUtc(local).toISOString();

describe("wallClockToUtc", () => {
  it("summer time (EDT) gives UTC minus four hours", () => {
    expect(utc("2026-07-14T18:00")).toBe("2026-07-14T22:00:00.000Z");
  });

  it("winter time (EST) gives UTC minus five hours", () => {
    expect(utc("2026-12-14T18:00")).toBe("2026-12-14T23:00:00.000Z");
  });

  it("a time in the March gap (02:30) moves forward by the gap to 03:30 EDT", () => {
    // 2027-03-14: 02:00 EST becomes 03:00 EDT.
    expect(utc("2027-03-14T02:30")).toBe("2027-03-14T07:30:00.000Z");
    expect(utc("2027-03-14T03:30")).toBe("2027-03-14T07:30:00.000Z");
    expect(utc("2027-03-14T01:59")).toBe("2027-03-14T06:59:00.000Z");
  });

  it("a time that occurs twice in November (01:30) uses the first one (EDT)", () => {
    // 2026-11-01: 02:00 EDT becomes 01:00 EST, so 01:00–01:59 occurs twice.
    expect(utc("2026-11-01T01:30")).toBe("2026-11-01T05:30:00.000Z");
    expect(utc("2026-11-01T02:30")).toBe("2026-11-01T07:30:00.000Z");
  });

  it("midnight at the start of a change day converts correctly", () => {
    expect(utc("2027-03-14T00:00")).toBe("2027-03-14T05:00:00.000Z");
    expect(utc("2026-11-01T00:00")).toBe("2026-11-01T04:00:00.000Z");
  });
});

describe("isoWithOffset", () => {
  it("offset text for JSON-LD is -04:00 in summer and -05:00 in winter", () => {
    expect(isoWithOffset("2026-07-14T18:00")).toBe("2026-07-14T18:00:00-04:00");
    expect(isoWithOffset("2026-12-14T18:00")).toBe("2026-12-14T18:00:00-05:00");
  });

  it("a time in the March gap is written as the real local time", () => {
    expect(isoWithOffset("2027-03-14T02:30")).toBe("2027-03-14T03:30:00-04:00");
  });
});

describe("icsUtc", () => {
  it("writes the RFC 5545 UTC form", () => {
    expect(icsUtc(new Date("2026-10-14T22:00:00.000Z"))).toBe("20261014T220000Z");
  });
});

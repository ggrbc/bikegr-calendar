import { describe, expect, it } from "vitest";
import {
  addDays,
  addMinutes,
  dayOfWeek,
  daysBetween,
  fromFloating,
  fromFloatingDate,
  minutesBetween,
  toFloating,
  utcToWallClock,
} from "./wall-clock";

describe("wall-clock helpers", () => {
  it("round-trips a wall-clock date and time through a floating Date", () => {
    const floating = toFloating("2026-11-03T18:00");
    expect(floating.toISOString()).toBe("2026-11-03T18:00:00.000Z");
    expect(fromFloating(floating)).toBe("2026-11-03T18:00");
  });

  it("round-trips a local date through a floating Date", () => {
    expect(fromFloatingDate(toFloating("2026-03-08"))).toBe("2026-03-08");
  });

  it("rejects text that is not a local date or date-time", () => {
    expect(() => toFloating("2026-11-03T18:00Z")).toThrow(/wall-clock/);
    expect(() => toFloating("11/03/2026")).toThrow(/wall-clock/);
  });

  it("adds minutes in wall-clock time across the November DST change", () => {
    // 1 am + 120 minutes is 3 am on the wall clock, though 3 real hours pass in Detroit.
    expect(addMinutes("2026-11-01T01:00", 120)).toBe("2026-11-01T03:00");
  });

  it("adds days across a month end and a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("gives the day of the week of a local date (0 = Sunday)", () => {
    expect(dayOfWeek("2026-09-06")).toBe(0);
    expect(dayOfWeek("2026-09-08")).toBe(2);
    expect(dayOfWeek("2026-09-12")).toBe(6);
  });

  it("measures wall-clock minutes and days", () => {
    expect(minutesBetween("2026-09-09T19:45", "2026-09-09T23:00")).toBe(195);
    expect(daysBetween("2026-09-01", "2026-09-30")).toBe(29);
  });

  it("converts UTC to Detroit wall-clock in summer (EDT, UTC-4)", () => {
    expect(utcToWallClock(new Date("2026-09-09T23:45:00Z"))).toBe("2026-09-09T19:45");
  });

  it("converts UTC to Detroit wall-clock in winter (EST, UTC-5)", () => {
    expect(utcToWallClock(new Date("2026-12-09T00:45:00Z"))).toBe("2026-12-08T19:45");
  });

  it("converts UTC midnight-adjacent times without a 24:00 hour", () => {
    expect(utcToWallClock(new Date("2026-09-01T04:00:00Z"))).toBe("2026-09-01T00:00");
  });
});

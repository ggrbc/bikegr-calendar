import { describe, expect, it } from "vitest";
import { agendaWindow, todayInDetroit } from "./dates";

describe("agenda dates", () => {
  it("todayInDetroit gives the Detroit date near midnight UTC", () => {
    // 2026-10-10 02:30 UTC is 2026-10-09 22:30 EDT.
    expect(todayInDetroit(new Date("2026-10-10T02:30:00Z"))).toBe("2026-10-09");
    expect(todayInDetroit(new Date("2026-10-10T04:30:00Z"))).toBe("2026-10-10");
    // Winter (EST, UTC-5).
    expect(todayInDetroit(new Date("2026-12-01T04:59:00Z"))).toBe("2026-11-30");
  });

  it("agendaWindow is today to eight weeks later, half-open", () => {
    expect(agendaWindow("2026-10-09")).toEqual({ from: "2026-10-09", to: "2026-12-04" });
  });
});

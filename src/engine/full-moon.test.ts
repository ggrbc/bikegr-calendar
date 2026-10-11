import { describe, expect, it } from "vitest";
import { expandOccurrences } from "./expand-occurrences";
import { InvalidRuleError, isRuleStart, ruleStartsBetween } from "./expand-rule";
import { fullMoonDates, fullMoonInstant } from "./full-moon";
import { allDay, timed } from "./test-helpers";

/** 2026 full moons in UTC, from the US Naval Observatory. */
const USNO_2026 = [
  "2026-01-03T10:03Z",
  "2026-02-01T22:09Z",
  "2026-03-03T11:38Z",
  "2026-04-02T02:12Z",
  "2026-05-01T17:23Z",
  "2026-05-31T08:45Z",
  "2026-06-29T23:57Z",
  "2026-07-29T14:36Z",
  "2026-08-28T04:18Z",
  "2026-09-26T16:49Z",
  "2026-10-26T04:12Z",
  "2026-11-24T14:53Z",
  "2026-12-24T01:28Z",
];

const MOON = "FREQ=X-FULLMOON";
const ride9pm = timed("2026-10-26T21:00", "2026-10-26T23:00");

describe("fullMoonInstant", () => {
  it("is within 2 minutes of the USNO times", () => {
    // Full moon number 321.5 is the one of 2026-01-03.
    const k0 = 321.5;
    USNO_2026.forEach((expected, i) => {
      const off = Math.abs(fullMoonInstant(k0 + i).getTime() - new Date(expected).getTime());
      expect(off).toBeLessThan(2 * 60_000);
    });
  });
});

describe("fullMoonDates", () => {
  it("gives the Detroit date, which is the day before a full moon early in the UTC day", () => {
    expect(fullMoonDates("2026-01-01", "2026-12-31")).toEqual([
      "2026-01-03",
      "2026-02-01",
      "2026-03-03",
      "2026-04-01",
      "2026-05-01",
      "2026-05-31",
      "2026-06-29",
      "2026-07-29",
      "2026-08-28",
      "2026-09-26",
      "2026-10-26",
      "2026-11-24",
      "2026-12-23",
    ]);
  });

  it("includes both ends", () => {
    expect(fullMoonDates("2026-10-26", "2026-11-24")).toEqual(["2026-10-26", "2026-11-24"]);
    expect(fullMoonDates("2026-10-27", "2026-11-23")).toEqual([]);
  });
});

describe("the full-moon rule", () => {
  it("repeats the time slot on each full-moon date", () => {
    expect(ruleStartsBetween(ride9pm, MOON, "2026-10-01T00:00", "2027-01-01T00:00")).toEqual([
      "2026-10-26T21:00",
      "2026-11-24T21:00",
      "2026-12-23T21:00",
    ]);
  });

  it("works for all-day Events", () => {
    expect(ruleStartsBetween(allDay("2026-10-26"), MOON, "2026-10-01", "2026-12-01")).toEqual([
      "2026-10-26",
      "2026-11-24",
    ]);
  });

  it("starts at the first full moon on or after the first date", () => {
    const fromOct1 = timed("2026-10-01T21:00", "2026-10-01T23:00");
    expect(ruleStartsBetween(fromOct1, MOON, "2026-09-01T00:00", "2026-11-01T00:00")).toEqual([
      "2026-10-26T21:00",
    ]);
  });

  it("stops at UNTIL, which includes the whole day", () => {
    expect(
      ruleStartsBetween(ride9pm, `${MOON};UNTIL=20261224T235959`, "2026-10-01T00:00", "2027-06-01T00:00"),
    ).toEqual(["2026-10-26T21:00", "2026-11-24T21:00", "2026-12-23T21:00"]);
    expect(
      ruleStartsBetween(ride9pm, `${MOON};UNTIL=20261223`, "2026-10-01T00:00", "2027-06-01T00:00"),
    ).toHaveLength(3);
  });

  it("stops after COUNT dates, counted from the first", () => {
    const rule = `${MOON};COUNT=14`;
    const all = ruleStartsBetween(ride9pm, rule, "2026-01-01T00:00", "9999-12-31T23:59");
    expect(all).toHaveLength(14);
    expect(all[13]).toBe("2027-11-13T21:00");
    expect(ruleStartsBetween(ride9pm, rule, "2027-11-01T00:00", "2028-12-01T00:00")).toEqual([
      "2027-11-13T21:00",
    ]);
  });

  it("tells if a value is a rule start", () => {
    expect(isRuleStart(ride9pm, MOON, "2026-11-24T21:00")).toBe(true);
    expect(isRuleStart(ride9pm, MOON, "2026-11-25T21:00")).toBe(false);
    expect(isRuleStart(ride9pm, MOON, "2026-11-24T20:00")).toBe(false);
  });

  it("expands into Occurrences with skipped dates", () => {
    const occurrences = expandOccurrences(
      {
        eventId: "moon",
        timing: ride9pm,
        rrule: MOON,
        exdates: ["2026-11-24T21:00"],
        scheduleStatus: "scheduled",
        scheduleNote: null,
      },
      [],
      { from: "2026-10-01", to: "2027-01-01" },
    );
    expect(occurrences.map((o) => o.originalStart)).toEqual(["2026-10-26T21:00", "2026-12-23T21:00"]);
  });

  it.each([
    ["BYDAY", `${MOON};BYDAY=TU`],
    ["INTERVAL", `${MOON};INTERVAL=2`],
    ["both UNTIL and COUNT", `${MOON};UNTIL=20261231;COUNT=3`],
  ])("rejects %s", (_name, rule) => {
    expect(() => ruleStartsBetween(ride9pm, rule, "2026-10-01T00:00", "2026-11-01T00:00")).toThrow(InvalidRuleError);
  });
});

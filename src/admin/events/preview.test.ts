import { describe, expect, it } from "vitest";
import type { EventRuleInput } from "@/engine";
import { firstStartOnOrAfter, nextOccurrences } from "./preview";

function series(patch: Partial<EventRuleInput> = {}): EventRuleInput {
  return {
    eventId: "e1",
    timing: { kind: "timed", start: "2026-10-06T18:00", end: "2026-10-06T20:00" },
    rrule: "FREQ=WEEKLY;BYDAY=TU",
    exdates: [],
    scheduleStatus: "scheduled",
    scheduleNote: null,
    ...patch,
  };
}

const starts = (result: ReturnType<typeof nextOccurrences>) =>
  result.ok ? result.occurrences.map((o) => o.originalStart) : result.message;

describe("preview of the next Occurrences", () => {
  it("next 10 Occurrences of a weekly Series from today", () => {
    const result = nextOccurrences(series(), [], "2026-10-10");
    expect(starts(result)).toEqual([
      "2026-10-13T18:00",
      "2026-10-20T18:00",
      "2026-10-27T18:00",
      "2026-11-03T18:00",
      "2026-11-10T18:00",
      "2026-11-17T18:00",
      "2026-11-24T18:00",
      "2026-12-01T18:00",
      "2026-12-08T18:00",
      "2026-12-15T18:00",
    ]);
  });

  it("skipped dates are not in the preview; a cancelled Override shows its Schedule status", () => {
    const result = nextOccurrences(
      series({ exdates: ["2026-10-13T18:00"] }),
      [{ eventId: "e1", originalStart: "2026-10-20T18:00", scheduleStatus: "cancelled" }],
      "2026-10-10",
      2,
    );
    expect(result.ok && result.occurrences.map((o) => [o.originalStart, o.scheduleStatus])).toEqual([
      ["2026-10-20T18:00", "cancelled"],
      ["2026-10-27T18:00", "scheduled"],
    ]);
  });

  it("a COUNT Series with 3 dates left shows 3", () => {
    const result = nextOccurrences(series({ rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=5" }), [], "2026-10-14");
    expect(starts(result)).toEqual(["2026-10-20T18:00", "2026-10-27T18:00", "2026-11-03T18:00"]);
  });

  it("a yearly Series finds 10 dates over 10 years", () => {
    const result = nextOccurrences(
      series({
        timing: { kind: "allDay", startDate: "2027-07-04", endDate: "2027-07-04" },
        rrule: "FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=4",
      }),
      [],
      "2026-10-10",
    );
    expect(result.ok && result.occurrences.length).toBe(10);
  });

  it("a one-time Event in the past shows no dates", () => {
    const result = nextOccurrences(series({ rrule: null }), [], "2026-10-10");
    expect(starts(result)).toEqual([]);
  });

  it("a bad Advanced rule shows the engine's message", () => {
    const result = nextOccurrences(series({ rrule: "FREQ=SOMETIMES" }), [], "2026-10-10");
    expect(result.ok).toBe(false);
    expect(starts(result)).toMatch(/Invalid RRULE "FREQ=SOMETIMES": bad value for FREQ/);
  });
});

describe("first rule start on or after a date", () => {
  const timing = { kind: "timed", start: "2026-10-05T18:00", end: "2026-10-05T20:00" } as const;

  it("a Monday start with a Tuesday rule gives the Tuesday", () => {
    expect(firstStartOnOrAfter(timing, "FREQ=WEEKLY;BYDAY=TU", "2026-10-05T18:00")).toBe(
      "2026-10-06T18:00",
    );
  });

  it("no start when the rule ends before", () => {
    expect(
      firstStartOnOrAfter(timing, "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261001T235959", "2026-10-05T18:00"),
    ).toBeNull();
  });
});

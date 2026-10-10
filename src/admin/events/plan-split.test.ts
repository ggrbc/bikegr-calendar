import { describe, expect, it } from "vitest";
import { expandOccurrences, type OverrideInput, type Timing } from "@/engine";
import type { SplitDraft } from "./event-input";
import { planSplit, type SplitSeries } from "./plan-split";

// Weekly on Tuesday at 18:00 from Tue 2026-10-06.
const tuesday: Timing = { kind: "timed", start: "2026-10-06T18:00", end: "2026-10-06T20:00" };

function series(patch: Partial<SplitSeries> = {}): SplitSeries {
  return { timing: tuesday, rrule: "FREQ=WEEKLY;BYDAY=TU", exdates: [], ...patch };
}

type Input = Pick<SplitDraft, "splitDate" | "mode" | "time" | "rule">;

function change(splitDate: string, patch: Partial<Input> = {}): Input {
  return {
    splitDate,
    mode: "change",
    time: { kind: "timed", startTime: "18:30", endTime: "20:30" },
    rule: { kind: "same" },
    ...patch,
  };
}

const override = (originalStart: string, patch: Partial<OverrideInput> = {}): OverrideInput => ({
  eventId: "old",
  originalStart,
  scheduleStatus: "cancelled",
  ...patch,
});

describe("Series split plan", () => {
  it("split on an Occurrence date ends the old Series the day before and starts the new one on that date", () => {
    const plan = planSplit(series(), [], change("2026-11-03"));
    expect(plan).toMatchObject({
      kind: "split",
      old: { rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261102T235959", exdates: [] },
      next: {
        timing: { kind: "timed", start: "2026-11-03T18:30", end: "2026-11-03T20:30" },
        rrule: "FREQ=WEEKLY;BYDAY=TU",
        exdates: [],
      },
    });
  });

  it("split between two Occurrences starts the new Series on the next Occurrence", () => {
    const plan = planSplit(series(), [], change("2026-10-29"));
    expect(plan.kind === "split" && plan.next.timing).toEqual({
      kind: "timed",
      start: "2026-11-03T18:30",
      end: "2026-11-03T20:30",
    });
    expect(plan.kind === "split" && plan.old.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261028T235959");
  });

  it("a new repeat starts on its first date on or after the split date", () => {
    const plan = planSplit(
      series(),
      [],
      change("2026-11-01", { rule: { kind: "rrule", rrule: "FREQ=WEEKLY;BYDAY=TH" } }),
    );
    expect(plan.kind === "split" && plan.next).toMatchObject({
      timing: { start: "2026-11-05T18:30" },
      rrule: "FREQ=WEEKLY;BYDAY=TH",
    });
  });

  it("split before the first Occurrence changes the Series in place", () => {
    const plan = planSplit(series(), [override("2026-10-13T18:00")], change("2026-10-01"));
    expect(plan).toMatchObject({
      kind: "in-place",
      next: { timing: { start: "2026-10-06T18:30" }, rrule: "FREQ=WEEKLY;BYDAY=TU" },
      moved: [{ from: "2026-10-13T18:00", to: "2026-10-13T18:30" }],
      removedOverrides: [],
    });
  });

  it("split after the last Occurrence is refused", () => {
    const plan = planSplit(series({ rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959" }), [], change("2026-10-28"));
    expect(plan).toEqual({
      kind: "refused",
      message: "This Series has no dates on or after Wed, Oct 28. Pick an earlier date.",
    });
  });

  it("a COUNT Series: old gets UNTIL, new gets the remaining COUNT with the same repeat", () => {
    // 5 dates: Oct 6, 13, 20, 27, Nov 3. Split on Oct 20 leaves 2 before it, 3 after.
    const plan = planSplit(series({ rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=5" }), [], change("2026-10-20"));
    expect(plan.kind === "split" && [plan.old.rrule, plan.next.rrule]).toEqual([
      "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261019T235959",
      "FREQ=WEEKLY;BYDAY=TU;COUNT=3",
    ]);
  });

  it("same repeat keeps the old UNTIL on the new Series", () => {
    const plan = planSplit(
      series({ rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261124T235959" }),
      [],
      change("2026-11-03"),
    );
    expect(plan.kind === "split" && plan.next.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261124T235959");
  });

  it("every-2-weeks Series keeps its weeks with the same repeat and a new time", () => {
    // Every 2 weeks from Oct 6: Oct 20, Nov 3, Nov 17 … A split on Oct 26 (an "off" week) must
    // start on Nov 3, not Oct 27.
    const old = series({ rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU" });
    const plan = planSplit(old, [], change("2026-10-26"));
    expect(plan.kind).toBe("split");
    if (plan.kind !== "split") return;
    const next = expandOccurrences(
      { eventId: "n", timing: plan.next.timing, rrule: plan.next.rrule, exdates: [], scheduleStatus: "scheduled", scheduleNote: null },
      [],
      { from: "2026-10-26", to: "2026-12-01" },
    );
    expect(next.map((o) => o.originalStart)).toEqual(["2026-11-03T18:30", "2026-11-17T18:30"]);
  });

  it("an Override exactly on the split date moves to the new Series with the new time as its key", () => {
    const plan = planSplit(series(), [override("2026-11-03T18:00")], change("2026-11-03"));
    expect(plan.kind === "split" && plan.moved).toEqual([{ from: "2026-11-03T18:00", to: "2026-11-03T18:30" }]);
  });

  it("an Override before the split date stays, also when it was moved to a later date", () => {
    const moved = override("2026-10-27T18:00", {
      timing: { kind: "timed", start: "2026-11-05T18:00", end: "2026-11-05T20:00" },
      scheduleStatus: undefined,
    });
    const plan = planSplit(series(), [moved], change("2026-11-03"));
    expect(plan.kind === "split" && [plan.moved, plan.removedOverrides]).toEqual([[], []]);
  });

  it("an Override on a date that the new repeat does not make is listed as removed", () => {
    const plan = planSplit(
      series(),
      [override("2026-11-10T18:00"), override("2026-11-03T18:00")],
      change("2026-11-01", { rule: { kind: "rrule", rrule: "FREQ=WEEKLY;BYDAY=TH" } }),
    );
    expect(plan.kind === "split" && [plan.moved, plan.removedOverrides]).toEqual([
      [],
      ["2026-11-03T18:00", "2026-11-10T18:00"],
    ]);
  });

  it("skipped dates on or after the split date move; earlier ones stay", () => {
    const plan = planSplit(
      series({ exdates: ["2026-10-13T18:00", "2026-11-10T18:00"] }),
      [],
      change("2026-11-03"),
    );
    expect(plan.kind === "split" && [plan.old.exdates, plan.next.exdates]).toEqual([
      ["2026-10-13T18:00"],
      ["2026-11-10T18:30"],
    ]);
  });

  it("an all-day Series can move to a timed slot; keys change from dates to date-times", () => {
    const allDay = series({
      timing: { kind: "allDay", startDate: "2026-10-06", endDate: "2026-10-06" },
      exdates: ["2026-11-10"],
    });
    const plan = planSplit(allDay, [override("2026-11-17")], change("2026-11-03"));
    expect(plan.kind === "split" && [plan.next.timing.kind, plan.next.exdates, plan.moved]).toEqual([
      "timed",
      ["2026-11-10T18:30"],
      [{ from: "2026-11-17", to: "2026-11-17T18:30" }],
    ]);
  });

  it("an end time before the start time ends on the next day", () => {
    const plan = planSplit(series(), [], change("2026-11-03", { time: { kind: "timed", startTime: "22:00", endTime: "01:00" } }));
    expect(plan.kind === "split" && plan.next.timing).toEqual({
      kind: "timed",
      start: "2026-11-03T22:00",
      end: "2026-11-04T01:00",
    });
  });

  it("a bad new rule is refused with the engine's message", () => {
    const plan = planSplit(series(), [], change("2026-11-03", { rule: { kind: "rrule", rrule: "FREQ=NEVER" } }));
    expect(plan).toEqual({ kind: "refused", message: 'Invalid RRULE "FREQ=NEVER": bad value for FREQ', field: "rule" });
  });

  it("Stop the Series sets UNTIL and removes later Overrides and skipped dates", () => {
    const plan = planSplit(
      series({ exdates: ["2026-10-13T18:00", "2026-11-10T18:00"] }),
      [override("2026-10-20T18:00"), override("2026-11-17T18:00")],
      { ...change("2026-11-03"), mode: "stop" },
    );
    expect(plan).toEqual({
      kind: "stop",
      old: { rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261102T235959", exdates: ["2026-10-13T18:00"] },
      removedOverrides: ["2026-11-17T18:00"],
    });
  });

  it("Stop the Series is refused when no date is left before it", () => {
    expect(planSplit(series(), [], { ...change("2026-10-06"), mode: "stop" })).toEqual({
      kind: "refused",
      message: "No dates would be left. Use Delete to remove the whole Event.",
    });
  });

  it("an Event that does not repeat cannot be split", () => {
    expect(planSplit(series({ rrule: null }), [], change("2026-10-06"))).toMatchObject({ kind: "refused" });
  });
});

import { describe, expect, it } from "vitest";
import { expandOccurrences } from "./expand-occurrences";
import { allDay, makeEvent, override, timed } from "./test-helpers";
import { timingStart } from "./timing";
import type { Occurrence, OverrideInput } from "./types";

const october = { from: "2026-10-01", to: "2026-11-01" };

describe("expandOccurrences — one-time Events and the window", () => {
  it("one-time timed Event in the window gives one Occurrence", () => {
    const event = makeEvent(timed("2026-10-03T09:00", "2026-10-03T14:00"));
    expect(expandOccurrences(event, [], october)).toEqual([
      {
        eventId: "evt",
        originalStart: "2026-10-03T09:00",
        originalTiming: timed("2026-10-03T09:00", "2026-10-03T14:00"),
        timing: timed("2026-10-03T09:00", "2026-10-03T14:00"),
        scheduleStatus: "scheduled",
        scheduleNote: null,
      },
    ]);
  });

  it("one-time Event outside the window gives nothing", () => {
    const event = makeEvent(timed("2026-09-19T10:00", "2026-09-19T14:00"));
    expect(expandOccurrences(event, [], october)).toEqual([]);
  });

  it("window is half-open: an Occurrence on the `to` date is excluded", () => {
    const event = makeEvent(timed("2026-11-01T09:00", "2026-11-01T10:00"));
    expect(expandOccurrences(event, [], october)).toEqual([]);
  });

  it("one-time Event carries its Schedule status and Schedule note", () => {
    const event = makeEvent(timed("2026-10-30T19:30", "2026-10-31T00:00"), {
      scheduleStatus: "cancelled",
      scheduleNote: "Rain — see you next year",
    });
    const [occurrence] = expandOccurrences(event, [], october);
    expect(occurrence.scheduleStatus).toBe("cancelled");
    expect(occurrence.scheduleNote).toBe("Rain — see you next year");
  });

  it("multi-day Event that starts before the window and ends in it is included", () => {
    const event = makeEvent(timed("2026-09-30T13:00", "2026-10-02T15:00"));
    expect(expandOccurrences(event, [], october)).toHaveLength(1);
  });

  it("timed Event that ends exactly at the window start is excluded", () => {
    const event = makeEvent(timed("2026-09-30T22:00", "2026-10-01T00:00"));
    expect(expandOccurrences(event, [], october)).toEqual([]);
  });

  it("zero-length Occurrence on the `from` date is included", () => {
    const event = makeEvent(timed("2026-10-01T00:00", "2026-10-01T00:00"));
    expect(expandOccurrences(event, [], october)).toHaveLength(1);
  });

  it("all-day one-day Event on the `from` date is included", () => {
    const event = makeEvent(allDay("2026-10-01"));
    const [occurrence] = expandOccurrences(event, [], october);
    expect(occurrence.originalStart).toBe("2026-10-01");
    expect(occurrence.timing).toEqual(allDay("2026-10-01"));
  });

  it("all-day one-day Event on the `to` date is excluded", () => {
    const event = makeEvent(allDay("2026-11-01"));
    expect(expandOccurrences(event, [], october)).toEqual([]);
  });

  it("all-day multi-day Event that touches the window is included", () => {
    const event = makeEvent(allDay("2026-09-01", "2026-10-01"));
    expect(expandOccurrences(event, [], october)).toHaveLength(1);
  });

  it("a bad window date gives a clear error", () => {
    const event = makeEvent(timed("2026-10-03T09:00", "2026-10-03T14:00"));
    expect(() => expandOccurrences(event, [], { from: "2026-13-01", to: "2027-01-01" })).toThrow(
      /window\.from/,
    );
    expect(() => expandOccurrences(event, [], { from: "2026-10-01", to: "2026/11/01" })).toThrow(
      /window\.to/,
    );
  });

  it("a timed Event that ends before it starts gives a clear error", () => {
    const event = makeEvent(timed("2026-10-03T09:00", "2026-10-03T08:00"));
    expect(() => expandOccurrences(event, [], october)).toThrow(/ends before it starts/);
  });

  it("an all-day Event that ends before it starts gives a clear error", () => {
    const event = makeEvent(allDay("2026-10-03", "2026-10-02"));
    expect(() => expandOccurrences(event, [], october)).toThrow(/ends before it starts/);
  });

  it("a timed Event with date-only values gives a clear error", () => {
    const event = makeEvent(timed("2026-10-03", "2026-10-03"));
    expect(() => expandOccurrences(event, [], october)).toThrow(/wall-clock/);
  });

  it("an Override time slot that ends before it starts gives a clear error", () => {
    const event = makeEvent(timed("2026-10-03T09:00", "2026-10-03T14:00"));
    const bad = override("2026-10-03T09:00", { timing: timed("2026-10-04T09:00", "2026-10-04T08:00") });
    expect(() => expandOccurrences(event, [bad], october)).toThrow(/Override/);
  });

  it("an empty or reversed window gives nothing", () => {
    const event = makeEvent(timed("2026-10-03T09:00", "2026-10-03T14:00"));
    expect(expandOccurrences(event, [], { from: "2026-10-03", to: "2026-10-03" })).toEqual([]);
    expect(expandOccurrences(event, [], { from: "2026-11-01", to: "2026-10-01" })).toEqual([]);
  });
});

const starts = (occurrences: Occurrence[]) => occurrences.map((o) => timingStart(o.timing));

describe("expandOccurrences — Series expansion", () => {
  const tuesdayRide = makeEvent(timed("2026-09-08T18:00", "2026-09-08T21:00"), {
    rrule: "FREQ=WEEKLY;BYDAY=TU",
  });

  it("weekly Series gives only the Occurrences in the window", () => {
    expect(starts(expandOccurrences(tuesdayRide, [], october))).toEqual([
      "2026-10-06T18:00",
      "2026-10-13T18:00",
      "2026-10-20T18:00",
      "2026-10-27T18:00",
    ]);
  });

  it("Tuesday 6 pm ride stays 6 pm across the November DST change", () => {
    // DST ends Sunday 2026-11-01 in Detroit.
    const result = expandOccurrences(tuesdayRide, [], { from: "2026-10-27", to: "2026-11-04" });
    expect(starts(result)).toEqual(["2026-10-27T18:00", "2026-11-03T18:00"]);
  });

  it("Tuesday 6 pm ride stays 6 pm across the March DST change", () => {
    // DST starts Sunday 2027-03-14 in Detroit.
    const result = expandOccurrences(tuesdayRide, [], { from: "2027-03-09", to: "2027-03-17" });
    expect(starts(result)).toEqual(["2027-03-09T18:00", "2027-03-16T18:00"]);
  });

  it("wall-clock length is kept on every Occurrence", () => {
    const result = expandOccurrences(tuesdayRide, [], { from: "2026-10-27", to: "2026-11-04" });
    expect(result.map((o) => o.timing)).toEqual([
      timed("2026-10-27T18:00", "2026-10-27T21:00"),
      timed("2026-11-03T18:00", "2026-11-03T21:00"),
    ]);
  });

  it("first Occurrence is the Event's own start", () => {
    const result = expandOccurrences(tuesdayRide, [], { from: "2026-09-01", to: "2026-09-10" });
    expect(starts(result)).toEqual(["2026-09-08T18:00"]);
  });

  it("EXDATE skips one Occurrence", () => {
    const event = { ...tuesdayRide, exdates: ["2026-10-13T18:00"] };
    expect(starts(expandOccurrences(event, [], october))).toEqual([
      "2026-10-06T18:00",
      "2026-10-20T18:00",
      "2026-10-27T18:00",
    ]);
  });

  it("wall-clock UNTIL includes the last day", () => {
    const event = { ...tuesdayRide, rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261020T235959" };
    expect(starts(expandOccurrences(event, [], october))).toEqual([
      "2026-10-06T18:00",
      "2026-10-13T18:00",
      "2026-10-20T18:00",
    ]);
  });

  it("date-only UNTIL includes the whole last day", () => {
    const event = { ...tuesdayRide, rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261020" };
    expect(starts(expandOccurrences(event, [], october)).at(-1)).toBe("2026-10-20T18:00");
  });

  it("UTC UNTIL is read as Detroit wall-clock", () => {
    // 2026-10-20T22:30Z is 6:30 pm EDT, after the 6 pm start, so 2026-10-20 is included.
    const included = { ...tuesdayRide, rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261020T223000Z" };
    expect(starts(expandOccurrences(included, [], october)).at(-1)).toBe("2026-10-20T18:00");
    // 2026-10-20T21:30Z is 5:30 pm EDT, before the 6 pm start, so 2026-10-20 is excluded.
    const excluded = { ...tuesdayRide, rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261020T213000Z" };
    expect(starts(expandOccurrences(excluded, [], october)).at(-1)).toBe("2026-10-13T18:00");
  });

  it("COUNT limits the Series", () => {
    const event = { ...tuesdayRide, rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=6" };
    // 09-08, 09-15, 09-22, 09-29, 10-06, 10-13.
    expect(starts(expandOccurrences(event, [], october))).toEqual([
      "2026-10-06T18:00",
      "2026-10-13T18:00",
    ]);
  });

  it("seasonal BYMONTH Series skips the winter months", () => {
    const event = makeEvent(timed("2026-04-02T18:00", "2026-04-02T20:00"), {
      rrule: "FREQ=WEEKLY;BYDAY=TH;BYMONTH=4,5,6,7,8,9,10",
    });
    const result = expandOccurrences(event, [], { from: "2026-10-20", to: "2027-04-10" });
    expect(starts(result)).toEqual([
      "2026-10-22T18:00",
      "2026-10-29T18:00",
      "2027-04-01T18:00",
      "2027-04-08T18:00",
    ]);
  });

  it("monthly Series on the 2nd and 4th Tuesday", () => {
    const event = makeEvent(timed("2026-09-22T08:00", "2026-09-22T09:00"), {
      rrule: "FREQ=MONTHLY;BYDAY=2TU,4TU",
    });
    expect(starts(expandOccurrences(event, [], { from: "2026-09-01", to: "2026-12-01" }))).toEqual([
      "2026-09-22T08:00",
      "2026-10-13T08:00",
      "2026-10-27T08:00",
      "2026-11-10T08:00",
      "2026-11-24T08:00",
    ]);
  });

  it("yearly Series on a fixed date falls on different weekdays", () => {
    const event = makeEvent(timed("2027-01-01T10:00", "2027-01-01T13:00"), {
      rrule: "FREQ=YEARLY",
    });
    expect(starts(expandOccurrences(event, [], { from: "2027-01-01", to: "2030-01-01" }))).toEqual([
      "2027-01-01T10:00",
      "2028-01-01T10:00",
      "2029-01-01T10:00",
    ]);
  });

  it("all-day Series every other Thursday", () => {
    const event = makeEvent(allDay("2026-09-10"), { rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH" });
    const result = expandOccurrences(event, [], { from: "2026-09-01", to: "2026-10-10" });
    expect(result.map((o) => o.timing)).toEqual([
      allDay("2026-09-10"),
      allDay("2026-09-24"),
      allDay("2026-10-08"),
    ]);
    expect(result.map((o) => o.originalStart)).toEqual(["2026-09-10", "2026-09-24", "2026-10-08"]);
  });

  it("multi-day Series Occurrence that starts before the window is included", () => {
    const event = makeEvent(allDay("2026-09-26", "2026-10-02"), { rrule: "FREQ=YEARLY" });
    expect(starts(expandOccurrences(event, [], october))).toEqual(["2026-09-26"]);
  });

  it("bad RRULE gives a clear error", () => {
    const event = { ...tuesdayRide, rrule: "FREQ=FORTNIGHTLY" };
    expect(() => expandOccurrences(event, [], october)).toThrow(/RRULE/);
  });
});

describe("expandOccurrences — Overrides", () => {
  const tuesdayRide = makeEvent(timed("2026-09-08T18:00", "2026-09-08T21:00"), {
    rrule: "FREQ=WEEKLY;BYDAY=TU",
  });
  const oneOctober = (overrides: OverrideInput[], window = october) =>
    expandOccurrences(tuesdayRide, overrides, window);
  const find = (occurrences: Occurrence[], originalStart: string) =>
    occurrences.find((o) => o.originalStart === originalStart);

  it("Override of title and location only does not make the Occurrence rescheduled", () => {
    const result = oneOctober([
      override("2026-10-13T18:00", { title: "Fall Colors Ride", location: "Riverside Park" }),
    ]);
    const occurrence = find(result, "2026-10-13T18:00")!;
    expect(occurrence.title).toBe("Fall Colors Ride");
    expect(occurrence.location).toBe("Riverside Park");
    expect(occurrence.scheduleStatus).toBe("scheduled");
    expect(occurrence.timing).toEqual(occurrence.originalTiming);
  });

  it("Occurrences with no Override have no title or location", () => {
    const occurrence = find(oneOctober([]), "2026-10-13T18:00")!;
    expect("title" in occurrence).toBe(false);
    expect("location" in occurrence).toBe(false);
  });

  it("Override sets cancelled with a Schedule note", () => {
    const result = oneOctober([
      override("2026-10-13T18:00", {
        scheduleStatus: "cancelled",
        scheduleNote: "Rain — see you next week",
      }),
    ]);
    expect(find(result, "2026-10-13T18:00")).toMatchObject({
      scheduleStatus: "cancelled",
      scheduleNote: "Rain — see you next week",
    });
    expect(find(result, "2026-10-20T18:00")?.scheduleStatus).toBe("scheduled");
  });

  it("Override sets tentative, and another sets postponed", () => {
    const result = oneOctober([
      override("2026-10-13T18:00", { scheduleStatus: "tentative" }),
      override("2026-10-20T18:00", { scheduleStatus: "postponed" }),
    ]);
    expect(find(result, "2026-10-13T18:00")?.scheduleStatus).toBe("tentative");
    expect(find(result, "2026-10-20T18:00")?.scheduleStatus).toBe("postponed");
  });

  it("Override with a Schedule note of null clears the Event's note", () => {
    const event = { ...tuesdayRide, scheduleNote: "Lights required" };
    const result = expandOccurrences(
      event,
      [override("2026-10-13T18:00", { scheduleNote: null })],
      october,
    );
    expect(find(result, "2026-10-13T18:00")?.scheduleNote).toBeNull();
    expect(find(result, "2026-10-20T18:00")?.scheduleNote).toBe("Lights required");
  });

  it("Override with the same timing is not rescheduled", () => {
    const result = oneOctober([
      override("2026-10-13T18:00", { timing: timed("2026-10-13T18:00", "2026-10-13T21:00") }),
    ]);
    expect(find(result, "2026-10-13T18:00")?.scheduleStatus).toBe("scheduled");
  });

  it("Override that moves the time on the same day is rescheduled", () => {
    const result = oneOctober([
      override("2026-10-13T18:00", { timing: timed("2026-10-13T18:30", "2026-10-13T21:30") }),
    ]);
    const occurrence = find(result, "2026-10-13T18:00")!;
    expect(occurrence.scheduleStatus).toBe("rescheduled");
    expect(occurrence.timing).toEqual(timed("2026-10-13T18:30", "2026-10-13T21:30"));
  });

  it("Override that changes only the end time is rescheduled", () => {
    const result = oneOctober([
      override("2026-10-13T18:00", { timing: timed("2026-10-13T18:00", "2026-10-13T20:00") }),
    ]);
    expect(find(result, "2026-10-13T18:00")?.scheduleStatus).toBe("rescheduled");
  });

  it("rescheduled Occurrence keeps its original timing", () => {
    const result = oneOctober([
      override("2026-10-13T18:00", { timing: timed("2026-10-15T18:00", "2026-10-15T21:00") }),
    ]);
    expect(find(result, "2026-10-13T18:00")?.originalTiming).toEqual(
      timed("2026-10-13T18:00", "2026-10-13T21:00"),
    );
  });

  it("Occurrence moved out of the window still shows when its original slot is in it", () => {
    const result = oneOctober([
      override("2026-10-27T18:00", { timing: timed("2026-11-05T18:00", "2026-11-05T21:00") }),
    ]);
    expect(find(result, "2026-10-27T18:00")?.timing).toEqual(
      timed("2026-11-05T18:00", "2026-11-05T21:00"),
    );
  });

  it("Occurrence moved into the window shows when its original slot is outside it", () => {
    const result = oneOctober([
      override("2026-09-29T18:00", { timing: timed("2026-10-01T18:00", "2026-10-01T21:00") }),
    ]);
    expect(find(result, "2026-09-29T18:00")).toMatchObject({
      scheduleStatus: "rescheduled",
      timing: timed("2026-10-01T18:00", "2026-10-01T21:00"),
    });
  });

  it("Occurrence moved into the window from far away shows", () => {
    // Original start is months before the window, far outside the normal expansion range.
    const result = oneOctober([
      override("2026-09-08T18:00", { timing: timed("2026-10-02T18:00", "2026-10-02T21:00") }),
    ]);
    expect(find(result, "2026-09-08T18:00")?.scheduleStatus).toBe("rescheduled");
  });

  it("Occurrence moved inside the window shows once", () => {
    const result = oneOctober([
      override("2026-10-13T18:00", { timing: timed("2026-10-15T18:00", "2026-10-15T21:00") }),
    ]);
    expect(result.filter((o) => o.originalStart === "2026-10-13T18:00")).toHaveLength(1);
    expect(result).toHaveLength(4);
  });

  it("moved and cancelled Occurrence shows cancelled, not rescheduled", () => {
    const result = oneOctober([
      override("2026-10-13T18:00", {
        timing: timed("2026-10-15T18:00", "2026-10-15T21:00"),
        scheduleStatus: "cancelled",
      }),
    ]);
    expect(find(result, "2026-10-13T18:00")?.scheduleStatus).toBe("cancelled");
  });

  it("Override on an EXDATE start is ignored", () => {
    const event = { ...tuesdayRide, exdates: ["2026-10-13T18:00"] };
    const result = expandOccurrences(
      event,
      [override("2026-10-13T18:00", { timing: timed("2026-10-15T18:00", "2026-10-15T21:00") })],
      october,
    );
    expect(find(result, "2026-10-13T18:00")).toBeUndefined();
  });

  it("Override on a start that is not in the rule is ignored", () => {
    const result = oneOctober([
      override("2026-10-14T18:00", { timing: timed("2026-10-16T18:00", "2026-10-16T21:00") }),
    ]);
    expect(find(result, "2026-10-14T18:00")).toBeUndefined();
    expect(result).toHaveLength(4);
  });

  it("Override for another Event is ignored", () => {
    const result = oneOctober([
      override("2026-10-13T18:00", { scheduleStatus: "cancelled" }, "other-event"),
    ]);
    expect(find(result, "2026-10-13T18:00")?.scheduleStatus).toBe("scheduled");
  });

  it("Override applies to a one-time Event too", () => {
    const event = makeEvent(timed("2026-10-03T09:00", "2026-10-03T14:00"));
    const [occurrence] = expandOccurrences(
      event,
      [override("2026-10-03T09:00", { scheduleStatus: "postponed" })],
      october,
    );
    expect(occurrence.scheduleStatus).toBe("postponed");
  });

  it("all-day Occurrence moved to another date is rescheduled", () => {
    const event = makeEvent(allDay("2026-09-10"), { rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH" });
    const result = expandOccurrences(
      event,
      [override("2026-10-08", { timing: allDay("2026-10-09") })],
      october,
    );
    expect(find(result, "2026-10-08")).toMatchObject({
      scheduleStatus: "rescheduled",
      timing: allDay("2026-10-09"),
    });
  });

  it("results sort by actual start, so a moved Occurrence sorts at its new slot", () => {
    const result = oneOctober([
      override("2026-10-06T18:00", { timing: timed("2026-10-21T07:00", "2026-10-21T09:00") }),
    ]);
    expect(starts(result)).toEqual([
      "2026-10-13T18:00",
      "2026-10-20T18:00",
      "2026-10-21T07:00",
      "2026-10-27T18:00",
    ]);
  });
});

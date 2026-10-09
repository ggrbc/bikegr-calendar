import { describe, expect, it } from "vitest";
import { expandOccurrences } from "./expand-occurrences";
import { allDay, makeEvent, timed } from "./test-helpers";

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

  it("an empty or reversed window gives nothing", () => {
    const event = makeEvent(timed("2026-10-03T09:00", "2026-10-03T14:00"));
    expect(expandOccurrences(event, [], { from: "2026-10-03", to: "2026-10-03" })).toEqual([]);
    expect(expandOccurrences(event, [], { from: "2026-11-01", to: "2026-10-01" })).toEqual([]);
  });
});

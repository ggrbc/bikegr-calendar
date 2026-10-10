import { describe, expect, it } from "vitest";
import { eventRowToRuleInput, overrideRowToInput } from "./mappers";

const base = {
  id: "e1",
  allDay: false,
  startLocal: null,
  endLocal: null,
  startDate: null,
  endDate: null,
  rrule: null,
  exdates: [],
  scheduleStatus: "scheduled" as const,
  scheduleNote: null,
};

describe("eventRowToRuleInput", () => {
  it("timed row maps to timed Timing", () => {
    const input = eventRowToRuleInput({
      ...base,
      startLocal: "2026-05-05T18:00",
      endLocal: "2026-05-05T20:00",
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      exdates: ["2026-05-12T18:00"],
    });
    expect(input).toEqual({
      eventId: "e1",
      timing: { kind: "timed", start: "2026-05-05T18:00", end: "2026-05-05T20:00" },
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      exdates: ["2026-05-12T18:00"],
      scheduleStatus: "scheduled",
      scheduleNote: null,
    });
  });

  it("all-day row maps to all-day Timing with an inclusive end", () => {
    const input = eventRowToRuleInput({
      ...base,
      allDay: true,
      startDate: "2026-06-06",
      endDate: "2026-06-07",
      scheduleStatus: "tentative",
      scheduleNote: "Date to be confirmed",
    });
    expect(input.timing).toEqual({ kind: "allDay", startDate: "2026-06-06", endDate: "2026-06-07" });
    expect(input.scheduleStatus).toBe("tentative");
    expect(input.scheduleNote).toBe("Date to be confirmed");
  });

  it("refuses a row with an incomplete timing shape", () => {
    expect(() => eventRowToRuleInput({ ...base, startLocal: "2026-05-05T18:00" })).toThrow();
  });
});

describe("overrideRowToInput", () => {
  const empty = {
    eventId: "e1",
    originalStart: "2026-05-12T18:00",
    allDay: null,
    startLocal: null,
    endLocal: null,
    startDate: null,
    endDate: null,
    title: null,
    location: null,
    scheduleStatus: null,
    scheduleNote: null,
  };

  it("override with no changes maps to only its key", () => {
    const input = overrideRowToInput(empty);
    expect(input).toStrictEqual({ eventId: "e1", originalStart: "2026-05-12T18:00" });
    expect(Object.keys(input)).toEqual(["eventId", "originalStart"]);
  });

  it("override with changes maps every set field", () => {
    const input = overrideRowToInput({
      ...empty,
      allDay: false,
      startLocal: "2026-05-14T18:00",
      endLocal: "2026-05-14T20:00",
      title: "Thursday make-up ride",
      location: "Riverside Park",
      scheduleStatus: "scheduled",
      scheduleNote: "Moved for rain",
    });
    expect(input).toStrictEqual({
      eventId: "e1",
      originalStart: "2026-05-12T18:00",
      timing: { kind: "timed", start: "2026-05-14T18:00", end: "2026-05-14T20:00" },
      title: "Thursday make-up ride",
      location: "Riverside Park",
      scheduleStatus: "scheduled",
      scheduleNote: "Moved for rain",
    });
  });
});

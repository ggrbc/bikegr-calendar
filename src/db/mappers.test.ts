import { describe, expect, it } from "vitest";
import {
  ctaToColumns,
  eventRowToRuleInput,
  overrideInputToRow,
  overrideRowToInput,
  ruleInputToColumns,
} from "./mappers";

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

describe("ruleInputToColumns", () => {
  const rule = {
    eventId: "e1",
    timing: { kind: "timed" as const, start: "2026-05-05T18:00", end: "2026-05-05T20:00" },
    rrule: "FREQ=WEEKLY;BYDAY=TU",
    exdates: ["2026-05-12T18:00"],
    scheduleStatus: "scheduled" as const,
    scheduleNote: null,
  };

  it("timed Event maps to start_local and end_local, with null date columns", () => {
    expect(ruleInputToColumns(rule)).toStrictEqual({
      allDay: false,
      startLocal: "2026-05-05T18:00",
      endLocal: "2026-05-05T20:00",
      startDate: null,
      endDate: null,
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      exdates: ["2026-05-12T18:00"],
      scheduleStatus: "scheduled",
      scheduleNote: null,
      occurrenceDetails: null,
    });
  });

  it("all-day Event maps to start_date and end_date, with null time columns", () => {
    const columns = ruleInputToColumns({
      ...rule,
      timing: { kind: "allDay", startDate: "2026-06-06", endDate: "2026-06-07" },
      rrule: null,
      exdates: [],
      scheduleStatus: "tentative",
      scheduleNote: "Date to be confirmed",
    });
    expect(columns).toMatchObject({
      allDay: true,
      startLocal: null,
      endLocal: null,
      startDate: "2026-06-06",
      endDate: "2026-06-07",
      scheduleStatus: "tentative",
      scheduleNote: "Date to be confirmed",
    });
  });

  it("write mapper then read mapper gives back the same rule", () => {
    expect(eventRowToRuleInput({ id: "e1", ...ruleInputToColumns(rule) })).toStrictEqual(rule);
  });
});

describe("ctaToColumns", () => {
  it("CTA maps to the label, URL, and skip flag; no CTA gives two nulls and no skip", () => {
    expect(ctaToColumns({ label: "Register", url: "https://example.org", skipDetails: true })).toStrictEqual({
      ctaLabel: "Register",
      ctaUrl: "https://example.org",
      ctaSkipDetails: true,
    });
    expect(ctaToColumns(null)).toStrictEqual({ ctaLabel: null, ctaUrl: null, ctaSkipDetails: false });
  });
});

describe("overrideInputToRow", () => {
  it("override with absent fields maps to null columns", () => {
    expect(
      overrideInputToRow({ eventId: "src", originalStart: "2026-05-12T18:00" }, "e1"),
    ).toStrictEqual({
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
      occurrenceDetails: null,
    });
  });

  it("write mapper then read mapper gives back the same Override", () => {
    const override = {
      eventId: "e1",
      originalStart: "2026-05-12T18:00",
      timing: { kind: "timed" as const, start: "2026-05-14T18:00", end: "2026-05-14T20:00" },
      title: "Make-up ride",
      location: "Riverside Park",
      scheduleStatus: "cancelled" as const,
      scheduleNote: "Rain",
    };
    expect(overrideRowToInput(overrideInputToRow(override, "e1"))).toStrictEqual(override);
  });

  it("all-day Override timing maps to the date columns", () => {
    const row = overrideInputToRow(
      {
        eventId: "e1",
        originalStart: "2026-06-04",
        timing: { kind: "allDay", startDate: "2026-06-05", endDate: "2026-06-05" },
      },
      "e1",
    );
    expect(row).toMatchObject({
      allDay: true,
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      startLocal: null,
    });
  });
});

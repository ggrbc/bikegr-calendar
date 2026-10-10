import { describe, expect, it } from "vitest";
import { addDays } from "@/engine";
import { buildEvent } from "./build-series";
import type { TockifyOccurrence } from "./types";

const HORIZON = "2029-07-04";

/** A Tuesday 6–9 pm Occurrence of Tockify Event "52" on `date`. */
function occurrence(date: string, changes: Partial<TockifyOccurrence> = {}): TockifyOccurrence {
  return {
    tockifyEventId: "52",
    startMinutes: Date.parse(`${date}T22:00:00Z`) / 60_000,
    timing: { kind: "timed", start: `${date}T18:00`, end: `${date}T21:00` },
    scheduleStatus: "scheduled",
    title: "VBF Tuesday Night Road Ride",
    description: "Road ride.",
    location: "Velo City Cycles",
    categories: ["Group-Ride", "Non-Drop", "Tuesday"],
    imageUrl: "https://img.example/ride.png",
    cta: { label: "Ride Details", url: "https://example.org/ride" },
    unknownTitlePrefix: null,
    ...changes,
  };
}

const tuesdays = (count: number) =>
  Array.from({ length: count }, (_, i) => addDays("2026-09-08", i * 7));

describe("Series build", () => {
  it("a single Occurrence becomes a one-time Event with its own Schedule status", () => {
    const built = buildEvent([occurrence("2026-09-08", { scheduleStatus: "cancelled" })], HORIZON);
    expect(built.report).toBeNull();
    expect(built.overrides).toEqual([]);
    expect(built.events).toHaveLength(1);
    expect(built.events[0]).toMatchObject({
      sourceId: "52",
      calendar: "rides",
      title: "VBF Tuesday Night Road Ride",
      tagSlugs: ["group-ride", "non-drop"],
      rule: {
        eventId: "52",
        timing: { kind: "timed", start: "2026-09-08T18:00", end: "2026-09-08T21:00" },
        rrule: null,
        exdates: [],
        scheduleStatus: "cancelled",
        scheduleNote: null,
      },
    });
  });

  it("a weekly Series becomes one Event with a rule", () => {
    const built = buildEvent(tuesdays(8).map((date) => occurrence(date)), HORIZON);
    expect(built.events).toHaveLength(1);
    expect(built.events[0].rule).toEqual({
      eventId: "52",
      timing: { kind: "timed", start: "2026-09-08T18:00", end: "2026-09-08T21:00" },
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959",
      exdates: [],
      scheduleStatus: "scheduled",
      scheduleNote: null,
    });
    expect(built.report).toEqual({
      sourceId: "52",
      title: "VBF Tuesday Night Road Ride",
      occurrences: 8,
      outcome: "rule",
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959",
      until: "2026-10-27",
      exdates: 0,
      overrides: 0,
    });
    expect(built.flags).toEqual([]);
  });

  it("the Event uses the earliest Occurrence, even if the feed is not sorted", () => {
    const built = buildEvent(tuesdays(4).reverse().map((date) => occurrence(date)), HORIZON);
    expect(built.events[0].rule.timing).toMatchObject({ start: "2026-09-08T18:00" });
  });

  it("cancelled Occurrence becomes an Override, not an EXDATE", () => {
    const occurrences = tuesdays(8).map((date) =>
      occurrence(date, date === "2026-09-29" ? { scheduleStatus: "cancelled" } : {}),
    );
    const built = buildEvent(occurrences, HORIZON);
    expect(built.events[0].rule.exdates).toEqual([]);
    expect(built.overrides).toEqual([
      { eventId: "52", originalStart: "2026-09-29T18:00", scheduleStatus: "cancelled" },
    ]);
  });

  it("prefix is removed before the title comparison, so a cancelled Occurrence has no title Override", () => {
    // The mapping step removed "**Cancelled**", so the title is the same as the others.
    const occurrences = tuesdays(3).map((date, i) =>
      occurrence(date, i === 1 ? { scheduleStatus: "cancelled" } : {}),
    );
    const [only] = buildEvent(occurrences, HORIZON).overrides;
    expect(only).not.toHaveProperty("title");
  });

  it("Occurrence with a different title or location becomes an Override", () => {
    const occurrences = tuesdays(5).map((date) =>
      date === "2026-09-22"
        ? occurrence(date, { title: "VBF Fall Kickoff", location: "Millennium Park" })
        : occurrence(date),
    );
    const built = buildEvent(occurrences, HORIZON);
    expect(built.events[0].title).toBe("VBF Tuesday Night Road Ride");
    expect(built.overrides).toEqual([
      {
        eventId: "52",
        originalStart: "2026-09-22T18:00",
        title: "VBF Fall Kickoff",
        location: "Millennium Park",
      },
    ]);
  });

  it("Occurrence at a different time on a rule date becomes a rescheduled Override", () => {
    const occurrences = tuesdays(5).map((date) =>
      date === "2026-09-22"
        ? occurrence(date, {
            timing: { kind: "timed", start: `${date}T17:30`, end: `${date}T20:30` },
          })
        : occurrence(date),
    );
    const built = buildEvent(occurrences, HORIZON);
    expect(built.events[0].rule.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261006T235959");
    expect(built.overrides).toEqual([
      {
        eventId: "52",
        originalStart: "2026-09-22T18:00",
        timing: { kind: "timed", start: "2026-09-22T17:30", end: "2026-09-22T20:30" },
      },
    ]);
  });

  it.each([
    ["description", { description: "Other text." }],
    ["image", { imageUrl: "https://img.example/other.png" }],
    ["CTA", { cta: { label: "Register", url: "https://example.org/reg" } }],
    ["Tags", { categories: ["Race"] }],
  ])("different %s flags contentDiffers", (field, change) => {
    const occurrences = tuesdays(4).map((date, i) => occurrence(date, i === 2 ? change : {}));
    const built = buildEvent(occurrences, HORIZON);
    expect(built.flags).toEqual([
      expect.objectContaining({ sourceId: "52", reason: "contentDiffers" }),
    ]);
    expect(built.flags[0].detail).toContain(field);
    // The most common value is kept.
    expect(built.events[0].description).toBe("Road ride.");
  });

  it("an unknown title prefix flags unknownTitlePrefix once for the Event", () => {
    const prefixed = { title: "**Sold out** VBF Tuesday Night Road Ride", unknownTitlePrefix: "**Sold out**" };
    const occurrences = tuesdays(4).map((date, i) => occurrence(date, i >= 2 ? prefixed : {}));
    const built = buildEvent(occurrences, HORIZON);
    expect(built.flags).toEqual([
      {
        sourceId: "52",
        title: "VBF Tuesday Night Road Ride",
        reason: "unknownTitlePrefix",
        detail: 'Unknown title prefix "**Sold out**" on 2 Occurrences. It stays in the title.',
      },
    ]);
  });

  it("an unknown title prefix on a one-time Event is flagged", () => {
    const built = buildEvent(
      [occurrence("2026-09-08", { title: "**Sold out** Ride", unknownTitlePrefix: "**Sold out**" })],
      HORIZON,
    );
    expect(built.flags.map((flag) => flag.reason)).toEqual(["unknownTitlePrefix"]);
  });

  it("the same Tags in a different order do not flag contentDiffers", () => {
    const occurrences = tuesdays(4).map((date, i) =>
      occurrence(date, i === 2 ? { categories: ["Tuesday", "Non-Drop", "Group-Ride"] } : {}),
    );
    expect(buildEvent(occurrences, HORIZON).flags).toEqual([]);
  });

  it("a Series with no rule is flagged and imported as one-time Events", () => {
    const dates = ["2026-09-01", "2026-09-03", "2026-09-12", "2026-10-02", "2026-11-20"];
    const built = buildEvent(
      dates.map((date) => occurrence(date)),
      HORIZON,
    );
    expect(built.flags).toEqual([
      expect.objectContaining({ sourceId: "52", reason: "ruleNotInferred" }),
    ]);
    expect(built.events.map((event) => event.sourceId)).toEqual(
      dates.map((date) => `52/${Date.parse(`${date}T22:00:00Z`) / 60_000}`),
    );
    expect(built.events.every((event) => event.rule.rrule === null)).toBe(true);
    expect(built.overrides).toEqual([]);
    expect(built.report).toMatchObject({ outcome: "flagged", rrule: null, until: null });
  });

  it("one-time Events made from a flagged Series keep their own Schedule status", () => {
    const dates = ["2026-09-01", "2026-09-03", "2026-09-12", "2026-10-02", "2026-11-20"];
    const built = buildEvent(
      dates.map((date, i) => occurrence(date, i === 0 ? { scheduleStatus: "tentative" } : {})),
      HORIZON,
    );
    expect(built.events[0].rule.scheduleStatus).toBe("tentative");
    expect(built.events[1].rule.scheduleStatus).toBe("scheduled");
  });

  it("an advocacy Series goes to the advocacy Calendar and loses the Advocacy category", () => {
    const occurrences = tuesdays(3).map((date) =>
      occurrence(date, { title: "ENTF Transportation Subcommittee", categories: ["Advocacy"] }),
    );
    const [event] = buildEvent(occurrences, HORIZON).events;
    expect(event.calendar).toBe("advocacy");
    expect(event.tagSlugs).toEqual([]);
  });
});

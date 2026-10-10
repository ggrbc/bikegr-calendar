import { describe, expect, it } from "vitest";
import { sameState, stateFromImport, stateFromRows, stableJson } from "./event-state";
import type { ImportedEvent } from "./types";

const event: ImportedEvent = {
  sourceId: "1",
  calendar: "rides",
  title: "Wednesday Evening Rides",
  description: "Meet at the shop.",
  location: "Shop",
  tagSlugs: ["social", "group-ride"],
  imageUrl: "https://tockify.example/a.jpg",
  cta: { label: "Register", url: "https://example.org" },
  rule: {
    eventId: "1",
    timing: { kind: "timed", start: "2026-09-02T18:00", end: "2026-09-02T20:00" },
    rrule: "FREQ=WEEKLY;BYDAY=WE",
    exdates: ["2026-09-16T18:00", "2026-09-09T18:00"],
    scheduleStatus: "scheduled",
    scheduleNote: null,
  },
};

const overrides = [
  { eventId: "1", originalStart: "2026-09-30T18:00", scheduleStatus: "cancelled" as const },
  { eventId: "1", originalStart: "2026-09-23T18:00", title: "Special ride" },
];

const row = {
  calendar: "rides" as const,
  title: "Wednesday Evening Rides",
  description: "Meet at the shop.",
  location: "Shop",
  imageUrl: "https://tockify.example/a.jpg",
  ctaLabel: "Register",
  ctaUrl: "https://example.org",
  allDay: false,
  startLocal: "2026-09-02T18:00",
  endLocal: "2026-09-02T20:00",
  startDate: null,
  endDate: null,
  rrule: "FREQ=WEEKLY;BYDAY=WE",
  exdates: ["2026-09-09T18:00", "2026-09-16T18:00"],
  scheduleStatus: "scheduled" as const,
  scheduleNote: null,
};

const emptyOverride = {
  eventId: "uuid-1",
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

const overrideRows = [
  { ...emptyOverride, originalStart: "2026-09-23T18:00", title: "Special ride" },
  { ...emptyOverride, originalStart: "2026-09-30T18:00", scheduleStatus: "cancelled" as const },
];

describe("Event state", () => {
  it("import and database rows with the same content give the same state", () => {
    const a = stateFromImport(event, overrides, { includeImage: true });
    const b = stateFromRows(row, overrideRows, ["group-ride", "social"], { includeImage: true });
    expect(sameState(a, b)).toBe(true);
  });

  it("order of Tags, EXDATEs, and Overrides does not matter", () => {
    const a = stateFromImport(event, [...overrides].reverse(), { includeImage: true });
    const b = stateFromImport(
      { ...event, tagSlugs: [...event.tagSlugs].reverse(), rule: { ...event.rule, exdates: [...event.rule.exdates].reverse() } },
      overrides,
      { includeImage: true },
    );
    expect(sameState(a, b)).toBe(true);
  });

  it("a different title, Override, or Tag is a change", () => {
    const base = stateFromImport(event, overrides, { includeImage: true });
    expect(sameState(base, stateFromImport({ ...event, title: "New" }, overrides, { includeImage: true }))).toBe(false);
    expect(sameState(base, stateFromImport(event, overrides.slice(1), { includeImage: true }))).toBe(false);
    expect(sameState(base, stateFromImport({ ...event, tagSlugs: ["social"] }, overrides, { includeImage: true }))).toBe(false);
  });

  it("without the image, a different image URL is not a change", () => {
    const a = stateFromImport(event, overrides, { includeImage: false });
    const b = stateFromRows({ ...row, imageUrl: "https://blob.example/events/x.jpg" }, overrideRows, event.tagSlugs, {
      includeImage: false,
    });
    expect(sameState(a, b)).toBe(true);
    expect(a).not.toHaveProperty("imageUrl");
  });

  it("stable JSON sorts object keys", () => {
    expect(stableJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });
});

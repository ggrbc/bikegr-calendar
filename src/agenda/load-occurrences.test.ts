import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ruleInputToColumns } from "@/db/mappers";
import { eventTags, events, overrides, tags } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import type { EventRuleInput, Timing } from "@/engine";
import { loadOccurrences } from "./load-occurrences";

const WINDOW = { from: "2026-10-12", to: "2026-10-26" };

const timed = (day: string, from = "18:00", to = "20:00"): Timing => ({
  kind: "timed",
  start: `${day}T${from}`,
  end: `${day}T${to}`,
});

type NewEvent = Partial<typeof events.$inferInsert> & { title: string; timing?: Timing; rrule?: string };

async function addEvent(db: Db, { timing = timed("2026-10-14"), rrule, ...patch }: NewEvent) {
  const rule: EventRuleInput = {
    eventId: "",
    timing,
    rrule: rrule ?? null,
    exdates: [],
    scheduleStatus: patch.scheduleStatus ?? "scheduled",
    scheduleNote: patch.scheduleNote ?? null,
  };
  const [row] = await db
    .insert(events)
    .values({ calendar: "rides", reviewStatus: "approved", ...ruleInputToColumns(rule), ...patch })
    .returning();
  return row;
}

describe("loadOccurrences", () => {
  let db: Db;
  let close: () => Promise<void>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ db, close } = await createTestDb());

    ids.weekly = (
      await addEvent(db, {
        title: "Wednesday Evening Rides",
        location: "Shop",
        timing: timed("2026-10-14"),
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        ctaLabel: "Register",
        ctaUrl: "https://example.org/register",
      })
    ).id;
    // 2026-10-14: cancelled with a note. 2026-10-21: moved to Thursday 2026-10-22, new title and place.
    await db.insert(overrides).values([
      {
        eventId: ids.weekly,
        originalStart: "2026-10-14T18:00",
        scheduleStatus: "cancelled",
        scheduleNote: "Rain — see you next week",
      },
      {
        eventId: ids.weekly,
        originalStart: "2026-10-21T18:00",
        allDay: false,
        startLocal: "2026-10-22T18:30",
        endLocal: "2026-10-22T20:30",
        title: "Thursday make-up ride",
        location: "Riverside Park",
      },
    ]);

    ids.tentative = (
      await addEvent(db, {
        title: "Hair of the Dog Ride",
        timing: { kind: "allDay", startDate: "2026-10-13", endDate: "2026-10-13" },
        scheduleStatus: "tentative",
      })
    ).id;
    ids.advocacy = (
      await addEvent(db, { title: "Mobile GR Commission", calendar: "advocacy", timing: timed("2026-10-13", "09:00", "11:00") })
    ).id;
    await addEvent(db, { title: "Pending ride", reviewStatus: "pending" });
    await addEvent(db, { title: "Rejected ride", reviewStatus: "rejected" });
    await addEvent(db, { title: "Deleted ride", deletedAt: new Date() });
    await addEvent(db, { title: "Outside the window", timing: timed("2026-11-30") });

    const [social, retired] = await db
      .insert(tags)
      .values([
        { calendar: "rides", name: "Social", slug: "social" },
        { calendar: "rides", name: "Old Tag", slug: "old-tag", retiredAt: new Date() },
      ])
      .returning();
    await db.insert(eventTags).values([
      { eventId: ids.weekly, tagId: social.id, calendar: "rides" },
      { eventId: ids.weekly, tagId: retired.id, calendar: "rides" },
    ]);
  });
  afterAll(async () => close());

  it("pending, rejected, and deleted Events are hidden", async () => {
    const titles = (await loadOccurrences(db, WINDOW, null)).map((r) => r.title);
    expect(titles).not.toContain("Pending ride");
    expect(titles).not.toContain("Rejected ride");
    expect(titles).not.toContain("Deleted ride");
    expect(titles).not.toContain("Outside the window");
  });

  it("cancelled Override shows with its Schedule note", async () => {
    const rows = await loadOccurrences(db, WINDOW, "rides");
    const cancelled = rows.find((r) => r.originalStart === "2026-10-14T18:00");
    expect(cancelled).toMatchObject({
      title: "Wednesday Evening Rides",
      scheduleStatus: "cancelled",
      scheduleNote: "Rain — see you next week",
      cta: { label: "Register", url: "https://example.org/register" },
    });
  });

  it("tentative one-time Event shows with its Schedule status", async () => {
    const rows = await loadOccurrences(db, WINDOW, "rides");
    expect(rows.find((r) => r.eventId === ids.tentative)).toMatchObject({
      scheduleStatus: "tentative",
      timing: { kind: "allDay", startDate: "2026-10-13", endDate: "2026-10-13" },
    });
  });

  it("Calendar filter shows only that Calendar; no filter shows both", async () => {
    const rides = await loadOccurrences(db, WINDOW, "rides");
    const advocacy = await loadOccurrences(db, WINDOW, "advocacy");
    const all = await loadOccurrences(db, WINDOW, null);
    expect(rides.every((r) => r.calendar === "rides")).toBe(true);
    expect(advocacy.map((r) => r.title)).toEqual(["Mobile GR Commission"]);
    expect(all).toHaveLength(rides.length + advocacy.length);
  });

  it("rescheduled Occurrence appears once, with its original and new timing", async () => {
    const rows = (await loadOccurrences(db, WINDOW, "rides")).filter(
      (r) => r.originalStart === "2026-10-21T18:00",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scheduleStatus: "rescheduled",
      originalTiming: timed("2026-10-21"),
      timing: timed("2026-10-22", "18:30", "20:30"),
    });
  });

  it("Override title and location replace the Event's", async () => {
    const rows = await loadOccurrences(db, WINDOW, "rides");
    expect(rows.find((r) => r.originalStart === "2026-10-21T18:00")).toMatchObject({
      title: "Thursday make-up ride",
      location: "Riverside Park",
    });
    expect(rows.find((r) => r.originalStart === "2026-10-14T18:00")?.location).toBe("Shop");
  });

  it("retired Tags are not shown", async () => {
    const rows = await loadOccurrences(db, WINDOW, "rides");
    const weekly = rows.find((r) => r.eventId === ids.weekly)!;
    expect(weekly.tags).toEqual([{ name: "Social", slug: "social" }]);
  });

  it("rows from several Events sort by actual start", async () => {
    const rows = await loadOccurrences(db, WINDOW, null);
    expect(rows.map((r) => [r.title, r.timing.kind === "timed" ? r.timing.start : r.timing.startDate])).toEqual([
      ["Hair of the Dog Ride", "2026-10-13"],
      ["Mobile GR Commission", "2026-10-13T09:00"],
      ["Wednesday Evening Rides", "2026-10-14T18:00"],
      ["Thursday make-up ride", "2026-10-22T18:30"],
    ]);
  });
});

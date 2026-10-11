import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editors, eventManagers, events } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import { parseManagerOccurrenceInput } from "./event-input";
import { saveManagerOccurrence } from "./manager-occurrence";
import { addManager } from "./managers";
import { saveOverride } from "./overrides";
import { addEditor, draft, eventRow, historyOf, overridesOf } from "./test-helpers";
import type { Actor } from "./write-helpers";

// A Series on Tuesdays at 18:00 from 2026-10-06. Today is Tuesday 2026-10-20.
const TODAY = "2026-10-20";
const DATE = "2026-10-27T18:00";

describe("an Event manager changes one Occurrence", () => {
  let db: Db;
  let close: () => Promise<void>;
  let erin: Actor;
  let sam: Actor;
  let id: string;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    erin = await addEditor(db, "Erin Editor");
    const created = await createEvent(db, erin, draft({ title: "Tuesday Ride" }));
    if (!created.ok) throw new Error(created.message);
    id = created.id;
    await addManager(db, erin, { eventId: id, email: "sam@example.org", name: "Sam Leader" });
    const [row] = await db.select().from(editors).where(eq(editors.email, "sam@example.org"));
    sam = { id: row.id, role: row.role };
  });
  afterEach(async () => close());

  const input = (patch: Record<string, unknown> = {}, originalStart = DATE) => ({
    eventId: id,
    originalStart,
    scheduleStatus: "cancelled",
    scheduleNote: "Rain",
    occurrenceDetails: "",
    ...patch,
  });
  const save = (patch: Record<string, unknown> = {}, originalStart = DATE, actor: Actor = sam) =>
    saveManagerOccurrence(db, actor, input(patch, originalStart), { today: TODAY });

  it("a Series date: writes an Override with the three fields only, bumps the version, writes history", async () => {
    const before = await eventRow(db, id);
    expect(await save({ occurrenceDetails: "Route: loop" })).toMatchObject({ ok: true });
    expect(await overridesOf(db, id)).toMatchObject([
      {
        originalStart: DATE,
        scheduleStatus: "cancelled",
        scheduleNote: "Rain",
        occurrenceDetails: "Route: loop",
        allDay: null,
        startLocal: null,
        title: null,
        location: null,
        createdBy: sam.id,
        updatedBy: sam.id,
      },
    ]);
    const after = await eventRow(db, id);
    expect(after.version).toBe(before.version + 1);
    expect(after.updatedBy).toBe(sam.id);
    expect((await historyOf(db, id)).at(-1)).toMatchObject({ action: "override", changedBy: sam.id });
  });

  it("an Editor moves the time, then the manager cancels: the new time stays", async () => {
    const moved = await saveOverride(db, erin, { id, version: 1 }, {
      originalStart: DATE,
      timing: { kind: "timed", start: "2026-10-27T19:00", end: "2026-10-27T21:00" },
      title: "Tuesday Ride",
      location: "Shop",
      scheduleStatus: "scheduled",
      scheduleNote: null,
      occurrenceDetails: null,
    });
    expect(moved.ok).toBe(true);
    expect(await save()).toMatchObject({ ok: true });
    expect(await overridesOf(db, id)).toMatchObject([
      { startLocal: "2026-10-27T19:00", endLocal: "2026-10-27T21:00", scheduleStatus: "cancelled", scheduleNote: "Rain" },
    ]);
  });

  it("an Editor's title and location on the Override stay too", async () => {
    await saveOverride(db, erin, { id, version: 1 }, {
      originalStart: DATE,
      timing: { kind: "timed", start: DATE, end: "2026-10-27T20:00" },
      title: "Halloween Ride",
      location: "Park",
      scheduleStatus: "scheduled",
      scheduleNote: null,
      occurrenceDetails: null,
    });
    await save();
    expect(await overridesOf(db, id)).toMatchObject([
      { title: "Halloween Ride", location: "Park", scheduleStatus: "cancelled" },
    ]);
  });

  it("back to scheduled clears only the status; the row stays while a note or details remain", async () => {
    await save({ occurrenceDetails: "Route: loop" });
    await save({ scheduleStatus: "scheduled", occurrenceDetails: "Route: loop" });
    expect(await overridesOf(db, id)).toMatchObject([
      { scheduleStatus: null, scheduleNote: "Rain", occurrenceDetails: "Route: loop" },
    ]);
  });

  it("when every field is empty the Override row is removed", async () => {
    await save();
    await save({ scheduleStatus: "scheduled", scheduleNote: "", occurrenceDetails: "" });
    expect(await overridesOf(db, id)).toEqual([]);
  });

  it("when every manager field is empty but an Editor field is set, the row stays", async () => {
    await saveOverride(db, erin, { id, version: 1 }, {
      originalStart: DATE,
      timing: { kind: "timed", start: "2026-10-27T19:00", end: "2026-10-27T21:00" },
      title: "Tuesday Ride",
      location: "Shop",
      scheduleStatus: "cancelled",
      scheduleNote: null,
      occurrenceDetails: null,
    });
    await save({ scheduleStatus: "scheduled", scheduleNote: "", occurrenceDetails: "" });
    expect(await overridesOf(db, id)).toMatchObject([{ startLocal: "2026-10-27T19:00", scheduleStatus: null }]);
  });

  it("a save with no change writes nothing: no version, no history", async () => {
    await save();
    const version = (await eventRow(db, id)).version;
    const entries = (await historyOf(db, id)).length;
    expect(await save()).toMatchObject({ ok: true });
    expect((await eventRow(db, id)).version).toBe(version);
    expect(await historyOf(db, id)).toHaveLength(entries);
    // Also a first save that changes nothing on a date with no Override.
    expect(await save({ scheduleStatus: "scheduled", scheduleNote: "" }, "2026-11-03T18:00")).toMatchObject({ ok: true });
    expect(await overridesOf(db, id)).toHaveLength(1);
  });

  it("a one-time Event: the three fields go on the Event row", async () => {
    const one = await createEvent(db, erin, draft({
      title: "Social",
      rule: { ...draft().rule, rrule: null, timing: { kind: "timed", start: "2026-11-05T18:00", end: "2026-11-05T20:00" } },
    }));
    if (!one.ok) throw new Error(one.message);
    await addManager(db, erin, { eventId: one.id, email: "sam@example.org", name: "Sam Leader" });
    const result = await saveManagerOccurrence(
      db,
      sam,
      { eventId: one.id, originalStart: "2026-11-05T18:00", scheduleStatus: "postponed", scheduleNote: "Snow", occurrenceDetails: "Indoors" },
      { today: TODAY },
    );
    expect(result).toMatchObject({ ok: true });
    expect(await eventRow(db, one.id)).toMatchObject({
      scheduleStatus: "postponed",
      scheduleNote: "Snow",
      occurrenceDetails: "Indoors",
      title: "Social",
      updatedBy: sam.id,
    });
    expect(await overridesOf(db, one.id)).toEqual([]);
    expect(
      await saveManagerOccurrence(db, sam, { eventId: one.id, originalStart: "2026-11-12T18:00", scheduleStatus: "cancelled", scheduleNote: "", occurrenceDetails: "" }, { today: TODAY }),
    ).toMatchObject({ ok: false });
  });

  describe("refusals", () => {
    it("no grant, or a grant for another Event", async () => {
      const [row] = await db.insert(editors).values({ email: "lee@example.org", name: "Lee", role: "event_manager" }).returning();
      expect(await save({}, DATE, { id: row.id, role: "event_manager" })).toMatchObject({ ok: false });
      expect(await overridesOf(db, id)).toEqual([]);
    });

    it("an Editor or Admin is refused here (they use the Editor forms)", async () => {
      expect(await save({}, DATE, erin)).toMatchObject({ ok: false });
    });

    it("a deactivated manager", async () => {
      await db.update(editors).set({ deactivatedAt: new Date() }).where(eq(editors.id, sam.id));
      expect(await save()).toMatchObject({ ok: false });
    });

    it("a pending, rejected, or deleted Event", async () => {
      for (const patch of [{ reviewStatus: "pending" as const }, { reviewStatus: "rejected" as const }, { reviewStatus: "approved" as const, deletedAt: new Date() }]) {
        await db.update(events).set(patch).where(eq(events.id, id));
        expect(await save()).toMatchObject({ ok: false });
      }
      expect(await overridesOf(db, id)).toEqual([]);
    });

    it("a date that is not a date of the Series, or a skipped date", async () => {
      expect(await save({}, "2026-10-28T18:00")).toMatchObject({ ok: false });
      await db.update(events).set({ exdates: [DATE] }).where(eq(events.id, id));
      expect(await save()).toMatchObject({ ok: false });
    });

    it("the dates window: 7 days back is open, 8 days back is read-only, one year ahead is the limit", async () => {
      expect(await save({}, "2026-10-13T18:00")).toMatchObject({ ok: true }); // started 7 days ago
      expect(await save({}, "2026-10-06T18:00")).toMatchObject({ ok: false }); // 14 days ago
      expect(await save({}, "2027-10-19T18:00")).toMatchObject({ ok: true }); // 364 days ahead
      expect(await save({}, "2027-10-26T18:00")).toMatchObject({ ok: false }); // 371 days ahead
    });

    it("parse refuses rescheduled, a long note, and long details", () => {
      const parse = (patch: Record<string, unknown>) => parseManagerOccurrenceInput(input(patch));
      expect(parse({ scheduleStatus: "rescheduled" })).toMatchObject({ ok: false, errors: { scheduleStatus: expect.any(String) } });
      expect(parse({ scheduleNote: "x".repeat(301) })).toMatchObject({ ok: false, errors: { scheduleNote: expect.any(String) } });
      expect(parse({ occurrenceDetails: "x".repeat(2001) })).toMatchObject({ ok: false, errors: { occurrenceDetails: expect.any(String) } });
      expect(parse({ occurrenceDetails: "x".repeat(2000) }).ok).toBe(true);
    });

    it("refuses bad input before it writes", async () => {
      expect(await save({ scheduleStatus: "rescheduled" })).toMatchObject({ ok: false, reason: "invalid" });
      expect(await overridesOf(db, id)).toEqual([]);
    });
  });

  it("the grants table is untouched by a manager write", async () => {
    await save();
    expect(await db.select().from(eventManagers)).toHaveLength(1);
  });
});

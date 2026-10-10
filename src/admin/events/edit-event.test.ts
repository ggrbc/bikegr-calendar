import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { events, tags } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import { editOneTimeEvent, editSeriesContent } from "./edit-event";
import type { SeriesContentDraft } from "./event-input";
import { addEditor, addTag, contentDraft, draft, eventRow, historyOf, rowCounts, tagIdsOfEvent } from "./test-helpers";
import type { Actor } from "./write-helpers";

function content(patch: Partial<SeriesContentDraft> = {}): SeriesContentDraft {
  return { ...contentDraft(), exdateDates: [], ...patch };
}

describe("edit an Event", () => {
  let db: Db;
  let close: () => Promise<void>;
  let erin: Actor;
  let sam: Actor;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    erin = await addEditor(db, "Erin Editor");
    sam = await addEditor(db, "Sam Second");
  });
  afterEach(async () => close());

  async function newEvent(patch: Parameters<typeof draft>[0] = {}) {
    const result = await createEvent(db, erin, draft(patch));
    if (!result.ok) throw new Error(result.message);
    return result.id;
  }

  it("All dates edit changes content, Tags, and skipped dates, not timing or rule; one edit row", async () => {
    const a = await addTag(db, "rides", "a");
    const b = await addTag(db, "rides", "b");
    const id = await newEvent({ tagIds: [a] });
    const result = await editSeriesContent(db, sam, { id, version: 1 }, content({
      title: "Tuesday Night Ride",
      tagIds: [b],
      exdateDates: ["2026-10-20"],
    }));
    expect(result.ok).toBe(true);
    const row = await eventRow(db, id);
    expect(row).toMatchObject({
      title: "Tuesday Night Ride",
      version: 2,
      updatedBy: sam.id,
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      startLocal: "2026-10-06T18:00",
      exdates: ["2026-10-20T18:00"],
      createdBy: erin.id,
    });
    expect(await tagIdsOfEvent(db, id)).toEqual([b]);
    expect((await historyOf(db, id)).map((h) => [h.action, h.version, h.changedBy])).toEqual([
      ["create", 1, erin.id],
      ["edit", 2, sam.id],
    ]);
  });

  it("a one-time edit of a Series is refused (time changes need This date and later)", async () => {
    const id = await newEvent();
    const result = await editOneTimeEvent(db, sam, { id, version: 1 }, draft());
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect((await eventRow(db, id)).version).toBe(1);
  });

  it("a Calendar change clears the Event's Tags and links Tags of the new Calendar", async () => {
    const ride = await addTag(db, "rides", "ride");
    const meeting = await addTag(db, "advocacy", "meeting");
    const id = await newEvent({ tagIds: [ride] });
    const result = await editSeriesContent(db, sam, { id, version: 1 }, content({ calendar: "advocacy", tagIds: [meeting] }));
    expect(result.ok).toBe(true);
    expect((await eventRow(db, id)).calendar).toBe("advocacy");
    expect(await tagIdsOfEvent(db, id)).toEqual([meeting]);
  });

  it("a retired Tag that the Event already has stays after an edit", async () => {
    const old = await addTag(db, "rides", "old");
    const id = await newEvent({ tagIds: [old] });
    await db.update(tags).set({ retiredAt: new Date() }).where(eq(tags.id, old));
    const result = await editSeriesContent(db, sam, { id, version: 1 }, content({ tagIds: [] }));
    expect(result.ok).toBe(true);
    expect(await tagIdsOfEvent(db, id)).toEqual([old]);
  });

  it("an edit does not add a new link to a Tag retired after the form opened", async () => {
    const late = await addTag(db, "rides", "late");
    const id = await newEvent();
    await db.update(tags).set({ retiredAt: new Date() }).where(eq(tags.id, late));
    const result = await editSeriesContent(db, sam, { id, version: 1 }, content({ tagIds: [late] }));
    expect(result).toMatchObject({ ok: false, errors: { tags: "This Tag was retired. Pick another one." } });
    expect(await tagIdsOfEvent(db, id)).toEqual([]);
  });

  it("one-time Event edit changes the time, Schedule status, and Schedule note", async () => {
    const id = await newEvent({ rule: { ...draft().rule, rrule: null } });
    const result = await editOneTimeEvent(db, sam, { id, version: 1 }, draft({
      rule: {
        timing: { kind: "allDay", startDate: "2026-10-10", endDate: "2026-10-11" },
        rrule: null,
        exdates: [],
        scheduleStatus: "postponed",
        scheduleNote: "New date soon",
      },
    }));
    expect(result.ok).toBe(true);
    expect(await eventRow(db, id)).toMatchObject({
      allDay: true,
      startDate: "2026-10-10",
      endDate: "2026-10-11",
      startLocal: null,
      scheduleStatus: "postponed",
      scheduleNote: "New date soon",
      version: 2,
    });
  });

  it("two Editors save the same version: the first wins, the second gets a conflict with the first's time", async () => {
    const id = await newEvent();
    const first = await editSeriesContent(db, erin, { id, version: 1 }, content({ title: "First" }));
    expect(first.ok).toBe(true);
    const before = await rowCounts(db);
    const savedAt = (await eventRow(db, id)).updatedAt;

    const second = await editSeriesContent(db, sam, { id, version: 1 }, content({ title: "Second" }));
    expect(second).toMatchObject({ ok: false, reason: "conflict", changedAt: savedAt });
    expect(second.ok === false && second.message).toMatch(
      /^Another Editor changed this Event at .* \(Detroit time\)\. Reload to see their change\.$/,
    );
    // A conflict changes nothing and writes no history row.
    expect((await eventRow(db, id)).title).toBe("First");
    expect(await rowCounts(db)).toEqual(before);
  });

  it("a write to a deleted Event is refused with This Event was deleted.", async () => {
    const id = await newEvent();
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, id));
    expect(await editSeriesContent(db, sam, { id, version: 1 }, content())).toEqual({
      ok: false,
      reason: "deleted",
      message: "This Event was deleted.",
    });
  });
});

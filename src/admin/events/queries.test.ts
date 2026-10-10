import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eventHistory, events } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import { deleteEvent } from "./delete-event";
import { editSeriesContent } from "./edit-event";
import {
  type EventListFilter,
  likePattern,
  listEvents,
  listRecentChanges,
  loadEventForEdit,
  loadHistory,
} from "./queries";
import { splitSeries } from "./split-series";
import { addEditor, draft } from "./test-helpers";
import type { Actor } from "./write-helpers";

describe("admin reads", () => {
  let db: Db;
  let close: () => Promise<void>;
  let erin: Actor;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    erin = await addEditor(db, "Erin Editor");
  });
  afterEach(async () => close());

  async function add(patch: Parameters<typeof draft>[0]) {
    const result = await createEvent(db, erin, draft(patch));
    if (!result.ok) throw new Error(result.message);
    return result.id;
  }

  const base: EventListFilter = { calendar: null, q: "", review: null, includeDeleted: false, today: "2026-10-10" };

  it("the list filters by Calendar, title search, and Review status; deleted only on request", async () => {
    const ride = await add({ title: "Tuesday Ride" });
    const percent = await add({ title: "100% Fun Ride" });
    const meeting = await add({ title: "Commission Meeting", calendar: "advocacy" });
    await db.update(events).set({ reviewStatus: "pending" }).where(eq(events.id, meeting));
    const gone = await add({ title: "Duplicate Ride" });
    await deleteEvent(db, erin, { id: gone, version: 1 });

    const ids = async (filter: Partial<EventListFilter>) =>
      (await listEvents(db, { ...base, ...filter })).map((r) => r.id);
    expect(await ids({})).toEqual([percent, meeting, ride]);
    expect(await ids({ calendar: "advocacy" })).toEqual([meeting]);
    expect(await ids({ q: "ride" })).toEqual([percent, ride]);
    expect(await ids({ q: "100%" })).toEqual([percent]);
    expect(await ids({ q: "0%F" })).toEqual([]);
    expect(await ids({ review: "pending" })).toEqual([meeting]);
    expect(await ids({ includeDeleted: true, q: "Duplicate" })).toEqual([gone]);
  });

  it("each row has the repeat in words and the next date", async () => {
    await add({});
    const [row] = await listEvents(db, base);
    expect(row).toMatchObject({ repeat: "Every week on Tuesday", deleted: false, reviewStatus: "approved" });
    expect(row.next?.originalStart).toBe("2026-10-13T18:00");
  });

  it("a like pattern escapes % and _", () => {
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
  });

  it("the Event for its form has Tags, Overrides, and split links both ways", async () => {
    const a = await add({});
    const split = await splitSeries(db, erin, { id: a, version: 1 }, {
      ...draft(),
      splitDate: "2026-11-03",
      mode: "change",
      time: { kind: "timed", startTime: "18:30", endTime: "20:30" },
      rule: { kind: "same" },
    }, { today: "2026-10-10" });
    if (!split.ok) throw new Error(split.message);
    const old = await loadEventForEdit(db, a);
    expect(old?.successors).toEqual([{ id: split.id, title: "Tuesday Ride" }]);
    const next = await loadEventForEdit(db, split.id);
    expect(next?.predecessor).toEqual({ id: a, title: "Tuesday Ride" });
    expect(await loadEventForEdit(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("history lists newest first with the Editor name, and Import for import rows", async () => {
    const id = await add({});
    await editSeriesContent(db, erin, { id, version: 1 }, { ...draft(), exdateDates: [] });
    await db.insert(eventHistory).values({ eventId: id, version: 3, action: "import", snapshot: {}, changedBy: null, changedAt: new Date(Date.now() + 60_000) });
    const history = await loadHistory(db, id);
    expect(history.map((h) => [h.who, h.what])).toEqual([
      ["Import", "Import"],
      ["Erin Editor", "Edited"],
      ["Erin Editor", "Created"],
    ]);
  });

  it("recent changes list the newest entries of all Events, with the title and the detail", async () => {
    const ride = await add({ title: "Tuesday Ride" });
    const meeting = await add({ title: "Commission Meeting", calendar: "advocacy" });
    const later = new Date(Date.now() + 60_000);
    await db.insert(eventHistory).values({
      eventId: ride,
      version: 2,
      action: "override",
      snapshot: { detail: { originalStart: "2026-10-13T18:00" } },
      changedBy: erin.id,
      changedAt: later,
    });
    const recent = await listRecentChanges(db, 2);
    expect(recent.map((r) => [r.eventId, r.title, r.who, r.what])).toEqual([
      [ride, "Tuesday Ride", "Erin Editor", "Changed one date (Tue, Oct 13)"],
      [meeting, "Commission Meeting", "Erin Editor", "Created"],
    ]);
    expect(recent.map((r) => r.deleted)).toEqual([false, false]);
  });

  it("recent changes mark a deleted Event", async () => {
    const gone = await add({ title: "Duplicate Ride" });
    await deleteEvent(db, erin, { id: gone, version: 1 });
    const recent = await listRecentChanges(db, 5);
    expect(recent.map((r) => [r.title, r.what, r.deleted])).toEqual([
      ["Duplicate Ride", "Deleted", true],
      ["Duplicate Ride", "Created", true],
    ]);
  });
});

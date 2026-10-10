import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOccurrences } from "@/agenda/load-occurrences";
import { overrides } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import type { SplitDraft } from "./event-input";
import { splitSeries } from "./split-series";
import {
  addEditor,
  addTag,
  contentDraft,
  draft,
  eventRow,
  historyOf,
  overridesOf,
  rowCounts,
  tagIdsOfEvent,
} from "./test-helpers";
import type { Actor } from "./write-helpers";

function splitDraft(splitDate: string, patch: Partial<SplitDraft> = {}): SplitDraft {
  return {
    ...contentDraft(),
    splitDate,
    mode: "change",
    time: { kind: "timed", startTime: "18:30", endTime: "20:30" },
    rule: { kind: "same" },
    ...patch,
  };
}

describe("Series split", () => {
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

  async function newSeries(tagIds: string[] = []) {
    const result = await createEvent(db, erin, draft({ tagIds }));
    if (!result.ok) throw new Error(result.message);
    await db.insert(overrides).values([
      { eventId: result.id, originalStart: "2026-10-20T18:00", scheduleStatus: "cancelled", createdBy: erin.id },
      { eventId: result.id, originalStart: "2026-11-03T18:00", scheduleNote: "Bring lights", createdBy: erin.id },
    ]);
    return result.id;
  }

  it("writes both Events, moves Overrides, copies Tags, and writes two history rows", async () => {
    const tag = await addTag(db, "rides", "non-drop");
    const oldId = await newSeries([tag]);
    const result = await splitSeries(db, sam, { id: oldId, version: 1 }, splitDraft("2026-11-03", {
      title: "Tuesday Ride (new time)",
      tagIds: [tag],
    }));
    expect(result).toMatchObject({ ok: true, kind: "split" });
    if (!result.ok) return;
    const newId = result.id;

    expect(await eventRow(db, oldId)).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261102T235959",
      title: "Tuesday Ride",
      version: 2,
      updatedBy: sam.id,
    });
    expect(await eventRow(db, newId)).toMatchObject({
      title: "Tuesday Ride (new time)",
      calendar: "rides",
      startLocal: "2026-11-03T18:30",
      endLocal: "2026-11-03T20:30",
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      predecessorId: oldId,
      reviewStatus: "approved",
      reviewedBy: erin.id,
      createdBy: sam.id,
      sourceId: null,
      version: 1,
    });
    expect((await overridesOf(db, oldId)).map((o) => o.originalStart)).toEqual(["2026-10-20T18:00"]);
    expect(await overridesOf(db, newId)).toMatchObject([
      { originalStart: "2026-11-03T18:30", scheduleNote: "Bring lights", createdBy: erin.id, updatedBy: sam.id },
    ]);
    expect(await tagIdsOfEvent(db, newId)).toEqual([tag]);
    expect(await tagIdsOfEvent(db, oldId)).toEqual([tag]);

    const oldHistory = await historyOf(db, oldId);
    expect(oldHistory.map((h) => h.action)).toEqual(["create", "split"]);
    expect(oldHistory[1].snapshot).toMatchObject({ detail: { splitDate: "2026-11-03", successorId: newId } });
    const newHistory = await historyOf(db, newId);
    expect(newHistory.map((h) => [h.action, h.version])).toEqual([["create-from-split", 1]]);
    expect(newHistory[0].snapshot).toMatchObject({ detail: { predecessorId: oldId, removedOverrides: [] } });
  });

  it("the agenda shows the old time before the date and the new time from it", async () => {
    const oldId = await newSeries();
    await splitSeries(db, sam, { id: oldId, version: 1 }, splitDraft("2026-11-03"));
    const rows = await loadOccurrences(db, { from: "2026-10-27", to: "2026-11-11" }, "rides");
    expect(rows.map((r) => r.originalStart)).toEqual(["2026-10-27T18:00", "2026-11-03T18:30", "2026-11-10T18:30"]);
  });

  it("links to the right predecessor for a Series that was already split", async () => {
    const a = await newSeries();
    const first = await splitSeries(db, sam, { id: a, version: 1 }, splitDraft("2026-11-03"));
    if (!first.ok) throw new Error(first.message);
    const b = first.id;
    const second = await splitSeries(db, sam, { id: b, version: 1 }, splitDraft("2026-12-01", {
      time: { kind: "timed", startTime: "17:30", endTime: "19:30" },
    }));
    if (!second.ok) throw new Error(second.message);
    expect((await eventRow(db, second.id)).predecessorId).toBe(b);
    expect((await eventRow(db, b)).rrule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261130T235959");
    expect(await eventRow(db, a)).toMatchObject({ version: 2, rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261102T235959" });
  });

  it("a split with a stale version is a conflict; nothing changes", async () => {
    const oldId = await newSeries();
    const before = await rowCounts(db);
    const result = await splitSeries(db, sam, { id: oldId, version: 7 }, splitDraft("2026-11-03"));
    expect(result).toMatchObject({ ok: false, reason: "conflict" });
    expect(await rowCounts(db)).toEqual(before);
  });

  it("a split that fails part way (a bad Tag) leaves both Events as they were", async () => {
    const oldId = await newSeries();
    const other = await addTag(db, "advocacy", "meeting");
    const before = await rowCounts(db);
    const result = await splitSeries(db, sam, { id: oldId, version: 1 }, splitDraft("2026-11-03", { tagIds: [other] }));
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(await rowCounts(db)).toEqual(before);
    expect(await eventRow(db, oldId)).toMatchObject({ version: 1, rrule: "FREQ=WEEKLY;BYDAY=TU" });
  });

  it("a split date after the last date is refused with a field message", async () => {
    const oldId = await newSeries();
    const stopped = await splitSeries(db, sam, { id: oldId, version: 1 }, splitDraft("2026-11-03", { mode: "stop" }));
    expect(stopped.ok).toBe(true);
    const result = await splitSeries(db, sam, { id: oldId, version: 2 }, splitDraft("2026-11-10"));
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { splitDate: "This Series has no dates on or after Tue, Nov 10. Pick an earlier date." },
    });
  });

  it("an in-place change keeps the Event id and keys its Overrides again", async () => {
    const id = await newSeries();
    const result = await splitSeries(db, sam, { id, version: 1 }, splitDraft("2026-10-01"));
    expect(result).toMatchObject({ ok: true, kind: "in-place", id });
    expect(await eventRow(db, id)).toMatchObject({ startLocal: "2026-10-06T18:30", version: 2, predecessorId: null });
    expect((await overridesOf(db, id)).map((o) => o.originalStart)).toEqual(["2026-10-20T18:30", "2026-11-03T18:30"]);
    expect((await historyOf(db, id)).map((h) => h.action)).toEqual(["create", "change-time-or-repeat"]);
    expect(await rowCounts(db)).toMatchObject({ events: 1 });
  });

  it("Stop the Series ends it and removes later Overrides; no new Event", async () => {
    const id = await newSeries();
    const result = await splitSeries(db, sam, { id, version: 1 }, splitDraft("2026-10-27", { mode: "stop" }));
    expect(result).toMatchObject({ ok: true, kind: "stop", id });
    expect((await eventRow(db, id)).rrule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261026T235959");
    expect((await overridesOf(db, id)).map((o) => o.originalStart)).toEqual(["2026-10-20T18:00"]);
    expect((await historyOf(db, id)).at(-1)).toMatchObject({
      action: "stop-series",
      snapshot: { detail: { removedOverrides: ["2026-11-03T18:00"] } },
    });
    expect(await rowCounts(db)).toMatchObject({ events: 1 });
  });

  /** Dates (YYYY-MM-DD) that the agenda shows more than once. */
  async function datesTwice(): Promise<string[]> {
    const rows = await loadOccurrences(db, { from: "2026-10-01", to: "2027-01-01" }, "rides");
    const dates = rows.map((r) => (r.timing.kind === "timed" ? r.timing.start.slice(0, 10) : r.timing.startDate));
    return [...new Set(dates.filter((d, i) => dates.indexOf(d) !== i))];
  }

  it("an in-place change on a continued Event does not run over its predecessor", async () => {
    const a = await newSeries();
    const first = await splitSeries(db, sam, { id: a, version: 1 }, splitDraft("2026-11-03"));
    if (!first.ok) throw new Error(first.message);
    // The page goes to B; the split date defaults to today (before B's first date).
    const second = await splitSeries(db, sam, { id: first.id, version: 1 }, splitDraft("2026-10-10", {
      rule: { kind: "rrule", rrule: "FREQ=WEEKLY;BYDAY=TU" },
    }));
    expect(second).toMatchObject({ ok: true, kind: "in-place", id: first.id });
    expect((await eventRow(db, first.id)).startLocal).toBe("2026-11-03T18:30");
    expect(await datesTwice()).toEqual([]);
  });

  it("Split A again before its end: the same repeat keeps A's end; an open new repeat is refused", async () => {
    const a = await newSeries();
    const toB = await splitSeries(db, sam, { id: a, version: 1 }, splitDraft("2026-11-03"));
    if (!toB.ok) throw new Error(toB.message);

    const open = await splitSeries(db, sam, { id: a, version: 2 }, splitDraft("2026-10-20", {
      rule: { kind: "rrule", rrule: "FREQ=WEEKLY;BYDAY=TU" },
    }));
    expect(open).toMatchObject({
      ok: false,
      reason: "invalid",
      errors: { rule: "This would overlap the later part of this Series (from Tue, Nov 3). End it before Tue, Nov 3." },
    });

    const same = await splitSeries(db, sam, { id: a, version: 2 }, splitDraft("2026-10-20", {
      time: { kind: "timed", startTime: "17:00", endTime: "19:00" },
    }));
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect((await eventRow(db, same.id)).rrule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959");
    expect(await datesTwice()).toEqual([]);
  });

  it("two Overrides on one date do not crash the split; the one the rule does not make is removed", async () => {
    const id = await newSeries();
    await db.insert(overrides).values([
      { eventId: id, originalStart: "2026-11-10T18:00", title: "real", createdBy: erin.id },
      { eventId: id, originalStart: "2026-11-10T17:00", title: "orphan", createdBy: erin.id },
    ]);
    const result = await splitSeries(db, sam, { id, version: 1 }, splitDraft("2026-11-03"));
    expect(result).toMatchObject({ ok: true, kind: "split" });
    if (!result.ok) return;
    expect((await overridesOf(db, result.id)).map((o) => [o.originalStart, o.title])).toEqual([
      ["2026-11-03T18:30", null],
      ["2026-11-10T18:30", "real"],
    ]);
    expect((await historyOf(db, result.id))[0].snapshot).toMatchObject({
      detail: { removedOverrides: ["2026-11-10T17:00"] },
    });
  });

  it("a change to all day drops the moved time of an Override and keeps its other changes", async () => {
    const id = await newSeries();
    await db.insert(overrides).values([
      { eventId: id, originalStart: "2026-11-10T18:00", allDay: false, startLocal: "2026-11-11T18:00", endLocal: "2026-11-11T20:00", createdBy: erin.id },
      { eventId: id, originalStart: "2026-11-17T18:00", allDay: false, startLocal: "2026-11-18T18:00", endLocal: "2026-11-18T20:00", scheduleNote: "Moved", createdBy: erin.id },
    ]);
    const result = await splitSeries(db, sam, { id, version: 1 }, splitDraft("2026-11-03", { time: { kind: "allDay", days: 1 } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await overridesOf(db, result.id)).toMatchObject([
      { originalStart: "2026-11-03", allDay: null, scheduleNote: "Bring lights" },
      { originalStart: "2026-11-17", allDay: null, startLocal: null, startDate: null, scheduleNote: "Moved" },
    ]);
    const rows = await loadOccurrences(db, { from: "2026-11-09", to: "2026-11-19" }, "rides");
    expect(rows.map((r) => [r.originalStart, r.scheduleStatus])).toEqual([
      ["2026-11-10", "scheduled"],
      ["2026-11-17", "scheduled"],
    ]);
  });
});

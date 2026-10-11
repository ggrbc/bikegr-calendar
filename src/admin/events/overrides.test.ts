import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOccurrences } from "@/agenda/load-occurrences";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import type { OverrideDraft } from "./event-input";
import { clearOverride, saveOverride } from "./overrides";
import { addEditor, draft, eventRow, historyOf, overridesOf } from "./test-helpers";
import type { Actor } from "./write-helpers";

function same(originalStart = "2026-10-20T18:00", patch: Partial<OverrideDraft> = {}): OverrideDraft {
  const end = `${originalStart.slice(0, 10)}T20:00`;
  return {
    originalStart,
    timing: { kind: "timed", start: originalStart, end },
    title: "Tuesday Ride",
    location: "Shop",
    scheduleStatus: "scheduled",
    scheduleNote: null,
    occurrenceDetails: null,
    ...patch,
  };
}

describe("change one date", () => {
  let db: Db;
  let close: () => Promise<void>;
  let erin: Actor;
  let id: string;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    erin = await addEditor(db, "Erin Editor");
    const result = await createEvent(db, erin, draft());
    if (!result.ok) throw new Error(result.message);
    id = result.id;
  });
  afterEach(async () => close());

  it("stores only changed fields, bumps the Event version, and writes an override row", async () => {
    const result = await saveOverride(db, erin, { id, version: 1 }, same(undefined, {
      scheduleStatus: "cancelled",
      scheduleNote: "Rain",
    }));
    expect(result.ok).toBe(true);
    expect(await overridesOf(db, id)).toMatchObject([
      {
        originalStart: "2026-10-20T18:00",
        allDay: null,
        startLocal: null,
        title: null,
        location: null,
        scheduleStatus: "cancelled",
        scheduleNote: "Rain",
        createdBy: erin.id,
      },
    ]);
    expect((await eventRow(db, id)).version).toBe(2);
    expect((await historyOf(db, id)).at(-1)).toMatchObject({
      action: "override",
      version: 2,
      snapshot: { detail: { originalStart: "2026-10-20T18:00" } },
    });
    const agenda = await loadOccurrences(db, { from: "2026-10-20", to: "2026-10-21" }, "rides");
    expect(agenda.map((r) => [r.scheduleStatus, r.scheduleNote])).toEqual([["cancelled", "Rain"]]);
  });

  it("a moved date is rescheduled in the agenda", async () => {
    await saveOverride(db, erin, { id, version: 1 }, same(undefined, {
      timing: { kind: "timed", start: "2026-10-22T18:00", end: "2026-10-22T20:00" },
    }));
    const agenda = await loadOccurrences(db, { from: "2026-10-20", to: "2026-10-23" }, "rides");
    expect(agenda.map((r) => r.scheduleStatus)).toEqual(["rescheduled"]);
  });

  it("an Override with every field equal to the Series removes the row", async () => {
    await saveOverride(db, erin, { id, version: 1 }, same(undefined, { title: "Other title" }));
    const result = await saveOverride(db, erin, { id, version: 2 }, same());
    expect(result.ok).toBe(true);
    expect(await overridesOf(db, id)).toEqual([]);
    expect((await historyOf(db, id)).at(-1)?.action).toBe("clear-override");
  });

  it("an Override on a date that is not an Occurrence is refused", async () => {
    const result = await saveOverride(db, erin, { id, version: 1 }, same("2026-10-21T18:00"));
    expect(result).toMatchObject({ ok: false, errors: { originalStart: "This is not a date of the Series." } });
  });

  it("a stale version is a conflict", async () => {
    await saveOverride(db, erin, { id, version: 1 }, same(undefined, { title: "A" }));
    const result = await saveOverride(db, erin, { id, version: 1 }, same(undefined, { title: "B" }));
    expect(result).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("clear removes the row and writes a clear-override row", async () => {
    await saveOverride(db, erin, { id, version: 1 }, same(undefined, { title: "A" }));
    const result = await clearOverride(db, erin, { id, version: 2 }, "2026-10-20T18:00");
    expect(result.ok).toBe(true);
    expect(await overridesOf(db, id)).toEqual([]);
    expect((await historyOf(db, id)).map((h) => h.action)).toEqual(["create", "override", "clear-override"]);
    expect((await eventRow(db, id)).version).toBe(3);
  });
});

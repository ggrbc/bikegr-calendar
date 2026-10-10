import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOccurrences } from "@/agenda/load-occurrences";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import { deleteEvent, restoreEvent } from "./delete-event";
import { addEditor, draft, eventRow, historyOf } from "./test-helpers";
import type { Actor } from "./write-helpers";

describe("delete and restore", () => {
  let db: Db;
  let close: () => Promise<void>;
  let erin: Actor;
  let ada: Actor;
  let id: string;
  const window = { from: "2026-10-06", to: "2026-10-14" };

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    erin = await addEditor(db, "Erin Editor");
    ada = await addEditor(db, "Ada Admin", "admin");
    const result = await createEvent(db, erin, draft());
    if (!result.ok) throw new Error(result.message);
    id = result.id;
  });
  afterEach(async () => close());

  it("delete hides the Event from the public agenda and keeps the row", async () => {
    expect(await loadOccurrences(db, window, "rides")).toHaveLength(2);
    const result = await deleteEvent(db, erin, { id, version: 1 });
    expect(result.ok).toBe(true);
    expect(await loadOccurrences(db, window, "rides")).toHaveLength(0);
    const row = await eventRow(db, id);
    expect(row.deletedAt).not.toBeNull();
    expect(row).toMatchObject({ deletedBy: erin.id, version: 2 });
    expect((await historyOf(db, id)).at(-1)?.action).toBe("delete");
  });

  it("a second delete is refused with This Event was deleted.", async () => {
    await deleteEvent(db, erin, { id, version: 1 });
    expect(await deleteEvent(db, erin, { id, version: 2 })).toMatchObject({
      ok: false,
      reason: "deleted",
      message: "This Event was deleted.",
    });
  });

  it("restore by an Admin shows the Event again and writes a restore row", async () => {
    await deleteEvent(db, erin, { id, version: 1 });
    const result = await restoreEvent(db, ada, { id, version: 2 });
    expect(result.ok).toBe(true);
    expect(await eventRow(db, id)).toMatchObject({ deletedAt: null, deletedBy: null, version: 3 });
    expect(await loadOccurrences(db, window, "rides")).toHaveLength(2);
    expect((await historyOf(db, id)).map((h) => [h.action, h.changedBy])).toEqual([
      ["create", erin.id],
      ["delete", erin.id],
      ["restore", ada.id],
    ]);
  });

  it("an Editor cannot restore", async () => {
    await deleteEvent(db, erin, { id, version: 1 });
    expect(await restoreEvent(db, erin, { id, version: 2 })).toMatchObject({ ok: false, reason: "invalid" });
    expect((await eventRow(db, id)).deletedAt).not.toBeNull();
  });

  it("a stale delete is a conflict", async () => {
    expect(await deleteEvent(db, erin, { id, version: 5 })).toMatchObject({ ok: false, reason: "conflict" });
  });
});

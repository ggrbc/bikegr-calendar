import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editors, events } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import { listManagedEvents, loadManagedOccurrence } from "./managed-events";
import { saveManagerOccurrence } from "./manager-occurrence";
import { addManager } from "./managers";
import { saveOverride } from "./overrides";
import { addEditor, draft, eventRow, overridesOf } from "./test-helpers";
import type { Actor } from "./write-helpers";

// A Series on Tuesdays at 18:00 from 2026-10-06. Today is Tuesday 2026-10-20.
const TODAY = "2026-10-20";

describe("the 7-day window of an Event manager", () => {
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

  const move = async (from: string, to: string) => {
    const version = (await eventRow(db, id)).version;
    const result = await saveOverride(db, erin, { id, version }, {
      originalStart: from,
      timing: { kind: "timed", start: to, end: `${to.slice(0, 10)}T20:00` },
      title: "Tuesday Ride",
      location: "Shop",
      scheduleStatus: "scheduled",
      scheduleNote: null,
      occurrenceDetails: null,
    });
    expect(result.ok).toBe(true);
  };
  const cancel = (originalStart: string) =>
    saveManagerOccurrence(
      db,
      sam,
      { eventId: id, originalStart, scheduleStatus: "cancelled", scheduleNote: "", occurrenceDetails: "" },
      { today: TODAY },
    );

  it("My Events lists the last 7 days as Recent dates, and the next 8 dates do not count them", async () => {
    const [card] = await listManagedEvents(db, sam.id, TODAY);
    expect(card.recent.map((d) => d.originalStart)).toEqual(["2026-10-13T18:00"]);
    expect(card.dates).toHaveLength(8);
    expect(card.dates[0].originalStart).toBe("2026-10-20T18:00");
  });

  it("an Editor moves Oct 6 to Oct 22: the manager can edit it, and it is listed with the upcoming dates", async () => {
    await move("2026-10-06T18:00", "2026-10-22T18:00");
    expect(await loadManagedOccurrence(db, sam.id, id, "2026-10-06T18:00", TODAY)).toMatchObject({ editable: true });
    expect(await cancel("2026-10-06T18:00")).toMatchObject({ ok: true });
    const [card] = await listManagedEvents(db, sam.id, TODAY);
    expect(card.dates.map((d) => d.originalStart)).toContain("2026-10-06T18:00");
    expect(card.recent).toHaveLength(1);
    expect((await overridesOf(db, id))[0]).toMatchObject({ scheduleStatus: "cancelled", startLocal: "2026-10-22T18:00" });
  });

  it("an Editor moves Oct 27 to Oct 10 (10 days ago): the date is closed and left out", async () => {
    await move("2026-10-27T18:00", "2026-10-10T18:00");
    expect(await loadManagedOccurrence(db, sam.id, id, "2026-10-27T18:00", TODAY)).toMatchObject({ editable: false });
    expect(await cancel("2026-10-27T18:00")).toMatchObject({ ok: false });
    const [card] = await listManagedEvents(db, sam.id, TODAY);
    expect(card.dates.map((d) => d.originalStart)).not.toContain("2026-10-27T18:00");
  });

  it("the save does not need the version: an Event that moved on since the page loaded does not conflict", async () => {
    await db.update(events).set({ version: 40 }).where(eq(events.id, id));
    expect(await cancel("2026-10-27T18:00")).toMatchObject({ ok: true });
    expect((await eventRow(db, id)).version).toBe(41);
  });
});

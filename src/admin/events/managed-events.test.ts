import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editors, events } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import { listManagedEvents, MY_EVENTS_FIRST_PAGE } from "./managed-events";
import { saveManagerOccurrence } from "./manager-occurrence";
import { addManager } from "./managers";
import { addEditor, draft } from "./test-helpers";
import type { Actor } from "./write-helpers";

const TODAY = "2026-10-20"; // a Tuesday; the Series is on Tuesdays at 18:00

describe("My Events", () => {
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

  it("one card per managed Event with the next 8 dates, from today", async () => {
    const cards = await listManagedEvents(db, sam.id, TODAY, { all: false });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ eventId: id, title: "Tuesday Ride", rrule: "FREQ=WEEKLY;BYDAY=TU" });
    expect(cards[0].dates).toHaveLength(MY_EVENTS_FIRST_PAGE);
    expect(cards[0].dates[0]).toMatchObject({ originalStart: "2026-10-20T18:00", editable: true });
    expect(cards[0].hasMore).toBe(true);
  });

  it("Show more lists every date up to one year ahead", async () => {
    const [card] = await listManagedEvents(db, sam.id, TODAY, { all: true });
    expect(card.dates.length).toBeGreaterThan(50);
    expect(card.dates.at(-1)!.originalStart <= "2027-10-20T23:59").toBe(true);
    expect(card.hasMore).toBe(false);
  });

  it("shows the status, note, and whether details are set", async () => {
    await saveManagerOccurrence(db, sam, { eventId: id, originalStart: "2026-10-27T18:00", scheduleStatus: "cancelled", scheduleNote: "Rain", occurrenceDetails: "Route" }, { today: TODAY });
    const [card] = await listManagedEvents(db, sam.id, TODAY, { all: false });
    expect(card.dates[1]).toMatchObject({ scheduleStatus: "cancelled", scheduleNote: "Rain", hasDetails: true });
  });

  it("hides a Deleted Event and shows it again after Restore; hides a pending Event", async () => {
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, id));
    expect(await listManagedEvents(db, sam.id, TODAY, { all: false })).toEqual([]);
    await db.update(events).set({ deletedAt: null }).where(eq(events.id, id));
    expect(await listManagedEvents(db, sam.id, TODAY, { all: false })).toHaveLength(1);
    await db.update(events).set({ reviewStatus: "pending" }).where(eq(events.id, id));
    expect(await listManagedEvents(db, sam.id, TODAY, { all: false })).toEqual([]);
  });

  it("a person with no grants gets an empty list", async () => {
    const other = await addEditor(db, "Lee");
    expect(await listManagedEvents(db, other.id, TODAY, { all: false })).toEqual([]);
  });
});

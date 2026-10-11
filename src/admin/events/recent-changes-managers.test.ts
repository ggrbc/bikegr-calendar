import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editors } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { createEvent } from "./create-event";
import { loadManagedOccurrence } from "./managed-events";
import { saveManagerOccurrence } from "./manager-occurrence";
import { addManager, removeManager } from "./managers";
import { listRecentChanges, loadHistory } from "./queries";
import { addEditor, draft } from "./test-helpers";
import type { Actor } from "./write-helpers";

const TODAY = "2026-10-20";

describe("manager changes in the history and the dashboard", () => {
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

  it("Recent changes and the Event history show the grant, the manager's change, and the removal", async () => {
    await saveManagerOccurrence(db, sam, { eventId: id, originalStart: "2026-10-27T18:00", scheduleStatus: "cancelled", scheduleNote: "", occurrenceDetails: "" }, { today: TODAY });
    await removeManager(db, erin, { eventId: id, editorId: sam.id });
    const recent = await listRecentChanges(db, 10);
    expect(recent.map((r) => [r.who, r.what])).toEqual([
      ["Erin Editor", "Removed Sam Leader as a manager"],
      ["Sam Leader", "Changed one date (Tue, Oct 27)"],
      ["Erin Editor", "Added Sam Leader as a manager"],
      ["Erin Editor", "Created"],
    ]);
    expect((await loadHistory(db, id)).map((h) => h.who)).toContain("Sam Leader");
  });

  it("loads one managed date for the form, and nothing without a grant", async () => {
    expect(await loadManagedOccurrence(db, sam.id, id, "2026-10-27T18:00", TODAY)).toMatchObject({
      title: "Tuesday Ride",
      scheduleStatus: "scheduled",
      editable: true,
    });
    expect(await loadManagedOccurrence(db, sam.id, id, "2026-10-28T18:00", TODAY)).toBeNull();
    expect(await loadManagedOccurrence(db, erin.id, id, "2026-10-27T18:00", TODAY)).toBeNull();
    expect(await loadManagedOccurrence(db, sam.id, id, "2026-10-06T18:00", TODAY)).toMatchObject({ editable: false });
  });
});

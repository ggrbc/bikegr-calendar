import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { editors, eventManagers, events } from "@/db/schema";
import { createEvent } from "./create-event";
import { deleteEvent, restoreEvent } from "./delete-event";
import { historyActionLabel } from "./format";
import { addManager, listGrantsOfEditor, listManagers, removeManager } from "./managers";
import { addEditor, draft, historyOf } from "./test-helpers";
import type { Actor } from "./write-helpers";

describe("Event managers: grants", () => {
  let db: Db;
  let close: () => Promise<void>;
  let erin: Actor;
  let id: string;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    erin = await addEditor(db, "Erin Editor");
    const created = await createEvent(db, erin, draft({ title: "Wednesday Evening Ride" }));
    if (!created.ok) throw new Error(created.message);
    id = created.id;
    await db.update(events).set({ reviewStatus: "approved" }).where(eq(events.id, id));
  });
  afterEach(async () => close());

  it("a new person is created as an Event manager, invited by the Editor, and gets the grant", async () => {
    const result = await addManager(db, erin, { eventId: id, email: " Sam@Example.org ", name: "Sam Leader" });
    expect(result).toMatchObject({ ok: true, kind: "invited" });
    const [sam] = await db.select().from(editors).where(eq(editors.email, "sam@example.org"));
    expect(sam).toMatchObject({ role: "event_manager", name: "Sam Leader", invitedBy: erin.id });
    expect(await listManagers(db, id)).toMatchObject([
      { editorId: sam.id, name: "Sam Leader", email: "sam@example.org", status: "invited" },
    ]);
    const history = (await historyOf(db, id)).at(-1);
    expect(history).toMatchObject({ action: "manager-add", changedBy: erin.id });
    expect(historyActionLabel("manager-add", (history!.snapshot as { detail: object }).detail)).toBe(
      "Added Sam Leader as a manager",
    );
  });

  it("an existing Event manager gets the grant", async () => {
    await addManager(db, erin, { eventId: id, email: "sam@example.org", name: "Sam Leader" });
    const other = await createEvent(db, erin, draft({ title: "Saturday Ride" }));
    if (!other.ok) throw new Error(other.message);
    await db.update(events).set({ reviewStatus: "approved" }).where(eq(events.id, other.id));
    const result = await addManager(db, erin, { eventId: other.id, email: "sam@example.org", name: "Ignored" });
    expect(result).toMatchObject({ ok: true, kind: "granted" });
    expect(await db.select().from(eventManagers)).toHaveLength(2);
  });

  it("a second grant for the same person changes nothing", async () => {
    await addManager(db, erin, { eventId: id, email: "sam@example.org", name: "Sam Leader" });
    const again = await addManager(db, erin, { eventId: id, email: "sam@example.org", name: "Sam Leader" });
    expect(again).toMatchObject({ ok: true, kind: "already" });
    expect(await db.select().from(eventManagers)).toHaveLength(1);
    expect(await historyOf(db, id)).toHaveLength(2); // create + the first grant
  });

  it("an Editor or Admin is refused: they can already change every Event", async () => {
    const drew = await addEditor(db, "Drew Wagner");
    const [row] = await db.select().from(editors).where(eq(editors.id, drew.id));
    const result = await addManager(db, erin, { eventId: id, email: row.email, name: "Drew Wagner" });
    expect(result).toMatchObject({ ok: false, message: "Drew Wagner is an Editor and can already change every Event." });
    const boss = await addEditor(db, "Bo Boss", "admin");
    const [bossRow] = await db.select().from(editors).where(eq(editors.id, boss.id));
    expect(await addManager(db, erin, { eventId: id, email: bossRow.email, name: "x" })).toMatchObject({
      ok: false,
      message: "Bo Boss is an Admin and can already change every Event.",
    });
    expect(await db.select().from(eventManagers)).toHaveLength(0);
  });

  it("a deactivated account is refused", async () => {
    await addManager(db, erin, { eventId: id, email: "sam@example.org", name: "Sam Leader" });
    await db.update(editors).set({ deactivatedAt: new Date() }).where(eq(editors.email, "sam@example.org"));
    const other = await createEvent(db, erin, draft({ title: "Saturday Ride" }));
    if (!other.ok) throw new Error(other.message);
    await db.update(events).set({ reviewStatus: "approved" }).where(eq(events.id, other.id));
    expect(await addManager(db, erin, { eventId: other.id, email: "sam@example.org", name: "Sam" })).toMatchObject({
      ok: false,
      message: "This person is deactivated. Ask an Admin to reactivate them first.",
    });
  });

  it("refuses a pending, rejected, or deleted Event", async () => {
    const pending = await createEvent(db, erin, draft({ title: "Pending" }));
    if (!pending.ok) throw new Error(pending.message);
    const ask = (eventId: string) => addManager(db, erin, { eventId, email: "sam@example.org", name: "Sam Leader" });
    await db.update(events).set({ reviewStatus: "pending" }).where(eq(events.id, pending.id));
    expect(await ask(pending.id)).toMatchObject({ ok: false });
    await db.update(events).set({ reviewStatus: "rejected" }).where(eq(events.id, pending.id));
    expect(await ask(pending.id)).toMatchObject({ ok: false });
    await db.update(events).set({ reviewStatus: "approved", deletedAt: new Date() }).where(eq(events.id, pending.id));
    expect(await ask(pending.id)).toMatchObject({ ok: false, reason: "deleted" });
    expect(await db.select().from(editors).where(eq(editors.email, "sam@example.org"))).toHaveLength(0);
  });

  it("refuses a bad name or email and an actor that is not an Editor", async () => {
    expect(await addManager(db, erin, { eventId: id, email: "not-an-email", name: "Sam" })).toMatchObject({
      ok: false,
      errors: { email: expect.any(String) },
    });
    expect(await addManager(db, erin, { eventId: id, email: "sam@example.org", name: " " })).toMatchObject({
      ok: false,
      errors: { name: expect.any(String) },
    });
    const manager = { id: erin.id, role: "event_manager" as const };
    expect(await addManager(db, manager, { eventId: id, email: "sam@example.org", name: "Sam" })).toMatchObject({
      ok: false,
    });
  });

  it("removing a grant keeps the account, and writes history with the Editor", async () => {
    await addManager(db, erin, { eventId: id, email: "sam@example.org", name: "Sam Leader" });
    const [sam] = await db.select().from(editors).where(eq(editors.email, "sam@example.org"));
    expect(await removeManager(db, erin, { eventId: id, editorId: sam.id })).toMatchObject({ ok: true });
    expect(await listManagers(db, id)).toEqual([]);
    expect((await db.select().from(editors).where(eq(editors.id, sam.id)))[0].deactivatedAt).toBeNull();
    expect((await historyOf(db, id)).at(-1)).toMatchObject({ action: "manager-remove", changedBy: erin.id });
    // A second removal is a quiet no-op.
    expect(await removeManager(db, erin, { eventId: id, editorId: sam.id })).toMatchObject({ ok: true });
    expect(await historyOf(db, id)).toHaveLength(3);
  });

  it("a manager who became an Editor shows as 'no effect', and the Editor can still remove the grant", async () => {
    await addManager(db, erin, { eventId: id, email: "sam@example.org", name: "Sam Leader" });
    await db.update(editors).set({ role: "editor" }).where(eq(editors.email, "sam@example.org"));
    const [row] = await listManagers(db, id);
    expect(row).toMatchObject({ status: "no-effect", role: "editor" });
    expect(await removeManager(db, erin, { eventId: id, editorId: row.editorId })).toMatchObject({ ok: true });
    expect(await listManagers(db, id)).toEqual([]);
  });

  it("a Deleted Event keeps its grants; Restore brings the Event back to the list", async () => {
    await addManager(db, erin, { eventId: id, email: "sam@example.org", name: "Sam Leader" });
    const [sam] = await db.select().from(editors).where(eq(editors.email, "sam@example.org"));
    const admin = await addEditor(db, "Ada Admin", "admin");
    const [{ version }] = await db.select({ version: events.version }).from(events).where(eq(events.id, id));
    expect((await deleteEvent(db, erin, { id, version })).ok).toBe(true);
    expect(await db.select().from(eventManagers)).toHaveLength(1);
    expect(await listGrantsOfEditor(db, sam.id)).toMatchObject([{ eventId: id, deleted: true }]);
    await restoreEvent(db, admin, { id, version: version + 1 });
    expect(await listGrantsOfEditor(db, sam.id)).toMatchObject([{ eventId: id, title: "Wednesday Evening Ride", deleted: false }]);
  });
});

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authSessions, authVerificationTokens, editors, type EditorRole } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import {
  changeEditorRole,
  deactivateEditor,
  getEditorForAdmin,
  listEditorsForAdmin,
  reactivateEditor,
  renameEditor,
} from "./editors";

const DAY = 24 * 60 * 60 * 1000;

describe("Editor management", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => close());

  async function person(email: string, role: EditorRole, patch: Partial<typeof editors.$inferInsert> = {}) {
    const [row] = await db.insert(editors).values({ email, role, ...patch }).returning();
    return row;
  }

  async function reload(id: string) {
    const [row] = await db.select().from(editors).where(eq(editors.id, id));
    return row;
  }

  async function session(userId: string, token: string, expires = new Date(Date.now() + 30 * DAY)) {
    await db.insert(authSessions).values({ sessionToken: token, userId, expires });
  }

  describe("role change", () => {
    it("Admin promotes an Editor to Admin", async () => {
      const x = await person("x@example.org", "admin");
      const e = await person("e@example.org", "editor");
      const result = await changeEditorRole(db, x.id, { editorId: e.id, role: "admin" });
      expect(result).toMatchObject({ ok: true, value: { role: "admin" } });
      expect((await reload(e.id)).role).toBe("admin");
    });

    it("Admin demotes another Admin when two active Admins exist", async () => {
      const x = await person("x@example.org", "admin");
      const y = await person("y@example.org", "admin");
      expect(await changeEditorRole(db, x.id, { editorId: y.id, role: "editor" })).toMatchObject({ ok: true });
      expect((await reload(y.id)).role).toBe("editor");
    });

    it("After X demotes Y, Y cannot demote X (the actor is read again in the transaction)", async () => {
      const x = await person("x@example.org", "admin");
      const y = await person("y@example.org", "admin");
      await changeEditorRole(db, x.id, { editorId: y.id, role: "editor" });
      const result = await changeEditorRole(db, y.id, { editorId: x.id, role: "editor" });
      expect(result).toMatchObject({ ok: false, reason: "not-admin" });
      expect((await reload(x.id)).role).toBe("admin");
    });

    it("Admin cannot change their own role", async () => {
      const x = await person("x@example.org", "admin");
      await person("y@example.org", "admin");
      expect(await changeEditorRole(db, x.id, { editorId: x.id, role: "editor" })).toMatchObject({
        ok: false,
        reason: "self",
      });
      expect((await reload(x.id)).role).toBe("admin");
    });

    it("Role change by an Editor is refused", async () => {
      const e = await person("e@example.org", "editor");
      const f = await person("f@example.org", "editor");
      expect(await changeEditorRole(db, e.id, { editorId: f.id, role: "admin" })).toMatchObject({
        ok: false,
        reason: "not-admin",
      });
    });

    it("Role change of a deactivated Editor is refused", async () => {
      const x = await person("x@example.org", "admin");
      const gone = await person("gone@example.org", "editor", { deactivatedAt: new Date() });
      expect(await changeEditorRole(db, x.id, { editorId: gone.id, role: "admin" })).toMatchObject({
        ok: false,
        reason: "deactivated",
      });
    });

    it("Role change of a missing Editor is refused", async () => {
      const x = await person("x@example.org", "admin");
      expect(await changeEditorRole(db, x.id, { editorId: crypto.randomUUID(), role: "admin" })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      expect(await changeEditorRole(db, x.id, { editorId: "nope", role: "admin" })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
    });
  });

  describe("deactivate", () => {
    it("Deactivate sets deactivated_at and deactivated_by and keeps the row", async () => {
      const x = await person("x@example.org", "admin");
      const e = await person("e@example.org", "editor");
      const result = await deactivateEditor(db, x.id, { editorId: e.id });
      expect(result).toMatchObject({ ok: true });
      const row = await reload(e.id);
      expect(row.deactivatedAt).toBeInstanceOf(Date);
      expect(row.deactivatedBy).toBe(x.id);
      expect(row.role).toBe("editor");
    });

    it("Deactivate deletes that Editor's sessions and unused magic-link tokens, and no other Editor's", async () => {
      const x = await person("x@example.org", "admin");
      const e = await person("e@example.org", "editor");
      await session(e.id, "e-1");
      await session(e.id, "e-2");
      await session(x.id, "x-1");
      const expires = new Date(Date.now() + DAY);
      await db.insert(authVerificationTokens).values([
        { identifier: "e@example.org", token: "e-token", expires },
        { identifier: "x@example.org", token: "x-token", expires },
      ]);

      await deactivateEditor(db, x.id, { editorId: e.id });

      const sessions = await db.select().from(authSessions);
      expect(sessions.map((s) => s.sessionToken)).toEqual(["x-1"]);
      const tokens = await db.select().from(authVerificationTokens);
      expect(tokens.map((t) => t.token)).toEqual(["x-token"]);
    });

    it("Admin cannot deactivate themself", async () => {
      const x = await person("x@example.org", "admin");
      await person("y@example.org", "admin");
      expect(await deactivateEditor(db, x.id, { editorId: x.id })).toMatchObject({ ok: false, reason: "self" });
      expect((await reload(x.id)).deactivatedAt).toBeNull();
    });

    it("Deactivated Admin cannot act with a stale session check", async () => {
      const x = await person("x@example.org", "admin");
      const y = await person("y@example.org", "admin");
      const e = await person("e@example.org", "editor");
      await deactivateEditor(db, y.id, { editorId: x.id });
      // x passed requireAdmin() before the deactivation; the transaction reads x again.
      expect(await deactivateEditor(db, x.id, { editorId: e.id })).toMatchObject({ ok: false, reason: "not-admin" });
      expect(await changeEditorRole(db, x.id, { editorId: e.id, role: "admin" })).toMatchObject({
        ok: false,
        reason: "not-admin",
      });
    });

    it("Deactivate of a deactivated Editor is refused", async () => {
      const x = await person("x@example.org", "admin");
      const gone = await person("gone@example.org", "editor", { deactivatedAt: new Date() });
      expect(await deactivateEditor(db, x.id, { editorId: gone.id })).toMatchObject({
        ok: false,
        reason: "deactivated",
      });
    });

    it("Admin deactivates another Admin when two active Admins exist", async () => {
      const x = await person("x@example.org", "admin");
      const y = await person("y@example.org", "admin");
      expect(await deactivateEditor(db, x.id, { editorId: y.id })).toMatchObject({ ok: true });
      // Now x is the last active Admin, and y cannot act.
      expect(await reactivateEditor(db, y.id, { editorId: y.id })).toMatchObject({ ok: false, reason: "not-admin" });
    });
  });

  describe("reactivate", () => {
    it("Reactivate clears deactivated_at and deactivated_by and keeps the role", async () => {
      const x = await person("x@example.org", "admin");
      const y = await person("y@example.org", "admin");
      await deactivateEditor(db, x.id, { editorId: y.id });
      const result = await reactivateEditor(db, x.id, { editorId: y.id });
      expect(result).toMatchObject({ ok: true });
      const row = await reload(y.id);
      expect(row.deactivatedAt).toBeNull();
      expect(row.deactivatedBy).toBeNull();
      expect(row.role).toBe("admin");
    });

    it("Reactivate of an active Editor is refused", async () => {
      const x = await person("x@example.org", "admin");
      const e = await person("e@example.org", "editor");
      expect(await reactivateEditor(db, x.id, { editorId: e.id })).toMatchObject({
        ok: false,
        reason: "not-deactivated",
      });
    });
  });

  describe("list", () => {
    it("Editor list shows inviter name, Seeded for no inviter, first sign-in, and last active from the latest session", async () => {
      const x = await person("x@example.org", "admin", { name: "Xavier" });
      const invitedAt = new Date("2026-09-01T12:00:00Z");
      const firstSignIn = new Date("2026-09-02T12:00:00Z");
      const e = await person("e@example.org", "editor", {
        name: "Eve",
        invitedBy: x.id,
        invitedAt,
        emailVerified: firstSignIn,
      });
      const latest = new Date("2026-11-05T00:00:00Z");
      await session(e.id, "old", new Date("2026-10-20T00:00:00Z"));
      await session(e.id, "new", latest);

      const list = await listEditorsForAdmin(db);
      const eve = list.find((r) => r.id === e.id)!;
      expect(eve).toMatchObject({
        name: "Eve",
        email: "e@example.org",
        role: "editor",
        invitedByName: "Xavier",
        invitedAt,
        firstSignIn,
        deactivatedAt: null,
      });
      expect(eve.lastActive).toEqual(new Date(latest.getTime() - 30 * DAY));
      const xavier = list.find((r) => r.id === x.id)!;
      expect(xavier.invitedByName).toBeNull();
      expect(xavier.invitedAt).toBeNull();
    });

    it("Editor list shows no last active when the Editor has no session", async () => {
      const e = await person("e@example.org", "editor");
      const [row] = await listEditorsForAdmin(db);
      expect(row.id).toBe(e.id);
      expect(row.lastActive).toBeNull();
    });

    it("Editor list shows who deactivated an Editor, and active Editors come first", async () => {
      const x = await person("x@example.org", "admin", { name: "Xavier" });
      await person("a@example.org", "editor", { name: "Aaron", deactivatedAt: new Date(), deactivatedBy: x.id });
      await person("b@example.org", "editor", { name: "Bea" });
      const list = await listEditorsForAdmin(db);
      expect(list.map((r) => r.name)).toEqual(["Bea", "Xavier", "Aaron"]);
      expect(list[2].deactivatedByName).toBe("Xavier");
    });
  });

  describe("rename", () => {
    it("Admin renames an Editor", async () => {
      const x = await person("x@example.org", "admin");
      const e = await person("e@example.org", "editor", { name: "Old" });
      const result = await renameEditor(db, x.id, { editorId: e.id, name: "  New Name " });
      expect(result).toMatchObject({ ok: true, value: { name: "New Name" } });
      expect((await reload(e.id)).name).toBe("New Name");
    });

    it("Admin renames another Admin and themselves", async () => {
      const x = await person("x@example.org", "admin");
      const y = await person("y@example.org", "admin");
      expect(await renameEditor(db, x.id, { editorId: y.id, name: "Why" })).toMatchObject({ ok: true });
      expect(await renameEditor(db, x.id, { editorId: x.id, name: "Ex" })).toMatchObject({ ok: true });
      expect((await reload(y.id)).name).toBe("Why");
    });

    it("Admin renames a deactivated Editor", async () => {
      const x = await person("x@example.org", "admin");
      const e = await person("e@example.org", "editor", { deactivatedAt: new Date() });
      expect(await renameEditor(db, x.id, { editorId: e.id, name: "Kept" })).toMatchObject({ ok: true });
    });

    it("an Editor renames themselves", async () => {
      const e = await person("e@example.org", "editor", { name: "Old" });
      expect(await renameEditor(db, e.id, { editorId: e.id, name: "Mine" })).toMatchObject({ ok: true });
      expect((await reload(e.id)).name).toBe("Mine");
    });

    it("an Editor cannot rename another person", async () => {
      const e = await person("e@example.org", "editor");
      const other = await person("o@example.org", "editor", { name: "Other" });
      expect(await renameEditor(db, e.id, { editorId: other.id, name: "Nope" })).toMatchObject({
        ok: false,
        reason: "not-allowed",
      });
      expect((await reload(other.id)).name).toBe("Other");
    });

    it("a deactivated actor is refused", async () => {
      const e = await person("e@example.org", "editor", { name: "Old", deactivatedAt: new Date() });
      expect(await renameEditor(db, e.id, { editorId: e.id, name: "New" })).toMatchObject({
        ok: false,
        reason: "not-allowed",
      });
      expect((await reload(e.id)).name).toBe("Old");
    });

    it("an empty name, a name over 100 characters, and a control character are refused", async () => {
      const x = await person("x@example.org", "admin", { name: "Keep" });
      for (const name of ["", "   ", "a".repeat(101), "Bad\u0000", "Bad\u200b"]) {
        expect(await renameEditor(db, x.id, { editorId: x.id, name }), JSON.stringify(name)).toMatchObject({
          ok: false,
          reason: "invalid",
        });
      }
      expect((await reload(x.id)).name).toBe("Keep");
    });

    it("an unknown or malformed id is not found", async () => {
      const x = await person("x@example.org", "admin");
      expect(await renameEditor(db, x.id, { editorId: "not-a-uuid", name: "A" })).toMatchObject({ reason: "not-found" });
      expect(
        await renameEditor(db, x.id, { editorId: "00000000-0000-4000-8000-000000000000", name: "A" }),
      ).toMatchObject({ reason: "not-found" });
    });
  });

  describe("getEditorForAdmin", () => {
    it("returns the details with the inviter and deactivator names", async () => {
      const x = await person("x@example.org", "admin", { name: "Xavier" });
      const e = await person("e@example.org", "editor", {
        invitedBy: x.id,
        invitedAt: new Date(),
        deactivatedAt: new Date(),
        deactivatedBy: x.id,
      });
      expect(await getEditorForAdmin(db, e.id)).toMatchObject({
        email: "e@example.org",
        invitedByName: "Xavier",
        deactivatedByName: "Xavier",
      });
    });

    it("returns null for an unknown or malformed id", async () => {
      expect(await getEditorForAdmin(db, "nope")).toBeNull();
      expect(await getEditorForAdmin(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });
});

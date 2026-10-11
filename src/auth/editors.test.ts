import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authAccounts, editors, type Editor } from "@/db/schema";
import { seedAdmins } from "@/db/seed-admins";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { findEditorByAccount, findEditorByEmail, inviteEditor, linkAccount, markEmailVerified } from "./editors";
import { canSignIn } from "./rules";

describe("editors", () => {
  let db: Db;
  let close: () => Promise<void>;
  let admin: Editor;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedAdmins(db);
    admin = (await findEditorByEmail(db, "jeremy@bikegr.org"))!;
  });
  afterAll(async () => close());

  it("email lookup ignores case", async () => {
    const found = await findEditorByEmail(db, "  Jeremy@BikeGR.org ");
    expect(found?.email).toBe("jeremy@bikegr.org");
    expect(await findEditorByEmail(db, "nobody@example.org")).toBeNull();
  });

  it("invite creates an Editor", async () => {
    const before = Date.now();
    const result = await inviteEditor(db, admin, { email: "New.Editor@Example.org", role: "editor", name: "Sam" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.editor).toMatchObject({
      email: "new.editor@example.org",
      name: "Sam",
      role: "editor",
      invitedBy: admin.id,
      deactivatedAt: null,
      emailVerified: null,
    });
    expect(result.editor.invitedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(canSignIn(await findEditorByEmail(db, "new.editor@example.org"))).toBe(true);
  });

  it("invite of an existing Editor fails", async () => {
    const result = await inviteEditor(db, admin, { email: "nate@bikegr.org", role: "editor", name: "Sam" });
    expect(result).toEqual({ ok: false, reason: "already-editor", error: expect.any(String) });
    const nates = await db.select().from(editors).where(eq(editors.email, "nate@bikegr.org"));
    expect(nates).toHaveLength(1);
    expect(nates[0].role).toBe("admin");
  });

  it("invite of a deactivated Editor fails", async () => {
    await db
      .insert(editors)
      .values({ email: "gone@example.org", role: "editor", deactivatedAt: new Date() });
    const result = await inviteEditor(db, admin, { email: "gone@example.org", role: "editor", name: "Sam" });
    expect(result).toMatchObject({ ok: false, reason: "deactivated" });
  });

  it("invite by a non-Admin is refused", async () => {
    const editor = (await findEditorByEmail(db, "new.editor@example.org"))!;
    const result = await inviteEditor(db, editor, { email: "other@example.org", role: "editor", name: "Sam" });
    expect(result).toMatchObject({ ok: false, reason: "not-admin" });
    expect(await findEditorByEmail(db, "other@example.org")).toBeNull();
  });

  it("an account link is found by provider and account id; a second link call changes nothing", async () => {
    const nate = (await findEditorByEmail(db, "nate@bikegr.org"))!;
    expect(await findEditorByAccount(db, "google", "sub-nate")).toBeNull();
    await linkAccount(db, nate.id, "google", "sub-nate");
    await linkAccount(db, nate.id, "google", "sub-nate");
    expect((await findEditorByAccount(db, "google", "sub-nate"))?.id).toBe(nate.id);
    expect(await findEditorByAccount(db, "other", "sub-nate")).toBeNull();
    expect(await db.select().from(authAccounts).where(eq(authAccounts.userId, nate.id))).toHaveLength(1);
  });

  it("markEmailVerified sets email_verified once and keeps the first date", async () => {
    const [row] = await db.insert(editors).values({ email: "verify.me@example.org" }).returning();
    await markEmailVerified(db, row.id);
    const first = (await findEditorByEmail(db, row.email))!.emailVerified;
    expect(first).toBeInstanceOf(Date);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await markEmailVerified(db, row.id);
    expect((await findEditorByEmail(db, row.email))!.emailVerified).toEqual(first);
  });
});

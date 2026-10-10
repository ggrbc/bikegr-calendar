/** Editor reads and the invite write. Callers pass the database, so tests can use PGlite. */
import { eq } from "drizzle-orm";
import { editors, type Editor } from "@/db/schema";
import type { Db } from "@/db/types";
import { canInvite, normalizeEmail, type InviteInput } from "./rules";

export async function findEditorByEmail(db: Db, email: string): Promise<Editor | null> {
  const [row] = await db
    .select()
    .from(editors)
    .where(eq(editors.email, normalizeEmail(email)))
    .limit(1);
  return row ?? null;
}

export async function findEditorById(db: Db, id: string): Promise<Editor | null> {
  const [row] = await db.select().from(editors).where(eq(editors.id, id)).limit(1);
  return row ?? null;
}

export type InviteResult =
  | { ok: true; editor: Editor }
  | { ok: false; reason: "not-admin" | "already-editor" | "deactivated"; error: string };

/**
 * Creates an invited Editor. Only an active Admin may invite. The caller sends the magic link
 * after this succeeds.
 */
export async function inviteEditor(
  db: Db,
  inviter: Pick<Editor, "id" | "role" | "deactivatedAt">,
  input: InviteInput,
): Promise<InviteResult> {
  if (!canInvite(inviter)) {
    return { ok: false, reason: "not-admin", error: "Only an Admin can invite Editors." };
  }

  const email = normalizeEmail(input.email);
  const [created] = await db
    .insert(editors)
    .values({ email, name: input.name, role: input.role, invitedBy: inviter.id, invitedAt: new Date() })
    .onConflictDoNothing({ target: editors.email })
    .returning();
  if (created) return { ok: true, editor: created };

  const existing = await findEditorByEmail(db, email);
  if (existing?.deactivatedAt) {
    return {
      ok: false,
      reason: "deactivated",
      error: `${email} is a deactivated Editor. Reactivate them in the Editors list.`,
    };
  }
  return { ok: false, reason: "already-editor", error: `${email} is already an Editor.` };
}

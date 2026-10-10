/** Editor reads, account links, and the invite write. Callers pass the database, so tests can use PGlite. */
import { and, eq, isNull } from "drizzle-orm";
import { authAccounts, editors, type Editor } from "@/db/schema";
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

/** The Editor that a provider account (for example a Google `sub`) is linked to, or null. */
export async function findEditorByAccount(db: Db, provider: string, providerAccountId: string): Promise<Editor | null> {
  const [row] = await db
    .select({ editor: editors })
    .from(authAccounts)
    .innerJoin(editors, eq(editors.id, authAccounts.userId))
    .where(and(eq(authAccounts.provider, provider), eq(authAccounts.providerAccountId, providerAccountId)))
    .limit(1);
  return row?.editor ?? null;
}

/**
 * Links an OIDC account to an Editor (docs/plans/google-login.md, `google-account-linking`). No
 * tokens: the app calls no provider API. A second call for the same account changes nothing.
 */
export async function linkAccount(db: Db, editorId: string, provider: string, providerAccountId: string): Promise<void> {
  await db
    .insert(authAccounts)
    .values({ userId: editorId, type: "oidc", provider, providerAccountId })
    .onConflictDoNothing({ target: [authAccounts.provider, authAccounts.providerAccountId] });
}

/** Sets `email_verified` on the first sign-in only ("the invite was accepted"). */
export async function markEmailVerified(db: Db, editorId: string): Promise<void> {
  await db
    .update(editors)
    .set({ emailVerified: new Date() })
    .where(and(eq(editors.id, editorId), isNull(editors.emailVerified)));
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

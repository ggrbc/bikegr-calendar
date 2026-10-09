/** Pure auth rules. No database, no Next.js, so they are easy to test. */
import { EDITOR_ROLES, type Editor, type EditorRole } from "@/db/schema";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Invite-only login: only an existing, active Editor may get or use a magic link. A deactivated
 * Editor is refused, so audit trails keep the row but the person cannot log in.
 */
export function canSignIn(editor: Pick<Editor, "deactivatedAt"> | null | undefined): boolean {
  return editor != null && editor.deactivatedAt === null;
}

/** Only an active Admin may invite Editors. */
export function canInvite(editor: Pick<Editor, "role" | "deactivatedAt">): boolean {
  return canSignIn(editor) && editor.role === "admin";
}

export interface InviteInput {
  email: string;
  role: EditorRole;
  name: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseInviteInput(raw: {
  email: unknown;
  role: unknown;
  name?: unknown;
}): ParseResult<InviteInput> {
  const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : "";
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid email address." };

  const role = raw.role;
  if (typeof role !== "string" || !(EDITOR_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: "Select a role: Admin or Editor." };
  }

  const name = typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : null;
  return { ok: true, value: { email, role: role as EditorRole, name } };
}

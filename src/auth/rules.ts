/** Pure auth rules. No database, no Next.js, so they are easy to test. */
import { EDITOR_ROLES, type Editor, type EditorRole } from "@/db/schema";

/**
 * NFKC first, so a look-alike character (for example a fullwidth `＠`) becomes plain ASCII before
 * the lookup and the format check. Then trim and lowercase.
 */
export function normalizeEmail(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
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

// Characters that are refused inside the parts:
// - spaces, `@`, `"`, `,`, `<`, `>`: they can turn one address into several (or into a display
//   name) in a mail parser;
// - the other RFC 5322 specials `( ) [ ] : ; \`: they are allowed only inside quotes, and quotes
//   are refused;
// - control characters (`\p{Cc}`, for example NUL, which Postgres refuses in text) and invisible
//   format characters (`\p{Cf}`, for example a zero-width space or an RTL override).
const PART = String.raw`[^\s@",<>()[\]:;\\\p{Cc}\p{Cf}]+`;
const EMAIL = new RegExp(`^${PART}@${PART}\\.${PART}$`, "u");

/** A simple shape check. The magic link proves that the address works. */
export function isValidEmail(email: string): boolean {
  return EMAIL.test(email);
}

export function parseInviteInput(raw: {
  email: unknown;
  role: unknown;
  name?: unknown;
}): ParseResult<InviteInput> {
  const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : "";
  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };

  const role = raw.role;
  if (typeof role !== "string" || !(EDITOR_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: "Select a role: Admin or Editor." };
  }

  const name = typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : null;
  return { ok: true, value: { email, role: role as EditorRole, name } };
}

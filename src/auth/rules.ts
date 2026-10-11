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
  name: string;
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

/** The longest Editor name. */
export const MAX_NAME_LENGTH = 100;

// Refused inside a name, because they can make one name look like another or like no name:
// - control characters `\p{Cc}`, line and paragraph separators `\p{Zl}` `\p{Zp}`, lone surrogates;
// - invisible format characters `\p{Cf}` (zero-width space, word joiner, BOM, soft hyphen, and the
//   bidi controls U+200E, U+200F, U+202A-202E, U+2066-2069, U+061C), except U+200C (ZWNJ) and
//   U+200D (ZWJ): Persian, Indic, and emoji names need them.
const BAD_NAME_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}]|(?![\u200C\u200D])\p{Cf}/u;

// Characters that show nothing: whitespace, other separators, ZWNJ, ZWJ, the Hangul fillers
// (U+115F, U+1160, U+3164, U+FFA0), and the blank braille pattern (U+2800).
const BLANK_NAME_CHARACTER = /[\s\p{Z}\u200C\u200D\u115F\u1160\u3164\uFFA0\u2800]/gu;

const VISIBLE_NAME_CHARACTER = /[\p{L}\p{N}\p{S}\p{P}]/u;

/**
 * An Editor's name: trimmed, 1 to 100 characters (code points), at least one visible character, and
 * no control or invisible format characters. The name is required (an email can have nothing to do
 * with the person's name).
 */
export function parseEditorName(raw: unknown): ParseResult<string> {
  // NFC, so the same name typed with combining marks (NFD) is not a different name.
  const name = typeof raw === "string" ? raw.trim().normalize("NFC") : "";
  // Something visible must remain: a letter, number, symbol, or punctuation mark. A name of only
  // blanks or combining marks (U+0301, U+034F, U+FE0F, U+180B) shows nothing.
  if (!VISIBLE_NAME_CHARACTER.test(name.replace(BLANK_NAME_CHARACTER, ""))) return { ok: false, error: "Enter a name." };
  if ([...name].length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Use ${MAX_NAME_LENGTH} characters or fewer for the name.` };
  }
  if (BAD_NAME_CHARACTER.test(name)) return { ok: false, error: "The name has a character that is not allowed." };
  return { ok: true, value: name };
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

  const name = parseEditorName(raw.name);
  if (!name.ok) return name;
  return { ok: true, value: { email, role: role as EditorRole, name: name.value } };
}

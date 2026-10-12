/** Pure Tag rules. No database, no Next.js. */
import type { ParseResult } from "@/auth/rules";
import { CALENDARS } from "@/db/schema";
import type { CalendarSlug } from "@/engine";
import { tagSlug } from "@/import/calendar-and-tags";
import { descriptionLength, normalizeDescription, TAG_DESCRIPTION_MAX } from "./description";

export { TAG_DESCRIPTION_MAX };

export const TAG_NAME_MAX = 40;

export interface TagNameInput {
  name: string;
  slug: string;
}

/**
 * A Tag name from a form: trimmed, inner white space collapsed to one space, 1–40 characters, and
 * a slug that is not empty. The slug comes from the one shared slug function (`tagSlug`).
 */
export function parseTagName(raw: unknown): ParseResult<TagNameInput> {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (name.length > TAG_NAME_MAX) {
    return { ok: false, error: `Use ${TAG_NAME_MAX} characters or fewer.` };
  }
  const slug = tagSlug(name);
  if (slug === "") return { ok: false, error: "Use at least one letter or number." };
  return { ok: true, value: { name, slug } };
}

/**
 * A Tag description from a form: normalized (description.ts), at most 200 characters. Empty means
 * no description (null).
 */
export function parseTagDescription(raw: unknown): ParseResult<string | null> {
  const description = typeof raw === "string" ? normalizeDescription(raw) : "";
  if (descriptionLength(description) > TAG_DESCRIPTION_MAX) {
    return { ok: false, error: `Use ${TAG_DESCRIPTION_MAX} characters or fewer.` };
  }
  return { ok: true, value: description === "" ? null : description };
}

export function parseCalendar(raw: unknown): CalendarSlug | null {
  return typeof raw === "string" && (CALENDARS as readonly string[]).includes(raw)
    ? (raw as CalendarSlug)
    : null;
}

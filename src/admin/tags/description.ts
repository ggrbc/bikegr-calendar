/** The Tag description text rule, shared by the server (rules.ts) and the admin form's counter. */
export const TAG_DESCRIPTION_MAX = 200;

/** Trimmed, white space collapsed to one space (it shows as one line). */
export function normalizeDescription(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** In code points, as Postgres `char_length` counts. */
export function descriptionLength(raw: string): number {
  return [...normalizeDescription(raw)].length;
}

/**
 * Calendar assignment and Tag cleanup for imported Events (design.md, "Tockify import", steps 3
 * and 4). Advocacy is a Calendar, not a Tag. Weekday Tags are replaced by the Day filter.
 */
import type { CalendarSlug } from "@/engine/types";

const ADVOCACY_TAG = "advocacy";
/** Events with no Advocacy Tag in Tockify that belong to the advocacy Calendar. */
const ADVOCACY_TITLES = new Set(["vital streets oversight commission"]);
const WEEKDAYS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export function assignCalendar(title: string, categories: string[]): CalendarSlug {
  const hasAdvocacyTag = categories.some((category) => category.toLowerCase() === ADVOCACY_TAG);
  return hasAdvocacyTag || ADVOCACY_TITLES.has(title.trim().toLowerCase()) ? "advocacy" : "rides";
}

/** Tag names to keep: no Advocacy Tag, no weekday Tags, no duplicates. Tockify's names are kept. */
export function cleanTags(categories: string[]): string[] {
  const kept = categories.filter((category) => {
    const name = category.toLowerCase();
    return name !== ADVOCACY_TAG && !WEEKDAYS.has(name);
  });
  return [...new Set(kept)];
}

/** Stable, URL-safe Tag slug: lowercase words joined by `-`. */
export function tagSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

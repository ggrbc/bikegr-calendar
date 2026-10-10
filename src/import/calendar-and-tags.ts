/**
 * Calendar assignment and Tag cleanup for imported Events (design.md, "Tockify import", steps 3
 * and 4). In Tockify, "Advocacy" is a category; in our model Advocacy is a Calendar, not a Tag.
 * Weekday categories are replaced by the Day filter.
 */
import type { CalendarSlug } from "@/engine";

/** The Tockify category that puts an Event in the advocacy Calendar. */
const ADVOCACY_CATEGORY = "advocacy";
/** Events with no Advocacy category in Tockify that belong to the advocacy Calendar. */
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

/** A Tag name with its slug. */
export interface CleanTag {
  name: string;
  slug: string;
}

export function assignCalendar(title: string, categories: string[]): CalendarSlug {
  const hasAdvocacyCategory = categories.some(
    (category) => category.toLowerCase() === ADVOCACY_CATEGORY,
  );
  return hasAdvocacyCategory || ADVOCACY_TITLES.has(title.trim().toLowerCase())
    ? "advocacy"
    : "rides";
}

/**
 * The Tags to keep from Tockify categories, in category order: no Advocacy category, no weekday
 * categories, no empty slug, and one Tag for each slug (the first name wins). Tockify's names are
 * kept. Every import path uses this function.
 */
export function cleanTags(categories: string[]): CleanTag[] {
  const bySlug = new Map<string, CleanTag>();
  for (const category of categories) {
    const name = category.trim();
    const lower = name.toLowerCase();
    if (lower === ADVOCACY_CATEGORY || WEEKDAYS.has(lower)) continue;
    const slug = tagSlug(name);
    if (slug !== "" && !bySlug.has(slug)) bySlug.set(slug, { name, slug });
  }
  return [...bySlug.values()];
}

/**
 * Stable, URL-safe Tag slug: lowercase ASCII words joined by `-`. Accented letters become plain
 * letters (NFKD splits "é" into "e" + a combining mark; the mark is removed).
 */
export function tagSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The ICS Feeds: `/feeds/rides.ics`, `/feeds/advocacy.ics`, `/feeds/all.ics`, each with the filter
 * query (`?tag=non-drop&day=tue`). Expanded: one `VEVENT` per Occurrence, about one month back to
 * twelve months forward (design.md "Feeds"). `from` and `to` are ignored: the window is fixed.
 */
import {
  type AgendaFilters,
  defaultTo,
  hasContentFilters,
  matchesFilters,
  serializeFilters,
} from "@/agenda/filters";
import { expandSnapshot } from "@/agenda/occurrence-rows";
import { calendarName, SITE_ORIGIN } from "@/agenda/site";
import type { CalendarSnapshot } from "@/agenda/snapshot";
import { addDays, type CalendarSlug, type LocalDate, type QueryWindow } from "@/engine";
import { buildCalendarFile } from "./vevent";

export const FEED_DAYS_BACK = 30;
export const FEED_DAYS_FORWARD = 365;

const FEEDS: Record<string, CalendarSlug | null> = {
  "rides.ics": "rides",
  "advocacy.ics": "advocacy",
  "all.ics": null,
};

/** The Calendar of a Feed file name (null = All), or `undefined` for an unknown name. */
export function parseFeedName(name: string): CalendarSlug | null | undefined {
  return Object.hasOwn(FEEDS, name) ? FEEDS[name] : undefined;
}

export function feedFileName(calendar: CalendarSlug | null): string {
  return `${calendar ?? "all"}.ics`;
}

export function feedWindow(today: LocalDate): QueryWindow {
  return { from: addDays(today, -FEED_DAYS_BACK), to: addDays(today, FEED_DAYS_FORWARD) };
}

export function feedTitle(calendar: CalendarSlug | null, filters: AgendaFilters): string {
  const title = `Bike GR — ${calendarName(calendar)}`;
  return hasContentFilters(filters) ? `${title} (filtered)` : title;
}

/** `/feeds/rides.ics?tag=…&day=…&q=…`: only the filters that a Feed uses (no dates). */
export function feedPath(calendar: CalendarSlug | null, filters: AgendaFilters, today: LocalDate): string {
  const query = serializeFilters({ ...filters, from: today, to: defaultTo(today) }, today);
  return `/feeds/${feedFileName(calendar)}${query ? `?${query}` : ""}`;
}

/** `webcal://calendar.bikegr.org/feeds/…`: opens the subscribe dialog of a calendar app. */
export function webcalUrl(path: string): string {
  return `${SITE_ORIGIN.replace(/^https:/, "webcal:")}${path}`;
}

export function buildFeed(options: {
  snapshot: CalendarSnapshot;
  calendar: CalendarSlug | null;
  filters: AgendaFilters;
  today: LocalDate;
  now: Date;
}): string {
  const { snapshot, calendar, filters, today, now } = options;
  const rows = expandSnapshot(snapshot, feedWindow(today)).filter((row) => matchesFilters(row, filters));
  return buildCalendarFile({ name: feedTitle(calendar, filters), rows, now });
}

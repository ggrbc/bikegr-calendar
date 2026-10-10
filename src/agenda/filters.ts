/**
 * The public filter model: Tags (AND), Day filter (OR within days), text search, and date range,
 * joined with AND. All filter state is in the URL. The agenda pages, the Feeds, and the Embed use
 * this one parser and serializer, so a filter link means the same thing everywhere.
 *
 * URL: `?tag=non-drop,group-ride&day=tue,thu&q=riverside&from=2026-10-12&to=2026-11-30`. Lists can
 * also come as repeated keys. Parsing never throws: bad values fall back to defaults, except a Tag
 * slug, which is kept so that an unknown or retired slug matches nothing (design.md "Tags").
 */
import {
  addDays,
  type CalendarSlug,
  checkLocalDate,
  dayOfWeek,
  type LocalDate,
  type QueryWindow,
  type Timing,
} from "@/engine";
import type { AgendaRow } from "./occurrence-rows";
import type { CalendarTag } from "./snapshot";

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface AgendaFilters {
  /** Tag slugs, lowercase, sorted, unique. An Occurrence must have every one. */
  tags: string[];
  /** In week order, unique. An Occurrence must start on one of them. Empty = every day. */
  days: Weekday[];
  /** Trimmed, spaces collapsed. Every word must be found. */
  q: string;
  /** Inclusive. */
  from: LocalDate;
  /** Inclusive. */
  to: LocalDate;
}

/** The default date range is eight weeks, the same as the plain agenda. */
export const DEFAULT_RANGE_DAYS = 8 * 7;
/** The longest date range, in days (inclusive). */
export const MAX_RANGE_DAYS = 366;
export const MAX_QUERY_LENGTH = 100;
/** `from` is at most one year before today. */
export const DAYS_BACK_LIMIT = 365;
/** `from` and `to` are at most two years after today. */
export const DAYS_FORWARD_LIMIT = 730;
const MAX_TAGS = 20;

/** `URLSearchParams`, or the plain object that Next.js gives a page as `searchParams`. */
export type FilterParams = URLSearchParams | Record<string, string | string[] | undefined>;

function values(params: FilterParams, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value = params[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Every comma-separated item of every value of `key`, trimmed and lowercase, empty items left out. */
function listValues(params: FilterParams, key: string): string[] {
  return values(params, key)
    .flatMap((value) => value.split(","))
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
}

function localDate(value: string | undefined): LocalDate | null {
  if (value === undefined) return null;
  try {
    checkLocalDate(value, "date");
    return value;
  } catch {
    return null;
  }
}

/** The default last day (inclusive) for a range that starts on `from`. */
export function defaultTo(from: LocalDate): LocalDate {
  return addDays(from, DEFAULT_RANGE_DAYS - 1);
}

export function parseFilters(params: FilterParams, today: LocalDate): AgendaFilters {
  const tags = [...new Set(listValues(params, "tag"))].sort().slice(0, MAX_TAGS);

  const daySet = new Set(listValues(params, "day"));
  const days = WEEKDAYS.filter((day) => daySet.has(day));

  const q = (values(params, "q")[0] ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH).trim();

  // Dates stay in a fixed range around today, so a URL such as ?from=9999-06-01 cannot make the
  // engine expand thousands of years (or step past year 9999).
  const earliest = addDays(today, -DAYS_BACK_LIMIT);
  const latest = addDays(today, DAYS_FORWARD_LIMIT);
  const clamp = (date: LocalDate) => (date < earliest ? earliest : date > latest ? latest : date);
  const from = clamp(localDate(values(params, "from")[0]) ?? today);
  let to = localDate(values(params, "to")[0]);
  if (to === null || to < from) to = defaultTo(from);
  const last = addDays(from, MAX_RANGE_DAYS - 1);
  if (to > last) to = last;
  if (to > latest) to = latest;

  return { tags, days: days.length === WEEKDAYS.length ? [] : days, q, from, to };
}

/**
 * The canonical query string (no `?`): keys in the order `tag`, `day`, `q`, `from`, `to`; lists
 * joined with commas; default values left out. `today` decides which `from` is the default.
 */
export function serializeFilters(filters: AgendaFilters, today: LocalDate): string {
  const parts: string[] = [];
  const list = (items: readonly string[]) => items.map(encodeURIComponent).join(",");
  if (filters.tags.length > 0) parts.push(`tag=${list([...new Set(filters.tags)].sort())}`);
  if (filters.days.length > 0) {
    parts.push(`day=${list(WEEKDAYS.filter((day) => filters.days.includes(day)))}`);
  }
  if (filters.q !== "") parts.push(`q=${encodeURIComponent(filters.q)}`);
  if (filters.from !== today) parts.push(`from=${filters.from}`);
  if (filters.to !== defaultTo(filters.from)) parts.push(`to=${filters.to}`);
  return parts.join("&");
}

/** `path` plus the canonical query, if any. */
export function filterHref(path: string, filters: AgendaFilters, today: LocalDate): string {
  const query = serializeFilters(filters, today);
  return query ? `${path}?${query}` : path;
}

/** The engine window of the date range: `[from, to + 1 day)`. */
export function filterWindow(filters: AgendaFilters): QueryWindow {
  return { from: filters.from, to: addDays(filters.to, 1) };
}

/** True when a Tag, Day, or text filter is set (the date range does not count). */
export function hasContentFilters(filters: AgendaFilters): boolean {
  return filters.tags.length > 0 || filters.days.length > 0 || filters.q !== "";
}

/** True if the weekday of `date` is in `days` (an empty list matches every day). */
export function matchesDays(date: LocalDate, days: readonly Weekday[]): boolean {
  return days.length === 0 || days.includes(WEEKDAYS[dayOfWeek(date)]);
}

/** A timed Occurrence counts for a later day only if it still runs after this wall-clock time. */
export const OVERNIGHT_CUTOFF = "06:00";

/**
 * The wall-clock dates (America/Detroit) that an Occurrence covers, for the Day filter. At most
 * seven dates: a longer span covers every weekday anyway.
 *
 * - All-day: every date from the start date to the end date (inclusive in our model; the same as an
 *   exclusive iCalendar `DTEND`).
 * - Timed: the start date, and each later date on which it still runs after 06:00. A 6 pm to 1 am
 *   ride is a Tuesday ride only; a ride to 7 am also counts for the next day.
 */
export function coveredDates(timing: Timing): LocalDate[] {
  const start = timing.kind === "allDay" ? timing.startDate : timing.start.slice(0, 10);
  const dates = [start];
  for (let date = addDays(start, 1); dates.length < 7; date = addDays(date, 1)) {
    const covered =
      timing.kind === "allDay" ? date <= timing.endDate : timing.end > `${date}T${OVERNIGHT_CUTOFF}`;
    if (!covered) break;
    dates.push(date);
  }
  return dates;
}

/** True if any date that the Occurrence covers is on one of `days` (empty = every day). */
export function matchesDaysOf(timing: Timing, days: readonly Weekday[]): boolean {
  return days.length === 0 || coveredDates(timing).some((date) => matchesDays(date, days));
}

/** Folds case and removes accents, so "Café" matches "cafe". */
export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Tags and text search only. The agenda applies the Day filter per entry (agenda-days.ts). */
export function matchesContent(row: AgendaRow, filters: AgendaFilters): boolean {
  const slugs = new Set(row.tags.map((tag) => tag.slug));
  if (!filters.tags.every((slug) => slugs.has(slug))) return false;
  if (filters.q === "") return true;
  const haystack = foldText(
    [row.title, row.location ?? "", row.description, ...row.tags.map((tag) => tag.name)].join("\n"),
  );
  return foldText(filters.q)
    .split(" ")
    .every((word) => haystack.includes(word));
}

/**
 * Tags, Day filter, and text search. The Day filter uses every wall-clock date that the actual
 * time slot (after Overrides) covers ({@link coveredDates}), so a rescheduled Occurrence uses its
 * new dates. The date range is the window.
 */
export function matchesFilters(row: AgendaRow, filters: AgendaFilters): boolean {
  return (
    matchesContent(row, filters) &&
    matchesDaysOf(row.timing, filters.days)
  );
}

/**
 * The filters to keep when the rider switches to `target` (null = All): day, text, and dates stay;
 * a Tag slug stays only if the target has an active Tag with that slug.
 */
export function switcherFilters(
  filters: AgendaFilters,
  target: CalendarSlug | null,
  activeTags: readonly CalendarTag[],
): AgendaFilters {
  const slugs = new Set(
    activeTags.filter((tag) => target === null || tag.calendar === target).map((tag) => tag.slug),
  );
  return { ...filters, tags: filters.tags.filter((slug) => slugs.has(slug)) };
}

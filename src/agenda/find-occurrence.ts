/**
 * Finds the one Occurrence of a detail URL (`/events/<eventId>/<segment>`).
 *
 * - `missing` (404): a bad id or segment, no Event, an Event that is not `approved` (pending and
 *   rejected Events never leak), or a start that is not a date of the Event (or is an `EXDATE`).
 * - `gone` (410): the Event is deleted.
 * - `found`: the Occurrence, after Overrides.
 *
 * The proxy (src/proxy.ts) calls this, so the status code is real; the detail page calls it again
 * (a direct database read, not the cached snapshot).
 *
 * Cost guard: a start outside 2000-01-01 to five years after today, before the first date, or after
 * `UNTIL` is `missing` before any expansion (a URL with year 9999 must not expand a daily Series
 * for thousands of years).
 */
import { eq } from "drizzle-orm";
import { events } from "@/db/schema";
import type { Db } from "@/db/types";
import { addDays, type CalendarSlug, type LocalDate, type OriginalStart, timingStart } from "@/engine";
import { todayInDetroit } from "./dates";
import { type AgendaRow, expandEvent } from "./occurrence-rows";
import { isUuid, parseStartSegment } from "./occurrence-url";
import { type SnapshotEvent, snapshotEvents } from "./snapshot";

export type FindResult =
  | { kind: "found"; row: AgendaRow; event: SnapshotEvent }
  | { kind: "gone"; calendar: CalendarSlug }
  | { kind: "missing" };

export const EARLIEST_START = "2000-01-01";
export const YEARS_AHEAD_LIMIT = 5;

/** True if a detail URL start is in the range that the site answers for. */
export function inStartRange(originalStart: OriginalStart, today: LocalDate): boolean {
  const date = originalStart.slice(0, 10);
  const latest = `${Number(today.slice(0, 4)) + YEARS_AHEAD_LIMIT}${today.slice(4)}`;
  return date >= EARLIEST_START && date <= latest;
}

/** The `UNTIL` date of a rule (`YYYY-MM-DD`), or null. */
function untilDate(rrule: string | null): LocalDate | null {
  const match = /(?:^|;)UNTIL=(\d{4})(\d{2})(\d{2})/i.exec(rrule ?? "");
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** The Occurrence of `event` whose original start is `originalStart`, or null. */
export function findInEvent(event: SnapshotEvent, originalStart: OriginalStart): AgendaRow | null {
  const date = originalStart.slice(0, 10);
  // Before the first date, or after UNTIL: no Occurrence, and no expansion.
  if (originalStart < timingStart(event.rule.timing)) return null;
  const until = untilDate(event.rule.rrule);
  if (until !== null && date > until) return null;
  if (event.rule.rrule === null && originalStart !== timingStart(event.rule.timing)) return null;
  return (
    expandEvent(event, { from: date, to: addDays(date, 1) }).find(
      (row) => row.originalStart === originalStart,
    ) ?? null
  );
}

/**
 * The original start of a detail URL, or null when the URL can only be `missing` (a bad id, a bad
 * segment, or a start out of range). No database read.
 */
export function checkDetailUrl(eventId: string, segment: string, today: LocalDate): OriginalStart | null {
  const originalStart = parseStartSegment(segment);
  if (!isUuid(eventId) || originalStart === null || !inStartRange(originalStart, today)) return null;
  return originalStart;
}

export async function findOccurrence(
  db: Db,
  eventId: string,
  segment: string,
  { today = todayInDetroit(new Date()), withTags = true }: { today?: LocalDate; withTags?: boolean } = {},
): Promise<FindResult> {
  const originalStart = checkDetailUrl(eventId, segment, today);
  if (originalStart === null) return { kind: "missing" };

  const [eventRow] = await db.select().from(events).where(eq(events.id, eventId.toLowerCase()));
  if (!eventRow || eventRow.reviewStatus !== "approved") return { kind: "missing" };
  if (eventRow.deletedAt !== null) return { kind: "gone", calendar: eventRow.calendar };

  const [event] = await snapshotEvents(db, [eventRow], { withTags });
  const row = findInEvent(event, originalStart);
  return row ? { kind: "found", row, event } : { kind: "missing" };
}

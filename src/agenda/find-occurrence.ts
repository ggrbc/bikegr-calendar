/**
 * Finds the one Occurrence of a detail URL (`/events/<eventId>/<segment>`).
 *
 * - `missing` (404): a bad id or segment, no Event, an Event that is not `approved` (pending and
 *   rejected Events never leak), or a start that is not a date of the Event (or is an `EXDATE`).
 * - `gone` (410): the Event is deleted.
 * - `found`: the Occurrence, after Overrides.
 *
 * The proxy (src/proxy.ts) calls this with the database, so the status code is real; the page then
 * finds the same Occurrence in the cached snapshot with {@link findInEvent}.
 */
import { eq } from "drizzle-orm";
import { events } from "@/db/schema";
import type { Db } from "@/db/types";
import { addDays, type CalendarSlug, type OriginalStart } from "@/engine";
import { type AgendaRow, expandEvent } from "./occurrence-rows";
import { isUuid, parseStartSegment } from "./occurrence-url";
import { type SnapshotEvent, snapshotEvents } from "./snapshot";

export type FindResult =
  | { kind: "found"; row: AgendaRow; event: SnapshotEvent }
  | { kind: "gone"; calendar: CalendarSlug }
  | { kind: "missing" };

/** The Occurrence of `event` whose original start is `originalStart`, or null. */
export function findInEvent(event: SnapshotEvent, originalStart: OriginalStart): AgendaRow | null {
  const date = originalStart.slice(0, 10);
  return (
    expandEvent(event, { from: date, to: addDays(date, 1) }).find(
      (row) => row.originalStart === originalStart,
    ) ?? null
  );
}

export async function findOccurrence(db: Db, eventId: string, segment: string): Promise<FindResult> {
  const originalStart = parseStartSegment(segment);
  if (!isUuid(eventId) || originalStart === null) return { kind: "missing" };

  const [eventRow] = await db.select().from(events).where(eq(events.id, eventId.toLowerCase()));
  if (!eventRow || eventRow.reviewStatus !== "approved") return { kind: "missing" };
  if (eventRow.deletedAt !== null) return { kind: "gone", calendar: eventRow.calendar };

  const [event] = await snapshotEvents(db, [eventRow]);
  const row = findInEvent(event, originalStart);
  return row ? { kind: "found", row, event } : { kind: "missing" };
}

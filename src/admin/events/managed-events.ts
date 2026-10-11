/**
 * The data of the My Events page: the Events an Event manager has a grant for, each with its next
 * dates. Only approved, not-deleted Events show (a Deleted Event keeps its grants and comes back
 * with a Restore).
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { eventRowToRuleInput, overrideRowToInput } from "@/db/mappers";
import { eventManagers, events, overrides } from "@/db/schema";
import type { Db } from "@/db/types";
import { addDays, expandOccurrences, type LocalDate, type Occurrence, type OriginalStart, type Timing } from "@/engine";
import { EDIT_DAYS_AHEAD, EDIT_DAYS_BACK, isEditableOccurrence } from "./manager-occurrence";

/** The dates on the first view of a card. */
export const MY_EVENTS_FIRST_PAGE = 8;

export interface ManagedDate {
  originalStart: OriginalStart;
  timing: Timing;
  scheduleStatus: string;
  scheduleNote: string | null;
  hasDetails: boolean;
  /** False for a date that started more than 7 days ago (read-only). */
  editable: boolean;
}

/** The date part of the actual start of an Occurrence (after an Editor's reschedule). */
const actualDay = (timing: Timing): LocalDate =>
  (timing.kind === "timed" ? timing.start : timing.startDate).slice(0, 10);

export interface ManagedEvent {
  eventId: string;
  title: string;
  /** The RRULE text, or null for a one-time Event. */
  rrule: string | null;
  /** Dates that started in the last 7 days (still open), oldest first. Not counted in the 8. */
  recent: ManagedDate[];
  /** From today on: the first 8, or all up to one year ahead for the expanded card. */
  dates: ManagedDate[];
  /** True when the card shows the first dates only and more exist up to one year ahead. */
  hasMore: boolean;
}

export async function listManagedEvents(
  db: Db,
  editorId: string,
  today: LocalDate,
  { expandId }: { expandId?: string } = {},
): Promise<ManagedEvent[]> {
  const rows = await db
    .select({ event: events })
    .from(eventManagers)
    .innerJoin(events, eq(events.id, eventManagers.eventId))
    .where(
      and(eq(eventManagers.editorId, editorId), eq(events.reviewStatus, "approved"), isNull(events.deletedAt)),
    )
    .orderBy(asc(events.title), asc(events.id));
  if (rows.length === 0) return [];

  const overrideRows = await db
    .select()
    .from(overrides)
    .where(inArray(overrides.eventId, rows.map((r) => r.event.id)));
  const window = { from: addDays(today, -EDIT_DAYS_BACK), to: addDays(today, EDIT_DAYS_AHEAD + 1) };

  return rows.map(({ event }) => {
    const mine = overrideRows.filter((o) => o.eventId === event.id);
    const toDate = (o: Occurrence): ManagedDate => ({
      originalStart: o.originalStart,
      timing: o.timing,
      scheduleStatus: o.scheduleStatus,
      scheduleNote: o.scheduleNote,
      hasDetails: o.occurrenceDetails !== undefined,
      editable: isEditableOccurrence(o.originalStart.slice(0, 10), actualDay(o.timing), today),
    });
    // Only dates that are open: a date moved to the past, 8 or more days ago, is closed.
    const found = expandOccurrences(eventRowToRuleInput(event), mine.map(overrideRowToInput), window).filter(
      (o) => isEditableOccurrence(o.originalStart.slice(0, 10), actualDay(o.timing), today),
    );
    const recent = found.filter((o) => actualDay(o.timing) < today).map(toDate);
    const upcoming = found.filter((o) => actualDay(o.timing) >= today);
    const all = event.id === expandId;
    const shown = all ? upcoming : upcoming.slice(0, MY_EVENTS_FIRST_PAGE);
    return {
      eventId: event.id,
      title: event.title,
      rrule: event.rrule,
      hasMore: !all && upcoming.length > shown.length,
      recent,
      dates: shown.map(toDate),
    };
  });
}

export interface ManagedOccurrence {
  eventId: string;
  title: string;
  originalStart: OriginalStart;
  timing: Timing;
  scheduleStatus: string;
  scheduleNote: string;
  occurrenceDetails: string;
  editable: boolean;
}

/**
 * One date of a managed Event for the date form, or null when the person has no grant, the Event
 * is not approved or is deleted, or the date is not a date of the Event.
 */
export async function loadManagedOccurrence(
  db: Db,
  editorId: string,
  eventId: string,
  originalStart: OriginalStart,
  today: LocalDate,
): Promise<ManagedOccurrence | null> {
  const [found] = await db
    .select({ event: events })
    .from(eventManagers)
    .innerJoin(events, eq(events.id, eventManagers.eventId))
    .where(
      and(
        eq(eventManagers.editorId, editorId),
        eq(eventManagers.eventId, eventId),
        eq(events.reviewStatus, "approved"),
        isNull(events.deletedAt),
      ),
    );
  if (!found) return null;
  const date = originalStart.slice(0, 10);
  const stored = await db
    .select()
    .from(overrides)
    .where(and(eq(overrides.eventId, eventId), eq(overrides.originalStart, originalStart)));
  const occurrence = expandOccurrences(eventRowToRuleInput(found.event), stored.map(overrideRowToInput), {
    from: date,
    to: addDays(date, 1),
  }).find((o) => o.originalStart === originalStart);
  if (!occurrence) return null;
  return {
    eventId,
    title: occurrence.title ?? found.event.title,
    originalStart,
    timing: occurrence.timing,
    // `rescheduled` is derived from a moved time; the form shows the stored status.
    scheduleStatus: stored[0]?.scheduleStatus ?? found.event.scheduleStatus,
    scheduleNote: occurrence.scheduleNote ?? "",
    occurrenceDetails: occurrence.occurrenceDetails ?? "",
    editable: isEditableOccurrence(date, actualDay(occurrence.timing), today),
  };
}

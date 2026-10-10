/**
 * The agenda query: approved, not-deleted Events of one Calendar (or all), expanded into their
 * Occurrences for a window by the Occurrence engine. Takes the database as an argument, so tests
 * run on PGlite and the app passes `getDb()`.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { eventRowToRuleInput, overrideRowToInput } from "@/db/mappers";
import { eventTags, events, overrides, tags } from "@/db/schema";
import type { Db } from "@/db/types";
import {
  type CalendarSlug,
  expandOccurrences,
  type OriginalStart,
  type OverrideInput,
  type QueryWindow,
  type ScheduleStatus,
  type Timing,
  timingStart,
} from "@/engine";

export interface AgendaTag {
  name: string;
  slug: string;
}

/** One Occurrence, ready for a view. */
export interface AgendaRow {
  eventId: string;
  calendar: CalendarSlug;
  originalStart: OriginalStart;
  /** After Overrides. */
  timing: Timing;
  originalTiming: Timing;
  /** The Override's title if it has one, else the Event's. */
  title: string;
  location: string | null;
  /** Not retired, sorted by name. */
  tags: AgendaTag[];
  cta: { label: string; url: string } | null;
  scheduleStatus: ScheduleStatus;
  scheduleNote: string | null;
}

export async function loadOccurrences(
  db: Db,
  window: QueryWindow,
  calendar: CalendarSlug | null,
): Promise<AgendaRow[]> {
  // No date filter in SQL: there are few Events, and the engine finds the Occurrences in the window.
  const eventRows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.reviewStatus, "approved"),
        isNull(events.deletedAt),
        calendar ? eq(events.calendar, calendar) : undefined,
      ),
    );
  if (eventRows.length === 0) return [];
  const ids = eventRows.map((e) => e.id);

  const overrideRows = await db.select().from(overrides).where(inArray(overrides.eventId, ids));
  const tagRows = await db
    .select({ eventId: eventTags.eventId, name: tags.name, slug: tags.slug })
    .from(eventTags)
    .innerJoin(tags, eq(tags.id, eventTags.tagId))
    .where(and(inArray(eventTags.eventId, ids), isNull(tags.retiredAt)))
    .orderBy(asc(tags.name));

  const overridesByEvent = groupBy(overrideRows.map(overrideRowToInput), (o) => o.eventId);
  const tagsByEvent = groupBy(tagRows, (t) => t.eventId);

  const rows: AgendaRow[] = eventRows.flatMap((event) => {
    const eventOverrides: OverrideInput[] = overridesByEvent.get(event.id) ?? [];
    const eventTagList = (tagsByEvent.get(event.id) ?? []).map(({ name, slug }) => ({ name, slug }));
    const cta =
      event.ctaLabel !== null && event.ctaUrl !== null
        ? { label: event.ctaLabel, url: event.ctaUrl }
        : null;
    return expandOccurrences(eventRowToRuleInput(event), eventOverrides, window).map(
      (occurrence): AgendaRow => ({
        eventId: event.id,
        calendar: event.calendar,
        originalStart: occurrence.originalStart,
        timing: occurrence.timing,
        originalTiming: occurrence.originalTiming,
        title: occurrence.title ?? event.title,
        location: occurrence.location ?? event.location,
        tags: eventTagList,
        cta,
        scheduleStatus: occurrence.scheduleStatus,
        scheduleNote: occurrence.scheduleNote,
      }),
    );
  });

  return rows.sort(
    (a, b) =>
      timingStart(a.timing).localeCompare(timingStart(b.timing)) ||
      a.title.localeCompare(b.title) ||
      a.eventId.localeCompare(b.eventId),
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

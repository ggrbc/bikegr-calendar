/**
 * The public data of one Calendar (or all), read from the database in three queries: approved,
 * not-deleted Events, their Overrides, and their active Tags, plus the active Tags of both Calendars
 * (for the filter form and the Calendar switcher, which keeps the Tags that the target has).
 *
 * The snapshot does not depend on a date, so one cached copy serves every window and filter
 * (src/agenda/cache.ts). It is plain data (strings, numbers, arrays, plain objects), so the Next.js
 * cache can serialize it. The engine expands it per request (occurrence-rows.ts).
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { eventRowToRuleInput, overrideRowToInput } from "@/db/mappers";
import { type EventRow, eventTags, events, overrides, tags } from "@/db/schema";
import type { Db } from "@/db/types";
import type { CalendarSlug, EventRuleInput, OriginalStart, OverrideInput } from "@/engine";
import { isHttpUrl } from "./safe-url";

export interface AgendaTag {
  name: string;
  slug: string;
  /** Set on an Event's Tags only, when the Tag has one (the Event page's info tip). */
  description?: string;
}

export interface CalendarTag extends AgendaTag {
  calendar: CalendarSlug;
}

/** One public Event with everything a view, a Feed, or the detail page needs. */
export interface SnapshotEvent {
  id: string;
  calendar: CalendarSlug;
  title: string;
  description: string;
  preview: string | null;
  location: string | null;
  imageUrl: string | null;
  cta: { label: string; url: string; skipDetails: boolean } | null;
  rule: EventRuleInput;
  overrides: OverrideInput[];
  /** Not retired, sorted by name. */
  tags: AgendaTag[];
  /** ISO 8601 instant. */
  updatedAt: string;
  /** ISO 8601 instant of each Override, by original start. */
  overrideUpdatedAt: Record<OriginalStart, string>;
}

export interface CalendarSnapshot {
  events: SnapshotEvent[];
  /** Active Tags of both Calendars, sorted by Calendar, then name. */
  tags: CalendarTag[];
}

export async function loadSnapshot(db: Db, calendar: CalendarSlug | null): Promise<CalendarSnapshot> {
  // No date filter in SQL: there are few Events, and the engine finds the Occurrences in a window.
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
  const calendarTags = await db
    .select({ calendar: tags.calendar, name: tags.name, slug: tags.slug })
    .from(tags)
    .where(isNull(tags.retiredAt))
    .orderBy(asc(tags.calendar), asc(tags.name));

  return { events: await snapshotEvents(db, eventRows), tags: calendarTags };
}

/**
 * Adds the Overrides and active Tags to Event rows. Also used for one Event (find-occurrence.ts).
 * `withTags: false` skips the Tags read (the proxy's status decision needs no Tags).
 */
export async function snapshotEvents(
  db: Db,
  eventRows: EventRow[],
  { withTags = true }: { withTags?: boolean } = {},
): Promise<SnapshotEvent[]> {
  if (eventRows.length === 0) return [];
  const ids = eventRows.map((e) => e.id);

  const overrideRows = await db.select().from(overrides).where(inArray(overrides.eventId, ids));
  const tagRows = withTags
    ? await db
        .select({ eventId: eventTags.eventId, name: tags.name, slug: tags.slug, description: tags.description })
        .from(eventTags)
        .innerJoin(tags, eq(tags.id, eventTags.tagId))
        .where(and(inArray(eventTags.eventId, ids), isNull(tags.retiredAt)))
        .orderBy(asc(tags.name))
    : [];

  const overridesByEvent = groupBy(overrideRows, (o) => o.eventId);
  const tagsByEvent = groupBy(tagRows, (t) => t.eventId);

  return eventRows.map((event): SnapshotEvent => {
    const eventOverrides = overridesByEvent.get(event.id) ?? [];
    return {
      id: event.id,
      calendar: event.calendar,
      title: event.title,
      description: event.description,
      preview: event.preview,
      location: event.location,
      imageUrl: event.imageUrl,
      // Only an http(s) URL goes into an href; a data: or javascript: CTA is left out.
      cta:
        event.ctaLabel !== null && event.ctaUrl !== null && isHttpUrl(event.ctaUrl)
          ? { label: event.ctaLabel, url: event.ctaUrl, skipDetails: event.ctaSkipDetails }
          : null,
      rule: eventRowToRuleInput(event),
      overrides: eventOverrides.map(overrideRowToInput),
      tags: (tagsByEvent.get(event.id) ?? []).map(({ name, slug, description }) =>
        description ? { name, slug, description } : { name, slug },
      ),
      updatedAt: event.updatedAt.toISOString(),
      overrideUpdatedAt: Object.fromEntries(
        eventOverrides.map((o) => [o.originalStart, o.updatedAt.toISOString()]),
      ),
    };
  });
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

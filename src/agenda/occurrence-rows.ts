/**
 * Expands a {@link CalendarSnapshot} into the Occurrences of a window, one view row each. Pure: the
 * engine does the date work; this adds the Event fields.
 */
import {
  type CalendarSlug,
  expandOccurrences,
  type OriginalStart,
  type QueryWindow,
  type ScheduleStatus,
  type Timing,
  timingStart,
} from "@/engine";
import type { AgendaTag, CalendarSnapshot, SnapshotEvent } from "./snapshot";

/** One Occurrence, ready for a view, a Feed, or the detail page. */
export interface AgendaRow {
  eventId: string;
  calendar: CalendarSlug;
  originalStart: OriginalStart;
  /** After Overrides. */
  timing: Timing;
  originalTiming: Timing;
  /** The Override's title if it has one, else the Event's. */
  title: string;
  description: string;
  /** Custom Preview: replaces the description excerpt on the card and in metadata. */
  preview: string | null;
  location: string | null;
  imageUrl: string | null;
  /** Not retired, sorted by name. */
  tags: AgendaTag[];
  /** `skipDetails`: links to the detail page go to `url` instead. */
  cta: { label: string; url: string; skipDetails: boolean } | null;
  scheduleStatus: ScheduleStatus;
  scheduleNote: string | null;
  /** Longer public text on this Occurrence. Absent when none. Not shown on the agenda card. */
  occurrenceDetails?: string;
  /** ISO 8601 instant: the later of the Event's and its Override's `updated_at`. */
  lastModified: string;
}

export function expandEvent(event: SnapshotEvent, window: QueryWindow): AgendaRow[] {
  return expandOccurrences(event.rule, event.overrides, window).map((occurrence): AgendaRow => {
    const overrideUpdated = event.overrideUpdatedAt[occurrence.originalStart];
    return {
      eventId: event.id,
      calendar: event.calendar,
      originalStart: occurrence.originalStart,
      timing: occurrence.timing,
      originalTiming: occurrence.originalTiming,
      title: occurrence.title ?? event.title,
      description: event.description,
      preview: event.preview,
      location: occurrence.location ?? event.location,
      imageUrl: event.imageUrl,
      tags: event.tags,
      cta: event.cta,
      scheduleStatus: occurrence.scheduleStatus,
      scheduleNote: occurrence.scheduleNote,
      ...(occurrence.occurrenceDetails ? { occurrenceDetails: occurrence.occurrenceDetails } : {}),
      lastModified:
        overrideUpdated && overrideUpdated > event.updatedAt ? overrideUpdated : event.updatedAt,
    };
  });
}

/** All rows of the window, sorted by actual start, then title, then Event id. */
export function expandSnapshot(snapshot: CalendarSnapshot, window: QueryWindow): AgendaRow[] {
  return snapshot.events
    .flatMap((event) => expandEvent(event, window))
    .sort(
      (a, b) =>
        timingStart(a.timing).localeCompare(timingStart(b.timing)) ||
        a.title.localeCompare(b.title) ||
        a.eventId.localeCompare(b.eventId),
    );
}

/**
 * Contract between the Occurrence engine and its callers (the database layer, the public side, the
 * Feeds, and the Tockify import). Types only. Terms follow CONTEXT.md.
 *
 * The engine never imports the database schema. Callers map rows to these types.
 */

/** Every wall-clock time in the app is in this zone. */
export const TIME_ZONE = "America/Detroit";

export type CalendarSlug = "rides" | "advocacy";

/** A local date, `YYYY-MM-DD`. */
export type LocalDate = string;

/** A wall-clock date and time in {@link TIME_ZONE}, `YYYY-MM-DDTHH:mm`. No offset, no `Z`. */
export type LocalDateTime = string;

/**
 * When an Occurrence happens. Timed Occurrences use wall-clock time; all-day Occurrences use dates
 * only. `endDate` is inclusive (a one-day all-day event has `startDate === endDate`).
 */
export type Timing =
  | { kind: "timed"; start: LocalDateTime; end: LocalDateTime }
  | { kind: "allDay"; startDate: LocalDate; endDate: LocalDate };

/**
 * Identifies one Occurrence of an Event: its start before any Override moved it. A `LocalDateTime`
 * for timed Events, a `LocalDate` for all-day Events.
 */
export type OriginalStart = LocalDateTime | LocalDate;

/** Schedule status of an Occurrence. `rescheduled` is never stored; the engine derives it. */
export type ScheduleStatus =
  | "scheduled"
  | "tentative"
  | "cancelled"
  | "postponed"
  | "rescheduled";

export type StoredScheduleStatus = Exclude<ScheduleStatus, "rescheduled">;

/** The parts of an Event that the engine needs. */
export interface EventRuleInput {
  eventId: string;
  /** The first Occurrence. For a Series, the `RRULE` repeats this time slot. */
  timing: Timing;
  /** RFC 5545 `RRULE` value without the `RRULE:` prefix, or `null` for a one-time Event. */
  rrule: string | null;
  /** Original starts that the Series skips. */
  exdates: OriginalStart[];
  /** Schedule status of a one-time Event. A Series uses Overrides instead. */
  scheduleStatus: StoredScheduleStatus;
  scheduleNote: string | null;
  /** Longer public text on the only Occurrence. A Series uses Overrides instead. */
  occurrenceDetails?: string | null;
}

/** A stored change to one Occurrence. Fields that are absent do not change. */
export interface OverrideInput {
  eventId: string;
  originalStart: OriginalStart;
  /** A new time slot. If it differs from the original, the Occurrence is `rescheduled`. */
  timing?: Timing;
  title?: string;
  location?: string;
  scheduleStatus?: StoredScheduleStatus;
  scheduleNote?: string | null;
  /** Longer public text on this Occurrence. */
  occurrenceDetails?: string;
}

/** Half-open date window `[from, to)` in {@link TIME_ZONE}. */
export interface QueryWindow {
  from: LocalDate;
  to: LocalDate;
}

/**
 * One dated Occurrence of an Event, after Overrides.
 *
 * A rescheduled Occurrence is returned once if its original or its actual time slot touches the
 * window. Views show it on both dates ("Rescheduled to …" and "Rescheduled from …").
 */
export interface Occurrence {
  eventId: string;
  originalStart: OriginalStart;
  /** The time slot before any Override. */
  originalTiming: Timing;
  /** The time slot after Overrides. Equal to `originalTiming` unless rescheduled. */
  timing: Timing;
  scheduleStatus: ScheduleStatus;
  scheduleNote: string | null;
  /** Present only when an Override changes it for this Occurrence. */
  title?: string;
  location?: string;
  /** Longer public text (route, conditions). Present only when set. */
  occurrenceDetails?: string;
}

/** Expands one Event into its Occurrences for a window, sorted by actual start. */
export type ExpandOccurrences = (
  event: EventRuleInput,
  overrides: OverrideInput[],
  window: QueryWindow,
) => Occurrence[];

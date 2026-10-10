/**
 * The Occurrence engine. See `types.ts` for the contract and CONTEXT.md for the terms.
 *
 * Steps: expand the rule near the window, remove `EXDATE`s, add Occurrences that an Override moved
 * into the window from far away, apply Overrides, keep the Occurrences whose original or actual time
 * slot touches the window, and sort by actual start.
 *
 * Rules inside the contract:
 * - The Event's Schedule status and Schedule note are the default for every Occurrence; an Override
 *   wins. (For a Series the import writes `scheduled` and `null`.)
 * - An Occurrence is `rescheduled` when an Override gives it a time slot that differs from the
 *   original. A stored status that is not `scheduled` (for example `cancelled`) wins over it.
 * - An Override whose original start the Event does not make (not in the rule, or an `EXDATE`) is
 *   ignored.
 */
import { isRuleStart, ruleStartsBetween } from "./expand-rule";
import {
  checkLocalDate,
  checkTiming,
  sameTiming,
  shiftTiming,
  timingLength,
  timingStart,
  touchesWindow,
} from "./timing";
import type {
  EventRuleInput,
  ExpandOccurrences,
  Occurrence,
  OriginalStart,
  OverrideInput,
  QueryWindow,
} from "./types";
import { addDays, addMinutes } from "./wall-clock";

export const expandOccurrences: ExpandOccurrences = (event, overrides, window) => {
  checkLocalDate(window.from, "window.from");
  checkLocalDate(window.to, "window.to");
  checkTiming(event.timing, `time slot of Event ${event.eventId}`);
  const ownOverrides = overrides.filter((item) => item.eventId === event.eventId);
  for (const item of ownOverrides) {
    if (item.timing) checkTiming(item.timing, `Override time slot (${item.originalStart})`);
  }
  if (window.from >= window.to) return [];

  const overridesByStart = new Map<OriginalStart, OverrideInput>();
  for (const item of ownOverrides) overridesByStart.set(item.originalStart, item);

  const originalStarts = new Set(originalStartsNear(event, window));
  for (const item of overridesByStart.values()) {
    if (item.timing && touchesWindow(item.timing, window) && makesStart(event, item.originalStart)) {
      originalStarts.add(item.originalStart);
    }
  }

  const exdates = new Set(event.exdates);
  return [...originalStarts]
    .filter((originalStart) => !exdates.has(originalStart))
    .map((originalStart) => buildOccurrence(event, originalStart, overridesByStart))
    .filter(
      (occurrence) =>
        touchesWindow(occurrence.originalTiming, window) || touchesWindow(occurrence.timing, window),
    )
    .sort(byActualStart);
};

/**
 * Original starts whose original time slot can touch the window. The range starts early by the
 * Event's length, so that a long Occurrence that starts before the window is found.
 */
function originalStartsNear(event: EventRuleInput, window: QueryWindow): OriginalStart[] {
  if (event.rrule === null) return [timingStart(event.timing)];

  const length = timingLength(event.timing);
  const [from, to] =
    event.timing.kind === "timed"
      ? [addMinutes(`${window.from}T00:00`, -length), `${window.to}T00:00`]
      : [addDays(window.from, -length), window.to];
  return ruleStartsBetween(event.timing, event.rrule, from, to);
}

/** True if the Event makes an Occurrence with this original start (before `EXDATE`s). */
function makesStart(event: EventRuleInput, originalStart: OriginalStart): boolean {
  return event.rrule === null
    ? originalStart === timingStart(event.timing)
    : isRuleStart(event.timing, event.rrule, originalStart);
}

function buildOccurrence(
  event: EventRuleInput,
  originalStart: OriginalStart,
  overridesByStart: Map<OriginalStart, OverrideInput>,
): Occurrence {
  const originalTiming = shiftTiming(event.timing, originalStart);
  const change = overridesByStart.get(originalStart);
  const timing = change?.timing ?? originalTiming;
  const storedStatus = change?.scheduleStatus ?? event.scheduleStatus;
  const moved = !sameTiming(timing, originalTiming);

  const occurrence: Occurrence = {
    eventId: event.eventId,
    originalStart,
    originalTiming,
    timing,
    scheduleStatus: moved && storedStatus === "scheduled" ? "rescheduled" : storedStatus,
    scheduleNote: change?.scheduleNote !== undefined ? change.scheduleNote : event.scheduleNote,
  };
  if (change?.title !== undefined) occurrence.title = change.title;
  if (change?.location !== undefined) occurrence.location = change.location;
  return occurrence;
}

/** Actual start, then original start. A date sorts before a date-time on the same day. */
function byActualStart(a: Occurrence, b: Occurrence): number {
  return (
    compare(timingStart(a.timing), timingStart(b.timing)) ||
    compare(a.originalStart, b.originalStart)
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

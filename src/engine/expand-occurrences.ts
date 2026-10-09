/**
 * The Occurrence engine. See `types.ts` for the contract and CONTEXT.md for the terms.
 */
import { ruleStartsBetween } from "./expand-rule";
import { shiftTiming, timingLength, timingStart, touchesWindow } from "./timing";
import type {
  EventRuleInput,
  ExpandOccurrences,
  Occurrence,
  OriginalStart,
  QueryWindow,
} from "./types";
import { addDays, addMinutes } from "./wall-clock";

export const expandOccurrences: ExpandOccurrences = (event, _overrides, window) => {
  if (window.from >= window.to) return [];

  const exdates = new Set(event.exdates);
  return originalStartsNear(event, window)
    .filter((originalStart) => !exdates.has(originalStart))
    .map((originalStart) => buildOccurrence(event, originalStart))
    .filter((occurrence) => touchesWindow(occurrence.timing, window));
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

function buildOccurrence(event: EventRuleInput, originalStart: OriginalStart): Occurrence {
  const originalTiming = shiftTiming(event.timing, originalStart);
  return {
    eventId: event.eventId,
    originalStart,
    originalTiming,
    timing: originalTiming,
    scheduleStatus: event.scheduleStatus,
    scheduleNote: event.scheduleNote,
  };
}

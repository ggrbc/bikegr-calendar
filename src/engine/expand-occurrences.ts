/**
 * The Occurrence engine. See `types.ts` for the contract and CONTEXT.md for the terms.
 */
import { shiftTiming, timingStart, touchesWindow } from "./timing";
import type { EventRuleInput, ExpandOccurrences, Occurrence, OriginalStart } from "./types";

export const expandOccurrences: ExpandOccurrences = (event, _overrides, window) => {
  if (window.from >= window.to) return [];

  return originalStartsNear(event)
    .map((originalStart) => buildOccurrence(event, originalStart))
    .filter((occurrence) => touchesWindow(occurrence.timing, window));
};

function originalStartsNear(event: EventRuleInput): OriginalStart[] {
  return [timingStart(event.timing)];
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

import type { EventRuleInput, OverrideInput, Timing } from "./types";

/** Builds an EventRuleInput for tests. Defaults: a one-time, scheduled, timed Event. */
export function makeEvent(
  timing: Timing,
  changes: Partial<Omit<EventRuleInput, "timing">> = {},
): EventRuleInput {
  return {
    eventId: "evt",
    timing,
    rrule: null,
    exdates: [],
    scheduleStatus: "scheduled",
    scheduleNote: null,
    ...changes,
  };
}

export function timed(start: string, end: string): Timing {
  return { kind: "timed", start, end };
}

export function allDay(startDate: string, endDate: string = startDate): Timing {
  return { kind: "allDay", startDate, endDate };
}

export function override(
  originalStart: string,
  changes: Omit<OverrideInput, "eventId" | "originalStart"> = {},
  eventId = "evt",
): OverrideInput {
  return { eventId, originalStart, ...changes };
}

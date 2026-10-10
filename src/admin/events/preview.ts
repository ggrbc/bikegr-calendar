/**
 * The rule editor's live preview and the "first Occurrence" search. Pure; runs in the browser. Both
 * look forward in one-year steps, up to 10 years.
 */
import {
  addDays,
  type EventRuleInput,
  expandOccurrences,
  type LocalDate,
  type Occurrence,
  type OriginalStart,
  type OverrideInput,
  ruleStartsBetween,
  type Timing,
} from "@/engine";

const STEP_DAYS = 366;
const MAX_STEPS = 10;

export type PreviewResult =
  | { ok: true; occurrences: Occurrence[] }
  | { ok: false; message: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The next `count` Occurrences that start on or after `from`, after Overrides. */
export function nextOccurrences(
  rule: EventRuleInput,
  overrides: OverrideInput[],
  from: LocalDate,
  count = 10,
): PreviewResult {
  try {
    const found: Occurrence[] = [];
    let windowFrom = from;
    for (let step = 0; step < MAX_STEPS && found.length < count; step++) {
      const windowTo = addDays(windowFrom, STEP_DAYS);
      const occurrences = expandOccurrences(rule, overrides, { from: windowFrom, to: windowTo });
      for (const occurrence of occurrences) {
        // An Occurrence is in the window of the step where its original date falls, so each one
        // is listed once.
        const date = occurrence.originalStart.slice(0, 10);
        if (date >= windowFrom && date < windowTo) found.push(occurrence);
      }
      if (rule.rrule === null) break;
      windowFrom = windowTo;
    }
    return { ok: true, occurrences: found.slice(0, count) };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/**
 * The first start that the rule makes on or after `from` (a date or a date-time of the same kind
 * as the timing), or null if there is none within 10 years. Throws `InvalidRuleError`.
 */
export function firstStartOnOrAfter(
  timing: Timing,
  rrule: string,
  from: OriginalStart,
): OriginalStart | null {
  let stepFrom = from;
  for (let step = 0; step < MAX_STEPS; step++) {
    const date = addDays(stepFrom.slice(0, 10), STEP_DAYS);
    const stepTo = timing.kind === "timed" ? `${date}T00:00` : date;
    const starts = ruleStartsBetween(timing, rrule, stepFrom, stepTo);
    if (starts.length > 0) return starts[0];
    stepFrom = stepTo;
  }
  return null;
}

/**
 * Infers an `RRULE` and `EXDATE`s for one Series from its Occurrence dates (design.md, "Tockify
 * import", step 2). Kept small on purpose: an Editor reviews each Series after the import.
 *
 * 1. Make a short list of candidate rules from the dates: weekly (with `INTERVAL`), weekly in the
 *    seen months (`BYMONTH`), monthly on the nth weekday (at most two positions), monthly on a day
 *    of the month, and yearly on a date.
 * 2. Expand each candidate up to the feed horizon. Drop it if it misses an original date.
 * 3. **Feed horizon.** The next rule date is the first date that the rule makes after the last
 *    original. If it is after the feed horizon, the Series is open-ended (no `UNTIL`): the feed
 *    would show that date if it existed. If not, the Series gets `UNTIL=<last date>T235959`.
 * 4. Dates that the rule makes but the feed does not have become `EXDATE`s. A rule may use
 *    `EXDATE`s for at most a quarter of its dates.
 * 5. Choose the candidate with the fewest `EXDATE`s (the first in list order on a tie).
 * 6. **Exact-match check:** the final rule, expanded by the engine itself up to the horizon, must
 *    make exactly the original list. If it does not, the Series is flagged.
 */
import { expandOccurrences } from "@/engine/expand-occurrences";
import { nextRuleStart, ruleStartsBetween } from "@/engine/expand-rule";
import type { LocalDate, OriginalStart, Timing } from "@/engine/types";
import { addDays, toFloating } from "@/engine/wall-clock";

export interface InferRuleInput {
  /** Time slot of the first Occurrence, at the Series' usual time of day and length. */
  timing: Timing;
  /** Sorted, unique original starts (date + usual time, or date for all-day Series). */
  originalStarts: OriginalStart[];
  /** Latest Occurrence start date in the whole feed. */
  feedHorizon: LocalDate;
}

export type InferRuleResult =
  | { ok: true; rrule: string; exdates: OriginalStart[]; until: LocalDate | null }
  | { ok: false; reason: string };

/** At most this share of a rule's dates may be `EXDATE`s. */
const MAX_EXDATE_SHARE = 0.25;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export function inferRule({ timing, originalStarts, feedHorizon }: InferRuleInput): InferRuleResult {
  if (originalStarts.length < 2) return { ok: false, reason: "a Series needs two or more dates" };

  let best: { rrule: string; exdates: OriginalStart[]; until: LocalDate | null } | null = null;
  let fewestRejected = Infinity;

  for (const candidate of candidateRules(originalStarts.map(dateOf))) {
    const fitted = fitCandidate(timing, candidate, originalStarts, feedHorizon);
    if (!fitted) continue;
    const share = fitted.exdates.length / (fitted.exdates.length + originalStarts.length);
    if (share > MAX_EXDATE_SHARE) {
      fewestRejected = Math.min(fewestRejected, fitted.exdates.length);
      continue;
    }
    if (!best || fitted.exdates.length < best.exdates.length) best = fitted;
  }

  if (!best) {
    return {
      ok: false,
      reason:
        fewestRejected < Infinity
          ? `the best rule needs ${fewestRejected} EXDATEs for ${originalStarts.length} dates`
          : "no candidate rule makes every date",
    };
  }
  if (!exactMatch(timing, best.rrule, best.exdates, originalStarts, feedHorizon)) {
    return { ok: false, reason: `rule ${best.rrule} does not expand to the exact original list` };
  }
  return { ok: true, ...best };
}

/**
 * Exact-match check: the rule with its `EXDATE`s, expanded by the engine from the first original
 * date to the end of the feed horizon day, makes exactly `originalStarts`.
 */
export function exactMatch(
  timing: Timing,
  rrule: string,
  exdates: OriginalStart[],
  originalStarts: OriginalStart[],
  feedHorizon: LocalDate,
): boolean {
  const occurrences = expandOccurrences(
    {
      eventId: "exact-match-check",
      timing,
      rrule,
      exdates,
      scheduleStatus: "scheduled",
      scheduleNote: null,
    },
    [],
    { from: dateOf(originalStarts[0]), to: addDays(feedHorizon, 1) },
  );
  const made = occurrences.map((occurrence) => occurrence.originalStart);
  return made.length === originalStarts.length && made.every((start, i) => start === originalStarts[i]);
}

function fitCandidate(
  timing: Timing,
  candidate: string,
  originalStarts: OriginalStart[],
  feedHorizon: LocalDate,
): { rrule: string; exdates: OriginalStart[]; until: LocalDate | null } | null {
  const first = originalStarts[0];
  const last = originalStarts[originalStarts.length - 1];
  const horizonEnd = timing.kind === "timed" ? `${feedHorizon}T23:59` : feedHorizon;
  const made = ruleStartsBetween(timing, candidate, first, horizonEnd);
  const madeSet = new Set(made);
  if (!originalStarts.every((start) => madeSet.has(start))) return null;

  const next = nextRuleStart(timing, candidate, last);
  const openEnded = next === null || dateOf(next) > feedHorizon;
  const originals = new Set(originalStarts);
  const exdates = made.filter((start) => start <= last && !originals.has(start));
  return openEnded
    ? { rrule: candidate, exdates, until: null }
    : { rrule: `${candidate};UNTIL=${dateOf(last).replace(/-/g, "")}T235959`, exdates, until: dateOf(last) };
}

/** Candidate rules with no `UNTIL`, simplest first. */
function candidateRules(dates: LocalDate[]): string[] {
  const candidates: string[] = [];
  const weekdays = unique(dates.map(weekdayOf));
  const months = unique(dates.map((date) => Number(date.slice(5, 7)))).sort((a, b) => a - b);

  // Weekly. With one weekday, INTERVAL is the largest step that fits every gap.
  const interval = weekdays.length === 1 ? weeklyInterval(dates) : 1;
  const weekly = `FREQ=WEEKLY${interval > 1 ? `;INTERVAL=${interval}` : ""};BYDAY=${weekdays.join(",")}`;
  candidates.push(weekly);
  if (months.length < 12) candidates.push(`${weekly};BYMONTH=${months.join(",")}`);

  // Monthly on the nth weekday: 2TU, or 2TU,4TU. A 5th weekday is also tried as "last" (-1).
  if (weekdays.length === 1) {
    const positions = unique(dates.map((date) => Math.ceil(Number(date.slice(8, 10)) / 7)));
    if (positions.length <= 2) {
      const sorted = positions.sort((a, b) => a - b);
      candidates.push(`FREQ=MONTHLY;BYDAY=${sorted.map((n) => `${n}${weekdays[0]}`).join(",")}`);
      if (sorted.includes(5)) {
        const withLast = sorted.map((n) => (n === 5 ? -1 : n));
        candidates.push(`FREQ=MONTHLY;BYDAY=${withLast.map((n) => `${n}${weekdays[0]}`).join(",")}`);
      }
    }
  }

  const monthDays = unique(dates.map((date) => Number(date.slice(8, 10))));
  if (monthDays.length === 1) {
    candidates.push(`FREQ=MONTHLY;BYMONTHDAY=${monthDays[0]}`);
    if (months.length === 1) {
      candidates.push(`FREQ=YEARLY;BYMONTH=${months[0]};BYMONTHDAY=${monthDays[0]}`);
    }
  }
  return candidates;
}

/** Greatest common divisor of the gaps, in weeks. 1 if a gap is not whole weeks. */
function weeklyInterval(dates: LocalDate[]): number {
  let result = 0;
  for (let i = 1; i < dates.length; i++) {
    const days = Math.round((toFloating(dates[i]).getTime() - toFloating(dates[i - 1]).getTime()) / 86_400_000);
    if (days % 7 !== 0) return 1;
    result = gcd(result, days / 7);
  }
  return Math.max(result, 1);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function weekdayOf(date: LocalDate): string {
  return WEEKDAYS[toFloating(date).getUTCDay()];
}

function dateOf(start: OriginalStart): LocalDate {
  return start.slice(0, 10);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

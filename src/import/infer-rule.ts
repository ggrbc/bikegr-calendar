/**
 * Infers an `RRULE` and `EXDATE`s for one Series from its Occurrence dates (design.md, "Tockify
 * import", step 2). Kept small on purpose: an Editor reviews each Series after the import.
 *
 * 1. Make a short list of candidate rules from the dates: weekly (with `INTERVAL`), weekly in the
 *    seen months (`BYMONTH`), monthly on the last weekday (`-1TU`), monthly on the nth weekday (at
 *    most two positions), monthly on a day of the month, and yearly on a date.
 * 2. Expand each candidate from the first to the last original. Drop it if it misses an original.
 * 3. Dates that the rule makes but the feed does not have become `EXDATE`s. A rule may use
 *    `EXDATE`s for at most a quarter of its dates.
 * 4. Choose the candidate with the fewest `EXDATE`s (the first in list order on a tie).
 * 5. **Open-ended Series** (Jeremy's decision, 2026-10-09): if the last original starts more than
 *    12 months after the import date (strictly after {@link openEndedAfter}), the rule has no
 *    `UNTIL`. If not, it gets `UNTIL=<last date>T235959`.
 * 6. **Exact-match check:** the final rule, expanded by the engine itself from the first to the
 *    last original (an open-ended rule goes on after that), must make exactly the original list. If
 *    it does not, the Series is flagged.
 */
import {
  addDays,
  dayOfWeek,
  daysBetween,
  expandOccurrences,
  ruleStartsBetween,
  type LocalDate,
  type OriginalStart,
  type Timing,
} from "@/engine";

export interface InferRuleInput {
  /** Time slot of the first Occurrence, at the Series' usual time of day and length. */
  timing: Timing;
  /** Sorted, unique original starts (date + usual time, or date for all-day Series). */
  originalStarts: OriginalStart[];
  /** The day the import runs, in Detroit. An explicit input: the import never reads the clock. */
  importDate: LocalDate;
}

/**
 * The same calendar date one year after `importDate` (29 February gives 28 February). A Series
 * whose last Occurrence starts after this date is open-ended.
 */
export function openEndedAfter(importDate: LocalDate): LocalDate {
  const year = Number(importDate.slice(0, 4)) + 1;
  const monthDay = importDate.slice(5) === "02-29" ? "02-28" : importDate.slice(5);
  return `${year}-${monthDay}`;
}

export type InferRuleResult =
  | { ok: true; rrule: string; exdates: OriginalStart[]; until: LocalDate | null }
  | { ok: false; reason: string };

/** At most this share of a rule's dates may be `EXDATE`s. */
const MAX_EXDATE_SHARE = 0.25;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export function inferRule({ timing, originalStarts, importDate }: InferRuleInput): InferRuleResult {
  if (originalStarts.length < 2) return { ok: false, reason: "a Series needs two or more dates" };

  let best: { rrule: string; exdates: OriginalStart[]; until: LocalDate | null } | null = null;
  let fewestRejected = Infinity;
  const openEnded = dateOf(originalStarts[originalStarts.length - 1]) > openEndedAfter(importDate);

  for (const candidate of candidateRules(originalStarts.map(dateOf))) {
    const fitted = fitCandidate(timing, candidate, originalStarts, openEnded);
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
  if (!exactMatch(timing, best.rrule, best.exdates, originalStarts)) {
    return { ok: false, reason: `rule ${best.rrule} does not expand to the exact original list` };
  }
  return { ok: true, ...best };
}

/**
 * Exact-match check: the rule with its `EXDATE`s, expanded by the engine from the first original
 * date to the end of the last original date, makes exactly `originalStarts`. The window ends at
 * the Series' own last Occurrence, because an open-ended rule goes on after it.
 */
export function exactMatch(
  timing: Timing,
  rrule: string,
  exdates: OriginalStart[],
  originalStarts: OriginalStart[],
): boolean {
  const lastDate = dateOf(originalStarts[originalStarts.length - 1]);
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
    { from: dateOf(originalStarts[0]), to: addDays(lastDate, 1) },
  );
  const made = occurrences.map((occurrence) => occurrence.originalStart);
  return (
    made.length === originalStarts.length && made.every((start, i) => start === originalStarts[i])
  );
}

function fitCandidate(
  timing: Timing,
  candidate: string,
  originalStarts: OriginalStart[],
  openEnded: boolean,
): { rrule: string; exdates: OriginalStart[]; until: LocalDate | null } | null {
  const first = originalStarts[0];
  const last = originalStarts[originalStarts.length - 1];
  const made = ruleStartsBetween(timing, candidate, first, last);
  const madeSet = new Set(made);
  if (!originalStarts.every((start) => madeSet.has(start))) return null;

  const originals = new Set(originalStarts);
  const exdates = made.filter((start) => !originals.has(start));
  if (openEnded) return { rrule: candidate, exdates, until: null };

  const until = dateOf(last);
  return { rrule: `${candidate};UNTIL=${until.replace(/-/g, "")}T235959`, exdates, until };
}

/** Candidate rules with no `UNTIL`, simplest first. */
function candidateRules(dates: LocalDate[]): string[] {
  const candidates: string[] = [];
  const weekdays = unique(dates.map(weekdayOf));
  const months = unique(dates.map((date) => Number(date.slice(5, 7)))).sort((a, b) => a - b);

  // Weekly. With one weekday, INTERVAL is the largest step that fits every gap.
  const interval = weekdays.length === 1 ? weeklyInterval(dates) : 1;
  const intervalPart = interval > 1 ? `;INTERVAL=${interval}` : "";
  const weekly = `FREQ=WEEKLY${intervalPart};BYDAY=${weekdays.join(",")}`;
  candidates.push(weekly);
  if (months.length < 12) candidates.push(`${weekly};BYMONTH=${months.join(",")}`);

  // Monthly on the last weekday (-1TU), when every date is the last such weekday of its month.
  // It comes before the nth-weekday forms, because 4TU,5TU would also cover these dates.
  if (weekdays.length === 1 && dates.every(isLastWeekdayOfMonth)) {
    candidates.push(`FREQ=MONTHLY;BYDAY=-1${weekdays[0]}`);
  }

  // Monthly on the nth weekday: 2TU, or 2TU,4TU. A 5th weekday is also tried as "last" (-1).
  if (weekdays.length === 1) {
    const positions = unique(dates.map((date) => Math.ceil(Number(date.slice(8, 10)) / 7)));
    if (positions.length <= 2) {
      const sorted = positions.sort((a, b) => a - b);
      const byDay = (ns: number[]) => ns.map((n) => `${n}${weekdays[0]}`).join(",");
      candidates.push(`FREQ=MONTHLY;BYDAY=${byDay(sorted)}`);
      if (sorted.includes(5)) {
        candidates.push(`FREQ=MONTHLY;BYDAY=${byDay(sorted.map((n) => (n === 5 ? -1 : n)))}`);
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
    const days = daysBetween(dates[i - 1], dates[i]);
    if (days % 7 !== 0) return 1;
    result = gcd(result, days / 7);
  }
  return Math.max(result, 1);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** True if the same weekday one week later is in the next month. */
function isLastWeekdayOfMonth(date: LocalDate): boolean {
  return addDays(date, 7).slice(5, 7) !== date.slice(5, 7);
}

function weekdayOf(date: LocalDate): string {
  return WEEKDAYS[dayOfWeek(date)];
}

function dateOf(start: OriginalStart): LocalDate {
  return start.slice(0, 10);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

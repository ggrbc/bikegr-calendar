/**
 * The Series split plan (ADR 0001): what "This date and later" does to a Series, before any write.
 * Pure; the form uses it for the summary and the server uses it for the write. Plan:
 * docs/plans/admin-event-editing.md ("Series split").
 */
import { shortDate } from "@/agenda/dates";
import {
  addDays,
  addMinutes,
  isRuleStart,
  type LocalDate,
  type OriginalStart,
  type OverrideInput,
  ruleStartsBetween,
  shiftTiming,
  type Timing,
  timingStart,
} from "@/engine";
import type { SplitDraft } from "./event-input";
import { firstStartOnOrAfter } from "./preview";

/** The parts of the old Event that the plan needs. */
export interface SplitSeries {
  timing: Timing;
  rrule: string | null;
  exdates: OriginalStart[];
}

export interface RuleState {
  rrule: string;
  exdates: OriginalStart[];
}

export interface NextSeries extends RuleState {
  timing: Timing;
}

/** An Override that moves to the new Series, with its new key. */
export interface MovedOverride {
  from: OriginalStart;
  to: OriginalStart;
  /** The new Series has the other kind of time slot (timed or all day): the Override's own slot goes. */
  dropTiming?: true;
}

/** The neighbors in a chain of splits, so a change cannot run over their dates. */
export interface SplitBounds {
  /** The last date of the Event this one continues (its predecessor). */
  predecessorLastDate?: LocalDate | null;
  /** The first date of the Event that continues this one (its successor). */
  successorFirstDate?: LocalDate | null;
  /** Today in Detroit. A split date before it is refused (past dates change through One date). */
  today?: LocalDate;
}

export const PAST_SPLIT_DATE = "Pick today or a later date. To change one past date, use One date.";

export type SplitPlan =
  | {
      kind: "split";
      splitDate: LocalDate;
      old: RuleState;
      next: NextSeries;
      moved: MovedOverride[];
      removedOverrides: OriginalStart[];
    }
  | {
      /** No Occurrence is left before the split date: the same Event changes. */
      kind: "in-place";
      splitDate: LocalDate;
      next: NextSeries;
      moved: MovedOverride[];
      removedOverrides: OriginalStart[];
    }
  | { kind: "stop"; old: RuleState; removedOverrides: OriginalStart[] }
  | { kind: "refused"; message: string; field?: "rule" | "splitDate" };

type SplitInput = Pick<SplitDraft, "splitDate" | "mode" | "time" | "rule">;

const dateOf = (start: OriginalStart) => start.slice(0, 10);

function withoutEnd(rrule: string): string[] {
  const body = rrule.endsWith(";") ? rrule.slice(0, -1) : rrule;
  return body.split(";").filter((part) => !/^(UNTIL|COUNT)=/.test(part));
}

function endPart(rrule: string, name: "UNTIL" | "COUNT"): string | undefined {
  return rrule
    .split(";")
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** The rule that ends the day before `date` (Detroit wall-clock, the import's form). */
export function ruleEndingBefore(rrule: string, date: LocalDate): string {
  return [...withoutEnd(rrule), `UNTIL=${addDays(date, -1).replace(/-/g, "")}T235959`].join(";");
}

/** Rule starts on one date. */
function startsOn(timing: Timing, rrule: string, date: LocalDate): OriginalStart[] {
  return timing.kind === "timed"
    ? ruleStartsBetween(timing, rrule, `${date}T00:00`, `${date}T23:59`)
    : ruleStartsBetween(timing, rrule, date, date);
}

/** Rule starts before `date` (before `EXDATE`s). */
function startsBefore(timing: Timing, rrule: string, date: LocalDate): OriginalStart[] {
  const last = addDays(date, -1);
  const from = timingStart(timing);
  return timing.kind === "timed"
    ? ruleStartsBetween(timing, rrule, from, `${last}T23:59`)
    : ruleStartsBetween(timing, rrule, from, last);
}

function anchorTiming(date: LocalDate, time: SplitDraft["time"]): Timing {
  if (time.kind === "allDay") {
    return { kind: "allDay", startDate: date, endDate: addDays(date, time.days - 1) };
  }
  const endDate = time.endTime < time.startTime ? addDays(date, 1) : date;
  return { kind: "timed", start: `${date}T${time.startTime}`, end: `${endDate}T${time.endTime}` };
}

/** The first rule start on or after `from` that is not skipped, or null. */
function firstKeptStart(series: SplitSeries & { rrule: string }, from: OriginalStart): OriginalStart | null {
  const skipped = new Set(series.exdates);
  let start = firstStartOnOrAfter(series.timing, series.rrule, from);
  // Each skipped start moves the search one minute (or one day) on.
  while (start !== null && skipped.has(start)) {
    const next = series.timing.kind === "timed" ? addMinutes(start, 1) : addDays(start, 1);
    start = firstStartOnOrAfter(series.timing, series.rrule, next);
  }
  return start;
}

const SEARCH_STEP_DAYS = 400;

/**
 * The date of the last start of a rule that ends, with no horizon: an `UNTIL` rule is searched back
 * from its `UNTIL` date, a `COUNT` rule stops by its count. An open-ended rule has none (null).
 */
export function lastStartDate(timing: Timing, rrule: string): LocalDate | null {
  const from = timingStart(timing);
  const atStart = (date: LocalDate) => (timing.kind === "timed" ? `${date}T00:00` : date);
  const atEnd = (date: LocalDate) => (timing.kind === "timed" ? `${date}T23:59` : date);
  const last = (starts: OriginalStart[]) => (starts.length > 0 ? dateOf(starts[starts.length - 1]) : null);

  const until = endPart(rrule, "UNTIL");
  if (until !== undefined) {
    // One day after the UNTIL date also covers an UNTIL in UTC (`…Z`).
    let to = addDays(`${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`, 1);
    while (atEnd(to) >= from) {
      const stepFrom = atStart(addDays(to, -SEARCH_STEP_DAYS));
      const found = last(ruleStartsBetween(timing, rrule, stepFrom > from ? stepFrom : from, atEnd(to)));
      if (found) return found;
      to = addDays(to, -SEARCH_STEP_DAYS - 1);
    }
    return null;
  }
  if (endPart(rrule, "COUNT") !== undefined) {
    return last(ruleStartsBetween(timing, rrule, from, atEnd("9999-12-31")));
  }
  return null;
}

/** True if the Override changes more than its time slot. */
function hasMoreThanTiming(o: OverrideInput): boolean {
  return (
    o.title !== undefined ||
    o.location !== undefined ||
    o.scheduleStatus !== undefined ||
    o.scheduleNote !== undefined ||
    o.occurrenceDetails !== undefined
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function planSplit(
  series: SplitSeries,
  overrides: OverrideInput[],
  input: SplitInput,
  bounds: SplitBounds = {},
): SplitPlan {
  const { rrule } = series;
  if (rrule === null) return { kind: "refused", message: "This Event does not repeat." };
  const ruled = { ...series, rrule };
  const day = input.splitDate;
  if (bounds.today && day < bounds.today) {
    return { kind: "refused", message: PAST_SPLIT_DATE, field: "splitDate" };
  }
  const exdates = new Set(series.exdates);

  const rawBefore = startsBefore(series.timing, rrule, day);
  const before = rawBefore.filter((start) => !exdates.has(start));
  const dayStart = series.timing.kind === "timed" ? `${day}T00:00` : day;
  if (firstStartOnOrAfter(series.timing, rrule, dayStart) === null) {
    return {
      kind: "refused",
      message: `This Series has no dates on or after ${shortDate(day)}. Pick an earlier date.`,
    };
  }

  const keptExdates = series.exdates.filter((start) => dateOf(start) < day);
  const laterOverrides = overrides.filter((o) => dateOf(o.originalStart) >= day);

  if (input.mode === "stop") {
    if (before.length === 0) {
      return { kind: "refused", message: "No dates would be left. Use Delete to remove the whole Event." };
    }
    return {
      kind: "stop",
      old: { rrule: ruleEndingBefore(rrule, day), exdates: keptExdates },
      removedOverrides: laterOverrides.map((o) => o.originalStart).sort(),
    };
  }

  // The first date of the new Series is never a skipped date. (A stop needs no such date: it may
  // end a Series whose later dates are all skipped.)
  const following = firstKeptStart(ruled, dayStart);
  if (following === null) {
    return {
      kind: "refused",
      message: `Every date on or after ${shortDate(day)} is skipped. Pick an earlier date.`,
    };
  }

  // The new rule and its first time slot.
  const inPlace = before.length === 0;
  let nextRule: string;
  let anchor: LocalDate;
  if (input.rule.kind === "same") {
    // The first old date on or after the split date, so an every-2-weeks Series keeps its weeks.
    anchor = dateOf(following);
    const parts = withoutEnd(rrule);
    const until = endPart(rrule, "UNTIL");
    const count = endPart(rrule, "COUNT");
    if (until !== undefined) {
      // The whole last old date, also when the new time is later than the old end time.
      const last = lastStartDate(series.timing, rrule);
      parts.push(last ? `UNTIL=${last.replace(/-/g, "")}T235959` : `UNTIL=${until}`);
    }
    if (count !== undefined) {
      parts.push(`COUNT=${Number(count) - startsBefore(series.timing, rrule, anchor).length}`);
    }
    nextRule = parts.join(";");
  } else {
    nextRule = input.rule.rrule;
    // In place, the Event keeps no date before its own first date (a continued Event must not
    // run over its predecessor).
    const ownFirst = dateOf(timingStart(series.timing));
    anchor = inPlace && ownFirst > day ? ownFirst : day;
  }
  const anchored = anchorTiming(anchor, input.time);
  let first: OriginalStart | null;
  try {
    first = firstStartOnOrAfter(anchored, nextRule, timingStart(anchored));
  } catch (error) {
    return { kind: "refused", message: message(error), field: "rule" };
  }
  if (first === null) {
    return {
      kind: "refused",
      message: `The new repeat has no dates on or after ${shortDate(day)}.`,
      field: "rule",
    };
  }
  const nextTiming = shiftTiming(anchored, first);

  const overlap = checkBounds(nextTiming, nextRule, bounds);
  if (overlap) return { kind: "refused", message: overlap, field: "rule" };

  // In place, every Override and skipped date is keyed again; in a split, those from the date on.
  const movingOverrides = inPlace ? overrides : laterOverrides;
  const movingExdates = inPlace ? series.exdates : series.exdates.filter((s) => dateOf(s) >= day);
  const newKey = (start: OriginalStart) => startsOn(nextTiming, nextRule, dateOf(start))[0];
  const kindChanged = nextTiming.kind !== series.timing.kind;

  const moved: MovedOverride[] = [];
  const removedOverrides: OriginalStart[] = [];
  const usedKeys = new Set<OriginalStart>();
  for (const o of [...movingOverrides].sort((a, b) => a.originalStart.localeCompare(b.originalStart))) {
    // Only an Override of a real old date moves; one key takes one Override.
    const to = isRuleStart(series.timing, rrule, o.originalStart) ? newKey(o.originalStart) : undefined;
    const dropTiming = kindChanged && o.timing !== undefined;
    if (to === undefined || usedKeys.has(to) || (dropTiming && !hasMoreThanTiming(o))) {
      removedOverrides.push(o.originalStart);
      continue;
    }
    usedKeys.add(to);
    moved.push(dropTiming ? { from: o.originalStart, to, dropTiming: true } : { from: o.originalStart, to });
  }
  const next: NextSeries = {
    timing: nextTiming,
    rrule: nextRule,
    exdates: [...new Set(movingExdates.map(newKey).filter((s): s is string => s !== undefined))].sort(),
  };

  removedOverrides.sort();
  if (inPlace) return { kind: "in-place", splitDate: day, next, moved, removedOverrides };
  return {
    kind: "split",
    splitDate: day,
    old: { rrule: ruleEndingBefore(rrule, day), exdates: keptExdates },
    next,
    moved,
    removedOverrides,
  };
}

/** A message if the new Series would run over a neighbor in the chain, else null. */
function checkBounds(timing: Timing, rrule: string, bounds: SplitBounds): string | null {
  const firstDate = dateOf(timingStart(timing));
  const { predecessorLastDate: last, successorFirstDate: next } = bounds;
  if (last && firstDate <= last) {
    return `This would overlap the earlier part of this Series (to ${shortDate(last)}). Start it after ${shortDate(last)}.`;
  }
  if (next) {
    const from = timing.kind === "timed" ? `${next}T00:00` : next;
    if (firstStartOnOrAfter(timing, rrule, from) !== null) {
      return `This would overlap the later part of this Series (from ${shortDate(next)}). End it before ${shortDate(next)}.`;
    }
  }
  return null;
}

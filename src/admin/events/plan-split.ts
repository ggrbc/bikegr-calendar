/**
 * The Series split plan (ADR 0001): what "This date and later" does to a Series, before any write.
 * Pure; the form uses it for the summary and the server uses it for the write. Plan:
 * docs/plans/admin-event-editing.md ("Series split").
 */
import { shortDate } from "@/agenda/dates";
import {
  addDays,
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
}

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
  | { kind: "refused"; message: string; field?: "rule" };

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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function planSplit(series: SplitSeries, overrides: OverrideInput[], input: SplitInput): SplitPlan {
  const { rrule } = series;
  if (rrule === null) return { kind: "refused", message: "This Event does not repeat." };
  const day = input.splitDate;
  const exdates = new Set(series.exdates);

  const rawBefore = startsBefore(series.timing, rrule, day);
  const before = rawBefore.filter((start) => !exdates.has(start));
  const dayStart = series.timing.kind === "timed" ? `${day}T00:00` : day;
  const following = firstStartOnOrAfter(series.timing, rrule, dayStart);
  if (following === null) {
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

  // The new rule and its first time slot.
  let nextRule: string;
  let anchor: LocalDate;
  if (input.rule.kind === "same") {
    const parts = withoutEnd(rrule);
    const until = endPart(rrule, "UNTIL");
    const count = endPart(rrule, "COUNT");
    if (until !== undefined) parts.push(`UNTIL=${until}`);
    if (count !== undefined) parts.push(`COUNT=${Number(count) - rawBefore.length}`);
    nextRule = parts.join(";");
    // The first old date on or after the split date, so an every-2-weeks Series keeps its weeks.
    anchor = dateOf(following);
  } else {
    nextRule = input.rule.rrule;
    anchor = day;
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

  // In place, every Override and skipped date is keyed again; in a split, those from the date on.
  const inPlace = before.length === 0;
  const movingOverrides = inPlace ? overrides : laterOverrides;
  const movingExdates = inPlace ? series.exdates : series.exdates.filter((s) => dateOf(s) >= day);
  const newKey = (start: OriginalStart) => startsOn(nextTiming, nextRule, dateOf(start))[0];

  const moved: MovedOverride[] = [];
  const removedOverrides: OriginalStart[] = [];
  for (const o of [...movingOverrides].sort((a, b) => a.originalStart.localeCompare(b.originalStart))) {
    const to = newKey(o.originalStart);
    if (to === undefined) removedOverrides.push(o.originalStart);
    else moved.push({ from: o.originalStart, to });
  }
  const next: NextSeries = {
    timing: nextTiming,
    rrule: nextRule,
    exdates: [...new Set(movingExdates.map(newKey).filter((s): s is string => s !== undefined))].sort(),
  };

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

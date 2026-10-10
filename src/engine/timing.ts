/** Helpers for one {@link Timing}: start, shift, compare, and window test. Wall-clock only. */
import type { OriginalStart, QueryWindow, Timing } from "./types";
import {
  addDays,
  addMinutes,
  daysBetween,
  isLocalDate,
  isLocalDateTime,
  minutesBetween,
  toFloating,
} from "./wall-clock";

/** Throws a clear error if `value` is not a real `LocalDate`. `label` names the input. */
export function checkLocalDate(value: string, label: string): void {
  if (!isLocalDate(value) || !isRealDate(value)) {
    throw new Error(`Bad ${label} "${value}": not a local date (YYYY-MM-DD)`);
  }
}

/**
 * Throws a clear error if the time slot is not well formed: wall-clock values of the right kind,
 * real dates, and an end that is not before the start.
 */
export function checkTiming(timing: Timing, label: string): void {
  const [start, end] =
    timing.kind === "timed" ? [timing.start, timing.end] : [timing.startDate, timing.endDate];
  const rightForm = timing.kind === "timed" ? isLocalDateTime : isLocalDate;
  const form =
    timing.kind === "timed" ? "wall-clock date-time (YYYY-MM-DDTHH:mm)" : "date (YYYY-MM-DD)";
  for (const value of [start, end]) {
    if (!rightForm(value) || !isRealDate(value)) {
      throw new Error(`Bad ${label}: "${value}" is not a ${form}`);
    }
  }
  if (end < start) throw new Error(`Bad ${label}: it ends before it starts (${start} to ${end})`);
}

function isRealDate(value: string): boolean {
  try {
    toFloating(value);
    return true;
  } catch {
    return false;
  }
}

/** The start of a time slot: a `LocalDateTime` (timed) or a `LocalDate` (all-day). */
export function timingStart(timing: Timing): OriginalStart {
  return timing.kind === "timed" ? timing.start : timing.startDate;
}

/**
 * Length of a time slot: wall-clock minutes (timed) or days from start date to end date (all-day,
 * 0 for a one-day Event).
 */
export function timingLength(timing: Timing): number {
  return timing.kind === "timed"
    ? minutesBetween(timing.start, timing.end)
    : daysBetween(timing.startDate, timing.endDate);
}

/** The same time slot, moved to start at `start`, with the same wall-clock length. */
export function shiftTiming(timing: Timing, start: OriginalStart): Timing {
  const length = timingLength(timing);
  return timing.kind === "timed"
    ? { kind: "timed", start, end: addMinutes(start, length) }
    : { kind: "allDay", startDate: start, endDate: addDays(start, length) };
}

export function sameTiming(a: Timing, b: Timing): boolean {
  if (a.kind === "timed" && b.kind === "timed") {
    return a.start === b.start && a.end === b.end;
  }
  if (a.kind === "allDay" && b.kind === "allDay") {
    return a.startDate === b.startDate && a.endDate === b.endDate;
  }
  return false;
}

/**
 * True if the time slot touches the half-open window `[from, to)`.
 *
 * - Timed: it starts before `to 00:00` and ends after `from 00:00`. A zero-length slot touches the
 *   window if its start is in the window.
 * - All-day: `startDate < to` and `endDate >= from` (`endDate` is inclusive).
 *
 * Fixed-width `YYYY-MM-DD[THH:mm]` strings compare correctly as text.
 */
export function touchesWindow(timing: Timing, window: QueryWindow): boolean {
  if (timing.kind === "allDay") {
    return timing.startDate < window.to && timing.endDate >= window.from;
  }
  const windowStart = `${window.from}T00:00`;
  const windowEnd = `${window.to}T00:00`;
  return timing.start < windowEnd && (timing.end > windowStart || timing.start >= windowStart);
}

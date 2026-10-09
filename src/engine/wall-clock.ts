/**
 * Wall-clock time helpers.
 *
 * The engine does all date arithmetic in wall-clock time and never adds a zone offset. It holds a
 * wall-clock value in a "floating" `Date`: a `Date` whose UTC fields are the wall-clock fields. For
 * example, 6:00 pm on 2026-11-03 in Detroit is held as `2026-11-03T18:00:00Z`. Because nothing
 * converts it, DST changes cannot move it.
 *
 * Only {@link utcToWallClock} knows about {@link TIME_ZONE}. It is for data that arrives in UTC.
 */
import { TIME_ZONE, type LocalDate, type LocalDateTime } from "./types";

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export function isLocalDate(value: string): value is LocalDate {
  return LOCAL_DATE.test(value);
}

export function isLocalDateTime(value: string): value is LocalDateTime {
  return LOCAL_DATE_TIME.test(value);
}

/** Reads a `LocalDate` or `LocalDateTime` into a floating `Date`. */
export function toFloating(value: LocalDate | LocalDateTime): Date {
  const match = LOCAL_DATE_TIME.exec(value) ?? LOCAL_DATE.exec(value);
  if (!match) {
    throw new Error(`Not a wall-clock date or date-time: "${value}"`);
  }
  const [, year, month, day, hour = "0", minute = "0"] = match;
  const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute));
  // Reject values such as 2026-02-30 that Date.UTC silently rolls over.
  if (date.getUTCDate() !== +day || date.getUTCMonth() !== +month - 1) {
    throw new Error(`Not a wall-clock date or date-time: "${value}"`);
  }
  return date;
}

/** Writes a floating `Date` as a `LocalDateTime`. */
export function fromFloating(date: Date): LocalDateTime {
  return date.toISOString().slice(0, 16);
}

/** Writes a floating `Date` as a `LocalDate`. */
export function fromFloatingDate(date: Date): LocalDate {
  return date.toISOString().slice(0, 10);
}

export function addMinutes(value: LocalDateTime, minutes: number): LocalDateTime {
  return fromFloating(new Date(toFloating(value).getTime() + minutes * MINUTE_MS));
}

export function addDays(value: LocalDate, days: number): LocalDate {
  return fromFloatingDate(new Date(toFloating(value).getTime() + days * DAY_MS));
}

/** Wall-clock minutes from `from` to `to`. */
export function minutesBetween(from: LocalDateTime, to: LocalDateTime): number {
  return Math.round((toFloating(to).getTime() - toFloating(from).getTime()) / MINUTE_MS);
}

/** Calendar days from `from` to `to`. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toFloating(to).getTime() - toFloating(from).getTime()) / DAY_MS);
}

const detroitFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  // h23 gives 00–23. The default for en-US can give "24" at midnight.
  hourCycle: "h23",
});

/** Converts an instant (a real UTC `Date`) to wall-clock time in {@link TIME_ZONE}. */
export function utcToWallClock(instant: Date): LocalDateTime {
  const parts: Record<string, string> = {};
  for (const part of detroitFormat.formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

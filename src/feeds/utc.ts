/**
 * Wall-clock time in America/Detroit to a real instant, for the Feeds, Add to calendar, and the
 * JSON-LD. The engine stays in wall-clock time (design.md "Feeds"); only these outputs convert.
 *
 * RFC 5545 3.3.5 rule at DST changes:
 * - a time that does not exist (02:30 on the March change day) moves forward by the length of the
 *   gap (03:30 EDT): it is read with the offset from before the change;
 * - a time that occurs twice (01:30 on the November change day) uses the first one (EDT).
 */
import { type LocalDateTime, utcToWallClock } from "@/engine";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The wall-clock fields read as if they were UTC (a "floating" instant). */
function floating(local: LocalDateTime): number {
  const [date, time] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour, minute);
}

/** Detroit's offset from UTC at an instant, in milliseconds (EDT is −4 h). */
function offsetAt(instant: number): number {
  return floating(utcToWallClock(new Date(instant))) - instant;
}

export function wallClockToUtc(local: LocalDateTime): Date {
  const wall = floating(local);
  const before = offsetAt(wall - DAY_MS);
  const after = offsetAt(wall + DAY_MS);
  const candidates = [...new Set([wall - before, wall - after])]
    .filter((instant) => utcToWallClock(new Date(instant)) === local)
    .sort((a, b) => a - b);
  // Two candidates: the time occurs twice, use the first. None: the time is in the gap, so read it
  // with the offset from before the change, which moves it forward by the gap.
  return new Date(candidates[0] ?? wall - before);
}

/** ISO 8601 with the Detroit offset of that instant, e.g. `2026-10-14T18:00:00-04:00`. */
export function isoWithOffset(local: LocalDateTime): string {
  const instant = wallClockToUtc(local).getTime();
  const offsetMinutes = Math.round(offsetAt(instant) / MINUTE_MS);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${utcToWallClock(new Date(instant))}:00${sign}${hh}:${mm}`;
}

/** RFC 5545 UTC date-time: `20261014T220000Z`. */
export function icsUtc(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

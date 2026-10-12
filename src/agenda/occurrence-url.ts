/**
 * The detail URL of one Occurrence: `/events/<eventId>/<start>`. `<start>` is the original start
 * (the Feed UID key) without the colon: `2026-10-14T1800` (timed) or `2026-10-14` (all-day). A
 * rescheduled Occurrence keeps its URL.
 */
import { checkLocalDate, type OriginalStart } from "@/engine";
import { SITE_ORIGIN } from "./site";

const SEGMENT = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2})(\d{2}))?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function startSegment(originalStart: OriginalStart): string {
  return originalStart.replace(":", "");
}

/** The original start of a URL segment, or null if the segment is not well formed. */
export function parseStartSegment(segment: string): OriginalStart | null {
  const match = SEGMENT.exec(segment);
  if (!match) return null;
  const [, date, hour, minute] = match;
  try {
    checkLocalDate(date, "start");
  } catch {
    return null;
  }
  if (hour === undefined) return date;
  if (Number(hour) > 23 || Number(minute) > 59) return null;
  return `${date}T${hour}:${minute}`;
}

export function occurrencePath(eventId: string, originalStart: OriginalStart): string {
  return `/events/${eventId}/${startSegment(originalStart)}`;
}

/** Absolute, on the production origin: the canonical URL. */
export function occurrenceUrl(eventId: string, originalStart: OriginalStart): string {
  return `${SITE_ORIGIN}${occurrencePath(eventId, originalStart)}`;
}

/** The path of the single-Occurrence `.ics` file. */
export function occurrenceIcsPath(eventId: string, originalStart: OriginalStart): string {
  return `${occurrencePath(eventId, originalStart)}/event.ics`;
}

/**
 * Reads `/events/<eventId>/<segment>` or `/events/<eventId>/<segment>/event.ics`. The parts are
 * not checked here; `findOccurrence` does that.
 */
export function parseOccurrencePath(
  pathname: string,
): { eventId: string; segment: string; isIcs: boolean } | null {
  const parts = pathname.split("/").filter((part) => part !== "");
  if (parts[0] !== "events") return null;
  if (parts.length === 3 || (parts.length === 4 && parts[3] === "event.ics")) {
    return { eventId: safeDecode(parts[1]), segment: safeDecode(parts[2]), isIcs: parts.length === 4 };
  }
  return null;
}

/** A bad `%` escape gives the raw text, which then fails the checks (no error). */
function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

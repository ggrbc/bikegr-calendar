/**
 * Reads one Tockify `VEVENT` into a {@link TockifyOccurrence}. Field mapping: design.md, "Tockify
 * import". `URL` (Tockify's own page) and `X-TKF-CUSTOM-PREVIEW` (a cut-off description) are dropped.
 */
import {
  addDays,
  TIME_ZONE,
  utcToWallClock,
  type StoredScheduleStatus,
  type Timing,
} from "@/engine";
import { firstProperty, textValue, type IcsEvent, type IcsProperty } from "./ics";
import type { Cta, TockifyOccurrence } from "./types";

/** `TKF/<calendarId>/<eventId>/<startMinutes>/0/0` */
const TOCKIFY_UID = /^TKF\/[^/]+\/([^/]+)\/(\d+)\/\d+\/\d+$/;
const ICS_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const ICS_DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

/** Schedule status prefixes that Tockify adds to `SUMMARY`, in lower case. */
const STATUS_PREFIXES: Record<string, StoredScheduleStatus> = {
  cancelled: "cancelled",
  canceled: "cancelled",
  "provisional (date to be confirmed)": "tentative",
};
const PREFIX = /^\*\*([^*]+)\*\*\s*/;

export function toTockifyOccurrence(event: IcsEvent): TockifyOccurrence {
  const uid = firstProperty(event, "UID")?.value ?? "";
  const uidMatch = TOCKIFY_UID.exec(uid);
  if (!uidMatch) throw new Error(`Not a Tockify UID: "${uid}"`);

  const { title, prefixStatus, unknownPrefix } = splitSummary(text(event, "SUMMARY") ?? "");
  const icsStatus = firstProperty(event, "STATUS")?.value.toUpperCase();

  return {
    tockifyEventId: uidMatch[1],
    startMinutes: Number(uidMatch[2]),
    timing: readTiming(event, uid),
    scheduleStatus:
      prefixStatus ??
      (icsStatus === "CANCELLED" ? "cancelled" : icsStatus === "TENTATIVE" ? "tentative" : "scheduled"),
    title,
    description: text(event, "DESCRIPTION") ?? "",
    location: text(event, "LOCATION") || null,
    categories: readCategories(event),
    imageUrl: firstProperty(event, "X-TKF-FEATURED-IMAGE")?.value.trim() || null,
    cta: readCta(firstProperty(event, "X-TKF-PROMOTION-BUTTON")),
    unknownTitlePrefix: unknownPrefix,
  };
}

function text(event: IcsEvent, name: string): string | undefined {
  const property = firstProperty(event, name);
  return property ? textValue(property.value).trim() : undefined;
}

/** Removes a known Schedule status prefix (any case). An unknown prefix stays in the title. */
function splitSummary(summary: string): {
  title: string;
  prefixStatus?: StoredScheduleStatus;
  unknownPrefix: string | null;
} {
  const match = PREFIX.exec(summary);
  if (!match) return { title: summary, unknownPrefix: null };
  const prefixStatus = STATUS_PREFIXES[match[1].trim().toLowerCase()];
  if (!prefixStatus) return { title: summary, unknownPrefix: match[0].trim() };
  return { title: summary.slice(match[0].length).trim(), prefixStatus, unknownPrefix: null };
}

function readTiming(event: IcsEvent, uid: string): Timing {
  const start = firstProperty(event, "DTSTART");
  if (!start) throw new Error(`No DTSTART in ${uid}`);
  const end = firstProperty(event, "DTEND") ?? start;

  if (start.params.value?.toUpperCase() === "DATE") {
    const startDate = readDate(start, uid);
    // ICS DTEND is exclusive for dates; our endDate is inclusive.
    const endDate = end === start ? startDate : addDays(readDate(end, uid), -1);
    return { kind: "allDay", startDate, endDate: endDate < startDate ? startDate : endDate };
  }
  return { kind: "timed", start: readDateTime(start, uid), end: readDateTime(end, uid) };
}

function readDate(property: IcsProperty, uid: string): string {
  const match = ICS_DATE.exec(property.value);
  if (!match) throw new Error(`Bad ${property.name} date "${property.value}" in ${uid}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** UTC (`…Z`) is converted to Detroit wall-clock. Floating or Detroit `TZID` is wall-clock already. */
function readDateTime(property: IcsProperty, uid: string): string {
  const match = ICS_DATE_TIME.exec(property.value);
  if (!match) throw new Error(`Bad ${property.name} "${property.value}" in ${uid}`);
  const [, year, month, day, hour, minute, second, utc] = match;
  if (utc) {
    return utcToWallClock(new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`));
  }
  const tzid = property.params.tzid;
  if (tzid && tzid !== TIME_ZONE) {
    throw new Error(`Time zone ${tzid} is not supported (${property.name} in ${uid})`);
  }
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function readCategories(event: IcsEvent): string[] {
  return event.properties
    .filter((property) => property.name === "CATEGORIES")
    .flatMap((property) => property.value.split(/(?<!\\),/))
    .map((category) => textValue(category).trim())
    .filter((category) => category !== "");
}

function readCta(property: IcsProperty | undefined): Cta | null {
  const label = property?.params.label?.trim();
  const url = property?.value.trim();
  return label && url ? { label, url } : null;
}

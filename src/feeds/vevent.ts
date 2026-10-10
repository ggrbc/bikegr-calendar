/**
 * One Occurrence as an ICS `VEVENT`, and a whole `VCALENDAR` file. Used by the Feeds and by
 * "Add to calendar" (the same UID in both, so a subscriber who also downloads one gets no copy).
 *
 * Times are UTC (`…Z`), not `TZID` + `VTIMEZONE`: each `VEVENT` is one Occurrence with no `RRULE`, so
 * no local-time repeats are needed, and UTC works the same in every client.
 */
import { badgeText } from "@/agenda/agenda-days";
import type { AgendaRow } from "@/agenda/occurrence-rows";
import { occurrenceUrl } from "@/agenda/occurrence-url";
import { UID_DOMAIN } from "@/agenda/site";
import { addDays, type ScheduleStatus, TIME_ZONE } from "@/engine";
import { contentLine, escapeText, icsFile } from "./ics-text";
import { icsUtc, wallClockToUtc } from "./utc";

/** design.md "Event model": Schedule status to ICS `STATUS`. `postponed` is `CANCELLED`: it does
 * not happen at the listed time; when the Editor sets the new date, the same UID comes back. */
export const ICS_STATUS: Record<ScheduleStatus, string> = {
  scheduled: "CONFIRMED",
  tentative: "TENTATIVE",
  cancelled: "CANCELLED",
  postponed: "CANCELLED",
  rescheduled: "CONFIRMED",
};

const SUMMARY_PREFIX: Partial<Record<ScheduleStatus, string>> = {
  cancelled: "[Cancelled] ",
  postponed: "[Postponed] ",
  tentative: "[Date to be confirmed] ",
};

export function occurrenceUid(row: Pick<AgendaRow, "eventId" | "originalStart">): string {
  return `${row.eventId}-${row.originalStart}@${UID_DOMAIN}`;
}

/** `20261014` from `2026-10-14`. */
const icsDate = (date: string) => date.replace(/-/g, "");

/** The `DTSTART` and `DTEND` lines (no `DTEND` for a zero-length Occurrence). */
function timeLines(row: AgendaRow): string[] {
  const { timing } = row;
  if (timing.kind === "allDay") {
    return [
      contentLine("DTSTART", icsDate(timing.startDate), { VALUE: "DATE" }),
      // DTEND of a date is exclusive: the day after the last day.
      contentLine("DTEND", icsDate(addDays(timing.endDate, 1)), { VALUE: "DATE" }),
    ];
  }
  const lines = [contentLine("DTSTART", icsUtc(wallClockToUtc(timing.start)))];
  if (timing.end !== timing.start) lines.push(contentLine("DTEND", icsUtc(wallClockToUtc(timing.end))));
  return lines;
}

/** Plain text: badge and Schedule note, the description, the CTA, and the detail page URL. */
export function occurrenceDetails(row: AgendaRow): string {
  const badge = badgeText(row);
  const status = [badge, row.scheduleNote].filter((part) => part).join(" — ");
  return [
    status,
    row.description.trim(),
    row.cta ? `${row.cta.label}: ${row.cta.url}` : "",
    occurrenceUrl(row.eventId, row.originalStart),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

export function occurrenceSummary(row: AgendaRow): string {
  return `${SUMMARY_PREFIX[row.scheduleStatus] ?? ""}${row.title}`;
}

export function occurrenceToVevent(row: AgendaRow, now: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    contentLine("UID", escapeText(occurrenceUid(row))),
    contentLine("DTSTAMP", icsUtc(now)),
    contentLine("LAST-MODIFIED", icsUtc(new Date(row.lastModified))),
    ...timeLines(row),
    contentLine("SUMMARY", escapeText(occurrenceSummary(row))),
    contentLine("STATUS", ICS_STATUS[row.scheduleStatus]),
    contentLine("DESCRIPTION", escapeText(occurrenceDetails(row))),
  ];
  if (row.location) lines.push(contentLine("LOCATION", escapeText(row.location)));
  if (row.tags.length > 0) {
    lines.push(contentLine("CATEGORIES", row.tags.map((tag) => escapeText(tag.name)).join(",")));
  }
  lines.push(contentLine("URL", occurrenceUrl(row.eventId, row.originalStart)), "END:VEVENT");
  return lines;
}

/** A whole `VCALENDAR` with one `VEVENT` per row. */
export function buildCalendarFile({ name, rows, now }: { name: string; rows: AgendaRow[]; now: Date }) {
  return icsFile([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bike GR//Bike GR Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    contentLine("X-WR-CALNAME", escapeText(name)),
    contentLine("X-WR-TIMEZONE", TIME_ZONE),
    contentLine("REFRESH-INTERVAL", "PT6H", { VALUE: "DURATION" }),
    "X-PUBLISHED-TTL:PT6H",
    ...rows.flatMap((row) => occurrenceToVevent(row, now)),
    "END:VCALENDAR",
  ]);
}

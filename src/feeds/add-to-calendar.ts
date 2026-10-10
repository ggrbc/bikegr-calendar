/**
 * "Add to calendar" for the one Occurrence that the rider clicked: Google Calendar and Outlook.com
 * links, and a single-`VEVENT` `.ics` file (the same UID as the Feeds).
 */
import type { AgendaRow } from "@/agenda/occurrence-rows";
import { addDays, TIME_ZONE } from "@/engine";
import { icsUtc, wallClockToUtc } from "./utc";
import { buildCalendarFile, occurrenceDetails, occurrenceSummary } from "./vevent";

const compactDate = (date: string) => date.replace(/-/g, "");

export function googleCalendarUrl(row: AgendaRow): string {
  const { timing } = row;
  const dates =
    timing.kind === "allDay"
      ? `${compactDate(timing.startDate)}/${compactDate(addDays(timing.endDate, 1))}`
      : `${icsUtc(wallClockToUtc(timing.start))}/${icsUtc(wallClockToUtc(timing.end))}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: occurrenceSummary(row),
    dates,
    details: occurrenceDetails(row),
    ctz: TIME_ZONE,
  });
  if (row.location) params.set("location", row.location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function outlookUrl(row: AgendaRow): string {
  const { timing } = row;
  const iso = (local: string) => wallClockToUtc(local).toISOString().replace(/\.\d{3}Z$/, "Z");
  const [startdt, enddt, allday] =
    timing.kind === "allDay"
      ? [timing.startDate, addDays(timing.endDate, 1), "true"]
      : [iso(timing.start), iso(timing.end), "false"];
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: occurrenceSummary(row),
    startdt,
    enddt,
    allday,
    body: occurrenceDetails(row),
  });
  if (row.location) params.set("location", row.location);
  return `https://outlook.live.com/calendar/0/action/compose?${params}`;
}

export function singleOccurrenceIcs(row: AgendaRow, now: Date): string {
  return buildCalendarFile({ name: row.title, rows: [row], now });
}

/** A file name from the title: `tuesday-night-ride.ics`. */
export function icsFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || "event"}.ics`;
}

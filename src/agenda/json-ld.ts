/**
 * schema.org `Event` JSON-LD for the detail page, so search engines index Events on the calendar's
 * own domain (design.md "Public side"). Times have the Detroit offset of that instant.
 */
import { isoWithOffset } from "@/feeds/utc";
import { type ScheduleStatus, type Timing } from "@/engine";
import type { AgendaRow } from "./occurrence-rows";
import { ORGANIZER } from "./site";

/** design.md "Event model" table. */
export const EVENT_STATUS: Record<ScheduleStatus, string> = {
  scheduled: "https://schema.org/EventScheduled",
  tentative: "https://schema.org/EventScheduled",
  cancelled: "https://schema.org/EventCancelled",
  postponed: "https://schema.org/EventPostponed",
  rescheduled: "https://schema.org/EventRescheduled",
};

const DESCRIPTION_LENGTH = 500;

function start(timing: Timing): string {
  return timing.kind === "allDay" ? timing.startDate : isoWithOffset(timing.start);
}

function end(timing: Timing): string | undefined {
  if (timing.kind === "allDay") return timing.endDate;
  return timing.end === timing.start ? undefined : isoWithOffset(timing.end);
}

export function eventJsonLd(row: AgendaRow, url: string): Record<string, unknown> {
  const description = row.description.trim();
  const json: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: row.title,
    startDate: start(row.timing),
    endDate: end(row.timing),
    eventStatus: EVENT_STATUS[row.scheduleStatus],
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url,
    organizer: { "@type": "Organization", ...ORGANIZER },
  };
  if (description) {
    json.description =
      description.length > DESCRIPTION_LENGTH
        ? `${description.slice(0, DESCRIPTION_LENGTH - 1).trimEnd()}…`
        : description;
  }
  if (row.scheduleStatus === "rescheduled") json.previousStartDate = start(row.originalTiming);
  if (row.location) json.location = { "@type": "Place", name: row.location, address: row.location };
  if (row.imageUrl) json.image = [row.imageUrl];
  if (json.endDate === undefined) delete json.endDate;
  return json;
}

/**
 * The text for a `<script type="application/ld+json">`. `<` is written as `<`, so a title such as
 * `</script>` cannot close the tag (Next.js JSON-LD guide).
 */
export function jsonLdText(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

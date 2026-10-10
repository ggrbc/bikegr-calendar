/** Fixed public names and addresses of the calendar site. */
import type { CalendarSlug } from "@/engine";

/**
 * The production origin. Canonical URLs, Feed links, and JSON-LD always use it (also on preview
 * deploys), so search engines and subscribers only ever see the real site.
 */
export const SITE_ORIGIN = "https://calendar.bikegr.org";

/** The domain part of every Feed UID: `<eventId>-<originalStart>@calendar.bikegr.org`. */
export const UID_DOMAIN = "calendar.bikegr.org";

export const CALENDAR_NAMES: Record<CalendarSlug, string> = {
  rides: "Rides & Events",
  advocacy: "Advocacy",
};

export const ALL_NAME = "All events";

export const ORGANIZER = {
  name: "Greater Grand Rapids Bicycle Coalition",
  url: "https://www.bikegr.org",
};

/** `/rides`, `/advocacy`, or `/` for All. */
export function calendarPath(calendar: CalendarSlug | null): string {
  return calendar ? `/${calendar}` : "/";
}

export function calendarName(calendar: CalendarSlug | null): string {
  return calendar ? CALENDAR_NAMES[calendar] : ALL_NAME;
}

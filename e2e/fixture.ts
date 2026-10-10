/**
 * Known data for the Playwright smoke tests. Dates are relative to "today" in Detroit, so the data
 * is always in the agenda window. Fixed ids, so the tests can build detail URLs.
 */
import { addDays, dayOfWeek, type LocalDate } from "@/engine";

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://bikegr:bikegr@localhost:55432/bikegr";
export const APP_PORT = 3100;
export const HOST_PORT = 4100;
export const APP = `http://localhost:${APP_PORT}`;
export const HOST = `http://localhost:${HOST_PORT}`;

export const IDS = {
  tuesday: "10000000-0000-4000-8000-000000000001",
  thursday: "10000000-0000-4000-8000-000000000002",
  meeting: "10000000-0000-4000-8000-000000000003",
  deleted: "10000000-0000-4000-8000-000000000004",
  pending: "10000000-0000-4000-8000-000000000005",
};

/** The first date on or after `from` with the weekday `day` (0 = Sunday). */
export function nextWeekday(from: LocalDate, day: number): LocalDate {
  return addDays(from, (day - dayOfWeek(from) + 7) % 7);
}

export function fixtureDates(today: LocalDate) {
  return {
    firstTuesday: nextWeekday(today, 2),
    firstThursday: nextWeekday(today, 4),
    meeting: addDays(today, 3),
    deleted: addDays(today, 2),
  };
}

/** `2026-10-14T1800`, the detail URL form. */
export const segment = (date: LocalDate, time = "1800") => `${date}T${time}`;

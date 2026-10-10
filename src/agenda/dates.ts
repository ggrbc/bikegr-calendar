/**
 * Dates for the agenda and the import CLI. Only these functions read a real instant; everything
 * after them is wall-clock arithmetic in America/Detroit.
 */
import { addDays, type LocalDate, type QueryWindow, utcToWallClock } from "@/engine";

/** How far ahead the plain agenda looks. */
export const AGENDA_WEEKS = 8;

/** Today's date in America/Detroit at the instant `now`. */
export function todayInDetroit(now: Date): LocalDate {
  return utcToWallClock(now).slice(0, 10);
}

/** `[today, today + 8 weeks)`. */
export function agendaWindow(today: LocalDate): QueryWindow {
  return { from: today, to: addDays(today, AGENDA_WEEKS * 7) };
}

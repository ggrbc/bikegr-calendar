/**
 * Dates for the agenda and the import CLI. Only these functions read a real instant; everything
 * after them is wall-clock arithmetic in America/Detroit.
 */
import {
  addDays,
  dayOfWeek,
  type LocalDate,
  type LocalDateTime,
  type QueryWindow,
  type Timing,
  utcToWallClock,
} from "@/engine";

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

// ---------------------------------------------------------------------------------------------
// Text. Wall-clock strings are formatted by hand: no time-zone conversion, the same output on the
// server and in tests whatever the machine's zone.

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function dateParts(date: LocalDate) {
  return {
    weekday: WEEKDAYS[dayOfWeek(date)],
    month: MONTHS[Number(date.slice(5, 7)) - 1],
    day: Number(date.slice(8, 10)),
  };
}

/** "Wednesday, October 14". */
export function dayHeading(date: LocalDate): string {
  const { weekday, month, day } = dateParts(date);
  return `${weekday}, ${month} ${day}`;
}

/** "Wed, Oct 14". */
export function shortDate(date: LocalDate): string {
  const { weekday, month, day } = dateParts(date);
  return `${weekday.slice(0, 3)}, ${month.slice(0, 3)} ${day}`;
}

/** "6:00 pm" from "…T18:00". */
export function clockTime(value: LocalDateTime): string {
  const hours = Number(value.slice(11, 13));
  const minutes = value.slice(14, 16);
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "am" : "pm"}`;
}

/** The start of a slot, short: "Wed, Oct 14, 6:00 pm", or "Wed, Oct 14" for an all-day slot. */
export function shortSlot(timing: Timing): string {
  return timing.kind === "allDay"
    ? shortDate(timing.startDate)
    : `${shortDate(timing.start.slice(0, 10))}, ${clockTime(timing.start)}`;
}

/** "6:00 pm – 9:00 pm", "7:00 am" (no length), "All day", or a range with the last day. */
export function timeText(timing: Timing): string {
  if (timing.kind === "allDay") {
    return timing.endDate === timing.startDate
      ? "All day"
      : `All day, through ${dayHeading(timing.endDate)}`;
  }
  if (timing.end === timing.start) return clockTime(timing.start);
  const endDate = timing.end.slice(0, 10);
  const end =
    endDate === timing.start.slice(0, 10)
      ? clockTime(timing.end)
      : `${shortDate(endDate)}, ${clockTime(timing.end)}`;
  return `${clockTime(timing.start)} – ${end}`;
}

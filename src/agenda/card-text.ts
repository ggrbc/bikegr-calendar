/**
 * Text for the agenda cards and the detail page, in the style of Bike GR's Tockify calendar
 * ("Sat Oct 10th 8:00am", "Mon Oct 12th 6:20pm - 9:00pm"). Wall-clock strings, formatted by hand:
 * the same output on the server and in tests, whatever the machine's zone.
 */
import { dayOfWeek, type LocalDate, type LocalDateTime, type Timing } from "@/engine";
import type { AgendaTag } from "./snapshot";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

/** "Oct 10th". */
export function monthDay(date: LocalDate): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${ordinal(Number(date.slice(8, 10)))}`;
}

/** "Sat Oct 10th". */
export function cardDate(date: LocalDate): string {
  return `${WEEKDAYS[dayOfWeek(date)]} ${monthDay(date)}`;
}

/** "8:00am", "6:20pm". */
export function cardTime(value: LocalDateTime): string {
  const hours = Number(value.slice(11, 13));
  return `${hours % 12 || 12}:${value.slice(14, 16)}${hours < 12 ? "am" : "pm"}`;
}

/** The date line of a card or the detail page. */
export function dateLine(timing: Timing): string {
  if (timing.kind === "allDay") {
    return timing.endDate === timing.startDate
      ? cardDate(timing.startDate)
      : `${cardDate(timing.startDate)} - ${cardDate(timing.endDate)}`;
  }
  const startDate = timing.start.slice(0, 10);
  const start = `${cardDate(startDate)} ${cardTime(timing.start)}`;
  if (timing.end === timing.start) return start;
  const endDate = timing.end.slice(0, 10);
  const end = endDate === startDate ? cardTime(timing.end) : `${cardDate(endDate)} ${cardTime(timing.end)}`;
  return `${start} - ${end}`;
}

/** "Events from Oct 10th". */
export function eventsFromHeading(from: LocalDate): string {
  return `Events from ${monthDay(from)}`;
}

/** The venue: the text before the first comma ("Riverside Park North Trailhead"). */
export function venueName(location: string): string {
  return location.split(",")[0].trim();
}

/** One space after each comma, none before: "A,B , C" → "A, B, C". */
export function normalizeLocation(location: string): string {
  return location
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(", ");
}

/** "Group Ride • Non-Drop". */
export function tagLine(tags: AgendaTag[]): string {
  return tags.map((tag) => tag.name).join(" • ");
}

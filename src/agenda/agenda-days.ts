/**
 * Turns agenda rows into the days of the plain agenda. Pure, so the page has no logic to test.
 *
 * A rescheduled Occurrence is one row, but it shows on both dates (design.md): the full entry on the
 * new date ("Rescheduled from …") and a short entry on the old date ("Rescheduled to …"), each only
 * when its date is in the window. A move to another time on the same day shows once.
 */
import { type LocalDate, type QueryWindow, timingStart, touchesWindow } from "@/engine";
import { dayHeading, shortSlot, timeText } from "./dates";
import type { AgendaRow } from "./load-occurrences";

export interface AgendaEntry {
  /** Stable React key. */
  key: string;
  /** `movedAway`: the short entry on the old date of a rescheduled Occurrence. */
  kind: "occurrence" | "movedAway";
  row: AgendaRow;
  timeText: string;
  badge: string | null;
}

export interface AgendaDay {
  date: LocalDate;
  heading: string;
  entries: AgendaEntry[];
}

const BADGES = {
  tentative: "Date to be confirmed",
  cancelled: "Cancelled",
  postponed: "Postponed",
} as const;

/** The public badge of an Occurrence on its (new) date. `scheduled` has none. */
export function badgeText(row: AgendaRow): string | null {
  if (row.scheduleStatus === "scheduled") return null;
  if (row.scheduleStatus === "rescheduled") return `Rescheduled from ${shortSlot(row.originalTiming)}`;
  return BADGES[row.scheduleStatus];
}

const dateOf = (start: string): LocalDate => start.slice(0, 10);

export function groupAgendaDays(rows: AgendaRow[], window: QueryWindow): AgendaDay[] {
  const placed: { date: LocalDate; sortKey: string; entry: AgendaEntry }[] = [];
  const inWindow = (date: LocalDate) => date >= window.from && date < window.to;

  for (const row of rows) {
    const start = timingStart(row.timing);
    const key = `${row.eventId}/${row.originalStart}`;
    // Only when the actual slot touches the window: a rescheduled Occurrence can be in the rows
    // because of its old slot alone. A multi-day Occurrence that started before the window and is
    // still running shows on the first day.
    if (touchesWindow(row.timing, window)) {
      const date = dateOf(start) < window.from ? window.from : dateOf(start);
      placed.push({
        date,
        sortKey: start,
        entry: { key, kind: "occurrence", row, timeText: timeText(row.timing), badge: badgeText(row) },
      });
    }

    if (row.scheduleStatus === "rescheduled") {
      const originalStart = timingStart(row.originalTiming);
      const oldDate = dateOf(originalStart);
      if (oldDate !== dateOf(start) && inWindow(oldDate)) {
        placed.push({
          date: oldDate,
          sortKey: originalStart,
          entry: {
            key: `${key}/moved`,
            kind: "movedAway",
            row,
            timeText: timeText(row.originalTiming),
            badge: `Rescheduled to ${shortSlot(row.timing)}`,
          },
        });
      }
    }
  }

  placed.sort((a, b) => a.date.localeCompare(b.date) || a.sortKey.localeCompare(b.sortKey));
  const days: AgendaDay[] = [];
  for (const { date, entry } of placed) {
    const last = days.at(-1);
    if (last?.date === date) last.entries.push(entry);
    else days.push({ date, heading: dayHeading(date), entries: [entry] });
  }
  return days;
}

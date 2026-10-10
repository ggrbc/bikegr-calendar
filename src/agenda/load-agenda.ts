/**
 * Loads the agenda days for a set of filters, and turns a database error into a fallback, so the
 * page keeps its heading and shows a short message instead of an error page. The log line has only
 * the error name and code.
 */
import { type AgendaDay, groupAgendaDays } from "./agenda-days";
import { describeError } from "./describe-error";
import { type AgendaFilters, filterWindow, matchesContent } from "./filters";
import { expandSnapshot } from "./occurrence-rows";
import type { CalendarSnapshot, CalendarTag } from "./snapshot";

export type AgendaResult =
  | { ok: true; days: AgendaDay[]; tags: CalendarTag[] }
  | { ok: false };

export async function loadAgenda(
  load: () => Promise<CalendarSnapshot>,
  filters: AgendaFilters,
  log: (line: string) => void = console.error,
): Promise<AgendaResult> {
  // A load error and an engine error (for example a bad stored rule) both give the fallback.
  try {
    const snapshot: CalendarSnapshot = await load();
    const window = filterWindow(filters);
    // Tags and text search here; the Day filter per entry in groupAgendaDays.
    const rows = expandSnapshot(snapshot, window).filter((row) => matchesContent(row, filters));
    return { ok: true, days: groupAgendaDays(rows, window, filters.days), tags: snapshot.tags };
  } catch (error) {
    log(`Agenda could not load: ${describeError(error)}`);
    return { ok: false };
  }
}

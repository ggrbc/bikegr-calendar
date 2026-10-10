/**
 * The agenda query: approved, not-deleted Events of one Calendar (or all), expanded into their
 * Occurrences for a window by the Occurrence engine. Takes the database as an argument, so tests
 * run on PGlite and the app passes `getDb()`.
 */
import type { Db } from "@/db/types";
import type { CalendarSlug, QueryWindow } from "@/engine";
import { type AgendaRow, expandSnapshot } from "./occurrence-rows";
import { loadSnapshot } from "./snapshot";

export type { AgendaRow } from "./occurrence-rows";
export type { AgendaTag } from "./snapshot";

export async function loadOccurrences(
  db: Db,
  window: QueryWindow,
  calendar: CalendarSlug | null,
): Promise<AgendaRow[]> {
  return expandSnapshot(await loadSnapshot(db, calendar), window);
}

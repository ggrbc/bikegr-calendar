/**
 * Edits in place. A Series: "All dates" changes content and skipped dates only (ADR 0001). A
 * one-time Event: every field, and it may become a Series.
 */
import { eventRowToRuleInput, ruleInputToColumns } from "@/db/mappers";
import type { Db } from "@/db/types";
import { contentColumns } from "./create-event";
import { type EventDraft, exdateFromDate, type SeriesContentDraft } from "./event-input";
import {
  type Actor,
  claimVersion,
  invalid,
  moveCalendar,
  readForWrite,
  runWrite,
  setEventTags,
  tagsAfterSave,
  writeHistory,
  type WriteResult,
} from "./write-helpers";

export interface EditTarget {
  id: string;
  version: number;
}

export async function editSeriesContent(
  db: Db,
  actor: Actor,
  target: EditTarget,
  draft: SeriesContentDraft,
): Promise<WriteResult> {
  return runWrite(db, async (tx) => {
    const row = await readForWrite(tx, target.id, target.version);
    if (row.rrule === null) throw invalid({}, "This Event does not repeat.");
    const timing = eventRowToRuleInput(row).timing;
    const tagIds = await tagsAfterSave(tx, row, draft);
    const { calendar, ...content } = contentColumns(draft);
    await claimVersion(tx, {
      ...target,
      actor,
      set: { ...content, exdates: draft.exdateDates.map((date) => exdateFromDate(timing, date)) },
    });
    if (calendar !== row.calendar) await moveCalendar(tx, row.id, calendar);
    await setEventTags(tx, row.id, draft.calendar, tagIds);
    await writeHistory(tx, row.id, "edit", actor);
    return {};
  });
}

export async function editOneTimeEvent(
  db: Db,
  actor: Actor,
  target: EditTarget,
  draft: EventDraft,
): Promise<WriteResult> {
  return runWrite(db, async (tx) => {
    const row = await readForWrite(tx, target.id, target.version);
    if (row.rrule !== null) {
      throw invalid({}, "This Event is a Series. Use All dates or This date and later.");
    }
    const tagIds = await tagsAfterSave(tx, row, draft);
    const { calendar, ...content } = contentColumns(draft);
    await claimVersion(tx, {
      ...target,
      actor,
      set: { ...content, ...ruleInputToColumns({ eventId: row.id, ...draft.rule }) },
    });
    if (calendar !== row.calendar) await moveCalendar(tx, row.id, calendar);
    await setEventTags(tx, row.id, draft.calendar, tagIds);
    await writeHistory(tx, row.id, "edit", actor);
    return {};
  });
}

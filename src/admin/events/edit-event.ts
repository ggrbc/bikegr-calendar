/**
 * Edits in place. A Series: "All dates" changes content and skipped dates only (ADR 0001). A
 * one-time Event: every field, and it may become a Series.
 */
import { and, inArray, isNotNull } from "drizzle-orm";
import { eventRowToRuleInput, ruleInputToColumns } from "@/db/mappers";
import { eventTags, tags, type EventRow } from "@/db/schema";
import type { Db } from "@/db/types";
import { contentColumns } from "./create-event";
import { type ContentDraft, type EventDraft, exdateFromDate, type SeriesContentDraft } from "./event-input";
import {
  type Actor,
  checkTagIds,
  claimVersion,
  invalid,
  readForWrite,
  runWrite,
  setEventTags,
  tagIdsOf,
  type Tx,
  writeHistory,
  type WriteResult,
} from "./write-helpers";

export interface EditTarget {
  id: string;
  version: number;
}

/**
 * The Tag ids to link after a content save. Same Calendar: the form's Tags, plus retired Tags
 * that the Event already has (they are not in the picker). Other Calendar: the form's Tags only
 * (a Calendar change clears the old Tags).
 */
async function tagsAfterSave(tx: Tx, row: EventRow, content: ContentDraft): Promise<string[]> {
  const existing = await tagIdsOf(tx, row.id);
  const sameCalendar = row.calendar === content.calendar;
  await checkTagIds(tx, content.calendar, content.tagIds, sameCalendar ? existing : []);
  if (!sameCalendar) {
    // Before the Calendar update: the composite foreign key refuses a Calendar change with Tags.
    await tx.delete(eventTags).where(inArray(eventTags.eventId, [row.id]));
    return content.tagIds;
  }
  const retired =
    existing.length === 0
      ? []
      : await tx
          .select({ id: tags.id })
          .from(tags)
          .where(and(inArray(tags.id, existing), isNotNull(tags.retiredAt)));
  return [...new Set([...content.tagIds, ...retired.map((t) => t.id)])];
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
    await claimVersion(tx, {
      ...target,
      actor,
      set: {
        ...contentColumns(draft),
        exdates: draft.exdateDates.map((date) => exdateFromDate(timing, date)),
      },
    });
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
    await claimVersion(tx, {
      ...target,
      actor,
      set: { ...contentColumns(draft), ...ruleInputToColumns({ eventId: row.id, ...draft.rule }) },
    });
    await setEventTags(tx, row.id, draft.calendar, tagIds);
    await writeHistory(tx, row.id, "edit", actor);
    return {};
  });
}

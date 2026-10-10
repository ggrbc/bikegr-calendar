/**
 * "This date and later" for a Series: a Series split (ADR 0001), a change in place when no date is
 * left before the split date, or a stop. One transaction. The plan comes from `planSplit`.
 */
import { and, eq, inArray } from "drizzle-orm";
import { eventRowToRuleInput, overrideRowToInput, ruleInputToColumns } from "@/db/mappers";
import { events, type EventRow, overrides, type OverrideRow } from "@/db/schema";
import type { Db } from "@/db/types";
import { contentColumns } from "./create-event";
import type { SplitDraft } from "./event-input";
import { type MovedOverride, type NextSeries, planSplit } from "./plan-split";
import {
  type Actor,
  claimVersion,
  invalid,
  readForWrite,
  runWrite,
  setEventTags,
  tagsAfterSave,
  type Tx,
  writeHistory,
  type WriteResult,
} from "./write-helpers";

export interface SplitOutcome {
  kind: "split" | "in-place" | "stop";
  /** The Event to show after the save: the new Event after a split, else the same Event. */
  id: string;
}

function ruleColumns(row: EventRow, next: NextSeries) {
  return ruleInputToColumns({
    eventId: row.id,
    timing: next.timing,
    rrule: next.rrule,
    exdates: next.exdates,
    scheduleStatus: row.scheduleStatus,
    scheduleNote: row.scheduleNote,
  });
}

/** Inserts the moved Overrides on `eventId` with their new keys. */
async function insertMoved(
  tx: Tx,
  eventId: string,
  rows: OverrideRow[],
  moved: MovedOverride[],
  actor: Actor,
): Promise<void> {
  const byStart = new Map(rows.map((r) => [r.originalStart, r]));
  const values = moved.map(({ from, to }) => ({
    ...byStart.get(from)!,
    eventId,
    originalStart: to,
    updatedBy: actor.id,
    updatedAt: new Date(),
  }));
  if (values.length > 0) await tx.insert(overrides).values(values);
}

async function deleteOverrides(tx: Tx, eventId: string, starts: string[]): Promise<void> {
  if (starts.length === 0) return;
  await tx
    .delete(overrides)
    .where(and(eq(overrides.eventId, eventId), inArray(overrides.originalStart, starts)));
}

export async function splitSeries(
  db: Db,
  actor: Actor,
  target: { id: string; version: number },
  draft: SplitDraft,
): Promise<WriteResult<SplitOutcome>> {
  return runWrite(db, async (tx) => {
    const row = await readForWrite(tx, target.id, target.version);
    const overrideRows = await tx.select().from(overrides).where(eq(overrides.eventId, row.id));
    const { timing } = eventRowToRuleInput(row);
    const plan = planSplit(
      { timing, rrule: row.rrule, exdates: row.exdates },
      overrideRows.map(overrideRowToInput),
      draft,
    );
    if (plan.kind === "refused") {
      throw invalid({ [plan.field ?? "splitDate"]: plan.message }, plan.message);
    }

    if (plan.kind === "stop") {
      await claimVersion(tx, { ...target, actor, set: plan.old });
      await deleteOverrides(tx, row.id, plan.removedOverrides);
      await writeHistory(tx, row.id, "stop-series", actor, {
        splitDate: draft.splitDate,
        removedOverrides: plan.removedOverrides,
      });
      return { kind: "stop" as const, id: row.id };
    }

    // A split keeps the Calendar; the content edits apply to the Series from the date on.
    const content = { ...draft, calendar: row.calendar };
    const tagIds = await tagsAfterSave(tx, row, content);

    if (plan.kind === "in-place") {
      await claimVersion(tx, {
        ...target,
        actor,
        set: { ...contentColumns(content), ...ruleColumns(row, plan.next) },
      });
      await tx.delete(overrides).where(eq(overrides.eventId, row.id));
      await insertMoved(tx, row.id, overrideRows, plan.moved, actor);
      await setEventTags(tx, row.id, row.calendar, tagIds);
      await writeHistory(tx, row.id, "change-time-or-repeat", actor, {
        splitDate: draft.splitDate,
        removedOverrides: plan.removedOverrides,
      });
      return { kind: "in-place" as const, id: row.id };
    }

    await claimVersion(tx, { ...target, actor, set: plan.old });
    await deleteOverrides(tx, row.id, [...plan.moved.map((m) => m.from), ...plan.removedOverrides]);
    const now = new Date();
    const [created] = await tx
      .insert(events)
      .values({
        ...contentColumns(content),
        ...ruleColumns(row, plan.next),
        predecessorId: row.id,
        reviewStatus: row.reviewStatus,
        reviewedBy: row.reviewedBy,
        reviewedAt: row.reviewedAt,
        submitterName: row.submitterName,
        submitterEmail: row.submitterEmail,
        createdBy: actor.id,
        updatedBy: actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: events.id });
    await insertMoved(tx, created.id, overrideRows, plan.moved, actor);
    await setEventTags(tx, created.id, row.calendar, tagIds);
    await writeHistory(tx, row.id, "split", actor, { splitDate: draft.splitDate, successorId: created.id });
    await writeHistory(tx, created.id, "create-from-split", actor, {
      splitDate: draft.splitDate,
      predecessorId: row.id,
      removedOverrides: plan.removedOverrides,
    });
    return { kind: "split" as const, id: created.id };
  });
}

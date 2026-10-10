/**
 * "This date and later" for a Series: a Series split (ADR 0001), a change in place when no date is
 * left before the split date, or a stop. One transaction. The plan comes from `planSplit`.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { eventRowToRuleInput, overrideRowToInput, ruleInputToColumns } from "@/db/mappers";
import { events, type EventRow, overrides, type OverrideRow } from "@/db/schema";
import type { Db } from "@/db/types";
import { contentColumns } from "./create-event";
import type { SplitDraft } from "./event-input";
import type { LocalDate } from "@/engine";
import { boundsFromChain, loadChainMembers, spanOf } from "./chain";
import { type MovedOverride, type NextSeries, planSplit, type SplitBounds } from "./plan-split";
import {
  type Actor,
  claimVersion,
  invalid,
  readForWrite,
  refusePending,
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
  const noTiming = { allDay: null, startLocal: null, endLocal: null, startDate: null, endDate: null };
  const values = moved.map(({ from, to, dropTiming }) => ({
    ...byStart.get(from)!,
    ...(dropTiming ? noTiming : {}),
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

/**
 * The neighbors of an Event in its chain of splits, from every live part of the chain (not only the
 * direct links; a deleted part frees its dates).
 */
export async function loadSplitBounds(db: Pick<Db, "select">, row: EventRow): Promise<SplitBounds> {
  return boundsFromChain(spanOf(eventRowToRuleInput(row)), await loadChainMembers(db, row.id));
}

export async function splitSeries(
  db: Db,
  actor: Actor,
  target: { id: string; version: number },
  draft: SplitDraft,
  { today }: { today: LocalDate },
): Promise<WriteResult<SplitOutcome>> {
  return runWrite(db, async (tx) => {
    const row = await readForWrite(tx, target.id, target.version);
    refusePending(row);
    const overrideRows = await tx.select().from(overrides).where(eq(overrides.eventId, row.id));
    const { timing } = eventRowToRuleInput(row);
    const plan = planSplit(
      { timing, rrule: row.rrule, exdates: row.exdates },
      overrideRows.map(overrideRowToInput),
      draft,
      { ...(await loadSplitBounds(tx, row)), today },
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
    // The chain stays a line: a part that continued the old Event now continues the new one.
    await tx
      .update(events)
      .set({ predecessorId: created.id })
      .where(and(eq(events.predecessorId, row.id), ne(events.id, created.id)));
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

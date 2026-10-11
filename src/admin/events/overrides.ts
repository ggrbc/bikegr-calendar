/**
 * "One date": change or clear the Override of one Occurrence of a Series. A field equal to the
 * Series' value is stored as null ("no change"); when every field is null there is no row. Each
 * write checks and bumps the Event's `version`.
 */
import { and, eq } from "drizzle-orm";
import { eventRowToRuleInput } from "@/db/mappers";
import { type EventRow, overrides } from "@/db/schema";
import type { Db } from "@/db/types";
import { isRuleStart, type OriginalStart, sameTiming, shiftTiming } from "@/engine";
import type { OverrideDraft } from "./event-input";
import {
  type Actor,
  claimVersion,
  invalid,
  readForWrite,
  refusePending,
  runWrite,
  type Tx,
  writeHistory,
  type WriteResult,
} from "./write-helpers";

interface Target {
  id: string;
  version: number;
}

/** Checks that the Event is a Series that makes this original start; gives the original slot. */
export function checkOccurrence(row: EventRow, originalStart: OriginalStart) {
  const rule = eventRowToRuleInput(row);
  if (rule.rrule === null) throw invalid({}, "This Event does not repeat. Change it in the Event form.");
  const makes =
    (rule.timing.kind === "timed") === originalStart.includes("T") &&
    isRuleStart(rule.timing, rule.rrule, originalStart) &&
    !rule.exdates.includes(originalStart);
  if (!makes) throw invalid({ originalStart: "This is not a date of the Series." });
  return shiftTiming(rule.timing, originalStart);
}

async function findOverride(tx: Tx, eventId: string, originalStart: OriginalStart) {
  const [row] = await tx
    .select()
    .from(overrides)
    .where(and(eq(overrides.eventId, eventId), eq(overrides.originalStart, originalStart)));
  return row;
}

/** A value that differs from the Series; `""` stands for "none on this date". */
function changed<T extends string>(value: T | null, seriesValue: T | null): T | "" | null {
  if (value === seriesValue) return null;
  return value ?? "";
}

export async function saveOverride(
  db: Db,
  actor: Actor,
  target: Target,
  draft: OverrideDraft,
): Promise<WriteResult> {
  return runWrite(db, async (tx) => {
    const row = await readForWrite(tx, target.id, target.version);
    refusePending(row);
    const original = checkOccurrence(row, draft.originalStart);
    if (draft.timing.kind !== original.kind) throw invalid({ start: "Keep the same kind of time slot." });

    const moved = !sameTiming(draft.timing, original);
    const values = {
      allDay: moved ? draft.timing.kind === "allDay" : null,
      startLocal: moved && draft.timing.kind === "timed" ? draft.timing.start : null,
      endLocal: moved && draft.timing.kind === "timed" ? draft.timing.end : null,
      startDate: moved && draft.timing.kind === "allDay" ? draft.timing.startDate : null,
      endDate: moved && draft.timing.kind === "allDay" ? draft.timing.endDate : null,
      title: draft.title === row.title ? null : draft.title,
      location: changed(draft.location, row.location),
      scheduleStatus: draft.scheduleStatus === row.scheduleStatus ? null : draft.scheduleStatus,
      scheduleNote: changed(draft.scheduleNote, row.scheduleNote),
      occurrenceDetails: draft.occurrenceDetails,
    };
    const empty = Object.values(values).every((v) => v === null);
    const existing = await findOverride(tx, row.id, draft.originalStart);
    if (empty && !existing) return {};

    await claimVersion(tx, { ...target, actor });
    if (empty) {
      await tx
        .delete(overrides)
        .where(and(eq(overrides.eventId, row.id), eq(overrides.originalStart, draft.originalStart)));
    } else {
      const now = new Date();
      await tx
        .insert(overrides)
        .values({
          eventId: row.id,
          originalStart: draft.originalStart,
          ...values,
          createdBy: actor.id,
          updatedBy: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [overrides.eventId, overrides.originalStart],
          set: { ...values, updatedBy: actor.id, updatedAt: now },
        });
    }
    await writeHistory(tx, row.id, empty ? "clear-override" : "override", actor, {
      originalStart: draft.originalStart,
    });
    return {};
  });
}

export async function clearOverride(
  db: Db,
  actor: Actor,
  target: Target,
  originalStart: OriginalStart,
): Promise<WriteResult> {
  return runWrite(db, async (tx) => {
    const row = await readForWrite(tx, target.id, target.version);
    if (!(await findOverride(tx, row.id, originalStart))) return {};
    await claimVersion(tx, { ...target, actor });
    await tx
      .delete(overrides)
      .where(and(eq(overrides.eventId, row.id), eq(overrides.originalStart, originalStart)));
    await writeHistory(tx, row.id, "clear-override", actor, { originalStart });
    return {};
  });
}

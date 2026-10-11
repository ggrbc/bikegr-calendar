/**
 * An Event manager changes one Occurrence of an Event they manage: Schedule status, Schedule note,
 * and Occurrence details. Nothing else (docs/plans/event-managers.md).
 *
 * The write touches only those three columns: the upsert of an Override never overwrites its time,
 * title, or location, so an Editor's change to the same date stays. The write takes the Event row
 * lock first (the version claim), as the Editor writes do, so two writers of one Event run in turn.
 */
import { and, eq } from "drizzle-orm";
import { eventRowToRuleInput } from "@/db/mappers";
import { editors, eventManagers, type EventRow, events, type OverrideRow, overrides } from "@/db/schema";
import type { Db } from "@/db/types";
import { addDays, type LocalDate, timingStart } from "@/engine";
import { type ManagerOccurrenceDraft, parseManagerOccurrenceInput } from "./event-input";
import { DELETED_MESSAGE } from "./format";
import { NOT_APPROVED_MESSAGE } from "./managers";
import { checkOccurrence } from "./overrides";
import { type Actor, claimVersion, invalid, runWrite, WriteError, type WriteResult, writeHistory } from "./write-helpers";

/** A date that started more than this many days ago is read-only. */
export const EDIT_DAYS_BACK = 7;
/** The furthest date an Event manager can open, in days from today. */
export const EDIT_DAYS_AHEAD = 365;

const NOT_YOURS = "You do not manage this Event.";

/**
 * True when an Occurrence is open to an Event manager: its actual start (after an Editor's
 * reschedule) is no more than 7 days in the past, and its original start (the key) is no more than
 * one year ahead.
 */
export function isEditableOccurrence(originalDate: LocalDate, actualDate: LocalDate, today: LocalDate): boolean {
  return actualDate >= addDays(today, -EDIT_DAYS_BACK) && originalDate <= addDays(today, EDIT_DAYS_AHEAD);
}

const refuse = (message: string) => new WriteError({ ok: false, reason: "not-found", message });

/** Reads the grant, the account, and the Event. Throws a refusal for anything that is not allowed. */
async function checkAccess(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], actor: Actor, eventId: string) {
  if (actor.role !== "event_manager") throw refuse(NOT_YOURS);
  const [person] = await tx.select().from(editors).where(eq(editors.id, actor.id));
  if (!person || person.deactivatedAt || person.role !== "event_manager") throw refuse(NOT_YOURS);
  const [grant] = await tx
    .select()
    .from(eventManagers)
    .where(and(eq(eventManagers.eventId, eventId), eq(eventManagers.editorId, actor.id)));
  if (!grant) throw refuse(NOT_YOURS);
  // Locked: the version below is the current one, so a manager never gets a false conflict.
  const [row] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
  if (!row) throw refuse(NOT_YOURS);
  if (row.deletedAt !== null) throw new WriteError({ ok: false, reason: "deleted", message: DELETED_MESSAGE });
  if (row.reviewStatus !== "approved") throw invalid({}, NOT_APPROVED_MESSAGE);
  return row;
}

function checkDate(
  row: EventRow,
  draft: ManagerOccurrenceDraft,
  today: LocalDate,
  stored: OverrideRow | undefined,
): void {
  const rule = eventRowToRuleInput(row);
  if (rule.rrule === null) {
    if (timingStart(rule.timing) !== draft.originalStart) {
      throw invalid({ originalStart: "This is not a date of the Event." });
    }
  } else {
    checkOccurrence(row, draft.originalStart);
  }
  // The actual start: an Editor may have moved the date.
  const moved = stored?.startLocal ?? stored?.startDate ?? null;
  const actualDate = (moved ?? draft.originalStart).slice(0, 10);
  if (!isEditableOccurrence(draft.originalStart.slice(0, 10), actualDate, today)) {
    throw invalid({ originalStart: "This date is closed. Ask an Editor to change it." }, "This date is closed.");
  }
}

export async function saveManagerOccurrence(
  db: Db,
  actor: Actor,
  input: unknown,
  { today }: { today: LocalDate },
): Promise<WriteResult> {
  const parsed = parseManagerOccurrenceInput(input);
  if (!parsed.ok) return { ok: false, reason: "invalid", message: "Check the marked fields.", errors: parsed.errors };
  const draft = parsed.value;

  return runWrite(db, async (tx) => {
    const row = await checkAccess(tx, actor, draft.eventId);
    const find = async () => {
      const [existing] = await tx
        .select()
        .from(overrides)
        .where(and(eq(overrides.eventId, row.id), eq(overrides.originalStart, draft.originalStart)));
      return existing;
    };
    const first = await find();
    checkDate(row, draft, today, first);

    const claim = () => claimVersion(tx, { id: row.id, version: row.version, actor });
    const history = () => writeHistory(tx, row.id, "override", actor, { originalStart: draft.originalStart });

    if (row.rrule === null) {
      const same =
        row.scheduleStatus === draft.scheduleStatus &&
        row.scheduleNote === draft.scheduleNote &&
        row.occurrenceDetails === draft.occurrenceDetails;
      if (same) return {};
      await claimVersion(tx, {
        id: row.id,
        version: row.version,
        actor,
        set: {
          scheduleStatus: draft.scheduleStatus,
          scheduleNote: draft.scheduleNote,
          occurrenceDetails: draft.occurrenceDetails,
        },
      });
      await history();
      return {};
    }

    // A Series: only the three columns of the Override. The Series' own status is `scheduled`, so
    // "scheduled" is stored as null ("no change"); the Series has no note and no details.
    const values = {
      scheduleStatus: draft.scheduleStatus === row.scheduleStatus ? null : draft.scheduleStatus,
      scheduleNote: draft.scheduleNote,
      occurrenceDetails: draft.occurrenceDetails,
    };
    const empty = Object.values(values).every((v) => v === null);
    if (!first && empty) return {};
    if (
      first &&
      first.scheduleStatus === values.scheduleStatus &&
      first.scheduleNote === values.scheduleNote &&
      first.occurrenceDetails === values.occurrenceDetails
    ) {
      return {};
    }

    await claim();
    // Read again under the Event row lock: an Editor may have changed the Override a moment ago.
    const existing = await find();
    const editorFields =
      existing !== undefined &&
      (existing.allDay !== null || existing.title !== null || existing.location !== null);
    const now = new Date();
    if (empty && existing && !editorFields) {
      await tx
        .delete(overrides)
        .where(and(eq(overrides.eventId, row.id), eq(overrides.originalStart, draft.originalStart)));
    } else if (empty && !existing) {
      return {};
    } else {
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
    await history();
    return {};
  });
}

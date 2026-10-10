/** Soft delete (Editors) and restore (Admins) of a whole Event. No hard delete. */
import type { Db } from "@/db/types";
import { eventRowToRuleInput } from "@/db/mappers";
import type { EventRow } from "@/db/schema";
import { firstSharedDate, loadChainMembers } from "./chain";
import { longDate } from "./format";
import {
  type Actor,
  claimVersion,
  invalid,
  readForWrite,
  runWrite,
  type Tx,
  writeHistory,
  type WriteResult,
} from "./write-helpers";

interface Target {
  id: string;
  version: number;
}

export async function deleteEvent(db: Db, actor: Actor, target: Target): Promise<WriteResult> {
  return runWrite(db, async (tx) => {
    await claimVersion(tx, { ...target, actor, set: { deletedAt: new Date(), deletedBy: actor.id } });
    await writeHistory(tx, target.id, "delete", actor);
    return {};
  });
}

export async function restoreEvent(db: Db, actor: Actor, target: Target): Promise<WriteResult> {
  return runWrite(db, async (tx) => {
    if (actor.role !== "admin") throw invalid({}, "Only an Admin can restore an Event.");
    const row = await readForWrite(tx, target.id, target.version, { deleted: true });
    await checkRestoreOverlap(tx, row);
    await claimVersion(tx, { ...target, actor, deleted: true, set: { deletedAt: null, deletedBy: null } });
    await writeHistory(tx, target.id, "restore", actor);
    return {};
  });
}

/**
 * A restore must not show a date two times: the restored Event may not share a date with a live
 * part of its chain (a part may have taken the dates while this one was deleted).
 */
async function checkRestoreOverlap(tx: Tx, row: EventRow): Promise<void> {
  const own = eventRowToRuleInput(row);
  let clash: { title: string; date: string } | null = null;
  for (const member of await loadChainMembers(tx, row.id)) {
    if (member.deletedAt !== null) continue;
    const date = firstSharedDate(own, eventRowToRuleInput(member));
    if (date && (!clash || date < clash.date)) clash = { title: member.title, date };
  }
  if (clash) {
    throw invalid(
      {},
      `Restoring this Event would repeat dates of ${clash.title} (${longDate(clash.date)}). Change or stop that Event first.`,
    );
  }
}

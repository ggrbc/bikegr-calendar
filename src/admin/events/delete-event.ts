/** Soft delete (Editors) and restore (Admins) of a whole Event. No hard delete. */
import type { Db } from "@/db/types";
import { type Actor, claimVersion, invalid, runWrite, writeHistory, type WriteResult } from "./write-helpers";

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
    await claimVersion(tx, { ...target, actor, deleted: true, set: { deletedAt: null, deletedBy: null } });
    await writeHistory(tx, target.id, "restore", actor);
    return {};
  });
}

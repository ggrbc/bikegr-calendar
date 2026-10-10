/**
 * Review writes: Approve, Reject, and Delete as spam. Each uses the `version` claim, so a review of
 * a stale form fails with the conflict message, and each writes one history row.
 *
 * - Approve: `pending` or `rejected` (undo a Reject) → `approved`. The Event is then public.
 * - Reject: `pending` → `rejected`. It never becomes public; it stays in the admin. The reason
 *   (optional) goes in the history detail and the email.
 * - Delete as spam: a `pending` Event is soft-deleted (CONTEXT.md: Delete is for spam). No email.
 *
 * Reject and Delete as spam clear an image that no other Event uses and give its URL back, so the
 * caller removes the blob after the commit.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { FieldErrors } from "@/admin/events/event-input";
import type { HistoryDetail } from "@/admin/events/format";
import {
  type Actor,
  claimVersion,
  invalid,
  readForWrite,
  runWrite,
  type Tx,
  writeHistory,
  type WriteResult,
} from "@/admin/events/write-helpers";
import { eventRowToRuleInput } from "@/db/mappers";
import { eventHistory, events, type EventRow } from "@/db/schema";
import type { Db } from "@/db/types";
import type { CalendarSlug, EventRuleInput } from "@/engine";

export interface ReviewTarget {
  id: string;
  version: number;
}

/** What the email to the Submitter needs. */
export interface ReviewedEvent {
  id: string;
  calendar: CalendarSlug;
  title: string;
  submitterEmail: string | null;
  rule: EventRuleInput;
}

export const REASON_MAX = 500;

export function parseRejectReason(value: unknown): { ok: true; value: string | null } | { ok: false; errors: FieldErrors } {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length > REASON_MAX) return { ok: false, errors: { reason: `Use ${REASON_MAX} characters or fewer.` } };
  return { ok: true, value: reason === "" ? null : reason };
}

function reviewed(row: EventRow): ReviewedEvent {
  return {
    id: row.id,
    calendar: row.calendar,
    title: row.title,
    submitterEmail: row.submitterEmail,
    rule: eventRowToRuleInput(row),
  };
}

/** The image URL when no other Event uses it, else null. */
async function orphanImage(tx: Tx, row: EventRow): Promise<string | null> {
  if (!row.imageUrl) return null;
  const [other] = await tx
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.imageUrl, row.imageUrl), ne(events.id, row.id)))
    .limit(1);
  return other ? null : row.imageUrl;
}

export async function approveSubmission(
  db: Db,
  actor: Actor,
  target: ReviewTarget,
): Promise<WriteResult<{ review: ReviewedEvent }>> {
  return runWrite(db, async (tx) => {
    const row = await readForWrite(tx, target.id, target.version);
    if (row.reviewStatus === "approved") throw invalid({}, "This Event is already approved.");
    const now = new Date();
    const updated = await claimVersion(tx, {
      ...target,
      actor,
      set: { reviewStatus: "approved", reviewedBy: actor.id, reviewedAt: now },
    });
    await writeHistory(tx, row.id, "approve", actor);
    return { review: reviewed(updated) };
  });
}

export async function rejectSubmission(
  db: Db,
  actor: Actor,
  target: ReviewTarget,
  reason: string | null,
): Promise<WriteResult<{ review: ReviewedEvent; orphanImageUrl: string | null }>> {
  return runWrite(db, async (tx) => {
    const row = await readForWrite(tx, target.id, target.version);
    if (row.reviewStatus !== "pending") throw invalid({}, "Only a Submission that waits for review can be rejected.");
    const orphanImageUrl = await orphanImage(tx, row);
    const updated = await claimVersion(tx, {
      ...target,
      actor,
      set: {
        reviewStatus: "rejected",
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        ...(orphanImageUrl ? { imageUrl: null } : {}),
      },
    });
    const detail = { ...(reason ? { reason } : {}), ...(orphanImageUrl ? { imageRemoved: true } : {}) };
    await writeHistory(tx, row.id, "reject", actor, Object.keys(detail).length > 0 ? detail : undefined);
    return { review: reviewed(updated), orphanImageUrl };
  });
}

export async function deleteSubmissionAsSpam(
  db: Db,
  actor: Actor,
  target: ReviewTarget,
): Promise<WriteResult<{ orphanImageUrl: string | null }>> {
  return runWrite(db, async (tx) => {
    const row = await readForWrite(tx, target.id, target.version);
    if (row.reviewStatus !== "pending") throw invalid({}, "Only a Submission that waits for review can be deleted as spam.");
    const orphanImageUrl = await orphanImage(tx, row);
    await claimVersion(tx, {
      ...target,
      actor,
      set: { deletedAt: new Date(), deletedBy: actor.id, ...(orphanImageUrl ? { imageUrl: null } : {}) },
    });
    await writeHistory(tx, row.id, "delete", actor, orphanImageUrl ? { imageRemoved: true } : undefined);
    return { orphanImageUrl };
  });
}

/**
 * True when the last Reject or Delete as spam removed the Event's image and it has no image now:
 * the Review panel then asks the Editor to add one before an Approve.
 */
export async function imageRemovedByReview(db: Db, eventId: string): Promise<boolean> {
  const [row] = await db.select({ imageUrl: events.imageUrl }).from(events).where(eq(events.id, eventId));
  if (!row || row.imageUrl !== null) return false;
  const [last] = await db
    .select({ snapshot: eventHistory.snapshot })
    .from(eventHistory)
    .where(and(eq(eventHistory.eventId, eventId), inArray(eventHistory.action, ["reject", "delete"])))
    .orderBy(desc(eventHistory.id))
    .limit(1);
  const detail = (last?.snapshot as { detail?: HistoryDetail } | undefined)?.detail;
  return detail?.imageRemoved === true;
}

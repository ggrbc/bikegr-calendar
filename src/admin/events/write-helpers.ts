/**
 * Shared steps of every admin Event write: the result type, the `version` claim, the Tag checks,
 * and the history row. Plan: docs/plans/admin-event-editing.md ("Every write: one transaction").
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { type EditorRole, eventHistory, eventTags, events, type EventRow, overrides, tags } from "@/db/schema";
import type { Db } from "@/db/types";
import type { CalendarSlug } from "@/engine";
import type { ContentDraft, FieldErrors } from "./event-input";
import {
  conflictMessage,
  DELETED_MESSAGE,
  type HistoryAction,
  type HistoryDetail,
  NOT_FOUND_MESSAGE,
} from "./format";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The Editor who makes the change. */
export interface Actor {
  id: string;
  role: EditorRole;
}

export type WriteFailure =
  | { ok: false; reason: "conflict"; changedAt: Date; message: string }
  | { ok: false; reason: "deleted" | "not-found"; message: string }
  | { ok: false; reason: "invalid"; message: string; errors: FieldErrors }
  /** An unexpected error (for example a database error). Nothing was written. */
  | { ok: false; reason: "failed"; message: string };

export const FAILED_MESSAGE = "The save failed. Nothing was changed. Try again.";
export const NOT_DELETED_MESSAGE = "This Event is not deleted.";

export type WriteResult<T extends object = object> = ({ ok: true } & T) | WriteFailure;

/** Thrown inside a transaction to roll it back; `runWrite` turns it into the result. */
export class WriteError extends Error {
  constructor(readonly failure: WriteFailure) {
    super(failure.message);
    this.name = "WriteError";
  }
}

export function invalid(errors: FieldErrors, message = "Check the marked fields."): WriteError {
  return new WriteError({ ok: false, reason: "invalid", message, errors });
}

/** Runs one write in one transaction. A `WriteError` rolls it back and becomes the result. */
export async function runWrite<T extends object>(
  db: Db,
  write: (tx: Tx) => Promise<T>,
): Promise<WriteResult<T>> {
  try {
    const value = await db.transaction(write);
    return { ok: true, ...value };
  } catch (error) {
    if (error instanceof WriteError) return error.failure;
    console.error(failureLog(error));
    return { ok: false, reason: "failed", message: FAILED_MESSAGE };
  }
}

/**
 * The log line for an unexpected error: the error classes, the Postgres code, and the stack frames.
 * No message text: a driver message (and the first stack line) can contain values from the input.
 */
export function failureLog(error: unknown): string {
  const parts = ["[admin] Event write failed:"];
  const frames: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 3; depth++) {
    const code = "code" in current ? ` code=${String((current as { code: unknown }).code)}` : "";
    parts.push(`${depth === 0 ? "" : "cause "}${current.constructor.name}${code}`);
    for (const line of (current.stack ?? "").split("\n")) {
      if (/^\s+at /.test(line) && frames.length < 12) frames.push(line);
    }
    current = current.cause;
  }
  if (!(error instanceof Error)) parts.push(typeof error);
  return [parts.join(" "), ...frames].join("\n");
}

/** The failure for an Event that the claim did not update. */
async function claimFailure(tx: Tx, id: string, deleted: boolean): Promise<WriteFailure> {
  const [row] = await tx
    .select({ deletedAt: events.deletedAt, updatedAt: events.updatedAt })
    .from(events)
    .where(eq(events.id, id));
  if (!row) return { ok: false, reason: "not-found", message: NOT_FOUND_MESSAGE };
  if (!deleted && row.deletedAt !== null) {
    return { ok: false, reason: "deleted", message: DELETED_MESSAGE };
  }
  if (deleted && row.deletedAt === null) {
    return { ok: false, reason: "invalid", message: NOT_DELETED_MESSAGE, errors: {} };
  }
  return conflictFailure(row.updatedAt);
}

export function conflictFailure(changedAt: Date): WriteFailure {
  return { ok: false, reason: "conflict", changedAt, message: conflictMessage(changedAt) };
}

/**
 * Reads the Event for a write and checks the form's `version` at once. A missing or deleted Event
 * and a stale version throw. (`claimVersion` checks the version again in its `where`.)
 */
export async function readForWrite(
  tx: Tx,
  id: string,
  version: number,
  { deleted = false }: { deleted?: boolean } = {},
): Promise<EventRow> {
  const [row] = await tx.select().from(events).where(eq(events.id, id));
  if (!row) throw new WriteError({ ok: false, reason: "not-found", message: NOT_FOUND_MESSAGE });
  if ((row.deletedAt !== null) !== deleted) {
    if (deleted) throw invalid({}, NOT_DELETED_MESSAGE);
    throw new WriteError({ ok: false, reason: "deleted", message: DELETED_MESSAGE });
  }
  if (row.version !== version) throw new WriteError(conflictFailure(row.updatedAt));
  return row;
}

/**
 * The first write: `update … where id = ? and version = ?` (and not deleted, or deleted for a
 * restore), with `version + 1`, `updated_by`, and `updated_at`. 0 rows throws the failure.
 */
export async function claimVersion(
  tx: Tx,
  {
    id,
    version,
    actor,
    set = {},
    deleted = false,
  }: {
    id: string;
    version: number;
    actor: Actor;
    set?: Partial<typeof events.$inferInsert>;
    deleted?: boolean;
  },
): Promise<EventRow> {
  const [row] = await tx
    .update(events)
    .set({ ...set, updatedBy: actor.id, updatedAt: new Date(), version: sql`${events.version} + 1` })
    .where(
      and(
        eq(events.id, id),
        eq(events.version, version),
        deleted ? isNotNull(events.deletedAt) : isNull(events.deletedAt),
      ),
    )
    .returning();
  if (!row) throw new WriteError(await claimFailure(tx, id, deleted));
  return row;
}

/**
 * Checks the Tags that a save would link. A new link must be to an active Tag of the Calendar
 * (a form opened before a retire or a merge can still show a retired Tag). A link that the Event
 * already has stays, also to a retired Tag.
 */
export async function checkTagIds(
  tx: Tx,
  calendar: CalendarSlug,
  tagIds: string[],
  existingTagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) return;
  const rows = await tx
    .select({ id: tags.id, calendar: tags.calendar, retiredAt: tags.retiredAt })
    .from(tags)
    .where(inArray(tags.id, tagIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const existing = new Set(existingTagIds);
  for (const id of tagIds) {
    const tag = byId.get(id);
    if (!tag || tag.calendar !== calendar) throw invalid({ tags: "Pick Tags from the list." });
    if (tag.retiredAt !== null && !existing.has(id)) {
      throw invalid({ tags: "This Tag was retired. Pick another one." });
    }
  }
}

export async function tagIdsOf(tx: Tx, eventId: string): Promise<string[]> {
  const rows = await tx.select({ tagId: eventTags.tagId }).from(eventTags).where(eq(eventTags.eventId, eventId));
  return rows.map((r) => r.tagId);
}

/** Replaces the Event's Tag links. */
export async function setEventTags(
  tx: Tx,
  eventId: string,
  calendar: CalendarSlug,
  tagIds: string[],
): Promise<void> {
  await tx.delete(eventTags).where(eq(eventTags.eventId, eventId));
  if (tagIds.length > 0) {
    await tx.insert(eventTags).values(tagIds.map((tagId) => ({ eventId, tagId, calendar })));
  }
}

/**
 * The Tag ids to link after a content save. Same Calendar: the form's Tags, plus retired Tags
 * that the Event already has (they are not in the picker). Other Calendar: the form's Tags only
 * (a Calendar change clears the old Tags).
 */
export async function tagsAfterSave(tx: Tx, row: EventRow, content: ContentDraft): Promise<string[]> {
  const existing = await tagIdsOf(tx, row.id);
  const sameCalendar = row.calendar === content.calendar;
  await checkTagIds(tx, content.calendar, content.tagIds, sameCalendar ? existing : []);
  if (!sameCalendar) return content.tagIds;
  const retired =
    existing.length === 0
      ? []
      : await tx
          .select({ id: tags.id })
          .from(tags)
          .where(and(inArray(tags.id, existing), isNotNull(tags.retiredAt)));
  return [...new Set([...content.tagIds, ...retired.map((t) => t.id)])];
}

/**
 * Moves the Event to another Calendar, after the version claim. Its Tags go first: the composite
 * foreign key refuses a Calendar change while the Event has Tags of the old Calendar.
 */
export async function moveCalendar(tx: Tx, eventId: string, calendar: CalendarSlug): Promise<void> {
  await tx.delete(eventTags).where(eq(eventTags.eventId, eventId));
  await tx.update(events).set({ calendar }).where(eq(events.id, eventId));
}

/** The last write: one history row with the state after the change (the import's shape). */
export async function writeHistory(
  tx: Tx,
  eventId: string,
  action: HistoryAction,
  actor: Actor,
  detail?: HistoryDetail,
): Promise<void> {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  const eventOverrides = await tx
    .select()
    .from(overrides)
    .where(eq(overrides.eventId, eventId))
    .orderBy(asc(overrides.originalStart));
  const slugs = await tx
    .select({ slug: tags.slug })
    .from(eventTags)
    .innerJoin(tags, eq(tags.id, eventTags.tagId))
    .where(eq(eventTags.eventId, eventId));
  await tx.insert(eventHistory).values({
    eventId,
    version: event.version,
    action,
    snapshot: {
      event,
      overrides: eventOverrides,
      tagSlugs: slugs.map((s) => s.slug).sort(),
      ...(detail ? { detail } : {}),
    },
    changedBy: actor.id,
  });
}

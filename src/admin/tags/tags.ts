/**
 * Tag management (design.md, "Tags"). Callers pass the database, so tests can use PGlite. Each
 * write is one transaction. Server actions check the session; these functions check the rules.
 */
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { eventTags, events, tags } from "@/db/schema";
import type { Db } from "@/db/types";
import type { CalendarSlug } from "@/engine";
import { parseTagName } from "./rules";

export type Tag = typeof tags.$inferSelect;

export type TagRefusal =
  | "invalid"
  | "duplicate-slug"
  | "duplicate-name"
  | "not-found"
  | "already-retired"
  | "not-retired"
  | "same-tag"
  | "other-calendar"
  | "retired-target";

export type TagResult<T> = { ok: true; value: T } | { ok: false; reason: TagRefusal; error: string };

const refuse = (reason: TagRefusal, error: string) => ({ ok: false, reason, error }) as const;
const NOT_FOUND = refuse("not-found", "This Tag does not exist. Reload the page.");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A form value that is not a UUID would make Postgres throw; treat it as "not found". */
const isUuid = (value: string) => UUID.test(value);

// ---------------------------------------------------------------------------------------------
// Reads

export interface PickerTag {
  id: string;
  name: string;
  slug: string;
}

/** The Tags an Editor can pick for an Event: active Tags of one Calendar, sorted by name. */
export async function listPickerTags(db: Db, calendar: CalendarSlug): Promise<PickerTag[]> {
  return db
    .select({ id: tags.id, name: tags.name, slug: tags.slug })
    .from(tags)
    .where(and(eq(tags.calendar, calendar), isNull(tags.retiredAt)))
    .orderBy(asc(sql`lower(${tags.name})`), asc(tags.slug));
}

export interface AdminTag {
  id: string;
  name: string;
  slug: string;
  retiredAt: Date | null;
  /** Linked Events that are not deleted, any Review status. */
  eventCount: number;
}

/** All Tags of one Calendar with their Event counts: active first, then retired, each by name. */
export async function listTagsForAdmin(db: Db, calendar: CalendarSlug): Promise<AdminTag[]> {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
      retiredAt: tags.retiredAt,
      eventCount: count(events.id),
    })
    .from(tags)
    .leftJoin(eventTags, eq(eventTags.tagId, tags.id))
    .leftJoin(events, and(eq(events.id, eventTags.eventId), isNull(events.deletedAt)))
    .where(eq(tags.calendar, calendar))
    .groupBy(tags.id)
    .orderBy(asc(isNotNull(tags.retiredAt)), asc(sql`lower(${tags.name})`), asc(tags.slug));
}

// ---------------------------------------------------------------------------------------------
// Writes

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * True when an active Tag of the Calendar (not `exceptId`) has this name, case-insensitive. A check
 * in the transaction, not a constraint (no schema change): two writes at the same time can still
 * make two equal names, which is harmless.
 */
async function activeNameTaken(
  tx: Tx,
  calendar: CalendarSlug,
  name: string,
  exceptId: string | null,
): Promise<boolean> {
  const [clash] = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(
      and(
        eq(tags.calendar, calendar),
        exceptId ? ne(tags.id, exceptId) : undefined,
        isNull(tags.retiredAt),
        sql`lower(${tags.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  return clash !== undefined;
}

/**
 * Adds a Tag. The slug comes from the name. Refused when an active Tag of the Calendar has the same
 * name. The insert is one statement: the `(calendar, slug)` unique constraint decides a race
 * between two adds.
 */
export async function addTag(
  db: Db,
  editorId: string,
  input: { calendar: CalendarSlug; name: unknown },
): Promise<TagResult<Tag>> {
  const parsed = parseTagName(input.name);
  if (!parsed.ok) return refuse("invalid", parsed.error);
  const { name, slug } = parsed.value;

  return db.transaction(async (tx) => {
    if (await activeNameTaken(tx, input.calendar, name, null)) {
      return refuse("duplicate-name", `Another Tag in this Calendar is named "${name}".`);
    }
    const [created] = await tx
      .insert(tags)
      .values({ calendar: input.calendar, name, slug, createdBy: editorId, updatedBy: editorId })
      .onConflictDoNothing({ target: [tags.calendar, tags.slug] })
      .returning();
    if (created) return { ok: true, value: created } as const;

    const [existing] = await tx
      .select()
      .from(tags)
      .where(and(eq(tags.calendar, input.calendar), eq(tags.slug, slug)));
    const what = `The Tag "${existing?.name ?? name}" already uses the slug "${slug}" in this Calendar.`;
    return refuse(
      "duplicate-slug",
      existing?.retiredAt ? `${what} It is retired. Unretire it instead.` : what,
    );
  });
}

/**
 * Renames a Tag. The slug stays, so shared filter links keep working. Refused when another active
 * Tag of the same Calendar has the same name (case-insensitive).
 */
export async function renameTag(
  db: Db,
  editorId: string,
  input: { tagId: string; name: unknown },
): Promise<TagResult<Tag>> {
  const parsed = parseTagName(input.name);
  if (!parsed.ok) return refuse("invalid", parsed.error);
  if (!isUuid(input.tagId)) return NOT_FOUND;
  const { name } = parsed.value;

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(tags).where(eq(tags.id, input.tagId)).for("update");
    if (!current) return NOT_FOUND;

    if (await activeNameTaken(tx, current.calendar, name, current.id)) return refuse("duplicate-name", `Another Tag in this Calendar is named "${name}".`);

    const [updated] = await tx
      .update(tags)
      .set({ name, updatedBy: editorId, updatedAt: new Date() })
      .where(eq(tags.id, current.id))
      .returning();
    return { ok: true, value: updated } as const;
  });
}

/** Retires a Tag. It keeps its Event links; the public agenda and the pickers hide it. */
export async function retireTag(db: Db, editorId: string, input: { tagId: string }): Promise<TagResult<Tag>> {
  if (!isUuid(input.tagId)) return NOT_FOUND;
  return db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(tags)
      .set({ retiredAt: now, retiredBy: editorId, updatedAt: now, updatedBy: editorId })
      .where(and(eq(tags.id, input.tagId), isNull(tags.retiredAt)))
      .returning();
    if (updated) return { ok: true, value: updated } as const;
    const [existing] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.id, input.tagId));
    return existing ? refuse("already-retired", "This Tag is already retired.") : NOT_FOUND;
  });
}

/**
 * Makes a retired Tag active again. Refused when another active Tag of the Calendar now has its
 * name (for example after a rename while it was retired).
 */
export async function unretireTag(db: Db, editorId: string, input: { tagId: string }): Promise<TagResult<Tag>> {
  if (!isUuid(input.tagId)) return NOT_FOUND;
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(tags).where(eq(tags.id, input.tagId)).for("update");
    if (!current) return NOT_FOUND;
    if (!current.retiredAt) return refuse("not-retired", "This Tag is not retired.");
    if (await activeNameTaken(tx, current.calendar, current.name, current.id)) {
      return refuse("duplicate-name", "Another active Tag has this name. Rename one first.");
    }
    const [updated] = await tx
      .update(tags)
      .set({ retiredAt: null, retiredBy: null, updatedAt: new Date(), updatedBy: editorId })
      .where(eq(tags.id, current.id))
      .returning();
    return { ok: true, value: updated } as const;
  });
}

export interface MergeCounts {
  /** Events that got a new link to the target. */
  moved: number;
  /** Events that already had the target: their source link is removed only. */
  duplicates: number;
}

/**
 * Merges Tag A (source) into Tag B (target) of the same Calendar: every Event with A gets B (no
 * duplicate links), A loses all links, and A is retired (kept, so its slug stays reserved).
 *
 * Both Tag rows are locked `for update` in id order. That prevents a deadlock between two merges,
 * and an Event save that links A or B waits for the merge (its foreign-key check needs a
 * `for key share` lock on the Tag row).
 */
export async function mergeTags(
  db: Db,
  editorId: string,
  input: { sourceId: string; targetId: string },
): Promise<TagResult<MergeCounts>> {
  const { sourceId, targetId } = input;
  if (sourceId === targetId) return refuse("same-tag", "Pick a different Tag to merge into.");
  if (!isUuid(sourceId) || !isUuid(targetId)) return NOT_FOUND;

  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(tags)
      .where(inArray(tags.id, [sourceId, targetId]))
      .orderBy(asc(tags.id))
      .for("update");
    const source = locked.find((t) => t.id === sourceId);
    const target = locked.find((t) => t.id === targetId);
    if (!source || !target) return NOT_FOUND;
    if (source.calendar !== target.calendar) {
      return refuse("other-calendar", "A Tag can only merge into a Tag of the same Calendar.");
    }
    if (target.retiredAt) {
      return refuse("retired-target", `"${target.name}" is retired. Unretire it first, or merge into an active Tag.`);
    }

    const links = await tx
      .select({ eventId: eventTags.eventId, calendar: eventTags.calendar })
      .from(eventTags)
      .where(eq(eventTags.tagId, source.id));
    const inserted =
      links.length === 0
        ? []
        : await tx
            .insert(eventTags)
            .values(links.map((l) => ({ eventId: l.eventId, tagId: target.id, calendar: l.calendar })))
            .onConflictDoNothing({ target: [eventTags.eventId, eventTags.tagId] })
            .returning({ eventId: eventTags.eventId });
    await tx.delete(eventTags).where(eq(eventTags.tagId, source.id));

    const now = new Date();
    await tx
      .update(tags)
      .set({
        retiredAt: source.retiredAt ?? now,
        retiredBy: source.retiredAt ? source.retiredBy : editorId,
        updatedAt: now,
        updatedBy: editorId,
      })
      .where(eq(tags.id, source.id));

    return { ok: true, value: { moved: inserted.length, duplicates: links.length - inserted.length } } as const;
  });
}

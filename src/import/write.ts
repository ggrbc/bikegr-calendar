/**
 * Writes an `ImportResult` to the database, safe to run again (upsert by Source ID). Each Event is
 * written in its own transaction. An Event whose import-owned state did not change is not written
 * at all. Plan: docs/plans/import-writer-and-agenda.md.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { ctaToColumns, overrideInputToRow, ruleInputToColumns } from "@/db/mappers";
import { eventHistory, eventTags, events, overrides, tags } from "@/db/schema";
import type { Db } from "@/db/types";
import type { OverrideInput } from "@/engine";
import { sameState, stateFromImport, stateFromRows } from "./event-state";
import { isBlobUrl } from "./images";
import type { ImportResult, ImportedEvent } from "./types";

export interface EventRef {
  sourceId: string;
  title: string;
}

export interface WriteReport {
  inserted: EventRef[];
  updated: EventRef[];
  unchanged: EventRef[];
  failed: (EventRef & { message: string })[];
  /** Updated Events that an Editor had changed. The import wrote them anyway. */
  editorOverwrites: EventRef[];
  /** Events in the database with a Source ID that the feed no longer has. Not deleted. */
  notInFeed: EventRef[];
}

export interface WriteOptions {
  /**
   * Source IDs of Events whose image was not copied in this run. If such an Event already has a
   * Blob URL, its `image_url` is not compared and not updated, so the Blob URL stays. Otherwise
   * (new Event, stored null or Tockify URL) the feed URL is written as usual.
   */
  uncopiedImages?: ReadonlySet<string>;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Outcome = "inserted" | "updated" | "unchanged";

export async function writeImport(
  db: Db,
  result: ImportResult,
  { uncopiedImages = new Set() }: WriteOptions = {},
): Promise<WriteReport> {
  const report: WriteReport = {
    inserted: [],
    updated: [],
    unchanged: [],
    failed: [],
    editorOverwrites: [],
    notInFeed: [],
  };
  const tagNames = new Map(result.tags.map((t) => [`${t.calendar}/${t.slug}`, t.name]));
  const overridesBySource = new Map<string, OverrideInput[]>();
  for (const o of result.overrides) {
    overridesBySource.set(o.eventId, [...(overridesBySource.get(o.eventId) ?? []), o]);
  }

  for (const event of result.events) {
    const ref = { sourceId: event.sourceId, title: event.title };
    try {
      const { outcome, editorChanged } = await db.transaction((tx) =>
        writeEvent(tx, event, overridesBySource.get(event.sourceId) ?? [], {
          imageCopied: !uncopiedImages.has(event.sourceId),
          tagNames,
        }),
      );
      report[outcome].push(ref);
      if (editorChanged) report.editorOverwrites.push(ref);
    } catch (error) {
      report.failed.push({ ...ref, message: errorMessage(error) });
    }
  }

  const feedIds = new Set(result.events.map((e) => e.sourceId));
  const stored = await db
    .select({ sourceId: events.sourceId, title: events.title })
    .from(events)
    .where(and(isNotNull(events.sourceId), isNull(events.deletedAt)));
  report.notInFeed = stored
    .filter((r): r is EventRef => r.sourceId !== null && !feedIds.has(r.sourceId))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId, "en", { numeric: true }));
  return report;
}

async function writeEvent(
  tx: Tx,
  event: ImportedEvent,
  eventOverrides: OverrideInput[],
  { imageCopied, tagNames }: { imageCopied: boolean; tagNames: Map<string, string> },
): Promise<{ outcome: Outcome; editorChanged: boolean }> {
  const tagIds = await upsertTags(tx, event, tagNames);
  const [existing] = await tx.select().from(events).where(eq(events.sourceId, event.sourceId));

  const owned = {
    calendar: event.calendar,
    title: event.title,
    description: event.description,
    location: event.location,
    ...ctaToColumns(event.cta),
    ...ruleInputToColumns(event.rule),
  };

  if (!existing) {
    const [row] = await tx
      .insert(events)
      .values({
        ...owned,
        imageUrl: event.imageUrl,
        sourceId: event.sourceId,
        reviewStatus: "approved",
        createdBy: null,
      })
      .returning();
    await writeChildren(tx, row.id, event.calendar, eventOverrides, tagIds);
    await writeHistory(tx, row, eventOverrides.length, event.tagSlugs);
    return { outcome: "inserted", editorChanged: false };
  }

  const storedOverrides = await tx.select().from(overrides).where(eq(overrides.eventId, existing.id));
  const storedSlugs = await tx
    .select({ slug: tags.slug })
    .from(eventTags)
    .innerJoin(tags, eq(tags.id, eventTags.tagId))
    .where(eq(eventTags.eventId, existing.id));

  // Never replace a stored Blob URL with a feed (Tockify) URL. A stored null or Tockify URL is
  // not a copy, so the feed value is compared and written as usual.
  const includeImage = imageCopied || !isBlobUrl(existing.imageUrl);
  const options = { includeImage };
  const wanted = stateFromImport(event, eventOverrides, options);
  const current = stateFromRows(
    existing,
    storedOverrides,
    storedSlugs.map((t) => t.slug),
    options,
  );
  if (sameState(wanted, current)) return { outcome: "unchanged", editorChanged: false };

  const editorChanged =
    existing.updatedBy !== null ||
    storedOverrides.some((o) => o.createdBy !== null || o.updatedBy !== null);

  // Tags first: the composite foreign key on event_tags would refuse a Calendar change.
  await tx.delete(eventTags).where(eq(eventTags.eventId, existing.id));
  const [row] = await tx
    .update(events)
    .set({
      ...owned,
      ...(includeImage ? { imageUrl: event.imageUrl } : {}),
      updatedBy: null,
      updatedAt: new Date(),
      version: sql`${events.version} + 1`,
    })
    .where(and(eq(events.id, existing.id), eq(events.version, existing.version)))
    .returning();
  if (!row) throw new Error("The Event changed during the import; run the import again");
  await tx.delete(overrides).where(eq(overrides.eventId, existing.id));
  await writeChildren(tx, row.id, event.calendar, eventOverrides, tagIds);
  await writeHistory(tx, row, eventOverrides.length, event.tagSlugs);
  return { outcome: "updated", editorChanged };
}

/** Inserts missing Tags (by Calendar and slug) and returns the ids of the Event's Tags. */
async function upsertTags(
  tx: Tx,
  event: ImportedEvent,
  tagNames: Map<string, string>,
): Promise<string[]> {
  const slugs = [...new Set(event.tagSlugs)];
  if (slugs.length === 0) return [];
  await tx
    .insert(tags)
    .values(
      slugs.map((slug) => ({
        calendar: event.calendar,
        slug,
        name: tagNames.get(`${event.calendar}/${slug}`) ?? slug,
      })),
    )
    .onConflictDoNothing({ target: [tags.calendar, tags.slug] });
  const rows = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.calendar, event.calendar), inArray(tags.slug, slugs)));
  return rows.map((r) => r.id);
}

async function writeChildren(
  tx: Tx,
  eventId: string,
  calendar: ImportedEvent["calendar"],
  eventOverrides: OverrideInput[],
  tagIds: string[],
): Promise<void> {
  if (eventOverrides.length > 0) {
    await tx.insert(overrides).values(eventOverrides.map((o) => overrideInputToRow(o, eventId)));
  }
  if (tagIds.length > 0) {
    await tx.insert(eventTags).values(tagIds.map((tagId) => ({ eventId, tagId, calendar })));
  }
}

async function writeHistory(
  tx: Tx,
  row: typeof events.$inferSelect,
  overrideCount: number,
  tagSlugs: string[],
): Promise<void> {
  const storedOverrides =
    overrideCount > 0 ? await tx.select().from(overrides).where(eq(overrides.eventId, row.id)) : [];
  await tx.insert(eventHistory).values({
    eventId: row.id,
    version: row.version,
    action: "import",
    snapshot: { event: row, overrides: storedOverrides, tagSlugs: [...tagSlugs].sort() },
    changedBy: null,
  });
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Drizzle wraps the driver error; the cause has the Postgres message (constraint name).
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message.split("\n")[0]}${cause}`;
}

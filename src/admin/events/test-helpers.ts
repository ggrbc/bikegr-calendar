/** Test helpers for the admin Event writes (PGlite). Use only in tests. */
import { asc, count, eq } from "drizzle-orm";
import { editors, eventHistory, eventTags, events, overrides, tags } from "@/db/schema";
import type { Db } from "@/db/types";
import type { CalendarSlug } from "@/engine";
import type { EventDraft } from "./event-input";
import type { Actor } from "./write-helpers";

export async function addEditor(db: Db, name: string, role: "admin" | "editor" = "editor"): Promise<Actor> {
  const [row] = await db
    .insert(editors)
    .values({ email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.org`, name, role })
    .returning();
  return { id: row.id, role: row.role };
}

export async function addTag(db: Db, calendar: CalendarSlug, slug: string, retired = false): Promise<string> {
  const [row] = await db
    .insert(tags)
    .values({ calendar, slug, name: slug, retiredAt: retired ? new Date() : null })
    .returning();
  return row.id;
}

export function draft(patch: Partial<EventDraft> = {}): EventDraft {
  return {
    calendar: "rides",
    title: "Tuesday Ride",
    description: "Meet at the shop.",
    location: "Shop",
    tagIds: [],
    cta: null,
    imageUrl: null,
    rule: {
      timing: { kind: "timed", start: "2026-10-06T18:00", end: "2026-10-06T20:00" },
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      exdates: [],
      scheduleStatus: "scheduled",
      scheduleNote: null,
    },
    ...patch,
  };
}

/** The content part of {@link draft} (no rule). */
export function contentDraft(patch: Partial<EventDraft> = {}): Omit<EventDraft, "rule"> {
  const value: Partial<EventDraft> = draft(patch);
  delete value.rule;
  return value as Omit<EventDraft, "rule">;
}

export async function eventRow(db: Db, id: string) {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  return row;
}

export async function historyOf(db: Db, eventId: string) {
  return db
    .select()
    .from(eventHistory)
    .where(eq(eventHistory.eventId, eventId))
    .orderBy(asc(eventHistory.id));
}

export async function tagIdsOfEvent(db: Db, eventId: string): Promise<string[]> {
  const rows = await db.select({ tagId: eventTags.tagId }).from(eventTags).where(eq(eventTags.eventId, eventId));
  return rows.map((r) => r.tagId).sort();
}

export async function overridesOf(db: Db, eventId: string) {
  return db.select().from(overrides).where(eq(overrides.eventId, eventId)).orderBy(asc(overrides.originalStart));
}

export async function rowCounts(db: Db) {
  const n = async (table: typeof events | typeof overrides | typeof eventTags | typeof eventHistory) =>
    (await db.select({ n: count() }).from(table))[0].n;
  return {
    events: await n(events),
    overrides: await n(overrides),
    eventTags: await n(eventTags),
    history: await n(eventHistory),
  };
}

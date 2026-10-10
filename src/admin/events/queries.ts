/** Reads for the admin Event pages: the list, one Event for its form, and its history. */
import { and, asc, desc, eq, ilike, inArray, isNull, type SQL } from "drizzle-orm";
import { eventRowToRuleInput, overrideRowToInput } from "@/db/mappers";
import { editors, eventHistory, eventTags, events, type EventRow, overrides } from "@/db/schema";
import type { Db } from "@/db/types";
import type { CalendarSlug, LocalDate, Occurrence, OverrideInput } from "@/engine";
import { describeRrule } from "./describe-rule";
import { type HistoryDetail, historyActionLabel } from "./format";
import { nextOccurrences } from "./preview";

export type ReviewStatus = EventRow["reviewStatus"];

export interface EventListFilter {
  calendar: CalendarSlug | null;
  /** Title search, case-insensitive. */
  q: string;
  review: ReviewStatus | null;
  includeDeleted: boolean;
  today: LocalDate;
}

export interface EventListRow {
  id: string;
  title: string;
  calendar: CalendarSlug;
  repeat: string;
  /** The next Occurrence on or after today, or null. */
  next: Occurrence | null;
  reviewStatus: ReviewStatus;
  deleted: boolean;
}

/** `%`, `_`, and `\` match themselves. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function groupOverrides(rows: (typeof overrides.$inferSelect)[]): Map<string, OverrideInput[]> {
  const byEvent = new Map<string, OverrideInput[]>();
  for (const row of rows) {
    const list = byEvent.get(row.eventId) ?? [];
    list.push(overrideRowToInput(row));
    byEvent.set(row.eventId, list);
  }
  return byEvent;
}

export async function listEvents(db: Db, filter: EventListFilter): Promise<EventListRow[]> {
  const where: (SQL | undefined)[] = [
    filter.calendar ? eq(events.calendar, filter.calendar) : undefined,
    filter.review ? eq(events.reviewStatus, filter.review) : undefined,
    filter.includeDeleted ? undefined : isNull(events.deletedAt),
    filter.q.trim() ? ilike(events.title, likePattern(filter.q.trim())) : undefined,
  ];
  const rows = await db
    .select()
    .from(events)
    .where(and(...where))
    .orderBy(asc(events.title), asc(events.id));
  if (rows.length === 0) return [];
  const overrideRows = await db
    .select()
    .from(overrides)
    .where(inArray(overrides.eventId, rows.map((r) => r.id)));
  const byEvent = groupOverrides(overrideRows);
  return rows.map((row) => {
    const preview = nextOccurrences(eventRowToRuleInput(row), byEvent.get(row.id) ?? [], filter.today, 1);
    return {
      id: row.id,
      title: row.title,
      calendar: row.calendar,
      repeat: row.rrule ? describeRrule(row.rrule) : "One time",
      next: preview.ok ? (preview.occurrences[0] ?? null) : null,
      reviewStatus: row.reviewStatus,
      deleted: row.deletedAt !== null,
    };
  });
}

export interface EventLink {
  id: string;
  title: string;
}

export interface EventForEdit {
  row: EventRow;
  tagIds: string[];
  overrides: OverrideInput[];
  predecessor: EventLink | null;
  successors: EventLink[];
}

export async function loadEventForEdit(db: Db, id: string): Promise<EventForEdit | null> {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  if (!row) return null;
  const tagRows = await db.select({ tagId: eventTags.tagId }).from(eventTags).where(eq(eventTags.eventId, id));
  const overrideRows = await db
    .select()
    .from(overrides)
    .where(eq(overrides.eventId, id))
    .orderBy(asc(overrides.originalStart));
  const [predecessor] = row.predecessorId
    ? await db.select({ id: events.id, title: events.title }).from(events).where(eq(events.id, row.predecessorId))
    : [];
  const successors = await db
    .select({ id: events.id, title: events.title })
    .from(events)
    .where(eq(events.predecessorId, id))
    .orderBy(asc(events.createdAt));
  return {
    row,
    tagIds: tagRows.map((t) => t.tagId),
    overrides: overrideRows.map(overrideRowToInput),
    predecessor: predecessor ?? null,
    successors,
  };
}

export interface HistoryEntry {
  id: number;
  changedAt: Date;
  /** Editor name, else email; "Import" when no Editor made the change. */
  who: string;
  what: string;
}

export async function loadHistory(db: Db, eventId: string): Promise<HistoryEntry[]> {
  const rows = await db
    .select({
      id: eventHistory.id,
      changedAt: eventHistory.changedAt,
      action: eventHistory.action,
      snapshot: eventHistory.snapshot,
      name: editors.name,
      email: editors.email,
    })
    .from(eventHistory)
    .leftJoin(editors, eq(editors.id, eventHistory.changedBy))
    .where(eq(eventHistory.eventId, eventId))
    .orderBy(desc(eventHistory.changedAt), desc(eventHistory.id));
  return rows.map((r) => {
    const detail = ((r.snapshot as { detail?: HistoryDetail } | null)?.detail ?? {}) as HistoryDetail;
    return {
      id: r.id,
      changedAt: r.changedAt,
      who: r.name ?? r.email ?? "Import",
      what: historyActionLabel(r.action, detail),
    };
  });
}

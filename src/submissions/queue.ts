/**
 * Reads for the Review queue: the pending, not deleted Events of both Calendars, oldest first
 * (the partial index `events_review_queue_idx`).
 */
import { and, asc, count, eq, isNull, type SQL } from "drizzle-orm";
import { describeRrule } from "@/admin/events/describe-rule";
import { shortSlot } from "@/agenda/dates";
import { eventRowToRuleInput } from "@/db/mappers";
import { events } from "@/db/schema";
import type { Db } from "@/db/types";
import type { CalendarSlug } from "@/engine";

export interface QueueRow {
  id: string;
  title: string;
  calendar: CalendarSlug;
  submittedAt: Date;
  /** Null for an Event that an Editor made pending by hand (no Submitter). */
  submitterName: string | null;
  /** The first date: "Tue, Oct 13, 6:00 pm". */
  when: string;
  /** The repeat in words, or "One time". */
  repeat: string;
}

const pending = (): SQL => and(eq(events.reviewStatus, "pending"), isNull(events.deletedAt))!;

export async function listReviewQueue(db: Db, { calendar }: { calendar: CalendarSlug | null }): Promise<QueueRow[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(pending(), calendar ? eq(events.calendar, calendar) : undefined))
    .orderBy(asc(events.createdAt), asc(events.id));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    calendar: row.calendar,
    submittedAt: row.createdAt,
    submitterName: row.submitterName,
    when: shortSlot(eventRowToRuleInput(row).timing),
    repeat: row.rrule ? describeRrule(row.rrule) : "One time",
  }));
}

/** The number of Events in the Review queue, for the admin nav. */
export async function countPending(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(events).where(pending());
  return row.n;
}

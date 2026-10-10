/**
 * The chain of a split Series: Events joined by `predecessor_id` links. A split keeps the chain a
 * line (A -> A' -> B). These helpers find the other parts of an Event's chain and the dates that two
 * parts share, so a split or a restore cannot show one date two times.
 */
import { eq, inArray, or } from "drizzle-orm";
import { eventRowToRuleInput } from "@/db/mappers";
import { events, type EventRow } from "@/db/schema";
import type { Db } from "@/db/types";
import {
  addDays,
  type EventRuleInput,
  type LocalDate,
  type OriginalStart,
  ruleStartsBetween,
  timingStart,
} from "@/engine";
import { lastStartDate, type SplitBounds } from "./plan-split";

type Reader = Pick<Db, "select">;

/** No real Series runs this far; an open-ended part "ends" here for the checks. */
const FAR_DATE = "9999-12-31";
/** Shared dates are searched at most this many days from the first possible one. */
const SHARED_SEARCH_DAYS = 366 * 20;

/** Every other Event in the chain of `eventId`, at any distance, deleted ones too. */
export async function loadChainMembers(db: Reader, eventId: string): Promise<EventRow[]> {
  const [self] = await db.select().from(events).where(eq(events.id, eventId));
  if (!self) return [];
  const seen = new Set([self.id]);
  const members: EventRow[] = [];
  let frontier = [self];
  while (frontier.length > 0) {
    const ids = frontier.map((r) => r.id);
    const predecessors = frontier.map((r) => r.predecessorId).filter((id): id is string => id !== null);
    const linked = await db
      .select()
      .from(events)
      .where(
        predecessors.length > 0
          ? or(inArray(events.predecessorId, ids), inArray(events.id, predecessors))
          : inArray(events.predecessorId, ids),
      );
    frontier = linked.filter((r) => !seen.has(r.id));
    for (const row of frontier) {
      seen.add(row.id);
      members.push(row);
    }
  }
  return members;
}

export interface Span {
  first: LocalDate;
  /** Null for an open-ended Series. */
  last: LocalDate | null;
}

export function spanOf(rule: EventRuleInput): Span {
  const first = timingStart(rule.timing).slice(0, 10);
  if (rule.rrule === null) return { first, last: first };
  return { first, last: lastStartDate(rule.timing, rule.rrule) };
}

/**
 * The neighbors of an Event in its chain, from the live parts only (a deleted part frees its
 * dates): the latest last date of the parts that start before it, and the earliest first date of
 * the parts that start after it.
 */
export function boundsFromChain(own: Span, members: EventRow[]): SplitBounds {
  const bounds: SplitBounds = {};
  for (const row of members) {
    if (row.deletedAt !== null) continue;
    const span = spanOf(eventRowToRuleInput(row));
    if (span.first < own.first) {
      const last = span.last ?? FAR_DATE;
      if (!bounds.predecessorLastDate || last > bounds.predecessorLastDate) bounds.predecessorLastDate = last;
    } else if (span.first > own.first) {
      if (!bounds.successorFirstDate || span.first < bounds.successorFirstDate) {
        bounds.successorFirstDate = span.first;
      }
    }
  }
  return bounds;
}

/** The dates (not skipped) of an Event from `from` to `to`, both included. */
function datesBetween(rule: EventRuleInput, from: LocalDate, to: LocalDate): Set<LocalDate> {
  if (rule.rrule === null) {
    const date = timingStart(rule.timing).slice(0, 10);
    return new Set(date >= from && date <= to ? [date] : []);
  }
  const timed = rule.timing.kind === "timed";
  const skipped = new Set<OriginalStart>(rule.exdates);
  const starts = ruleStartsBetween(
    rule.timing,
    rule.rrule,
    timed ? `${from}T00:00` : from,
    timed ? `${to}T23:59` : to,
  );
  return new Set(starts.filter((s) => !skipped.has(s)).map((s) => s.slice(0, 10)));
}

/** The first date that two Events both have, or null. */
export function firstSharedDate(a: EventRuleInput, b: EventRuleInput): LocalDate | null {
  const spanA = spanOf(a);
  const spanB = spanOf(b);
  const from = spanA.first > spanB.first ? spanA.first : spanB.first;
  const lastA = spanA.last ?? FAR_DATE;
  const lastB = spanB.last ?? FAR_DATE;
  let to = lastA < lastB ? lastA : lastB;
  const limit = addDays(from, SHARED_SEARCH_DAYS);
  if (to > limit) to = limit;
  if (from > to) return null;
  const datesB = datesBetween(b, from, to);
  const shared = [...datesBetween(a, from, to)].filter((d) => datesB.has(d)).sort();
  return shared[0] ?? null;
}

/** Test helpers: add Events, Overrides, and Tags to a PGlite database, and make view rows. */
import { ruleInputToColumns } from "@/db/mappers";
import { eventTags, events, tags } from "@/db/schema";
import type { Db } from "@/db/types";
import type { CalendarSlug, EventRuleInput, Timing } from "@/engine";
import type { AgendaRow } from "./occurrence-rows";
import type { SnapshotEvent } from "./snapshot";

export const timed = (day: string, from = "18:00", to = "20:00"): Timing => ({
  kind: "timed",
  start: `${day}T${from}`,
  end: `${day}T${to}`,
});

export const allDay = (startDate: string, endDate = startDate): Timing => ({
  kind: "allDay",
  startDate,
  endDate,
});

export type NewEvent = Partial<typeof events.$inferInsert> & {
  title: string;
  timing?: Timing;
  rrule?: string;
  exdates?: string[];
};

export async function addEvent(
  db: Db,
  { timing = timed("2026-10-14"), rrule, exdates, ...patch }: NewEvent,
) {
  const rule: EventRuleInput = {
    eventId: "",
    timing,
    rrule: rrule ?? null,
    exdates: exdates ?? [],
    scheduleStatus: patch.scheduleStatus ?? "scheduled",
    scheduleNote: patch.scheduleNote ?? null,
  };
  const [row] = await db
    .insert(events)
    .values({ calendar: "rides", reviewStatus: "approved", ...ruleInputToColumns(rule), ...patch })
    .returning();
  return row;
}

export async function addTag(
  db: Db,
  calendar: CalendarSlug,
  name: string,
  slug: string,
  retired = false,
) {
  const [row] = await db
    .insert(tags)
    .values({ calendar, name, slug, retiredAt: retired ? new Date() : null })
    .returning();
  return row;
}

export async function tagEvent(db: Db, eventId: string, tagId: string, calendar: CalendarSlug) {
  await db.insert(eventTags).values({ eventId, tagId, calendar });
}

/** A snapshot Event with defaults, for pure tests. `timing` and `rrule` make its rule. */
export function snapshotEvent(
  patch: Partial<Omit<SnapshotEvent, "rule">> & {
    timing?: Timing;
    rrule?: string;
    scheduleStatus?: EventRuleInput["scheduleStatus"];
    scheduleNote?: string | null;
  } = {},
): SnapshotEvent {
  const { timing = timed("2026-10-14"), rrule, scheduleStatus, scheduleNote, ...rest } = patch;
  const id = rest.id ?? "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  return {
    id,
    calendar: "rides",
    title: "Wednesday Evening Rides",
    description: "",
    location: null,
    imageUrl: null,
    cta: null,
    overrides: [],
    tags: [],
    updatedAt: "2026-10-01T12:00:00.000Z",
    overrideUpdatedAt: {},
    ...rest,
    rule: {
      eventId: id,
      timing,
      rrule: rrule ?? null,
      exdates: [],
      scheduleStatus: scheduleStatus ?? "scheduled",
      scheduleNote: scheduleNote ?? null,
    },
  };
}

/** A view row with defaults, for pure tests. */
export function row(patch: Partial<AgendaRow> = {}): AgendaRow {
  const timing = patch.timing ?? timed("2026-10-14");
  const originalTiming = patch.originalTiming ?? timing;
  return {
    eventId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    calendar: "rides",
    originalStart: originalTiming.kind === "timed" ? originalTiming.start : originalTiming.startDate,
    timing,
    originalTiming,
    title: "Tuesday Night Ride",
    description: "",
    location: null,
    imageUrl: null,
    tags: [],
    cta: null,
    scheduleStatus: "scheduled",
    scheduleNote: null,
    lastModified: "2026-10-01T12:00:00.000Z",
    ...patch,
  };
}

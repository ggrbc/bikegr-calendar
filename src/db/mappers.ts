/**
 * Maps database rows to the Occurrence engine contract (src/engine/types.ts). The engine never
 * imports the schema; this is the one place that knows both.
 */
import type { EventRuleInput, OverrideInput, Timing } from "@/engine/types";
import type { EventRow, OverrideRow } from "./schema";

type TimingColumns = Pick<EventRow, "startLocal" | "endLocal" | "startDate" | "endDate">;

function toTiming(allDay: boolean, row: TimingColumns, what: string): Timing {
  if (allDay) {
    if (row.startDate && row.endDate) {
      return { kind: "allDay", startDate: row.startDate, endDate: row.endDate };
    }
  } else if (row.startLocal && row.endLocal) {
    return { kind: "timed", start: row.startLocal, end: row.endLocal };
  }
  throw new Error(`${what} has an incomplete timing shape`);
}

export type EventRuleColumns = Pick<
  EventRow,
  "id" | "allDay" | "rrule" | "exdates" | "scheduleStatus" | "scheduleNote"
> &
  TimingColumns;

export function eventRowToRuleInput(row: EventRuleColumns): EventRuleInput {
  return {
    eventId: row.id,
    timing: toTiming(row.allDay, row, `Event ${row.id}`),
    rrule: row.rrule,
    exdates: row.exdates,
    scheduleStatus: row.scheduleStatus,
    scheduleNote: row.scheduleNote,
  };
}

export type OverrideColumns = Pick<
  OverrideRow,
  | "eventId"
  | "originalStart"
  | "allDay"
  | "title"
  | "location"
  | "scheduleStatus"
  | "scheduleNote"
> &
  TimingColumns;

/** Null columns mean "no change", so they become absent fields (not `undefined` keys). */
export function overrideRowToInput(row: OverrideColumns): OverrideInput {
  const input: OverrideInput = { eventId: row.eventId, originalStart: row.originalStart };
  if (row.allDay !== null) {
    input.timing = toTiming(row.allDay, row, `Override ${row.eventId} ${row.originalStart}`);
  }
  if (row.title !== null) input.title = row.title;
  if (row.location !== null) input.location = row.location;
  if (row.scheduleStatus !== null) input.scheduleStatus = row.scheduleStatus;
  if (row.scheduleNote !== null) input.scheduleNote = row.scheduleNote;
  return input;
}

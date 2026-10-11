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
  Partial<Pick<EventRow, "occurrenceDetails">> &
  TimingColumns;

export function eventRowToRuleInput(row: EventRuleColumns): EventRuleInput {
  return {
    eventId: row.id,
    timing: toTiming(row.allDay, row, `Event ${row.id}`),
    rrule: row.rrule,
    exdates: row.exdates,
    scheduleStatus: row.scheduleStatus,
    scheduleNote: row.scheduleNote,
    ...(row.occurrenceDetails ? { occurrenceDetails: row.occurrenceDetails } : {}),
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
  Partial<Pick<OverrideRow, "occurrenceDetails">> &
  TimingColumns;

// ---------------------------------------------------------------------------------------------
// Write direction: engine contract -> row values. Each is the inverse of a read mapper above.

type TimingColumnValues = { allDay: boolean } & {
  startLocal: string | null;
  endLocal: string | null;
  startDate: string | null;
  endDate: string | null;
};

function timingToColumns(timing: Timing): TimingColumnValues {
  return timing.kind === "allDay"
    ? {
        allDay: true,
        startLocal: null,
        endLocal: null,
        startDate: timing.startDate,
        endDate: timing.endDate,
      }
    : { allDay: false, startLocal: timing.start, endLocal: timing.end, startDate: null, endDate: null };
}

export type RuleColumns = Omit<EventRuleColumns, "id">;

/** The timing, rule, and Schedule columns of an Event. `eventId` is not a column here. */
export function ruleInputToColumns(rule: EventRuleInput): RuleColumns {
  return {
    ...timingToColumns(rule.timing),
    rrule: rule.rrule,
    exdates: rule.exdates,
    scheduleStatus: rule.scheduleStatus,
    scheduleNote: rule.scheduleNote,
  };
}

export function ctaToColumns(
  cta: { label: string; url: string } | null,
): Pick<EventRow, "ctaLabel" | "ctaUrl"> {
  return { ctaLabel: cta?.label ?? null, ctaUrl: cta?.url ?? null };
}

/**
 * Absent fields become null columns ("no change"). `eventId` is the database id of the Event, not
 * the `eventId` in the input (the import uses the Source ID there).
 */
export function overrideInputToRow(override: OverrideInput, eventId: string): OverrideColumns {
  const timing: Pick<OverrideRow, "allDay" | "startLocal" | "endLocal" | "startDate" | "endDate"> =
    override.timing
      ? timingToColumns(override.timing)
      : { allDay: null, startLocal: null, endLocal: null, startDate: null, endDate: null };
  return {
    eventId,
    originalStart: override.originalStart,
    ...timing,
    title: override.title ?? null,
    location: override.location ?? null,
    scheduleStatus: override.scheduleStatus ?? null,
    scheduleNote: override.scheduleNote ?? null,
    occurrenceDetails: override.occurrenceDetails ?? null,
  };
}

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
  if (row.occurrenceDetails) input.occurrenceDetails = row.occurrenceDetails;
  return input;
}

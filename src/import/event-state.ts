/**
 * The import-owned state of one Event: the fields the Tockify import writes, in one canonical
 * shape. The writer compares the state from the feed with the state in the database; equal state
 * means no write. Fields the import does not own (Review status, soft delete, audit fields) are
 * not in it.
 *
 * Both sides use the row shape: the import side goes through the write mappers, so a value that
 * the database cannot store (an Override's `scheduleNote: null`) compares the same as its stored form.
 */
import {
  ctaToColumns,
  type OverrideColumns,
  overrideInputToRow,
  type RuleColumns,
  ruleInputToColumns,
} from "@/db/mappers";
import type { EventRow } from "@/db/schema";
import type { OverrideInput } from "@/engine";
import type { ImportedEvent } from "./types";

type OverrideState = Omit<OverrideColumns, "eventId">;

export interface EventState extends RuleColumns {
  calendar: EventRow["calendar"];
  title: string;
  description: string;
  location: string | null;
  /** Absent when the image was not copied in this run: the stored value stays. */
  imageUrl?: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  ctaSkipDetails: boolean;
  tagSlugs: string[];
  overrides: OverrideState[];
}

export interface StateOptions {
  /** False when the image was not copied in this run, so `image_url` is not compared or written. */
  includeImage: boolean;
}

export type EventStateColumns = Pick<
  EventRow,
  | "calendar"
  | "title"
  | "description"
  | "location"
  | "imageUrl"
  | "ctaLabel"
  | "ctaUrl"
  | "ctaSkipDetails"
  | "allDay"
  | "startLocal"
  | "endLocal"
  | "startDate"
  | "endDate"
  | "rrule"
  | "exdates"
  | "scheduleStatus"
  | "scheduleNote"
>;

export function stateFromImport(
  event: ImportedEvent,
  overrides: OverrideInput[],
  options: StateOptions,
): EventState {
  return build(
    {
      calendar: event.calendar,
      title: event.title,
      description: event.description,
      location: event.location,
      imageUrl: event.imageUrl,
      ...ctaToColumns(event.cta),
      ...ruleInputToColumns(event.rule),
    },
    overrides.map((o) => overrideInputToRow(o, "")),
    event.tagSlugs,
    options,
  );
}

export function stateFromRows(
  row: EventStateColumns,
  overrides: OverrideColumns[],
  tagSlugs: string[],
  options: StateOptions,
): EventState {
  return build(row, overrides, tagSlugs, options);
}

function build(
  row: EventStateColumns,
  overrides: OverrideColumns[],
  tagSlugs: string[],
  { includeImage }: StateOptions,
): EventState {
  const state: EventState = {
    calendar: row.calendar,
    title: row.title,
    description: row.description,
    location: row.location,
    ctaLabel: row.ctaLabel,
    ctaUrl: row.ctaUrl,
    ctaSkipDetails: row.ctaSkipDetails,
    allDay: row.allDay,
    startLocal: row.startLocal,
    endLocal: row.endLocal,
    startDate: row.startDate,
    endDate: row.endDate,
    rrule: row.rrule,
    exdates: [...row.exdates].sort(),
    scheduleStatus: row.scheduleStatus,
    scheduleNote: row.scheduleNote,
    tagSlugs: [...new Set(tagSlugs)].sort(),
    overrides: overrides
      .map(
        (o): OverrideState => ({
          originalStart: o.originalStart,
          allDay: o.allDay,
          startLocal: o.startLocal,
          endLocal: o.endLocal,
          startDate: o.startDate,
          endDate: o.endDate,
          title: o.title,
          location: o.location,
          scheduleStatus: o.scheduleStatus,
          scheduleNote: o.scheduleNote,
        }),
      )
      .sort((a, b) => a.originalStart.localeCompare(b.originalStart)),
  };
  if (includeImage) state.imageUrl = row.imageUrl;
  return state;
}

export function sameState(a: EventState, b: EventState): boolean {
  return stableJson(a) === stableJson(b);
}

/** `JSON.stringify` with object keys sorted at every level. Arrays keep their order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

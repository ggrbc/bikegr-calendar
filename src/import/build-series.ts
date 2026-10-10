/**
 * Builds import records for one Tockify Event (all Occurrences that share an `<eventId>`).
 *
 * - One Occurrence: a one-time Event with its own Schedule status.
 * - More: a Series. Its base values are the most common values over its Occurrences. Occurrences
 *   that differ in title, location, time slot, or Schedule status become Overrides. If the
 *   description, image, CTA, or Tags differ (an Override cannot hold them), the most common value
 *   is used and the Series is flagged `contentDiffers`.
 * - If no rule passes the exact-match check, each Occurrence becomes a one-time Event with Source ID
 *   `<eventId>/<startMinutes>`, and the Series is flagged `ruleNotInferred`.
 */
import {
  sameTiming,
  shiftTiming,
  timingLength,
  timingStart,
  type LocalDate,
  type OriginalStart,
  type OverrideInput,
  type Timing,
} from "@/engine";
import { assignCalendar, cleanTags, tagSlug } from "./calendar-and-tags";
import { inferRule } from "./infer-rule";
import type { ImportFlag, ImportedEvent, SeriesReport, TockifyOccurrence } from "./types";

export interface BuiltEvent {
  events: ImportedEvent[];
  overrides: OverrideInput[];
  flags: ImportFlag[];
  /** `null` for a one-time Event. */
  report: SeriesReport | null;
}

export function buildEvent(group: TockifyOccurrence[], feedHorizon: LocalDate): BuiltEvent {
  const occurrences = [...group].sort((a, b) => a.startMinutes - b.startMinutes);
  const sourceId = occurrences[0].tockifyEventId;
  const calendar = assignCalendar(
    mostCommon(occurrences.map((o) => o.title)),
    occurrences.flatMap((o) => o.categories),
  );

  if (occurrences.length === 1) {
    const event = oneTimeEvent(occurrences[0], sourceId, calendar);
    return { events: [event], overrides: [], flags: [], report: null };
  }

  const base = baseValues(occurrences);
  const flags: ImportFlag[] = [];
  if (base.differing.length > 0) {
    flags.push({
      sourceId,
      title: base.title,
      reason: "contentDiffers",
      detail:
        `These fields differ between Occurrences: ${base.differing.join(", ")}. ` +
        "The most common value is used.",
    });
  }

  // Each Occurrence's original start: its date at the Series' usual time of day.
  const originalStarts = occurrences.map((o) => originalStartOf(o.timing, base.slot));
  const firstTiming = shiftTiming(base.slot, originalStarts[0]);
  const duplicateDate = new Set(originalStarts).size !== originalStarts.length;
  const inferred = duplicateDate
    ? ({ ok: false, reason: "two Occurrences start on one date" } as const)
    : inferRule({ timing: firstTiming, originalStarts, feedHorizon });

  if (!inferred.ok) {
    flags.push({
      sourceId,
      title: base.title,
      reason: "ruleNotInferred",
      detail: `No rule found (${inferred.reason}). Imported as ${occurrences.length} one-time Events.`,
    });
    return {
      events: occurrences.map((o) => oneTimeEvent(o, `${sourceId}/${o.startMinutes}`, calendar)),
      overrides: [],
      flags,
      report: {
        sourceId,
        title: base.title,
        occurrences: occurrences.length,
        outcome: "flagged",
        rrule: null,
        until: null,
        exdates: 0,
        overrides: 0,
      },
    };
  }

  const overrides = occurrences.flatMap((o, i) => {
    const change = overrideFor(o, originalStarts[i], base, sourceId);
    return change ? [change] : [];
  });

  const event: ImportedEvent = {
    sourceId,
    calendar,
    title: base.title,
    description: base.description,
    location: base.location,
    tagSlugs: base.tags.map(tagSlug),
    imageUrl: base.imageUrl,
    cta: base.cta,
    rule: {
      eventId: sourceId,
      timing: firstTiming,
      rrule: inferred.rrule,
      exdates: inferred.exdates,
      scheduleStatus: "scheduled",
      scheduleNote: null,
    },
  };
  return {
    events: [event],
    overrides,
    flags,
    report: {
      sourceId,
      title: base.title,
      occurrences: occurrences.length,
      outcome: "rule",
      rrule: inferred.rrule,
      until: inferred.until,
      exdates: inferred.exdates.length,
      overrides: overrides.length,
    },
  };
}

function oneTimeEvent(
  occurrence: TockifyOccurrence,
  sourceId: string,
  calendar: ImportedEvent["calendar"],
): ImportedEvent {
  return {
    sourceId,
    calendar,
    title: occurrence.title,
    description: occurrence.description,
    location: occurrence.location,
    tagSlugs: cleanTags(occurrence.categories).map(tagSlug),
    imageUrl: occurrence.imageUrl,
    cta: occurrence.cta,
    rule: {
      eventId: sourceId,
      timing: occurrence.timing,
      rrule: null,
      exdates: [],
      scheduleStatus: occurrence.scheduleStatus,
      scheduleNote: null,
    },
  };
}

interface BaseValues {
  title: string;
  description: string;
  location: string | null;
  imageUrl: string | null;
  cta: TockifyOccurrence["cta"];
  tags: string[];
  /** The usual time slot, at the date of the first Occurrence. Only its time and length matter. */
  slot: Timing;
  /** Names of the fields that differ but cannot be Overrides. */
  differing: string[];
}

function baseValues(occurrences: TockifyOccurrence[]): BaseValues {
  const differing: string[] = [];
  const pick = <T>(field: string, values: T[], key: (value: T) => string = JSON.stringify): T => {
    if (new Set(values.map(key)).size > 1) differing.push(field);
    return mostCommon(values, key);
  };
  const base: BaseValues = {
    title: mostCommon(occurrences.map((o) => o.title)),
    location: mostCommon(occurrences.map((o) => o.location)),
    description: pick("description", occurrences.map((o) => o.description)),
    imageUrl: pick("image", occurrences.map((o) => o.imageUrl)),
    cta: pick("CTA", occurrences.map((o) => o.cta)),
    tags: pick("Tags", occurrences.map((o) => cleanTags(o.categories))),
    slot: mostCommon(occurrences.map((o) => o.timing), slotKey),
    differing,
  };
  // An Override cannot remove a location, so a missing location on some Occurrences is flagged.
  if (base.location !== null && occurrences.some((o) => o.location === null)) {
    differing.push("location");
  }
  return base;
}

/** Same kind, same time of day, same length. */
function slotKey(timing: Timing): string {
  return timing.kind === "timed"
    ? `timed ${timing.start.slice(11)} ${timingLength(timing)}`
    : `allDay ${timingLength(timing)}`;
}

function originalStartOf(actual: Timing, slot: Timing): OriginalStart {
  const date = timingStart(actual).slice(0, 10);
  return slot.kind === "timed" ? `${date}T${slot.start.slice(11)}` : date;
}

function overrideFor(
  occurrence: TockifyOccurrence,
  originalStart: OriginalStart,
  base: BaseValues,
  sourceId: string,
): OverrideInput | null {
  const change: OverrideInput = { eventId: sourceId, originalStart };
  if (!sameTiming(occurrence.timing, shiftTiming(base.slot, originalStart))) {
    change.timing = occurrence.timing;
  }
  if (occurrence.title !== base.title) change.title = occurrence.title;
  if (occurrence.location !== null && occurrence.location !== base.location) {
    change.location = occurrence.location;
  }
  if (occurrence.scheduleStatus !== "scheduled") change.scheduleStatus = occurrence.scheduleStatus;
  return Object.keys(change).length > 2 ? change : null;
}

/** The value that occurs most often; on a tie, the one seen first. */
function mostCommon<T>(values: T[], key: (value: T) => string = JSON.stringify): T {
  const counts = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    const k = key(value);
    const entry = counts.get(k);
    if (entry) entry.count++;
    else counts.set(k, { value, count: 1 });
  }
  let best: { value: T; count: number } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best!.value;
}

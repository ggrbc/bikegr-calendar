/**
 * The Tockify import, pure part: ICS feed in, plain import records out. No database, no network,
 * no image copy. The caller upserts the records by Source ID, so the import is safe to run again.
 */
import { timingStart, type LocalDate } from "@/engine";
import { buildEvent } from "./build-series";
import { parseIcsEvents } from "./ics";
import { toTockifyOccurrence } from "./tockify-occurrence";
import type { ImportResult, ImportedTag, TockifyOccurrence } from "./types";

/** Give the feed as bytes when you can (see `parseIcsEvents`). */
export function importTockify(ics: string | Uint8Array): ImportResult {
  const occurrences = parseIcsEvents(ics).map(toTockifyOccurrence);
  if (occurrences.length === 0) throw new Error("The Tockify feed has no events");

  const feedHorizon = latestStartDate(occurrences);
  const groups = groupByEvent(occurrences);
  const built = [...groups.keys()]
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((eventId) => buildEvent(groups.get(eventId)!, feedHorizon));

  const events = built.flatMap((b) => b.events);
  return {
    feedHorizon,
    events,
    overrides: built.flatMap((b) => b.overrides),
    tags: tagList(built.flatMap((b) => b.tags)),
    flags: built.flatMap((b) => b.flags),
    series: built.flatMap((b) => (b.report ? [b.report] : [])),
  };
}

/** The feed horizon: the latest Occurrence start date in the whole feed. */
function latestStartDate(occurrences: TockifyOccurrence[]): LocalDate {
  return occurrences
    .map((o) => timingStart(o.timing).slice(0, 10))
    .reduce((latest, date) => (date > latest ? date : latest));
}

function groupByEvent(occurrences: TockifyOccurrence[]): Map<string, TockifyOccurrence[]> {
  const groups = new Map<string, TockifyOccurrence[]>();
  for (const occurrence of occurrences) {
    const group = groups.get(occurrence.tockifyEventId) ?? [];
    group.push(occurrence);
    groups.set(occurrence.tockifyEventId, group);
  }
  return groups;
}

/**
 * One Tag per Calendar and slug. The Events are in Source ID order, so the first name for a slug
 * does not depend on the order of the feed.
 */
function tagList(eventTags: ImportedTag[]): ImportedTag[] {
  const tags = new Map<string, ImportedTag>();
  for (const tag of eventTags) {
    const key = `${tag.calendar}/${tag.slug}`;
    if (!tags.has(key)) tags.set(key, tag);
  }
  return [...tags.values()].sort(
    (a, b) => a.calendar.localeCompare(b.calendar) || a.slug.localeCompare(b.slug),
  );
}

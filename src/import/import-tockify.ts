/**
 * The Tockify import, pure part: ICS feed in, plain import records out. No database, no network,
 * no image copy. The caller upserts the records by Source ID, so the import is safe to run again.
 */
import { timingStart } from "@/engine/timing";
import type { LocalDate } from "@/engine/types";
import { buildEvent } from "./build-series";
import { cleanTags, tagSlug } from "./calendar-and-tags";
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
    tags: tagList(events, occurrences),
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

/** One Tag per Calendar and slug, for every Tag that an imported Event uses. */
function tagList(events: ImportResult["events"], occurrences: TockifyOccurrence[]): ImportedTag[] {
  const nameBySlug = new Map<string, string>();
  for (const name of occurrences.flatMap((o) => cleanTags(o.categories))) {
    if (!nameBySlug.has(tagSlug(name))) nameBySlug.set(tagSlug(name), name);
  }
  const tags = new Map<string, ImportedTag>();
  for (const event of events) {
    for (const slug of event.tagSlugs) {
      const key = `${event.calendar}/${slug}`;
      if (!tags.has(key)) tags.set(key, { calendar: event.calendar, name: nameBySlug.get(slug)!, slug });
    }
  }
  return [...tags.values()].sort(
    (a, b) => a.calendar.localeCompare(b.calendar) || a.slug.localeCompare(b.slug),
  );
}

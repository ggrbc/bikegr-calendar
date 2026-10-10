/**
 * The Tockify import, pure part: ICS feed in, plain import records out. No database, no network,
 * no image copy. The caller upserts the records by Source ID, so the import is safe to run again.
 */
import { checkLocalDate } from "@/engine";
import { buildEvent } from "./build-series";
import { parseIcsEvents } from "./ics";
import { openEndedAfter } from "./infer-rule";
import { toTockifyOccurrence } from "./tockify-occurrence";
import type { ImportOptions, ImportResult, ImportedTag, TockifyOccurrence } from "./types";

/**
 * Give the feed as bytes when you can (see `parseIcsEvents`). `importDate` decides which Series are
 * open-ended, so the same feed and date always give the same result.
 */
export function importTockify(ics: string | Uint8Array, { importDate }: ImportOptions): ImportResult {
  checkLocalDate(importDate, "importDate");
  const occurrences = parseIcsEvents(ics).map(toTockifyOccurrence);
  if (occurrences.length === 0) throw new Error("The Tockify feed has no events");

  const groups = groupByEvent(occurrences);
  const built = [...groups.keys()]
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((eventId) => buildEvent(groups.get(eventId)!, importDate));

  return {
    importDate,
    openEndedAfter: openEndedAfter(importDate),
    events: built.flatMap((b) => b.events),
    overrides: built.flatMap((b) => b.overrides),
    tags: tagList(built.flatMap((b) => b.tags)),
    flags: built.flatMap((b) => b.flags),
    series: built.flatMap((b) => (b.report ? [b.report] : [])),
  };
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

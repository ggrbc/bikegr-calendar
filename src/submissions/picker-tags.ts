/**
 * The active Tags of both Calendars for the public form, cached like the public snapshot
 * (src/agenda/cache.ts). Each Tag change in the admin clears the `public-events` tag, so the form
 * shows a new or retired Tag at once.
 */
import { cacheLife, cacheTag } from "next/cache";
import { listPickerTags, type PickerTag } from "@/admin/tags/tags";
import { PUBLIC_EVENTS_TAG } from "@/agenda/cache";
import { getDb } from "@/db";
import type { CalendarSlug } from "@/engine";

export async function cachedPickerTags(): Promise<Record<CalendarSlug, PickerTag[]>> {
  "use cache: remote";
  cacheTag(PUBLIC_EVENTS_TAG);
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 });
  const db = getDb();
  return { rides: await listPickerTags(db, "rides"), advocacy: await listPickerTags(db, "advocacy") };
}

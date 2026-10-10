/**
 * The cached Calendar snapshot for the public side (agenda pages, Embed, Feeds, detail page).
 *
 * - `"use cache: remote"`: on Vercel, all instances share the entry (Vercel Runtime Cache; on Hobby,
 *   the item limit is 2 MB, and the snapshot of the Bike GR data is far smaller). Plain `"use cache"`
 *   is in memory per instance, with low hit rates on serverless.
 * - One entry per Calendar (and one for All). The snapshot does not depend on the date, so one entry
 *   serves every window and filter.
 * - Admin Server Actions call {@link invalidatePublicEvents} after each change to an Event, an
 *   Override, or a Tag, so the Editor sees the change at once.
 * - The Tockify import CLI runs outside the app and cannot invalidate: after an import, the public
 *   side is stale for at most one hour (`revalidate`). A redeploy starts with an empty cache (the
 *   cache key includes the deployment).
 */
import { cacheLife, cacheTag, updateTag } from "next/cache";
import { getDb } from "@/db";
import type { CalendarSlug } from "@/engine";
import { type CalendarSnapshot, loadSnapshot } from "./snapshot";

export const PUBLIC_EVENTS_TAG = "public-events";

export async function cachedSnapshot(calendar: CalendarSlug | null): Promise<CalendarSnapshot> {
  "use cache: remote";
  cacheTag(PUBLIC_EVENTS_TAG);
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 });
  return loadSnapshot(getDb(), calendar);
}

/** Call at the end of each admin Server Action that changes an Event, an Override, or a Tag. */
export function invalidatePublicEvents(): void {
  updateTag(PUBLIC_EVENTS_TAG);
}

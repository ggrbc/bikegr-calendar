/**
 * Stand-ins for modules of the parallel stream `admin-people-tags-images`, with the agreed
 * interface (plan: "Contract with the parallel stream"). When that stream merges, import
 * `listPickerTags` from `@/admin/tags/tags` and `isEventImageUrl` from `@/admin/images/image-url`
 * instead, and delete this file.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { tags } from "@/db/schema";
import type { Db } from "@/db/types";
import type { CalendarSlug } from "@/engine";

export interface PickerTag {
  id: string;
  name: string;
  slug: string;
}

/** The active Tags of one Calendar, sorted by name. */
export async function listPickerTags(db: Db, calendar: CalendarSlug): Promise<PickerTag[]> {
  return db
    .select({ id: tags.id, name: tags.name, slug: tags.slug })
    .from(tags)
    .where(and(eq(tags.calendar, calendar), isNull(tags.retiredAt)))
    .orderBy(asc(tags.name));
}

/** Stand-in check: any https URL. The real check accepts only URLs that the upload makes. */
export function isEventImageUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

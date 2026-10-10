import type { Metadata } from "next";
import type { FilterParams } from "@/agenda/filters";
import { calendarName, calendarPath, SITE_ORIGIN } from "@/agenda/site";
import { EMBED_ROOT_ID } from "@/embed/protocol";
import type { CalendarSlug } from "@/engine";
import { AgendaList } from "../../_components/agenda-list";

/** Embed views are not for search engines; the standalone page is the canonical one. */
export function embedMetadata(calendar: CalendarSlug | null): Metadata {
  return {
    title: `${calendarName(calendar)} — Bike GR Calendar`,
    robots: { index: false, follow: true },
    alternates: { canonical: `${SITE_ORIGIN}${calendarPath(calendar)}` },
  };
}

/**
 * One Calendar inside a Squarespace page (an iframe placed by public/embed.js). No header and no
 * site chrome. The background is the bikegr.org page gray (#F2F2F3), the color of the Squarespace
 * section around the iframe, so the Embed does not look like a box. The root element is what the
 * iframe measures for its height. Blocking like the standalone pages (`instant = false`).
 */
export function EmbedPage({
  calendar,
  searchParams,
}: {
  calendar: CalendarSlug | null;
  searchParams: Promise<FilterParams>;
}) {
  return (
    <main id={EMBED_ROOT_ID} className="w-full bg-brand-page px-1 py-2 text-brand-gray sm:px-2">
      <AgendaList calendar={calendar} searchParams={searchParams} variant="embed" />
    </main>
  );
}

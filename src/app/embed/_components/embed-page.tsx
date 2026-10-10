import type { Metadata } from "next";
import { Suspense } from "react";
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
 * One Calendar inside a Squarespace page (an iframe placed by public/embed.js). No site chrome: no
 * home link and no Calendar switcher. The root element is what the iframe measures for its height.
 */
export function EmbedPage({
  calendar,
  searchParams,
}: {
  calendar: CalendarSlug | null;
  searchParams: Promise<FilterParams>;
}) {
  return (
    <main id={EMBED_ROOT_ID} className="w-full bg-white px-3 py-3 text-gray-900">
      <p className="mb-3 text-xs text-gray-700">
        <a href={`${SITE_ORIGIN}${calendarPath(calendar)}`} target="_blank" rel="noopener" className="underline">
          Bike GR Calendar · {calendarName(calendar)}
        </a>
      </p>
      <Suspense fallback={<p className="text-gray-700">Loading events…</p>}>
        <AgendaList calendar={calendar} searchParams={searchParams} variant="embed" />
      </Suspense>
    </main>
  );
}

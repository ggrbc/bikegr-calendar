import type { FilterParams } from "@/agenda/filters";
import type { CalendarSlug } from "@/engine";
import { AgendaList } from "./agenda-list";
import { pillButton } from "./filter-form";
import { SiteHeader } from "./site-header";

/**
 * The bikegr.org header, the page heading, and the agenda. Blocking, not streamed: each page file
 * sets `instant = false`, and there is no <Suspense>, so the first HTML has the events. A streamed
 * Suspense boundary needs JavaScript to show its content, and the filter form must work without
 * JavaScript (the Apply button submits it). The snapshot is cached, so the wait is short.
 * Flat like bikegr.org: the page gray, no boxed panels, a lot of white space.
 */
export function AgendaPage({
  title,
  calendar,
  searchParams,
}: {
  title: string;
  calendar: CalendarSlug | null;
  searchParams: Promise<FilterParams>;
}) {
  return (
    <>
      <SiteHeader />
      <main className="w-full flex-1 bg-brand-page text-brand-gray">
        <div className="mx-auto max-w-[1100px] px-6 py-12 sm:px-[38px] sm:py-16">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <h1 className="font-chivo text-[34px] font-normal leading-tight sm:text-[46.72px]">{title}</h1>
            {/* Standalone pages only; the Embed has no link (the Squarespace pages have their own). */}
            <a href={calendar ? `/submit?calendar=${calendar}` : "/submit"} className={pillButton}>
              Submit an Event
            </a>
          </div>
          <AgendaList calendar={calendar} searchParams={searchParams} variant="site" />
        </div>
      </main>
    </>
  );
}

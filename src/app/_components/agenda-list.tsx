import { io } from "next/cache";
import { cachedSnapshot } from "@/agenda/cache";
import { eventsFromHeading } from "@/agenda/card-text";
import { todayInDetroit } from "@/agenda/dates";
import { type FilterParams, hasContentFilters, parseFilters, serializeFilters } from "@/agenda/filters";
import { loadAgenda } from "@/agenda/load-agenda";
import { calendarPath } from "@/agenda/site";
import type { CalendarSlug } from "@/engine";
import { feedPath, webcalUrl } from "@/feeds/feed";
import { ResizeReporter } from "../embed/_components/resize-reporter";
import { CanonicalQuery } from "./canonical-query";
import { FilterForm } from "./filter-form";
import { OccurrenceCard } from "./occurrence-card";

export { CALENDAR_NAMES } from "@/agenda/site";

export type AgendaVariant = "site" | "embed";

/**
 * The switcher, toolbar, "Events from …" heading, Occurrence list, and Feed link for one Calendar,
 * or all (`calendar` null). Reads the search params, the clock, and the (cached) database, so it
 * must render inside <Suspense>: `io()` stops the prerender here, and `next build` needs no
 * database.
 *
 * Headings: on the site, the page has the h1 (Calendar name), so "Events from …" is an h2 and each
 * title an h3. In the Embed there is no other heading, so "Events from …" is the h1.
 */
export async function AgendaList({
  calendar,
  searchParams,
  variant,
}: {
  calendar: CalendarSlug | null;
  searchParams: Promise<FilterParams>;
  variant: AgendaVariant;
}) {
  const params = await searchParams;
  await io();
  const today = todayInDetroit(new Date());
  const filters = parseFilters(params, today);
  const embed = variant === "embed";
  const path = embed ? `/embed/${calendar ?? "all"}` : calendarPath(calendar);
  // cachedSnapshot() is inside the callback: a missing DATABASE_URL is a load error too.
  const agenda = await loadAgenda(() => cachedSnapshot(calendar), filters);

  if (!agenda.ok) {
    return (
      <p role="alert" className="text-brand-gray">
        Events could not load. Try again later.
      </p>
    );
  }
  const { days, tags } = agenda;
  const calendarTags = calendar ? tags.filter((tag) => tag.calendar === calendar) : tags;
  const feed = feedPath(calendar, filters, today);
  const query = serializeFilters(filters, today);
  const entries = days.flatMap((day) => day.entries);
  const Heading = embed ? "h1" : "h2";
  const external = embed ? { target: "_blank", rel: "noopener" } : {};

  return (
    <>
      <CanonicalQuery query={query} />
      {embed && <ResizeReporter search={query} />}
      <FilterForm action={path} calendar={calendar} filters={filters} tags={calendarTags} today={today} />

      <Heading className="mb-2 font-chivo text-2xl text-brand-gray sm:text-[34px] sm:leading-tight">
        {eventsFromHeading(filters.from)}
      </Heading>

      {entries.length === 0 ? (
        <p className="border-t border-brand-divider py-6 text-brand-gray">
          No events match. Change the filters or the dates.
        </p>
      ) : (
        <ol className="divide-y divide-brand-divider border-t-4 border-brand-orange bg-white sm:border-t sm:border-brand-divider sm:bg-transparent">
          {entries.map((entry) => (
            <OccurrenceCard
              key={entry.key}
              entry={entry}
              showCalendar={calendar === null}
              embed={embed}
              headingLevel={embed ? 2 : 3}
            />
          ))}
        </ol>
      )}

      <p className="mt-6 border-t border-brand-divider pt-4 text-sm text-brand-gray">
        <a href={webcalUrl(feed)} className="font-bold text-brand-green-text underline" {...external}>
          Subscribe in your calendar app
        </a>
        {hasContentFilters(filters) ? " (with these filters)" : ""} · Feed URL:{" "}
        <a href={feed} className="break-all text-brand-green-text underline" {...external}>
          {`calendar.bikegr.org${feed}`}
        </a>
      </p>
    </>
  );
}

import { io } from "next/cache";
import Link from "next/link";
import type { AgendaEntry } from "@/agenda/agenda-days";
import { cachedSnapshot } from "@/agenda/cache";
import { todayInDetroit } from "@/agenda/dates";
import { type FilterParams, hasContentFilters, parseFilters, serializeFilters } from "@/agenda/filters";
import { loadAgenda } from "@/agenda/load-agenda";
import { occurrencePath } from "@/agenda/occurrence-url";
import { CALENDAR_NAMES, calendarPath } from "@/agenda/site";
import type { CalendarSlug } from "@/engine";
import { feedPath, webcalUrl } from "@/feeds/feed";
import { Badge } from "./badge";
import { CalendarSwitcher } from "./calendar-switcher";
import { CanonicalQuery } from "./canonical-query";
import { FilterForm } from "./filter-form";

export { CALENDAR_NAMES } from "@/agenda/site";

export type AgendaVariant = "site" | "embed";

/**
 * The filters, switcher, Feed link, and agenda for one Calendar, or all (`calendar` null). Reads
 * the search params, the clock, and the (cached) database, so it must render inside <Suspense>:
 * `io()` stops the prerender here, and `next build` needs no database.
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
      <p role="alert" className="text-gray-900">
        Events could not load. Try again later.
      </p>
    );
  }
  const { days, tags } = agenda;
  const calendarTags = calendar ? tags.filter((tag) => tag.calendar === calendar) : tags;
  const feed = feedPath(calendar, filters, today);
  const filtered = hasContentFilters(filters);

  return (
    <>
      <CanonicalQuery query={serializeFilters(filters, today)} />
      {!embed && <CalendarSwitcher current={calendar} filters={filters} allTags={tags} today={today} />}
      <FilterForm action={path} calendar={calendar} filters={filters} tags={calendarTags} collapsible={embed} />
      <p className="mb-6 text-sm text-gray-700">
        <a href={webcalUrl(feed)} className="text-blue-800 underline" target={embed ? "_blank" : undefined}>
          Subscribe in your calendar app
        </a>{" "}
        {filtered ? "(with these filters)" : ""} · Feed URL:{" "}
        <a href={feed} className="break-all text-blue-800 underline" target={embed ? "_blank" : undefined}>
          {`calendar.bikegr.org${feed}`}
        </a>
      </p>
      {days.length === 0 ? (
        <p className="text-gray-700">No events match. Change the filters or the dates.</p>
      ) : (
        <div className="space-y-8">
          {days.map((day) => (
            <section key={day.date} aria-labelledby={`day-${day.date}`}>
              <h2
                id={`day-${day.date}`}
                className="mb-3 border-b border-gray-300 pb-1 text-lg font-semibold"
              >
                {day.heading}
              </h2>
              <ul className="space-y-4">
                {day.entries.map((entry) => (
                  <Entry key={entry.key} entry={entry} showCalendar={calendar === null} embed={embed} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function Entry({ entry, showCalendar, embed }: { entry: AgendaEntry; showCalendar: boolean; embed: boolean }) {
  const { row } = entry;
  const struck = row.scheduleStatus === "cancelled" || entry.kind === "movedAway";
  const href = occurrencePath(row.eventId, row.originalStart);
  // In the Embed, detail pages open in a new tab on the calendar domain.
  const linkProps = embed ? { target: "_blank", rel: "noopener" } : {};

  return (
    <li className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <p className="w-44 shrink-0 text-sm text-gray-700">{entry.timeText}</p>
      <div className="min-w-0">
        <p className="font-medium">
          <Link
            href={href}
            {...linkProps}
            className={`text-gray-900 hover:underline ${struck ? "line-through decoration-gray-500" : ""}`}
          >
            {row.title}
          </Link>
          {entry.badge && <Badge text={entry.badge} />}
        </p>
        {entry.kind === "occurrence" && (
          <>
            {row.scheduleNote && <p className="text-sm text-gray-900">{row.scheduleNote}</p>}
            {row.location && <p className="text-sm text-gray-700">{row.location}</p>}
            {(showCalendar || row.tags.length > 0) && (
              <p className="mt-1 flex flex-wrap gap-1 text-xs">
                {showCalendar && (
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-900">
                    {CALENDAR_NAMES[row.calendar]}
                  </span>
                )}
                {row.tags.map((tag) => (
                  <span key={tag.slug} className="rounded bg-gray-100 px-2 py-0.5 text-gray-800">
                    {tag.name}
                  </span>
                ))}
              </p>
            )}
            {row.cta && (
              <a
                href={row.cta.url}
                className="mt-1 inline-block text-sm font-medium text-blue-800 underline"
                rel="noopener noreferrer"
                target="_blank"
              >
                {row.cta.label}
              </a>
            )}
          </>
        )}
      </div>
    </li>
  );
}

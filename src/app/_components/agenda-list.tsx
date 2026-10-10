import { io } from "next/cache";
import type { AgendaEntry } from "@/agenda/agenda-days";
import { agendaWindow, AGENDA_WEEKS, todayInDetroit } from "@/agenda/dates";
import { loadAgenda } from "@/agenda/load-agenda";
import { loadOccurrences } from "@/agenda/load-occurrences";
import { getDb } from "@/db";
import type { CalendarSlug } from "@/engine";

export const CALENDAR_NAMES: Record<CalendarSlug, string> = {
  rides: "Rides & Events",
  advocacy: "Advocacy",
};

/**
 * The agenda for one Calendar, or all (`calendar` null). Reads the clock and the database, so it
 * must render inside <Suspense>: `io()` stops the prerender here, and `next build` needs no database.
 */
export async function AgendaList({ calendar }: { calendar: CalendarSlug | null }) {
  await io();
  const window = agendaWindow(todayInDetroit(new Date()));
  // getDb() is inside the callback: a missing DATABASE_URL is a load error too.
  const agenda = await loadAgenda(() => loadOccurrences(getDb(), window, calendar), window);

  if (!agenda.ok) {
    return (
      <p role="alert" className="text-gray-900">
        Events could not load. Try again later.
      </p>
    );
  }
  const { days } = agenda;
  if (days.length === 0) {
    return <p className="text-gray-700">No events in the next {AGENDA_WEEKS} weeks.</p>;
  }

  return (
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
              <Entry key={entry.key} entry={entry} showCalendar={calendar === null} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Entry({ entry, showCalendar }: { entry: AgendaEntry; showCalendar: boolean }) {
  const { row } = entry;
  const struck = row.scheduleStatus === "cancelled" || entry.kind === "movedAway";

  return (
    <li className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <p className="w-44 shrink-0 text-sm text-gray-700">{entry.timeText}</p>
      <div className="min-w-0">
        <p className="font-medium">
          <span className={struck ? "line-through decoration-gray-500" : undefined}>{row.title}</span>
          {entry.badge && (
            <span className="ml-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
              {entry.badge}
            </span>
          )}
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

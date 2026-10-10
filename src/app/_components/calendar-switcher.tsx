import Link from "next/link";
import { type AgendaFilters, filterHref, switcherFilters } from "@/agenda/filters";
import { calendarName, calendarPath } from "@/agenda/site";
import type { CalendarTag } from "@/agenda/snapshot";
import type { CalendarSlug, LocalDate } from "@/engine";

const TARGETS: (CalendarSlug | null)[] = ["rides", "advocacy", null];

/** Rides & Events | Advocacy | All, keeping the filters that the target can match. */
export function CalendarSwitcher({
  current,
  filters,
  allTags,
  today,
}: {
  current: CalendarSlug | null;
  filters: AgendaFilters;
  /** Active Tags of both Calendars. */
  allTags: CalendarTag[];
  today: LocalDate;
}) {
  return (
    <nav aria-label="Calendars" className="mb-4 flex flex-wrap gap-2 text-sm">
      {TARGETS.map((target) => {
        const active = target === current;
        return (
          <Link
            key={target ?? "all"}
            href={filterHref(calendarPath(target), switcherFilters(filters, target, allTags), today)}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded bg-blue-800 px-3 py-1 font-medium text-white"
                : "rounded border border-blue-800 px-3 py-1 font-medium text-blue-800"
            }
          >
            {target === null ? "All" : calendarName(target)}
          </Link>
        );
      })}
    </nav>
  );
}

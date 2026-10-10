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
                ? "rounded-[300px] border border-brand-green-text bg-brand-green-text px-4 py-1.5 font-chivo font-bold text-white"
                : "rounded-[300px] border border-brand-green-text bg-white px-4 py-1.5 font-chivo font-bold text-brand-green-text hover:bg-brand-page"
            }
          >
            {target === null ? "All" : calendarName(target)}
          </Link>
        );
      })}
    </nav>
  );
}

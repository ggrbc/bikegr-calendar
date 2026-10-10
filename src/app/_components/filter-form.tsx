import { type AgendaFilters, defaultTo, WEEKDAYS, type Weekday } from "@/agenda/filters";
import { CALENDAR_NAMES } from "@/agenda/site";
import type { CalendarTag } from "@/agenda/snapshot";
import type { CalendarSlug, LocalDate } from "@/engine";

const DAY_LABELS: Record<Weekday, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

const input =
  "rounded border border-brand-divider bg-white px-2 py-1 text-sm text-brand-gray focus-visible:border-brand-green-text";
export const greenButton =
  "inline-flex items-center rounded bg-brand-green-text px-3 py-1 font-chivo text-sm font-bold text-white hover:bg-brand-gray";

/**
 * The toolbar (Tockify style, on a light band): search, and a "Filter" control (a <details>
 * element) for the date range, days, and Tags, so the toolbar stays short in a narrow column. A plain HTML GET form, so filters work without JavaScript and every result is a URL.
 * The page makes the URL canonical after the load (CanonicalQuery).
 */
export function FilterForm({
  action,
  calendar,
  filters,
  tags,
  today,
}: {
  today: LocalDate;
  action: string;
  calendar: CalendarSlug | null;
  filters: AgendaFilters;
  tags: CalendarTag[];
}) {
  const groups: { label: string | null; tags: CalendarTag[] }[] =
    calendar === null
      ? (["rides", "advocacy"] as const).map((c) => ({
          label: CALENDAR_NAMES[c],
          tags: tags.filter((tag) => tag.calendar === c),
        }))
      : [{ label: null, tags }];
  const chosen = filters.tags.length + filters.days.length;
  const dated = filters.from !== today || filters.to !== defaultTo(filters.from);

  return (
    <form
      method="get"
      action={action}
      role="search"
      aria-label="Filter events"
      className="mb-6 rounded border border-brand-divider bg-[#f7f7f2] p-3 text-sm text-brand-gray"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="sr-only">Search</span>
          <input
            type="search"
            name="q"
            placeholder="search"
            defaultValue={filters.q}
            maxLength={100}
            className={input}
          />
        </label>
        <button type="submit" className={greenButton}>
          Apply
        </button>
        <a href={action} className="px-1 py-1 font-chivo text-sm font-bold text-brand-green-text underline">
          Clear
        </a>
      </div>

      <details className="mt-2">
        <summary className="inline-flex cursor-pointer select-none items-center rounded border border-brand-green-text px-3 py-1 font-chivo text-sm font-bold text-brand-green-text">
          Filter{chosen > 0 ? ` (${chosen})` : ""}
          {dated ? " · dates set" : ""}
        </summary>
        <div className="mt-3 space-y-3">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 font-chivo font-bold">Dates</legend>
            <label className="flex flex-col gap-1">
              <span className="text-xs">From</span>
              <input type="date" name="from" defaultValue={filters.from} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs">To</span>
              <input type="date" name="to" defaultValue={filters.to} className={input} />
            </label>
          </fieldset>
          <fieldset>
            <legend className="mb-1 font-chivo font-bold">Days</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {WEEKDAYS.map((day) => (
                <label key={day} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="day"
                    value={day}
                    defaultChecked={filters.days.includes(day)}
                    className="accent-brand-green-text"
                  />
                  {DAY_LABELS[day]}
                </label>
              ))}
            </div>
          </fieldset>

          {tags.length > 0 && (
            <fieldset>
              <legend className="mb-1 font-chivo font-bold">Tags (all must match)</legend>
              {groups.map((group) =>
                group.tags.length === 0 ? null : (
                  <div key={group.label ?? "tags"} className="mb-1">
                    {group.label && <p className="text-xs">{group.label}</p>}
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {group.tags.map((tag) => (
                        <label key={`${tag.calendar}/${tag.slug}`} className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            name="tag"
                            value={tag.slug}
                            defaultChecked={filters.tags.includes(tag.slug)}
                            className="accent-brand-green-text"
                          />
                          {tag.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </fieldset>
          )}
          <button type="submit" className={greenButton}>
            Apply filters
          </button>
        </div>
      </details>
    </form>
  );
}

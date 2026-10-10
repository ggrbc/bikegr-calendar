import { type AgendaFilters, defaultTo, WEEKDAYS, type Weekday } from "@/agenda/filters";
import { CALENDAR_NAMES } from "@/agenda/site";
import type { CalendarTag } from "@/agenda/snapshot";
import type { CalendarSlug, LocalDate } from "@/engine";
import { serializeFilters } from "@/agenda/filters";
import { AutoApply } from "./auto-apply";

const DAY_LABELS: Record<Weekday, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

const FORM_ID = "agenda-filters";

// The border #858486 has 3.33:1 on the page gray (WCAG 1.4.11); the placeholder (the only visible
// label of the search box) is the gray at 80%, 5.63:1 on white.
const input =
  "rounded-[300px] border border-[#858486] bg-white px-4 py-2 text-[15px] font-light text-brand-gray placeholder:text-brand-gray/80";

/** bikegr.org buttons: Chivo, white text on orange, pill. The background is the AA variant. */
export const pillButton =
  "inline-flex items-center rounded-[300px] bg-brand-orange-text px-[22px] py-[10px] font-chivo text-[13px] uppercase tracking-[0.02em] text-white hover:bg-brand-gray";

/**
 * The flat toolbar: search, Apply, Clear, and a "Filter" control (a <details> element) for the date
 * range, days, and Tags. A plain HTML GET form, so it works without JavaScript (Apply submits it).
 * With JavaScript, a checkbox or date change applies at once and the search applies on Enter
 * (AutoApply).
 */
export function FilterForm({
  action,
  calendar,
  filters,
  tags,
  today,
}: {
  action: string;
  calendar: CalendarSlug | null;
  filters: AgendaFilters;
  tags: CalendarTag[];
  today: LocalDate;
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
      id={FORM_ID}
      method="get"
      action={action}
      role="search"
      aria-label="Filter events"
      className="mb-8 text-[15px] text-brand-gray"
    >
      <AutoApply formId={FORM_ID} action={action} today={today} query={serializeFilters(filters, today)} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-1 basis-56">
          <span className="sr-only">Search</span>
          <input
            type="search"
            name="q"
            placeholder="Search events"
            defaultValue={filters.q}
            maxLength={100}
            className={`${input} w-full`}
          />
        </label>
        <button type="submit" className={pillButton}>
          Apply
        </button>
        <a href={action} className="font-chivo text-[15px] text-brand-green-text underline underline-offset-4">
          Clear
        </a>
      </div>

      <details className="mt-3">
        <summary className="inline-flex cursor-pointer select-none items-center rounded-[300px] border border-brand-green-text px-[18px] py-[7px] font-chivo text-[13px] uppercase tracking-[0.02em] text-brand-green-text">
          Filter{chosen > 0 ? ` (${chosen})` : ""}
          {dated ? " · dates set" : ""}
        </summary>
        <div className="mt-4 space-y-4 font-light">
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-2 font-chivo font-normal">Dates</legend>
            <label className="flex flex-col gap-1">
              <span className="text-sm">From</span>
              <input type="date" name="from" defaultValue={filters.from} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">To</span>
              <input type="date" name="to" defaultValue={filters.to} className={input} />
            </label>
          </fieldset>

          <fieldset>
            <legend className="mb-2 font-chivo font-normal">Days</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {WEEKDAYS.map((day) => (
                <label key={day} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="day"
                    value={day}
                    defaultChecked={filters.days.includes(day)}
                    className="size-4 accent-brand-green-text"
                  />
                  {DAY_LABELS[day]}
                </label>
              ))}
            </div>
          </fieldset>

          {tags.length > 0 && (
            <fieldset>
              <legend className="mb-2 font-chivo font-normal">Tags (all must match)</legend>
              {groups.map((group) =>
                group.tags.length === 0 ? null : (
                  <div key={group.label ?? "tags"} className="mb-2">
                    {group.label && <p className="text-sm">{group.label}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {group.tags.map((tag) => (
                        <label key={`${tag.calendar}/${tag.slug}`} className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            name="tag"
                            value={tag.slug}
                            defaultChecked={filters.tags.includes(tag.slug)}
                            className="size-4 accent-brand-green-text"
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
        </div>
      </details>
    </form>
  );
}

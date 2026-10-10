import { type AgendaFilters, WEEKDAYS, type Weekday } from "@/agenda/filters";
import { CALENDAR_NAMES } from "@/agenda/site";
import type { CalendarTag } from "@/agenda/snapshot";
import type { CalendarSlug } from "@/engine";

const DAY_LABELS: Record<Weekday, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

/**
 * A plain HTML GET form, so filters work without JavaScript and every result is a URL. The page
 * makes the URL canonical after the load (CanonicalQuery).
 */
export function FilterForm({
  action,
  calendar,
  filters,
  tags,
  collapsible,
}: {
  action: string;
  calendar: CalendarSlug | null;
  filters: AgendaFilters;
  tags: CalendarTag[];
  /** In the Embed, the form is in a closed <details> element, so a narrow column stays short. */
  collapsible: boolean;
}) {
  const groups: { label: string | null; tags: CalendarTag[] }[] =
    calendar === null
      ? (["rides", "advocacy"] as const).map((c) => ({
          label: CALENDAR_NAMES[c],
          tags: tags.filter((tag) => tag.calendar === c),
        }))
      : [{ label: null, tags }];

  const form = (
    <form method="get" action={action} className="space-y-4 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-medium">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            maxLength={100}
            className="rounded border border-gray-400 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">From</span>
          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="rounded border border-gray-400 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">To</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="rounded border border-gray-400 px-2 py-1"
          />
        </label>
      </div>

      <fieldset>
        <legend className="mb-1 font-medium">Days</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {WEEKDAYS.map((day) => (
            <label key={day} className="inline-flex items-center gap-1">
              <input type="checkbox" name="day" value={day} defaultChecked={filters.days.includes(day)} />
              {DAY_LABELS[day]}
            </label>
          ))}
        </div>
      </fieldset>

      {tags.length > 0 && (
        <fieldset>
          <legend className="mb-1 font-medium">Tags (all must match)</legend>
          {groups.map((group) =>
            group.tags.length === 0 ? null : (
              <div key={group.label ?? "tags"} className="mb-1">
                {group.label && <p className="text-xs text-gray-700">{group.label}</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {group.tags.map((tag) => (
                    <label key={`${tag.calendar}/${tag.slug}`} className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        name="tag"
                        value={tag.slug}
                        defaultChecked={filters.tags.includes(tag.slug)}
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

      <div className="flex gap-3">
        <button type="submit" className="rounded bg-blue-800 px-3 py-1 font-medium text-white">
          Apply
        </button>
        <a href={action} className="px-1 py-1 text-blue-800 underline">
          Clear
        </a>
      </div>
    </form>
  );

  if (!collapsible) return <div className="mb-6 rounded border border-gray-300 p-4">{form}</div>;
  return (
    <details className="mb-6 rounded border border-gray-300 p-3">
      <summary className="cursor-pointer text-sm font-medium">Filter events</summary>
      <div className="mt-3">{form}</div>
    </details>
  );
}

import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { CALENDAR_LABELS } from "@/admin/events/format";
import { type EventListRow, listEvents, type ReviewStatus } from "@/admin/events/queries";
import { shortSlot, todayInDetroit } from "@/agenda/dates";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import type { CalendarSlug } from "@/engine";
import {
  Badge,
  buttonClass,
  CalendarTabs,
  EmptyState,
  inputClass,
  labelClass,
  linkClass,
  mutedClass,
  PageHeader,
  REVIEW_LABELS,
  ReviewBadge,
  rowClass,
  ScheduleBadge,
  tableClass,
  tdClass,
  theadRowClass,
  thClass,
} from "../_components/ui";

type Search = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

function hrefWith(search: Search, patch: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const key of ["calendar", "q", "review", "deleted"]) {
    const value = key in patch ? patch[key] : one(search[key]);
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `/admin/events?${text}` : "/admin/events";
}

async function EventList({ searchParams }: { searchParams: Promise<Search> }) {
  const editor = await requireEditor();
  const search = await searchParams;
  await io();
  const isAdmin = editor.role === "admin";
  const calendarParam = one(search.calendar);
  const calendar: CalendarSlug | null =
    calendarParam === "rides" || calendarParam === "advocacy" ? calendarParam : null;
  const reviewParam = one(search.review);
  const review = reviewParam in REVIEW_LABELS ? (reviewParam as ReviewStatus) : null;
  const q = one(search.q);
  // Only Admins see deleted Events; the server ignores the flag from an Editor.
  const includeDeleted = isAdmin && one(search.deleted) === "1";

  const rows = await listEvents(getDb(), {
    calendar,
    q,
    review,
    includeDeleted,
    today: todayInDetroit(new Date()),
  });

  const tabs = [
    { value: "", label: "All" },
    { value: "rides", label: CALENDAR_LABELS.rides },
    { value: "advocacy", label: CALENDAR_LABELS.advocacy },
  ].map((tab) => ({
    href: hrefWith(search, { calendar: tab.value }),
    label: tab.label,
    current: (calendar ?? "") === tab.value,
  }));

  const nextText = (row: EventListRow) => (row.next ? shortSlot(row.next.timing) : "None");
  const badges = (row: EventListRow) => (
    <>
      {row.deleted && <Badge tone="deleted">Deleted</Badge>}
      {row.next && <ScheduleBadge status={row.next.scheduleStatus} />}
    </>
  );

  return (
    <>
      <CalendarTabs tabs={tabs} />

      <form
        method="get"
        action="/admin/events"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-brand-divider bg-white p-4"
      >
        {calendar && <input type="hidden" name="calendar" value={calendar} />}
        <label className="flex min-w-0 grow flex-col gap-1 sm:grow-0">
          <span className={labelClass}>Title</span>
          <input type="search" name="q" defaultValue={q} className={inputClass} placeholder="Search by title" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Review status</span>
          <select name="review" defaultValue={review ?? ""} className={inputClass}>
            <option value="">Any</option>
            {(Object.keys(REVIEW_LABELS) as ReviewStatus[]).map((r) => (
              <option key={r} value={r}>
                {REVIEW_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        {isAdmin && (
          <label className="flex min-h-11 items-center gap-2 sm:min-h-10">
            <input type="checkbox" name="deleted" value="1" defaultChecked={includeDeleted} className="size-4 accent-brand-orange-text" />
            Show deleted
          </label>
        )}
        <button type="submit" className={buttonClass("secondary")}>
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState>No Events match.</EmptyState>
      ) : (
        <div className="rounded-lg border border-brand-divider bg-white px-4 sm:px-6">
          {/* A phone gets a list; the table needs about 700 px. The rows are read-only, so two markups are safe. */}
          <ul className="divide-y divide-brand-divider sm:hidden">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/events/${row.id}`} className={`${linkClass} font-semibold`}>
                    {row.title}
                  </Link>
                  <ReviewBadge status={row.reviewStatus} />
                  {badges(row)}
                </span>
                <span className={mutedClass}>
                  {CALENDAR_LABELS[row.calendar]} · {row.repeat}
                </span>
                <span>Next: {nextText(row)}</span>
              </li>
            ))}
          </ul>
          <table className={`${tableClass} hidden sm:table`}>
            <thead>
              <tr className={theadRowClass}>
                <th className={thClass}>Title</th>
                <th className={thClass}>Calendar</th>
                <th className={thClass}>Repeat</th>
                <th className={thClass}>Next date</th>
                <th className={thClass}>Review status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={rowClass}>
                  <td className={tdClass}>
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/events/${row.id}`} className={linkClass}>
                        {row.title}
                      </Link>
                      {row.deleted && <Badge tone="deleted">Deleted</Badge>}
                    </span>
                  </td>
                  <td className={tdClass}>{CALENDAR_LABELS[row.calendar]}</td>
                  <td className={tdClass}>{row.repeat}</td>
                  <td className={tdClass}>
                    <span className="flex flex-wrap items-center gap-2">
                      {nextText(row)}
                      {row.next && <ScheduleBadge status={row.next.scheduleStatus} />}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <ReviewBadge status={row.reviewStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function AdminEventsPage({ searchParams }: PageProps<"/admin/events">) {
  return (
    <>
      <PageHeader
        title="Events"
        actions={
          <Link href="/admin/events/new" className={buttonClass("primary")}>
            New Event
          </Link>
        }
      />
      <Suspense fallback={<p className={mutedClass}>Loading…</p>}>
        <EventList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

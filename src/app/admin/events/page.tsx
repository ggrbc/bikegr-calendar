import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { CALENDAR_LABELS, statusLabel } from "@/admin/events/format";
import { listEvents, type ReviewStatus } from "@/admin/events/queries";
import { shortSlot, todayInDetroit } from "@/agenda/dates";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import type { CalendarSlug } from "@/engine";

type Search = Record<string, string | string[] | undefined>;

const REVIEW_LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

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

  const tabs: { value: string; label: string }[] = [
    { value: "", label: "All" },
    { value: "rides", label: CALENDAR_LABELS.rides },
    { value: "advocacy", label: CALENDAR_LABELS.advocacy },
  ];

  return (
    <>
      <nav aria-label="Calendars" className="mb-4 flex gap-4 border-b border-gray-300">
        {tabs.map((tab) => {
          const current = (calendar ?? "") === tab.value;
          return (
            <Link
              key={tab.value}
              href={hrefWith(search, { calendar: tab.value })}
              aria-current={current ? "page" : undefined}
              className={`-mb-px border-b-2 px-1 pb-2 ${current ? "border-blue-700 font-semibold" : "border-transparent"}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <form method="get" action="/admin/events" className="mb-4 flex flex-wrap items-end gap-3">
        {calendar && <input type="hidden" name="calendar" value={calendar} />}
        <label className="flex flex-col gap-1">
          <span className="font-medium">Title</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            className="rounded border border-gray-400 px-3 py-2"
            placeholder="Search by title"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Review status</span>
          <select name="review" defaultValue={review ?? ""} className="rounded border border-gray-400 px-3 py-2">
            <option value="">Any</option>
            {(Object.keys(REVIEW_LABELS) as ReviewStatus[]).map((r) => (
              <option key={r} value={r}>
                {REVIEW_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        {isAdmin && (
          <label className="flex items-center gap-2 py-2">
            <input type="checkbox" name="deleted" value="1" defaultChecked={includeDeleted} />
            Show deleted
          </label>
        )}
        <button type="submit" className="rounded border border-gray-400 px-4 py-2">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p>No Events match.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="py-2 pr-3">Title</th>
              <th className="py-2 pr-3">Calendar</th>
              <th className="py-2 pr-3">Repeat</th>
              <th className="py-2 pr-3">Next date</th>
              <th className="py-2">Review status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const badge = row.next ? statusLabel(row.next.scheduleStatus) : null;
              return (
                <tr key={row.id} className="border-b border-gray-200 align-top">
                  <td className="py-2 pr-3">
                    <Link href={`/admin/events/${row.id}`} className="underline">
                      {row.title}
                    </Link>
                    {row.deleted && <span className="ml-2 rounded bg-red-100 px-1 text-sm text-red-900">Deleted</span>}
                  </td>
                  <td className="py-2 pr-3">{CALENDAR_LABELS[row.calendar]}</td>
                  <td className="py-2 pr-3">{row.repeat}</td>
                  <td className="py-2 pr-3">
                    {row.next ? shortSlot(row.next.timing) : "None"}
                    {badge && <span className="ml-2 rounded bg-gray-200 px-1 text-sm">{badge}</span>}
                  </td>
                  <td className="py-2">{REVIEW_LABELS[row.reviewStatus]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

export default function AdminEventsPage({ searchParams }: PageProps<"/admin/events">) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Link href="/admin/events/new" className="rounded bg-blue-700 px-4 py-2 font-medium text-white">
          New Event
        </Link>
      </div>
      <Suspense fallback={<p>Loading…</p>}>
        <EventList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

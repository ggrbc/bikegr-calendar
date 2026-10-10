import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { CALENDAR_LABELS, formatInstantDetroit } from "@/admin/events/format";
import { listRecentChanges } from "@/admin/events/queries";
import { cachedSnapshot } from "@/agenda/cache";
import { shortSlot, todayInDetroit } from "@/agenda/dates";
import { describeError } from "@/agenda/describe-error";
import { type AgendaRow, expandSnapshot } from "@/agenda/occurrence-rows";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import { addDays } from "@/engine";
import { listReviewQueue } from "@/submissions/queue";
import {
  buttonClass,
  Card,
  EmptyState,
  linkClass,
  mutedClass,
  noticeClass,
  PageHeader,
  ScheduleBadge,
} from "./_components/ui";

const WEEK_SHOWN = 8;
const QUEUE_SHOWN = 3;
const CHANGES_SHOWN = 8;

/**
 * The approved Occurrences from today to today + 6, from the public snapshot cache: no database
 * query on a cache hit (the same entry as the public `/` page). Null if it cannot load.
 */
async function thisWeek(today: string): Promise<AgendaRow[] | null> {
  try {
    return expandSnapshot(await cachedSnapshot(null), { from: today, to: addDays(today, 7) });
  } catch (error) {
    console.error(`Admin dashboard: this week could not load: ${describeError(error)}`);
    return null;
  }
}

/**
 * The dashboard. Reads: the Review queue (one query on the partial index), the snapshot cache, and
 * the newest history entries (one query, `limit 8`).
 */
async function AdminHome() {
  const editor = await requireEditor();
  const isAdmin = editor.role === "admin";
  await io();
  const db = getDb();
  const today = todayInDetroit(new Date());
  const [queue, week, changes] = await Promise.all([
    listReviewQueue(db, { calendar: null }),
    thisWeek(today),
    listRecentChanges(db, CHANGES_SHOWN),
  ]);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card title="Waiting for review" titleId="dash-queue">
        <p className="mb-3 flex items-baseline gap-2">
          <span data-testid="pending-count" className="font-chivo text-4xl">
            {queue.length}
          </span>
          <span>{queue.length === 1 ? "Submission waits." : "Submissions wait."}</span>
        </p>
        {queue.length > 0 && (
          <ul className="mb-4 divide-y divide-brand-divider">
            {queue.slice(0, QUEUE_SHOWN).map((row) => (
              <li key={row.id} className="flex flex-col py-2">
                <Link href={`/admin/events/${row.id}`} className={linkClass}>
                  {row.title}
                </Link>
                <span className={`text-sm ${mutedClass}`}>
                  {CALENDAR_LABELS[row.calendar]} · sent {formatInstantDetroit(row.submittedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/admin/review" className={buttonClass(queue.length > 0 ? "primary" : "secondary", "sm")}>
          Open the Review queue
        </Link>
      </Card>

      <Card title="This week" titleId="dash-week">
        {week === null ? (
          <p className={noticeClass("error")}>The dates could not load. Reload the page.</p>
        ) : (
          <>
            <p className="mb-3 flex items-baseline gap-2">
              <span data-testid="week-count" className="font-chivo text-4xl">
                {week.length}
              </span>
              <span>{week.length === 1 ? "public date" : "public dates"} from today to 6 days from now.</span>
            </p>
            {week.length === 0 ? (
              <EmptyState>No public dates this week.</EmptyState>
            ) : (
              <ul className="divide-y divide-brand-divider" data-testid="week-list">
                {week.slice(0, WEEK_SHOWN).map((row) => (
                  <li key={`${row.eventId}-${row.originalStart}`} className="flex flex-col py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/events/${row.eventId}`} className={linkClass}>
                        {row.title}
                      </Link>
                      <ScheduleBadge status={row.scheduleStatus} />
                    </span>
                    <span className={`text-sm ${mutedClass}`}>
                      {shortSlot(row.timing)} · {CALENDAR_LABELS[row.calendar]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {week.length > WEEK_SHOWN && (
              <p className={`mt-2 text-sm ${mutedClass}`}>And {week.length - WEEK_SHOWN} more.</p>
            )}
          </>
        )}
      </Card>

      <Card title="Recent changes" titleId="dash-changes" className="md:col-span-2">
        {changes.length === 0 ? (
          <EmptyState>No changes yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-brand-divider">
            {changes.map((change) => (
              <li key={change.id} className="flex flex-col gap-x-4 py-2 sm:flex-row sm:items-baseline">
                <span className={`shrink-0 text-sm sm:w-64 ${mutedClass}`}>
                  {formatInstantDetroit(change.changedAt)}
                </span>
                <span className="min-w-0">
                  <Link href={`/admin/events/${change.eventId}`} className={linkClass}>
                    {change.title}
                  </Link>
                  {" — "}
                  {change.what} <span className={mutedClass}>({change.who})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Quick links" titleId="dash-links" className="md:col-span-2">
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href="/admin/events/new" className={buttonClass("primary")}>
            New Event
          </Link>
          <Link href="/admin/review" className={buttonClass("secondary")}>
            Review queue
          </Link>
        </div>
        <ul className="flex flex-col gap-1">
          <li>
            <Link href="/admin/events" className={linkClass}>
              Events
            </Link>{" "}
            — create and edit Events in both Calendars.
          </li>
          <li>
            <Link href="/admin/review" className={linkClass}>
              Review queue
            </Link>{" "}
            — approve, change, or reject Submissions from the public form.
          </li>
          <li>
            <Link href="/admin/tags" className={linkClass}>
              Tags
            </Link>{" "}
            — the Tag list of each Calendar.
          </li>
          {isAdmin && (
            <li>
              <Link href="/admin/editors" className={linkClass}>
                Editors
              </Link>{" "}
              — invite, change roles, deactivate.
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}

export default function AdminPage() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <Suspense fallback={<p className={mutedClass}>Loading…</p>}>
        <AdminHome />
      </Suspense>
    </>
  );
}

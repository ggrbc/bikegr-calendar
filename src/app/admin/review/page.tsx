import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { CALENDAR_LABELS, formatInstantDetroit } from "@/admin/events/format";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import type { CalendarSlug } from "@/engine";
import { listReviewQueue } from "@/submissions/queue";
import {
  CalendarTabs,
  EmptyState,
  linkClass,
  mutedClass,
  PageHeader,
  rowClass,
  tableClass,
  tdClass,
  theadRowClass,
  thClass,
} from "../_components/ui";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** The Review queue: pending Events of both Calendars, oldest first. */
async function ReviewQueue({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireEditor();
  const search = await searchParams;
  await io();
  const param = one(search.calendar);
  const calendar: CalendarSlug | null = param === "rides" || param === "advocacy" ? param : null;
  const rows = await listReviewQueue(getDb(), { calendar });

  const tabs = [
    { value: "", label: "All" },
    { value: "rides", label: CALENDAR_LABELS.rides },
    { value: "advocacy", label: CALENDAR_LABELS.advocacy },
  ].map((tab) => ({
    href: tab.value ? `/admin/review?calendar=${tab.value}` : "/admin/review",
    label: tab.label,
    current: (calendar ?? "") === tab.value,
  }));

  return (
    <>
      <CalendarTabs tabs={tabs} />

      {rows.length === 0 ? (
        <EmptyState>No Submissions wait for review.</EmptyState>
      ) : (
        <div className="rounded-lg border border-brand-divider bg-white px-4 sm:px-6">
          {/* A phone gets a list; the table needs about 900 px. */}
          <ul className="divide-y divide-brand-divider sm:hidden">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 py-3">
                <Link href={`/admin/events/${row.id}`} className={`${linkClass} font-semibold`}>
                  {row.title}
                </Link>
                <span>
                  {CALENDAR_LABELS[row.calendar]} · {row.when}
                </span>
                <span>{row.repeat}</span>
                <span className={`text-sm ${mutedClass}`}>
                  {row.submitterName ?? "No Submitter"} · sent {formatInstantDetroit(row.submittedAt)}
                </span>
              </li>
            ))}
          </ul>
          <table className={`${tableClass} hidden sm:table`}>
            <thead>
              <tr className={theadRowClass}>
                <th className={thClass}>Title</th>
                <th className={thClass}>Calendar</th>
                <th className={thClass}>First date</th>
                <th className={thClass}>Repeat</th>
                <th className={thClass}>Submitter</th>
                <th className={thClass}>Sent (Detroit time)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={rowClass}>
                  <td className={tdClass}>
                    <Link href={`/admin/events/${row.id}`} className={linkClass}>
                      {row.title}
                    </Link>
                  </td>
                  <td className={tdClass}>{CALENDAR_LABELS[row.calendar]}</td>
                  <td className={tdClass}>{row.when}</td>
                  <td className={tdClass}>{row.repeat}</td>
                  <td className={tdClass}>{row.submitterName ?? "—"}</td>
                  <td className={`${tdClass} text-sm`}>{formatInstantDetroit(row.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function ReviewQueuePage({ searchParams }: PageProps<"/admin/review">) {
  return (
    <>
      <PageHeader title="Review queue">
        <p className="max-w-2xl">
          Submissions from the public form. They are not public until an Editor approves them. Open one
          to change, approve, or reject it.
        </p>
      </PageHeader>
      <Suspense fallback={<p className={mutedClass}>Loading…</p>}>
        <ReviewQueue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

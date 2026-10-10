import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { CALENDAR_LABELS, formatInstantDetroit } from "@/admin/events/format";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import type { CalendarSlug } from "@/engine";
import { listReviewQueue } from "@/submissions/queue";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** The Review queue: pending Events of both Calendars, oldest first. */
async function ReviewQueue({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireEditor();
  const search = await searchParams;
  await io();
  const param = one(search.calendar);
  const calendar: CalendarSlug | null = param === "rides" || param === "advocacy" ? param : null;
  const rows = await listReviewQueue(getDb(), { calendar });

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
              href={tab.value ? `/admin/review?calendar=${tab.value}` : "/admin/review"}
              aria-current={current ? "page" : undefined}
              className={`-mb-px border-b-2 px-1 pb-2 ${current ? "border-blue-700 font-semibold" : "border-transparent"}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <p>No Submissions wait for review.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="py-2 pr-3">Title</th>
                <th className="py-2 pr-3">Calendar</th>
                <th className="py-2 pr-3">First date</th>
                <th className="py-2 pr-3">Repeat</th>
                <th className="py-2 pr-3">Submitter</th>
                <th className="py-2">Sent (Detroit time)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-gray-200 align-top">
                  <td className="py-2 pr-3">
                    <Link href={`/admin/events/${row.id}`} className="underline">
                      {row.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{CALENDAR_LABELS[row.calendar]}</td>
                  <td className="py-2 pr-3">{row.when}</td>
                  <td className="py-2 pr-3">{row.repeat}</td>
                  <td className="py-2 pr-3">{row.submitterName ?? "—"}</td>
                  <td className="py-2 text-sm">{formatInstantDetroit(row.submittedAt)}</td>
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
      <h1 className="mb-2 text-2xl font-semibold">Review queue</h1>
      <p className="mb-4 text-gray-800">
        Submissions from the public form. They are not public until an Editor approves them. Open one to
        change, approve, or reject it.
      </p>
      <Suspense fallback={<p>Loading…</p>}>
        <ReviewQueue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

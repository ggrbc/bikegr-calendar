import { io } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { describeRrule } from "@/admin/events/describe-rule";
import { CALENDAR_LABELS, formatInstantDetroit } from "@/admin/events/format";
import {
  eventValuesFromRow,
  seriesContentValuesFromRow,
  splitValuesFromRow,
} from "@/admin/events/form-values";
import { nextOccurrences } from "@/admin/events/preview";
import { type EventForEdit, loadEventForEdit, loadHistory } from "@/admin/events/queries";
import { listPickerTags } from "@/admin/tags/tags";
import { shortDate, timeText, todayInDetroit } from "@/agenda/dates";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import { eventRowToRuleInput } from "@/db/mappers";
import { addDays, isLocalDate, timingStart } from "@/engine";
import { DeleteRestore } from "../_components/delete-restore";
import { EventForm } from "../_components/event-form";
import { ManagersSection } from "../_components/managers-section";
import { PendingReview } from "../_components/pending-review";
import { ReviewPanel } from "../_components/review-panel";
import { SeriesEditor } from "../_components/series-editor";
import { listManagers } from "@/admin/events/managers";
import { loadSplitBounds } from "@/admin/events/split-series";
import { imageRemovedByReview } from "@/submissions/review";
import {
  Badge,
  buttonClass,
  Card,
  EmptyState,
  hintClass,
  labelClass,
  linkClass,
  mutedClass,
  noticeClass,
  ReviewBadge,
  rowClass,
  ScheduleBadge,
  smallInputClass,
  tableClass,
  tdClass,
  theadRowClass,
  thClass,
} from "../../_components/ui";

type Search = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATES_SHOWN = 20;

const SAVED_NOTICES: Record<string, string> = {
  created: "Created. The Event is approved and public.",
  split: "Saved. The new time or repeat starts on this new Event. The earlier dates stay on the old Event.",
  approved: "Approved. The Event is public.",
  rejected: "Rejected. The Event is not public.",
  spam: "Deleted as spam. No email was sent. An Admin can restore it.",
};

/** The review notices also say if the Submitter gets an email. */
function savedNotice(key: unknown, submitterEmail: string | null): string | undefined {
  if (typeof key !== "string") return undefined;
  const notice = SAVED_NOTICES[key];
  const emailed = submitterEmail !== null && (key === "approved" || key === "rejected");
  return notice && emailed ? `${notice} The Submitter gets an email.` : notice;
}

function DateList({ event, from }: { event: EventForEdit; from: string }) {
  const { row } = event;
  const result = nextOccurrences(eventRowToRuleInput(row), event.overrides, from, DATES_SHOWN);
  const changed = new Set(event.overrides.map((o) => o.originalStart));
  if (!result.ok) return <p className={noticeClass("error")}>{result.message}</p>;
  const last = result.occurrences.at(-1);
  return (
    <Card title="Dates" titleId="dates">
      <form method="get" action={`/admin/events/${row.id}/occurrence`} className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Go to date</span>
          <input type="date" name="date" required className={smallInputClass} />
        </label>
        <button type="submit" className={buttonClass("secondary", "sm")}>
          Open
        </button>
      </form>
      {result.occurrences.length === 0 ? (
        <EmptyState>No dates from {shortDate(from)}.</EmptyState>
      ) : (
        <ul className="divide-y divide-brand-divider">
          {result.occurrences.map((o) => (
            <li key={o.originalStart} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-wrap items-center gap-2">
                {shortDate(timingStart(o.timing).slice(0, 10))}, {timingStart(o.timing).slice(0, 4)} · {timeText(o.timing)}
                {o.title && <span className="italic">“{o.title}”</span>}
                <ScheduleBadge status={o.scheduleStatus} />
                {changed.has(o.originalStart) && <span className={`text-sm ${mutedClass}`}>(changed)</span>}
              </span>
              <Link
                href={`/admin/events/${row.id}/occurrence?start=${encodeURIComponent(o.originalStart)}`}
                className={`${linkClass} text-sm`}
              >
                Change this date
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/admin/events/${row.id}?from=${addDays(from, -90)}#dates`} className={buttonClass("secondary", "sm")}>
          Earlier dates
        </Link>
        {last && result.occurrences.length === DATES_SHOWN && (
          <Link
            href={`/admin/events/${row.id}?from=${addDays(last.originalStart.slice(0, 10), 1)}#dates`}
            className={buttonClass("secondary", "sm")}
          >
            Later dates
          </Link>
        )}
      </div>
    </Card>
  );
}

async function History({ eventId }: { eventId: string }) {
  const entries = await loadHistory(getDb(), eventId);
  return (
    <Card title="History" titleId="history">
      {entries.length === 0 ? (
        <EmptyState>No history.</EmptyState>
      ) : (
        <table className={`${tableClass} text-sm`}>
          <thead>
            <tr className={theadRowClass}>
              <th className={thClass}>When (Detroit time)</th>
              <th className={thClass}>Who</th>
              <th className={thClass}>What</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((h) => (
              <tr key={h.id} className={rowClass}>
                <td className={`${tdClass} py-2`}>{formatInstantDetroit(h.changedAt)}</td>
                <td className={`${tdClass} py-2`}>{h.who}</td>
                <td className={`${tdClass} break-words py-2`}>{h.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const editor = await requireEditor();
  const { id } = await params;
  const search = await searchParams;
  await io();
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const event = await loadEventForEdit(db, id);
  if (!event) notFound();
  const { row } = event;
  const isAdmin = editor.role === "admin";
  const deleted = row.deletedAt !== null;
  const today = todayInDetroit(new Date());
  const fromParam = typeof search.from === "string" ? search.from : "";
  // The list starts 30 days back, so recent past dates can be changed too.
  const from = isLocalDate(fromParam) ? fromParam : addDays(today, -30);
  const saved = savedNotice(search.saved, row.submitterEmail);
  const pending = row.reviewStatus === "pending";
  const upcoming = nextOccurrences(eventRowToRuleInput(row), event.overrides, today, 1);
  const allPast = upcoming.ok && upcoming.occurrences.length === 0;
  const tagsByCalendar = {
    rides: await listPickerTags(db, "rides"),
    advocacy: await listPickerTags(db, "advocacy"),
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 tabIndex={-1} className="font-chivo text-[28px] font-normal leading-tight">
          {row.title}
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {CALENDAR_LABELS[row.calendar]} · {row.rrule ? describeRrule(row.rrule) : "One time"} · Review status:{" "}
          <ReviewBadge status={row.reviewStatus} />
          {deleted && <Badge tone="deleted">Deleted</Badge>}
          {row.sourceId && <span className={mutedClass}>· Imported from Tockify</span>}
        </p>
        {event.predecessor && (
          <p>
            Earlier dates (split from):{" "}
            <Link href={`/admin/events/${event.predecessor.id}`} className={linkClass}>
              {event.predecessor.title}
            </Link>
          </p>
        )}
        {event.successors.map((s) => (
          <p key={s.id}>
            Later dates (continued by):{" "}
            <Link href={`/admin/events/${s.id}`} className={linkClass}>
              {s.title}
            </Link>
          </p>
        ))}
        {row.submitterName && (
          <p>
            Submitted by {row.submitterName}
            {row.submitterEmail && (
              <>
                {" · "}
                <a href={`mailto:${row.submitterEmail}`} className={linkClass}>
                  {row.submitterEmail}
                </a>
              </>
            )}
            {" · "}
            <span className={hintClass}>Only Editors see the Submitter&apos;s name and email.</span>
          </p>
        )}
        {saved && (
          <p role="status" className={noticeClass("success")}>
            {saved}
          </p>
        )}
        {deleted && (
          <p role="status" className={noticeClass("error")}>
            This Event was deleted at {formatInstantDetroit(row.deletedAt!)}. It is hidden everywhere.
            {isAdmin ? " You can restore it." : " An Admin can restore it."}
          </p>
        )}
      </header>

      {!deleted && pending && (
        <PendingReview
          id={row.id}
          version={row.version}
          initial={eventValuesFromRow(row, event.tagIds)}
          tagsByCalendar={tagsByCalendar}
          isAdmin={isAdmin}
          today={today}
          overrides={event.overrides}
          allPast={allPast}
        />
      )}
      {!deleted && row.reviewStatus === "rejected" && (
        <ReviewPanel
          id={row.id}
          version={row.version}
          reviewStatus="rejected"
          dirty={false}
          allPast={allPast}
          imageRemoved={await imageRemovedByReview(db, row.id)}
        />
      )}
      {!deleted && !pending && row.rrule === null && (
        <EventForm
          mode="edit"
          id={row.id}
          version={row.version}
          initial={eventValuesFromRow(row, event.tagIds)}
          tagsByCalendar={tagsByCalendar}
          isAdmin={isAdmin}
          today={today}
          overrides={event.overrides}
        />
      )}
      {!deleted && !pending && row.rrule !== null && (
        <SeriesEditor
          id={row.id}
          version={row.version}
          contentInitial={seriesContentValuesFromRow(row, event.tagIds)}
          splitInitial={splitValuesFromRow(row, event.tagIds, today)}
          series={{ timing: eventRowToRuleInput(row).timing, rrule: row.rrule, exdates: row.exdates }}
          bounds={await loadSplitBounds(db, row)}
          overrides={event.overrides}
          tagsByCalendar={tagsByCalendar}
          isAdmin={isAdmin}
          today={today}
        />
      )}

      {!deleted && !pending && row.rrule !== null && <DateList event={event} from={from} />}

      {!deleted && row.reviewStatus === "approved" && (
        <ManagersSection eventId={row.id} managers={await listManagers(db, row.id)} />
      )}

      {/* A pending Event has "Delete as spam" in its Review panel. */}
      {(!pending || deleted) && (
        <DeleteRestore key={String(deleted)} id={row.id} version={row.version} deleted={deleted} isAdmin={isAdmin} />
      )}

      <History eventId={row.id} />
    </div>
  );
}

export default function AdminEventPage({ params, searchParams }: PageProps<"/admin/events/[id]">) {
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/events" className={linkClass}>
          Events
        </Link>
        {" · "}
        <Link href="/admin/review" className={linkClass}>
          Review queue
        </Link>
      </p>
      <Suspense fallback={<p className={mutedClass}>Loading…</p>}>
        <EventPage params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

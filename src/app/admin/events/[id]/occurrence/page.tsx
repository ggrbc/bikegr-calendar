import { io } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { OverrideFormValues } from "@/admin/events/event-input";
import { loadEventForEdit } from "@/admin/events/queries";
import { shortDate, shortSlot, timeText } from "@/agenda/dates";
import { requireEditor } from "@/auth/dal";
import { getDb } from "@/db";
import { eventRowToRuleInput } from "@/db/mappers";
import {
  addDays,
  expandOccurrences,
  isLocalDate,
  isLocalDateTime,
  ruleStartsBetween,
  type Timing,
} from "@/engine";
import { OverrideForm } from "../../_components/override-form";

type Search = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function slotValues(timing: Timing): Pick<OverrideFormValues, "start" | "end"> {
  return timing.kind === "timed"
    ? { start: timing.start, end: timing.end }
    : { start: timing.startDate, end: timing.endDate };
}

async function OccurrencePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  await requireEditor();
  const { id } = await params;
  const search = await searchParams;
  await io();
  if (!UUID.test(id)) notFound();
  const event = await loadEventForEdit(getDb(), id);
  if (!event || event.row.rrule === null || event.row.deletedAt !== null) notFound();
  const { row } = event;
  const rule = eventRowToRuleInput(row);
  const back = (
    <p className="mb-2 text-sm">
      <Link href={`/admin/events/${row.id}#dates`} className="underline">
        {row.title}
      </Link>
    </p>
  );

  // "Go to date": find the Occurrence on that date.
  const date = typeof search.date === "string" ? search.date : "";
  if (isLocalDate(date)) {
    const starts =
      rule.timing.kind === "timed"
        ? ruleStartsBetween(rule.timing, row.rrule!, `${date}T00:00`, `${date}T23:59`)
        : ruleStartsBetween(rule.timing, row.rrule!, date, date);
    const start = starts.find((s) => !row.exdates.includes(s));
    if (start) redirect(`/admin/events/${row.id}/occurrence?start=${encodeURIComponent(start)}`);
    return (
      <>
        {back}
        <p>The Series has no date on {shortDate(date)}, {date.slice(0, 4)}.</p>
      </>
    );
  }

  const start = typeof search.start === "string" ? search.start : "";
  const rightKind = rule.timing.kind === "timed" ? isLocalDateTime(start) : isLocalDate(start);
  const day = start.slice(0, 10);
  const occurrence = rightKind
    ? expandOccurrences(rule, event.overrides, { from: day, to: addDays(day, 1) }).find(
        (o) => o.originalStart === start,
      )
    : undefined;
  if (!occurrence) {
    return (
      <>
        {back}
        <p>This is not a date of the Series.</p>
      </>
    );
  }
  const stored = event.overrides.find((o) => o.originalStart === start);
  const initial: OverrideFormValues = {
    originalStart: start,
    ...slotValues(occurrence.timing),
    title: occurrence.title ?? row.title,
    location: occurrence.location ?? row.location ?? "",
    scheduleStatus: stored?.scheduleStatus ?? row.scheduleStatus,
    scheduleNote: occurrence.scheduleNote ?? "",
  };

  return (
    <>
      {back}
      <h1 className="mb-1 text-2xl font-semibold">
        One date: {shortSlot(occurrence.originalTiming)}, {start.slice(0, 4)}
      </h1>
      <p className="mb-4 text-gray-800">
        Series time: {timeText(occurrence.originalTiming)}. This change is for this date only.
      </p>
      <OverrideForm
        id={row.id}
        version={row.version}
        allDay={row.allDay}
        initial={initial}
        hasOverride={stored !== undefined}
      />
    </>
  );
}

export default function AdminOccurrencePage({ params, searchParams }: PageProps<"/admin/events/[id]/occurrence">) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <OccurrencePage params={params} searchParams={searchParams} />
    </Suspense>
  );
}

import { io } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { loadManagedOccurrence } from "@/admin/events/managed-events";
import { dayHeading, timeText, todayInDetroit } from "@/agenda/dates";
import { isUuid, parseStartSegment } from "@/agenda/occurrence-url";
import { requireEventManager } from "@/auth/dal";
import { getDb } from "@/db";
import { timingStart } from "@/engine";
import { Notice, linkClass, mutedClass, PageHeader, panelClass } from "../../../_components/ui";
import { OccurrenceForm } from "../../_components/occurrence-form";

async function DateForm({ params }: { params: Promise<{ eventId: string; start: string }> }) {
  const me = await requireEventManager();
  const { eventId, start } = await params;
  await io();
  const originalStart = parseStartSegment(start);
  if (!isUuid(eventId) || !originalStart) notFound();
  const occurrence = await loadManagedOccurrence(getDb(), me.id, eventId, originalStart, todayInDetroit(new Date()));
  // No grant, a deleted or pending Event, and a wrong date all look the same: not found.
  if (!occurrence) notFound();

  const day = timingStart(occurrence.timing).slice(0, 10);
  return (
    <>
      <PageHeader
        title={occurrence.title}
        back={
          <Link href="/admin/my-events" className={linkClass}>
            ← My Events
          </Link>
        }
      >
        <p className={mutedClass}>
          {dayHeading(day)}, {timeText(occurrence.timing)}
        </p>
      </PageHeader>
      {occurrence.editable ? (
        <OccurrenceForm
          eventId={occurrence.eventId}
          originalStart={occurrence.originalStart}
          initial={{
            scheduleStatus: occurrence.scheduleStatus,
            scheduleNote: occurrence.scheduleNote,
            occurrenceDetails: occurrence.occurrenceDetails,
          }}
        />
      ) : (
        <>
          <Notice tone="info">This date started more than 7 days ago. Ask an Editor to change it.</Notice>
          <dl className={`${panelClass} mt-4 grid gap-1`}>
            <dt className="font-semibold">Schedule status</dt>
            <dd>{occurrence.scheduleStatus}</dd>
            <dt className="mt-2 font-semibold">Schedule note</dt>
            <dd>{occurrence.scheduleNote || "None"}</dd>
            <dt className="mt-2 font-semibold">Occurrence details</dt>
            <dd className="whitespace-pre-line">{occurrence.occurrenceDetails || "None"}</dd>
          </dl>
        </>
      )}
    </>
  );
}

export default function MyEventsDatePage({ params }: PageProps<"/admin/my-events/[eventId]/[start]">) {
  return (
    <Suspense fallback={<p className={mutedClass}>Loading…</p>}>
      <DateForm params={params} />
    </Suspense>
  );
}


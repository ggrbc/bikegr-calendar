import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { describeRrule } from "@/admin/events/describe-rule";
import { type ManagedDate, listManagedEvents } from "@/admin/events/managed-events";
import { shortDate, timeText, todayInDetroit } from "@/agenda/dates";
import { startSegment } from "@/agenda/occurrence-url";
import { requireEventManager } from "@/auth/dal";
import { getDb } from "@/db";
import { timingStart, type ScheduleStatus } from "@/engine";
import { buttonClass, Card, EmptyState, h3Class, mutedClass, PageHeader, ScheduleBadge } from "../_components/ui";

function DateRows({ eventId, title, dates }: { eventId: string; title: string; dates: ManagedDate[] }) {
  return (
    <ul className="divide-y divide-brand-divider">
      {dates.map((date) => {
        const day = timingStart(date.timing).slice(0, 10);
        return (
          <li key={date.originalStart} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
            <div className="min-w-0">
              <p className="font-semibold">
                {shortDate(day)} <span className="font-normal">{timeText(date.timing)}</span>
              </p>
              {(date.scheduleStatus !== "scheduled" || date.scheduleNote || date.hasDetails) && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  {date.scheduleStatus !== "scheduled" && <ScheduleBadge status={date.scheduleStatus as ScheduleStatus} />}
                  {date.scheduleNote && <span>{date.scheduleNote}</span>}
                  {date.hasDetails && <span className={mutedClass}>Has details</span>}
                </p>
              )}
            </div>
            {date.editable ? (
              <Link
                href={`/admin/my-events/${eventId}/${startSegment(date.originalStart)}`}
                className={buttonClass("secondary", "sm")}
                aria-label={`Edit ${title}, ${shortDate(day)}`}
              >
                Edit
              </Link>
            ) : (
              <span className={`${mutedClass} text-sm`}>Closed</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

async function MyEvents({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireEventManager();
  const search = await searchParams;
  await io();
  const more = typeof search.more === "string" ? search.more : undefined;
  const cards = await listManagedEvents(getDb(), me.id, todayInDetroit(new Date()), { expandId: more });

  if (cards.length === 0) return <EmptyState>You manage no Events now.</EmptyState>;

  return (
    <div className="flex flex-col gap-6">
      {cards.map((card) => (
        <Card key={card.eventId} title={card.title} titleId={`event-${card.eventId}`}>
          {card.rrule && <p className={`${mutedClass} -mt-2 mb-3 text-sm`}>{describeRrule(card.rrule)}</p>}
          {card.recent.length > 0 && (
            <section aria-label={`Recent dates of ${card.title}`} className="mb-4">
              <h3 className={`${h3Class} mb-1`}>Recent dates</h3>
              <p className={`${mutedClass} text-sm`}>These dates started in the last 7 days. After that they close.</p>
              <DateRows eventId={card.eventId} title={card.title} dates={card.recent} />
            </section>
          )}
          {card.dates.length === 0 ? (
            <p className={mutedClass}>No dates in the next year.</p>
          ) : (
            <>
              {card.recent.length > 0 && <h3 className={`${h3Class} mb-1`}>Next dates</h3>}
              <DateRows eventId={card.eventId} title={card.title} dates={card.dates} />
            </>
          )}
          {card.hasMore && (
            <p className="mt-3">
              <Link
                href={`/admin/my-events?more=${card.eventId}`}
                scroll={false}
                className={buttonClass("secondary", "sm")}
                aria-label={`Show more dates of ${card.title}`}
              >
                Show more
              </Link>
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

export default function MyEventsPage({ searchParams }: PageProps<"/admin/my-events">) {
  return (
    <>
      <PageHeader title="My Events">
        <p className={mutedClass}>Change the status, the note, and the details of a date. The change is public at once.</p>
      </PageHeader>
      <Suspense fallback={<p className={mutedClass}>Loading…</p>}>
        <MyEvents searchParams={searchParams} />
      </Suspense>
    </>
  );
}

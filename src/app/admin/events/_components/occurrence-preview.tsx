"use client";

import type { PreviewResult } from "@/admin/events/preview";
import { shortDate, timeText } from "@/agenda/dates";
import { timingStart } from "@/engine";
import { h3Class, mutedClass, panelClass, ScheduleBadge } from "../../_components/ui";

/** The next dates of the Event, from the Occurrence engine. */
export function OccurrencePreview({ title, result }: { title: string; result: PreviewResult }) {
  return (
    <section aria-label={title} className={panelClass}>
      <h3 className={`${h3Class} mb-3`}>{title}</h3>
      {!result.ok ? (
        <p className="font-semibold text-red-700">{result.message}</p>
      ) : result.occurrences.length === 0 ? (
        <p className={mutedClass}>No upcoming dates.</p>
      ) : (
        <ol className="list-decimal divide-y divide-brand-divider pl-6 marker:text-[#5f5e5f]">
          {result.occurrences.map((o) => (
            <li key={o.originalStart} className="py-1.5 pl-1">
              <span className="flex flex-wrap items-center gap-2">
                {shortDate(timingStart(o.timing).slice(0, 10))}, {o.originalStart.slice(0, 4)} · {timeText(o.timing)}
                <ScheduleBadge status={o.scheduleStatus} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

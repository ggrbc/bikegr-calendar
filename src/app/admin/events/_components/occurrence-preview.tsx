"use client";

import { statusLabel } from "@/admin/events/format";
import type { PreviewResult } from "@/admin/events/preview";
import { shortDate, timeText } from "@/agenda/dates";
import { timingStart } from "@/engine";

/** The next dates of the Event, from the Occurrence engine. */
export function OccurrencePreview({ title, result }: { title: string; result: PreviewResult }) {
  return (
    <section aria-label={title} className="rounded border border-gray-300 p-3">
      <h3 className="mb-2 font-medium">{title}</h3>
      {!result.ok ? (
        <p className="text-red-700">{result.message}</p>
      ) : result.occurrences.length === 0 ? (
        <p className="text-gray-700">No upcoming dates.</p>
      ) : (
        <ol className="list-decimal pl-6">
          {result.occurrences.map((o) => {
            const label = statusLabel(o.scheduleStatus);
            return (
              <li key={o.originalStart}>
                {shortDate(timingStart(o.timing).slice(0, 10))}, {o.originalStart.slice(0, 4)} · {timeText(o.timing)}
                {label && <span className="ml-2 rounded bg-gray-200 px-1 text-sm">{label}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

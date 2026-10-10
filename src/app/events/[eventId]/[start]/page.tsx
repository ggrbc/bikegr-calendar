import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { badgeText } from "@/agenda/agenda-days";
import { dayHeading, timeText } from "@/agenda/dates";
import { descriptionParagraphs, excerpt } from "@/agenda/description-text";
import { findOccurrence } from "@/agenda/find-occurrence";
import { eventJsonLd, jsonLdText } from "@/agenda/json-ld";
import { occurrenceIcsPath, occurrenceUrl } from "@/agenda/occurrence-url";
import { CALENDAR_NAMES, calendarPath } from "@/agenda/site";
import { getDb } from "@/db";
import { timingStart } from "@/engine";
import { googleCalendarUrl, outlookUrl } from "@/feeds/add-to-calendar";
import { Badge } from "../../../_components/badge";

/**
 * One Occurrence. Blocking (no <Suspense>): it reads `params` and the database before it renders.
 * The real 404 and 410 status codes come from the proxy (src/proxy.ts), which runs the same
 * `findOccurrence` first; the `notFound()` here is a backup (for example, an Event deleted between
 * the proxy check and the render), and gives 200 with `noindex`.
 *
 * A direct database read, not the cached snapshot: the proxy reads the database for each detail
 * request anyway, so the cache would save little, and the page always agrees with the proxy.
 */
export const instant = false;

const load = cache(async (eventId: string, start: string) => findOccurrence(getDb(), eventId, start));

export async function generateMetadata({ params }: PageProps<"/events/[eventId]/[start]">): Promise<Metadata> {
  const { eventId, start } = await params;
  const result = await load(eventId, start);
  if (result.kind !== "found") return { title: "Event not found — Bike GR Calendar", robots: { index: false } };
  const { row } = result;
  const date = dayHeading(timingStart(row.timing).slice(0, 10));
  const url = occurrenceUrl(row.eventId, row.originalStart);
  const description = excerpt(row.description) || `${row.title} on ${date}`;
  return {
    title: `${row.title} — ${date} — Bike GR Calendar`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: row.title,
      description,
      url,
      type: "website",
      images: row.imageUrl ? [row.imageUrl] : undefined,
    },
  };
}

export default async function OccurrencePage({ params }: PageProps<"/events/[eventId]/[start]">) {
  const { eventId, start } = await params;
  const result = await load(eventId, start);
  if (result.kind !== "found") notFound();
  const { row } = result;

  const url = occurrenceUrl(row.eventId, row.originalStart);
  const badge = badgeText(row);
  const date = timingStart(row.timing).slice(0, 10);
  const cancelled = row.scheduleStatus === "cancelled";

  return (
    <main className="w-full flex-1 bg-white text-gray-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdText(eventJsonLd(row, url)) }}
      />
      <article className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-gray-700">
          <Link href={calendarPath(row.calendar)} className="underline">
            {CALENDAR_NAMES[row.calendar]}
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          <span className={cancelled ? "line-through decoration-gray-500" : undefined}>{row.title}</span>
          {badge && <Badge text={badge} />}
        </h1>
        {row.scheduleNote && <p className="mt-2 text-gray-900">{row.scheduleNote}</p>}

        <p className="mt-4 font-medium">
          {dayHeading(date)} · {timeText(row.timing)}
        </p>
        {row.location && (
          <p className="mt-1 text-gray-800">
            {row.location}{" "}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.location)}`}
              className="text-sm text-blue-800 underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              Map
            </a>
          </p>
        )}

        {row.tags.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-1 text-xs">
            {row.tags.map((tag) => (
              <Link
                key={tag.slug}
                href={`${calendarPath(row.calendar)}?tag=${encodeURIComponent(tag.slug)}`}
                className="rounded bg-gray-100 px-2 py-0.5 text-gray-800 hover:underline"
              >
                {tag.name}
              </Link>
            ))}
          </p>
        )}

        {row.cta && (
          <p className="mt-4">
            <a
              href={row.cta.url}
              className="inline-block rounded bg-blue-800 px-4 py-2 font-medium text-white"
              rel="noopener noreferrer"
              target="_blank"
            >
              {row.cta.label}
            </a>
          </p>
        )}

        {row.imageUrl && (
          // A Blob URL; next/image would need remotePatterns in next.config for little gain here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.imageUrl} alt={row.title} className="mt-6 h-auto max-w-full rounded" />
        )}

        <div className="mt-6 space-y-3">
          {descriptionParagraphs(row.description).map((lines, p) => (
            <p key={p}>
              {lines.map((parts, l) => (
                <span key={l}>
                  {l > 0 && <br />}
                  {parts.map((part, i) =>
                    part.kind === "link" ? (
                      <a key={i} href={part.href} className="break-all text-blue-800 underline" rel="nofollow noopener noreferrer">
                        {part.text}
                      </a>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </span>
              ))}
            </p>
          ))}
        </div>

        <section aria-labelledby="add-to-calendar" className="mt-8 border-t border-gray-300 pt-4">
          <h2 id="add-to-calendar" className="mb-2 font-semibold">
            Add to calendar
          </h2>
          <ul className="flex flex-wrap gap-4 text-sm">
            <li>
              <a href={occurrenceIcsPath(row.eventId, row.originalStart)} className="text-blue-800 underline">
                Download .ics (Apple, Outlook, other apps)
              </a>
            </li>
            <li>
              <a href={googleCalendarUrl(row)} className="text-blue-800 underline" rel="noopener noreferrer" target="_blank">
                Google Calendar
              </a>
            </li>
            <li>
              <a href={outlookUrl(row)} className="text-blue-800 underline" rel="noopener noreferrer" target="_blank">
                Outlook.com
              </a>
            </li>
          </ul>
        </section>

        <p className="mt-8 text-sm">
          <Link href={calendarPath(row.calendar)} className="text-blue-800 underline">
            Back to {CALENDAR_NAMES[row.calendar]}
          </Link>
        </p>
      </article>
    </main>
  );
}

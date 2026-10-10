import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { io } from "next/cache";
import { cache } from "react";
import { badgeText } from "@/agenda/agenda-days";
import { dateLine, normalizeLocation } from "@/agenda/card-text";
import { dayHeading } from "@/agenda/dates";
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

// `io()` before the clock and the database: Next.js may prerender this route for known params, and
// that prerender must stop here, not fail on `new Date()` (the start range uses today).
const load = cache(async (eventId: string, start: string) => {
  await io();
  return findOccurrence(getDb(), eventId, start);
});

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

const outlineButton =
  "inline-block rounded border border-brand-green-text px-3 py-1 font-chivo text-sm font-bold text-brand-green-text hover:bg-brand-page";

export default async function OccurrencePage({ params }: PageProps<"/events/[eventId]/[start]">) {
  const { eventId, start } = await params;
  const result = await load(eventId, start);
  if (result.kind !== "found") notFound();
  const { row } = result;

  const url = occurrenceUrl(row.eventId, row.originalStart);
  const badge = badgeText(row);
  const cancelled = row.scheduleStatus === "cancelled";
  const calendarHref = calendarPath(row.calendar);

  return (
    <main className="w-full flex-1 bg-brand-page text-brand-gray">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdText(eventJsonLd(row, url)) }}
      />
      <article className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
        <p className="font-chivo text-sm">
          <Link href={calendarHref} className="underline">
            {CALENDAR_NAMES[row.calendar]}
          </Link>
        </p>
        <div className="mt-3 rounded border-t-4 border-brand-orange bg-white p-4 sm:p-6">
          <h1 className="font-chivo text-[28px] leading-tight text-brand-orange sm:text-[34px]">
            <span className={cancelled ? "line-through decoration-brand-gray/60" : undefined}>{row.title}</span>
          </h1>
          <p className="mt-2 font-chivo text-[17px] font-bold">
            {dateLine(row.timing)}
            {badge && <Badge text={badge} />}
          </p>
          {row.scheduleNote && <p className="mt-1 font-bold">{row.scheduleNote}</p>}

          {row.location && (
            <p className="mt-3">
              {normalizeLocation(row.location)}{" "}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.location)}`}
                className="text-sm font-bold text-brand-green-text underline"
                rel="noopener noreferrer"
                target="_blank"
              >
                Map
              </a>
            </p>
          )}

          {row.tags.length > 0 && (
            <p className="mt-3 font-chivo text-sm font-bold text-brand-green-text">
              {row.tags.map((tag, i) => (
                <span key={tag.slug}>
                  {i > 0 && <span aria-hidden="true"> • </span>}
                  <Link href={`${calendarHref}?tag=${encodeURIComponent(tag.slug)}`} className="hover:underline">
                    {tag.name}
                  </Link>
                </span>
              ))}
            </p>
          )}

          {row.cta && (
            <p className="mt-4">
              <a
                href={row.cta.url}
                className="inline-block rounded bg-brand-orange-text px-4 py-2 text-white hover:bg-brand-gray"
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
            <img src={row.imageUrl} alt={row.title} className="mt-6 h-auto max-h-[480px] max-w-full rounded" />
          )}

          <div className="mt-6 space-y-3 font-light leading-relaxed">
            {descriptionParagraphs(row.description).map((lines, p) => (
              <p key={p}>
                {lines.map((parts, l) => (
                  <span key={l}>
                    {l > 0 && <br />}
                    {parts.map((part, i) =>
                      part.kind === "link" ? (
                        <a
                          key={i}
                          href={part.href}
                          className="break-all font-normal text-brand-orange-text underline"
                          rel="nofollow noopener noreferrer"
                        >
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

          <section aria-labelledby="add-to-calendar" className="mt-8 border-t border-brand-divider pt-4">
            <h2 id="add-to-calendar" className="mb-2 font-chivo font-bold">
              Add to calendar
            </h2>
            <ul className="flex flex-wrap gap-2">
              <li>
                <a href={occurrenceIcsPath(row.eventId, row.originalStart)} className={outlineButton}>
                  Download .ics (Apple, Outlook, other apps)
                </a>
              </li>
              <li>
                <a href={googleCalendarUrl(row)} className={outlineButton} rel="noopener noreferrer" target="_blank">
                  Google Calendar
                </a>
              </li>
              <li>
                <a href={outlookUrl(row)} className={outlineButton} rel="noopener noreferrer" target="_blank">
                  Outlook.com
                </a>
              </li>
            </ul>
          </section>
        </div>

        <p className="mt-6 font-chivo text-sm">
          <Link href={calendarHref} className="font-bold text-brand-green-text underline">
            Back to {CALENDAR_NAMES[row.calendar]}
          </Link>
        </p>
      </article>
    </main>
  );
}

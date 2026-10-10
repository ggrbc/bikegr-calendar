import Link from "next/link";
import type { AgendaEntry } from "@/agenda/agenda-days";
import { dateLine, tagLine, venueName } from "@/agenda/card-text";
import { excerpt } from "@/agenda/description-text";
import { occurrencePath } from "@/agenda/occurrence-url";
import { CALENDAR_NAMES } from "@/agenda/site";
import { Badge } from "./badge";

/**
 * One Occurrence in the agenda. One responsive component replaces Tockify's two embeds:
 * - full (≥ 640 px): round 136 px image on the left; title (Chivo 26 px, orange), date line,
 *   description (2 lines), Tags (green, " • "), CTA button;
 * - mini (< 640 px): text on the left, square 72 px thumbnail on the right; title (17 px), bold date
 *   line, description (2 lines), bold venue (the text before the first comma); no Tags, no CTA.
 */
export function OccurrenceCard({
  entry,
  showCalendar,
  embed,
  headingLevel,
}: {
  entry: AgendaEntry;
  showCalendar: boolean;
  embed: boolean;
  headingLevel: 2 | 3;
}) {
  const { row } = entry;
  const moved = entry.kind === "movedAway";
  const struck = row.scheduleStatus === "cancelled" || moved;
  const href = occurrencePath(row.eventId, row.originalStart);
  // In the Embed, detail pages open in a new tab on the calendar domain.
  const linkProps = embed ? { target: "_blank", rel: "noopener" } : {};
  const Title = headingLevel === 2 ? "h2" : "h3";
  const description = moved ? "" : excerpt(row.description, 300);

  return (
    <li className="flex gap-4 px-3 py-3 sm:gap-6 sm:px-2 sm:py-5">
      <div className="order-last shrink-0 sm:order-first" aria-hidden="true">
        {row.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.imageUrl}
            alt=""
            loading="lazy"
            className={`size-[72px] object-cover sm:size-[136px] sm:rounded-full ${moved ? "opacity-50" : ""}`}
          />
        ) : (
          <div className="flex size-[72px] items-center justify-center bg-brand-green sm:size-[136px] sm:rounded-full">
            <BikeIcon />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {showCalendar && (
          <p className="text-xs font-bold uppercase tracking-wide text-brand-gray">
            {CALENDAR_NAMES[row.calendar]}
          </p>
        )}
        <Title className="font-chivo text-[17px] leading-snug text-brand-orange-text sm:text-[26px] sm:text-brand-orange">
          <Link
            href={href}
            {...linkProps}
            className={`hover:underline ${struck ? "line-through decoration-brand-gray/60" : ""}`}
          >
            {row.title}
          </Link>
        </Title>
        <p className="mt-1 font-chivo text-[15px] font-bold text-brand-gray sm:font-normal">
          {dateLine(moved ? row.originalTiming : row.timing)}
          {entry.badge && <Badge text={entry.badge} />}
        </p>
        {!moved && row.scheduleNote && (
          <p className="mt-1 text-sm font-bold text-brand-gray">{row.scheduleNote}</p>
        )}
        {description && (
          <p className="mt-2 line-clamp-2 text-sm font-light text-brand-gray sm:text-[15px]">{description}</p>
        )}
        {!moved && row.location && (
          <p className="mt-2 text-sm font-bold text-brand-gray sm:hidden">{venueName(row.location)}</p>
        )}
        {!moved && row.tags.length > 0 && (
          <p className="mt-2 hidden font-chivo text-sm font-bold text-brand-green-text sm:block">
            {tagLine(row.tags)}
          </p>
        )}
        {!moved && row.cta && (
          <a
            href={row.cta.url}
            className="mt-3 hidden rounded bg-brand-orange-text px-3 py-1.5 text-sm text-white hover:bg-brand-gray sm:inline-block"
            rel="noopener noreferrer"
            target="_blank"
          >
            {row.cta.label}
          </a>
        )}
      </div>
    </li>
  );
}

/** The placeholder for an Event with no image: a white bicycle on the Bike GR green. */
function BikeIcon() {
  return (
    <svg
      viewBox="0 0 64 40"
      className="w-[44px] sm:w-[76px]"
      fill="none"
      stroke="white"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="13" cy="27" r="10" />
      <circle cx="51" cy="27" r="10" />
      <path d="M13 27 L24 8 H40 M22 8 H28 M24 8 L33 27 L45 11 M42 6 H49 M33 27 H13 M45 11 L51 27" />
    </svg>
  );
}

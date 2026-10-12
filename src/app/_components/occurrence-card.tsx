import Image from "next/image";
import Link from "next/link";
import type { AgendaEntry } from "@/agenda/agenda-days";
import { dateLine, tagLine, venueName } from "@/agenda/card-text";
import { listingText } from "@/agenda/listing-text";
import { occurrencePath } from "@/agenda/occurrence-url";
import { CALENDAR_NAMES } from "@/agenda/site";
import { skipDetailsUrl } from "@/agenda/skip-details";
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
  const skipUrl = moved ? null : skipDetailsUrl(row);
  const href = skipUrl ?? occurrencePath(row.eventId, row.originalStart);
  // In the Embed, detail pages open in a new tab on the calendar domain. The CTA URL always does.
  const linkProps = skipUrl
    ? { target: "_blank", rel: "noopener noreferrer" }
    : embed
      ? { target: "_blank", rel: "noopener" }
      : {};
  const Title = headingLevel === 2 ? "h2" : "h3";
  const description = moved ? "" : listingText(row, 300);
  const TitleLink = skipUrl ? "a" : Link;

  return (
    <li className="flex gap-5 py-6 sm:gap-8 sm:py-8">
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
          // No image: the Bike GR logo icon (as Tockify showed), decorative.
          <Image
            src="/brand/ggrbc-logo-icon.png"
            alt=""
            width={136}
            height={136}
            className="size-[72px] sm:size-[136px]"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {showCalendar && (
          <p className="font-chivo text-[13px] uppercase tracking-[0.06em] text-brand-gray">
            {CALENDAR_NAMES[row.calendar]}
          </p>
        )}
        <Title className="font-chivo text-[19px] font-normal leading-snug text-brand-orange-text sm:text-[26px] sm:text-brand-orange">
          <TitleLink
            href={href}
            {...linkProps}
            className={`hover:underline ${struck ? "line-through decoration-brand-gray/60" : ""}`}
          >
            {row.title}
          </TitleLink>
        </Title>
        <p className="mt-1.5 font-chivo text-[15px] text-brand-gray">
          {dateLine(moved ? row.originalTiming : row.timing)}
          {entry.badge && <Badge text={entry.badge} />}
        </p>
        {!moved && row.scheduleNote && (
          <p className="mt-1 text-[15px] text-brand-gray">{row.scheduleNote}</p>
        )}
        {description && (
          <p className="mt-2 line-clamp-2 text-[15px] font-light leading-[1.9] text-brand-gray sm:text-[15.84px]">
            {description}
          </p>
        )}
        {!moved && row.location && (
          <p className="mt-1 font-chivo text-[15px] text-brand-gray sm:hidden">{venueName(row.location)}</p>
        )}
        {!moved && row.tags.length > 0 && (
          <p className="mt-2 hidden font-chivo text-[15px] text-brand-green-text sm:block">
            {tagLine(row.tags)}
          </p>
        )}
        {!moved && row.cta && (
          <a
            href={row.cta.url}
            className="mt-4 hidden rounded-[300px] bg-brand-orange-text px-[22px] py-[10px] font-chivo text-[13px] uppercase tracking-[0.02em] text-white hover:bg-brand-gray sm:inline-block"
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

import type { NextRequest } from "next/server";
import { cachedSnapshot } from "@/agenda/cache";
import { todayInDetroit } from "@/agenda/dates";
import { describeError } from "@/agenda/describe-error";
import { parseFilters } from "@/agenda/filters";
import { buildFeed, feedFileName, parseFeedName } from "@/feeds/feed";

/**
 * ICS Feeds: `/feeds/rides.ics`, `/feeds/advocacy.ics`, `/feeds/all.ics`, with the filter query.
 * The Vercel CDN keeps each URL (with its query) for 15 minutes; calendar apps poll every few hours.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/feeds/[feed]">) {
  const { feed } = await params;
  const calendar = parseFeedName(feed);
  if (calendar === undefined) return new Response("Feed not found.", { status: 404 });

  const now = new Date();
  const today = todayInDetroit(now);
  const filters = parseFilters(request.nextUrl.searchParams, today);
  let body: string;
  try {
    body = buildFeed({ snapshot: await cachedSnapshot(calendar), calendar, filters, today, now });
  } catch (error) {
    console.error(`Feed could not load: ${describeError(error)}`);
    return new Response("The feed could not load. Try again later.", {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "300" },
    });
  }
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="bikegr-${feedFileName(calendar)}"`,
      "cache-control": "public, s-maxage=900, stale-while-revalidate=86400",
    },
  });
}

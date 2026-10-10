import { describeError } from "@/agenda/describe-error";
import { findOccurrence } from "@/agenda/find-occurrence";
import { getDb } from "@/db";
import { icsFileName, singleOccurrenceIcs } from "@/feeds/add-to-calendar";

/** One Occurrence as an `.ics` download. The same `VEVENT` and UID as in the Feeds. */
export async function GET(_request: Request, { params }: RouteContext<"/events/[eventId]/[start]/event.ics">) {
  const { eventId, start } = await params;
  let result;
  try {
    result = await findOccurrence(getDb(), eventId, start);
  } catch (error) {
    console.error(`Event .ics could not load: ${describeError(error)}`);
    return new Response("The event could not load. Try again later.", { status: 503 });
  }
  if (result.kind === "gone") return new Response("This event was removed.", { status: 410 });
  if (result.kind === "missing") return new Response("Event not found.", { status: 404 });

  return new Response(singleOccurrenceIcs(result.row, new Date()), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${icsFileName(result.row.title)}"`,
      "cache-control": "no-store",
    },
  });
}

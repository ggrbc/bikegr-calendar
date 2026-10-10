/**
 * The status decision for a detail path, made in the proxy (src/proxy.ts) before the page renders.
 * A page cannot set its status code under Cache Components (the static shell is sent first, so a
 * `notFound()` in the page gives 200 + noindex), and Next.js has no `gone()`. So the proxy gives the
 * real 404 and 410.
 *
 * On a database error the proxy lets the request through (`next`): the page then handles it.
 */
import { describeError } from "./describe-error";
import type { LocalDate } from "@/engine";
import { todayInDetroit } from "./dates";
import { checkDetailUrl, type FindResult } from "./find-occurrence";
import { parseOccurrencePath } from "./occurrence-url";

export type GateDecision = { kind: "next" } | { kind: "status"; status: 404 | 410 };

export async function detailGate(
  pathname: string,
  find: (eventId: string, segment: string) => Promise<FindResult>,
  log: (line: string) => void = console.error,
  today: LocalDate = todayInDetroit(new Date()),
): Promise<GateDecision> {
  const parsed = parseOccurrencePath(pathname);
  if (!parsed) return { kind: "next" };
  // A bad id, a bad start, or a start out of range: 404 with no database read.
  if (checkDetailUrl(parsed.eventId, parsed.segment, today) === null) return { kind: "status", status: 404 };
  let result: FindResult;
  try {
    result = await find(parsed.eventId, parsed.segment);
  } catch (error) {
    log(`Detail check could not load: ${describeError(error)}`);
    return { kind: "next" };
  }
  if (result.kind === "gone") return { kind: "status", status: 410 };
  if (result.kind === "missing") return { kind: "status", status: 404 };
  return { kind: "next" };
}

const PAGE_TEXT = {
  404: { title: "Event not found", text: "This event is not on the Bike GR Calendar." },
  410: { title: "Event removed", text: "This event was removed from the Bike GR Calendar." },
} as const;

/**
 * A small, self-contained HTML page for a 404 or 410 from the proxy (no app CSS, no web fonts), in
 * the bikegr.org look: white header with the coalition name, the page gray, a heading in a regular
 * weight, and pill links. Text colors follow the AA rule (#424142, #BF4624 behind white text).
 */
export function statusPageHtml(status: 404 | 410): string {
  const { title, text } = PAGE_TEXT[status];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — Bike GR Calendar</title>
<style>
body{margin:0;background:#f2f2f3;color:#424142;font-family:"Open Sans",Arial,Helvetica,sans-serif;font-weight:300;font-size:15.84px;line-height:1.9}
header{background:#fff;padding:28px 38px}
header a{color:#424142;text-decoration:none;font-family:Chivo,Arial,sans-serif;font-weight:400;letter-spacing:.06em;text-transform:uppercase}
main{max-width:1100px;margin:0 auto;padding:64px 38px}
h1{font-family:Chivo,Arial,sans-serif;font-weight:400;font-size:46px;line-height:1.2;margin:0 0 16px}
nav a{display:inline-block;margin:8px 8px 0 0;padding:10px 22px;border-radius:300px;background:#bf4624;color:#fff;text-decoration:none;font-family:Chivo,Arial,sans-serif;font-weight:400;font-size:13px;text-transform:uppercase}
a:focus-visible{outline:2px solid #bf4624;outline-offset:2px}
</style>
</head>
<body>
<header><a href="https://www.bikegr.org/">Greater Grand Rapids Bicycle Coalition</a></header>
<main>
<h1>${title}</h1>
<p>${text}</p>
<nav aria-label="Calendars"><a href="/rides">Rides &amp; Events</a><a href="/advocacy">Advocacy</a><a href="/">All events</a></nav>
</main>
</body>
</html>
`;
}

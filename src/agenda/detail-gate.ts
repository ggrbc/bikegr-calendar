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

/** A small, self-contained HTML page for a 404 or 410 from the proxy (no app CSS). */
export function statusPageHtml(status: 404 | 410): string {
  const { title, text } = PAGE_TEXT[status];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — Bike GR Calendar</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#171717;max-width:40rem;margin:3rem auto;padding:0 1.5rem;line-height:1.5}a{color:#1e40af}</style>
</head>
<body>
<h1>${title}</h1>
<p>${text}</p>
<p><a href="/rides">Rides &amp; Events</a> · <a href="/advocacy">Advocacy</a> · <a href="/">All events</a></p>
</body>
</html>
`;
}

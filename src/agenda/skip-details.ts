/**
 * Skip details: where links to an Occurrence's detail page go instead, or null to show the page.
 *
 * - Only an Occurrence that runs as listed (`scheduled`) skips. Any other Schedule status has a
 *   notice (cancelled, postponed, moved, …) that the detail page shows, so a Visitor must see it.
 * - A CTA URL that is itself a detail page on `ownHosts` does not skip: the target page would
 *   redirect again (to itself, or on to another Event), a redirect loop.
 */
import type { AgendaRow } from "./occurrence-rows";
import { parseOccurrencePath } from "./occurrence-url";

export function skipDetailsUrl(
  row: Pick<AgendaRow, "cta" | "scheduleStatus">,
  ownHosts: readonly string[] = [],
): string | null {
  if (!row.cta?.skipDetails || row.scheduleStatus !== "scheduled") return null;
  const target = new URL(row.cta.url);
  if (ownHosts.includes(target.host) && parseOccurrencePath(target.pathname)) return null;
  return row.cta.url;
}

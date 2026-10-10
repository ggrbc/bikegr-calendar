/**
 * Who may frame which page (CSP `frame-ancestors`), used by `headers()` in next.config.ts.
 *
 * - Embed views (`/embed/*`): the calendar itself, the Bike GR Squarespace site, and the Squarespace
 *   editor and preview (`*.squarespace.com`), plus `EMBED_EXTRA_FRAME_ANCESTORS` (for example the
 *   local test host page; empty in production).
 * - Every other page: nobody (protects the admin from clickjacking).
 *
 * next.config.ts reads this at build time, so a change of `EMBED_EXTRA_FRAME_ANCESTORS` needs a new
 * build.
 */

export const EMBED_FRAME_ANCESTORS = [
  "'self'",
  "https://www.bikegr.org",
  "https://bikegr.org",
  "https://*.squarespace.com",
];

/** Only `http(s)://host[:port]` sources (a host may start with `*.`); anything else is dropped. */
export function extraFrameAncestors(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .filter((source) => /^https?:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/i.test(source));
}

export function embedFrameAncestors(extra: string | undefined): string {
  return `frame-ancestors ${[...EMBED_FRAME_ANCESTORS, ...extraFrameAncestors(extra)].join(" ")}`;
}

export const NO_FRAME_ANCESTORS = "frame-ancestors 'none'";

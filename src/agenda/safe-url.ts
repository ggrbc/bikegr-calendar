/**
 * True only for an absolute `http:` or `https:` URL. A CTA URL goes into an `href`, so a `data:` or
 * `javascript:` URL must never render. The public side shows a CTA only when this is true; the
 * admin can use the same check when an Editor saves a CTA.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

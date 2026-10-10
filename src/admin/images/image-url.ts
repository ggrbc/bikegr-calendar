/**
 * For the Event save: is this URL an Event image in OUR Blob store? The upload writes
 * `events/<sha256>.webp`; the Tockify import writes `events/<sha256>.<jpg|png|gif|webp|avif>`.
 * The Event form sends the URL as plain text, so the save must check it; the upload field cannot.
 *
 * - `isEventImageUrl(url)` — server code: reads our store host from the environment.
 * - `isEventImageUrlForHost(url, host)` — pure: the caller gives the host.
 */

const BLOB_DOMAIN = ".public.blob.vercel-storage.com";
const EVENT_IMAGE_PATH = /^\/events\/[0-9a-f]{64}\.(webp|jpg|png|gif|avif)$/;
const STORE_ID = /^[a-z0-9]+$/i;

/**
 * The public host of our Blob store, built as `@vercel/blob` builds its URLs
 * (`https://<store id>.public.blob.vercel-storage.com/…`): the store ID comes from `BLOB_STORE_ID`
 * (`store_<id>`, used with OIDC), else from `BLOB_READ_WRITE_TOKEN` (`vercel_blob_rw_<id>_<secret>`).
 * Null when neither gives a usable ID.
 */
export function blobPublicHost(env: Record<string, string | undefined>): string | null {
  const fromStoreId = env.BLOB_STORE_ID?.trim().replace(/^store_/, "");
  const fromToken = env.BLOB_READ_WRITE_TOKEN?.trim().split("_")[3];
  const id = fromStoreId || fromToken || "";
  return STORE_ID.test(id) ? `${id.toLowerCase()}${BLOB_DOMAIN}` : null;
}

/**
 * True only for `https://<host>/events/<64 hex>.<webp|jpg|png|gif|avif>` with no user info, port,
 * query, or hash. A null host (no Blob settings) accepts nothing.
 */
export function isEventImageUrlForHost(url: string | null | undefined, host: string | null): boolean {
  if (!url || !host) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    // `URL` lowercases the hostname; the host from the caller may not be.
    parsed.hostname === host.toLowerCase() &&
    EVENT_IMAGE_PATH.test(parsed.pathname)
  );
}

/** Server code: the same check, with our store host from the environment. */
export function isEventImageUrl(
  url: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isEventImageUrlForHost(url, blobPublicHost(env));
}

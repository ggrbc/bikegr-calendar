/**
 * For the Event save: is this URL an Event image in our Blob store? The upload and the Tockify
 * import both store Event images at `events/<sha256>.<ext>` on the public Blob host. The Event
 * form sends the URL as plain text, so the save must check it; the upload field cannot.
 */
import { isBlobUrl } from "@/import/images";

const PUBLIC_BLOB_HOST = ".public.blob.vercel-storage.com";

export function isEventImageUrl(url: string | null | undefined): boolean {
  if (!url || !isBlobUrl(url)) return false;
  const parsed = new URL(url);
  return (
    parsed.protocol === "https:" &&
    parsed.hostname.endsWith(PUBLIC_BLOB_HOST) &&
    parsed.pathname.startsWith("/events/") &&
    parsed.search === "" &&
    parsed.hash === ""
  );
}

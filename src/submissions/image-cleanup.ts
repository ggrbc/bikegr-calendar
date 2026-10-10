/**
 * Removes the blob of a refused Submission's image (Reject, Delete as spam) after the write
 * commits. Only a URL of our own store's `events/` images is removed; the review write already
 * checked that no other Event uses it. A failure is logged with the error class only.
 */
import { isEventImageUrl } from "@/admin/images/image-url";

export async function removeOrphanImage(
  url: string | null,
  {
    del,
    env = process.env,
    log = (line: string) => console.error(line),
  }: {
    del: (url: string) => Promise<void>;
    env?: Record<string, string | undefined>;
    log?: (line: string) => void;
  },
): Promise<void> {
  if (!url || !isEventImageUrl(url, env)) return;
  try {
    await del(url);
  } catch (error) {
    log(`[images] Blob delete failed: ${error instanceof Error ? error.name : typeof error}`);
  }
}

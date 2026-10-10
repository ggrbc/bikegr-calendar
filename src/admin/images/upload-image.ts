/**
 * Stores one uploaded Event image in Vercel Blob (store `uploads`): resize to WebP, then
 * `events/<sha256 of the WebP>.webp`, `head` before `put`, so the same image always gives the
 * same URL and is stored once. The Blob store and its credentials come from the import
 * (`src/import/images.ts`: OIDC first, then a read-write token).
 */
import { createHash } from "node:crypto";
import type { BlobStore } from "@/import/images";
import { MAX_UPLOAD_BYTES } from "./limits";
import { ImageRejected, toEventWebp } from "./process-image";

export type UploadResult =
  | { ok: true; url: string; width: number; height: number }
  | { ok: false; error: string };

export interface UploadOptions {
  /** Null when the environment has no Blob credentials. */
  store: BlobStore | null;
  /** Test seam. Default: `toEventWebp`. */
  process?: typeof toEventWebp;
}

export async function uploadEventImage(
  bytes: Uint8Array,
  { store, process = toEventWebp }: UploadOptions,
): Promise<UploadResult> {
  if (!store) return { ok: false, error: "Image upload is not set up." };
  if (bytes.byteLength === 0) return { ok: false, error: "The file is empty." };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "The image is larger than 4 MB. Make it smaller and try again." };
  }

  let webp;
  try {
    webp = await process(bytes);
  } catch (error) {
    if (error instanceof ImageRejected) return { ok: false, error: error.message };
    throw error;
  }

  const pathname = `events/${createHash("sha256").update(webp.bytes).digest("hex")}.webp`;
  try {
    const stored = (await store.head(pathname)) ?? (await store.put(pathname, webp.bytes, "image/webp"));
    return { ok: true, url: stored.url, width: webp.width, height: webp.height };
  } catch (error) {
    // Only the error name: a Blob error message can contain a token or a store ID.
    console.error("[images] Blob store failed:", error instanceof Error ? error.name : typeof error);
    return { ok: false, error: "The image could not be stored. Try again." };
  }
}

/**
 * Copies the Tockify images into Vercel Blob (store `uploads`), because the Tockify CloudFront URLs
 * stop working when the subscription ends. Copy only, no resize.
 *
 * Path: `events/<sha256 of the bytes>.<ext>`, so the same image always gives the same Blob URL and a
 * second run uploads nothing. An image that is not copied keeps its Tockify URL in the result, and
 * its Event is in `uncopiedImages`, so the writer keeps the `image_url` already in the database.
 */
import { createHash } from "node:crypto";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import type { ImportResult } from "./types";

export interface BlobStore {
  /** The stored blob at this path, or null if there is none. */
  head(pathname: string): Promise<{ url: string } | null>;
  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<{ url: string }>;
}

export type BlobCredentials = "oidc" | "readWrite" | null;

/**
 * Which Blob credentials the environment has, in the order `@vercel/blob` uses them: a Vercel OIDC
 * token with a store ID first, then a read-write token.
 */
export function blobCredentials(env: Record<string, string | undefined>): BlobCredentials {
  const set = (name: string) => (env[name]?.trim() ?? "") !== "";
  if (set("VERCEL_OIDC_TOKEN") && set("BLOB_STORE_ID")) return "oidc";
  if (set("BLOB_READ_WRITE_TOKEN")) return "readWrite";
  return null;
}

/**
 * The real store. It passes no credentials: `@vercel/blob` reads `VERCEL_OIDC_TOKEN` and
 * `BLOB_STORE_ID` (or `BLOB_READ_WRITE_TOKEN`) from the environment and refreshes an expired OIDC
 * token in development.
 */
export function vercelBlobStore(): BlobStore {
  return {
    async head(pathname) {
      try {
        const blob = await head(pathname);
        return { url: blob.url };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },
    async put(pathname, bytes, contentType) {
      const blob = await put(pathname, Buffer.from(bytes), {
        access: "public",
        addRandomSuffix: false,
        contentType,
      });
      return { url: blob.url };
    },
  };
}

export interface ImageReport {
  /** `noCredentials`: nothing was downloaded; every image keeps its Tockify URL. */
  status: "done" | "noCredentials";
  copied: { from: string; to: string }[];
  alreadyInBlob: { from: string; to: string }[];
  failed: { url: string; reason: string }[];
}

export interface CopyImagesOptions {
  /** Null when there are no Blob credentials. */
  store: BlobStore | null;
  fetch?: typeof fetch;
  /** Larger images are refused and reported. Default 10 MB. */
  maxBytes?: number;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export interface CopyImagesResult {
  /** The import result with Blob URLs for the copied images. */
  result: ImportResult;
  /** Source IDs of Events with an image that was not copied. */
  uncopiedImages: Set<string>;
  report: ImageReport;
}

export async function copyImages(
  input: ImportResult,
  { store, fetch: fetchImpl = fetch, maxBytes = MAX_IMAGE_BYTES }: CopyImagesOptions,
): Promise<CopyImagesResult> {
  const report: ImageReport = {
    status: store ? "done" : "noCredentials",
    copied: [],
    alreadyInBlob: [],
    failed: [],
  };
  const urls = [...new Set(input.events.flatMap((e) => (e.imageUrl ? [e.imageUrl] : [])))];
  const blobUrls = new Map<string, string>();

  if (store) {
    for (const url of urls) {
      try {
        const { bytes, contentType, extension } = await download(fetchImpl, url, maxBytes);
        const pathname = `events/${sha256(bytes)}.${extension}`;
        const found = await store.head(pathname);
        if (found) {
          report.alreadyInBlob.push({ from: url, to: found.url });
          blobUrls.set(url, found.url);
        } else {
          const stored = await store.put(pathname, bytes, contentType);
          report.copied.push({ from: url, to: stored.url });
          blobUrls.set(url, stored.url);
        }
      } catch (error) {
        report.failed.push({ url, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const uncopiedImages = new Set<string>();
  const events = input.events.map((event) => {
    if (!event.imageUrl) return event;
    const blobUrl = blobUrls.get(event.imageUrl);
    if (!blobUrl) {
      uncopiedImages.add(event.sourceId);
      return event;
    }
    return { ...event, imageUrl: blobUrl };
  });
  return { result: { ...input, events }, uncopiedImages, report };
}

async function download(
  fetchImpl: typeof fetch,
  url: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; contentType: string; extension: string }> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const extension = imageExtension(contentType);
  if (!extension) {
    throw new Error(`not an allowed image type (content type "${contentType || "none"}")`);
  }
  const tooLarge = () => new Error(`image too large (over ${maxBytes} bytes)`);
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw tooLarge();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw tooLarge();
  return { bytes, contentType, extension };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The only image types the import copies. No SVG: it can carry script. */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** The file extension for an allowed image content type, or null if the type is not allowed. */
export function imageExtension(contentType: string): string | null {
  return EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()] ?? null;
}

/** True for a Vercel Blob URL (`https://<store>.public.blob.vercel-storage.com/…`). */
export function isBlobUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

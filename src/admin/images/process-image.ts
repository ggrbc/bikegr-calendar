/**
 * Event-image processing with `sharp`, on the server only. The decoded type decides, not the
 * browser's MIME type. Output: WebP, at most 1600 px wide, EXIF orientation applied, no metadata
 * (no GPS). An animated GIF or WebP keeps its first frame only.
 */
import sharp, { type Metadata } from "sharp";
import { MAX_WIDTH } from "./limits";

// A function instance must not keep image memory between requests.
sharp.cache(false);

/** An image that we refuse. The message is for the Editor. */
export class ImageRejected extends Error {
  override name = "ImageRejected";
}

/** Larger images are refused before decode (a small file can decode to a huge bitmap). */
const MAX_INPUT_PIXELS = 40_000_000;
const WEBP_QUALITY = 82;

export interface EventWebp {
  bytes: Uint8Array;
  width: number;
  height: number;
}


/** JPEG, PNG, GIF, WebP, or AVIF (`heif` with AV1). Refuses SVG, HEIC, TIFF, and the rest. */
function isAllowedFormat(meta: Metadata): boolean {
  switch (meta.format) {
    case "jpeg":
    case "png":
    case "gif":
    case "webp":
      return true;
    case "heif":
      return meta.compression === "av1";
    default:
      return false;
  }
}

export async function toEventWebp(
  bytes: Uint8Array,
  { maxInputPixels = MAX_INPUT_PIXELS }: { maxInputPixels?: number } = {},
): Promise<EventWebp> {
  let meta: Metadata;
  try {
    // Header only, no decode. The pixel limit is checked below, with a clear message.
    meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new ImageRejected("This file is not an image that we can read. Use a JPEG or PNG.");
  }
  if (!isAllowedFormat(meta)) throw new ImageRejected("Use a JPEG, PNG, GIF, WebP, or AVIF image.");
  if ((meta.width ?? 0) * (meta.height ?? 0) > maxInputPixels) {
    throw new ImageRejected("This image has too many pixels. Make it smaller and try again.");
  }

  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: maxInputPixels, failOn: "error" })
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), width: info.width, height: info.height };
  } catch {
    throw new ImageRejected("This image is damaged or cannot be read. Try another file.");
  }
}

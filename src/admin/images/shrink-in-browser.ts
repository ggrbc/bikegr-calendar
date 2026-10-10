/**
 * Browser step of the upload. A Vercel Function accepts at most 4.5 MB, so a picked file over
 * `MAX_UPLOAD_BYTES` is drawn smaller (max 1600 px wide) before it is sent. The server then runs
 * `sharp` as for every upload. Only `targetSize` is pure; `shrinkForUpload` needs a browser.
 */
import { MAX_UPLOAD_BYTES, MAX_WIDTH } from "./limits";

/** Width at most `maxWidth`, aspect ratio kept, never upscaled, at least 1 px high. */
export function targetSize(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

export class ShrinkFailed extends Error {
  override name = "ShrinkFailed";
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The file to send: the same file when it is small enough, else a smaller WebP (or JPEG where
 * the browser cannot encode WebP). Throws `ShrinkFailed` with a message for the Editor.
 */
export async function shrinkForUpload(file: File): Promise<Blob> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF orientation, as the server does.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ShrinkFailed("This image cannot be read. Try a JPEG or PNG.");
  }
  const size = targetSize(bitmap.width, bitmap.height, MAX_WIDTH);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new ShrinkFailed("This browser cannot make the image smaller. Use a file under 4 MB.");
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  // A browser that cannot encode WebP returns PNG instead; then use JPEG, which is smaller.
  let blob = await toBlob(canvas, "image/webp", 0.9);
  if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", 0.9);
  if (!blob) throw new ShrinkFailed("This image cannot be read. Try a JPEG or PNG.");
  if (blob.size > MAX_UPLOAD_BYTES) throw new ShrinkFailed("The image is still larger than 4 MB. Try another file.");
  return blob;
}

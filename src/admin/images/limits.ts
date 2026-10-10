/** Event-image limits, shared by the server module and the browser field. No imports. */

/**
 * Largest file the server accepts. A Vercel Function takes a request body of 4.5 MB at most;
 * `next.config.ts` sets the server-action body limit to 4.5 MB, so this leaves room for the
 * multipart overhead.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Largest file an Editor can pick. Over `MAX_UPLOAD_BYTES`, the browser shrinks it first. */
export const MAX_SELECT_BYTES = 10 * 1024 * 1024;

/** Stored images are at most this wide. Never upscaled. */
export const MAX_WIDTH = 1600;

/** The image types an Editor can pick. No SVG: it can carry script. */
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"] as const;

/** The `accept` value of the file input. Without HEIC, iOS converts a HEIC photo to JPEG. */
export const ACCEPT = ACCEPTED_TYPES.join(",");

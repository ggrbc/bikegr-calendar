"use server";

import { requireEditor } from "@/auth/dal";
import { MAX_UPLOAD_BYTES } from "./limits";
import { requestBlobStore } from "./request-blob-store";
import { uploadEventImage, type UploadResult } from "./upload-image";

/**
 * Editors only. Takes `file` from the form data, resizes it to WebP, stores it in Blob, and
 * returns the public URL. Changes no page, so no `revalidatePath`: the Event save does that.
 *
 * The body limit (`experimental.serverActions.bodySizeLimit` in next.config.ts) is 4.5 MB, the
 * Vercel Function limit. `<ImageUploadField>` shrinks a larger file in the browser first.
 */
export async function uploadEventImageAction(formData: FormData): Promise<UploadResult> {
  await requireEditor();

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Pick an image file." };
  // Check the size before the bytes are read into memory.
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "The image is larger than 4 MB. Make it smaller and try again." };
  }

  const store = await requestBlobStore();
  return uploadEventImage(new Uint8Array(await file.arrayBuffer()), { store });
}

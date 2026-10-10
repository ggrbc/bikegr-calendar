"use client";

/**
 * The Event image field. Put it inside the Event `<form>`: it sends the image URL in a hidden
 * input (`name`, default `imageUrl`), never the file.
 *
 * ```tsx
 * import { ImageUploadField } from "@/admin/images/image-upload-field";
 *
 * <ImageUploadField
 *   name="imageUrl"                 // hidden input name; default "imageUrl"
 *   defaultValue={event.imageUrl}   // string | null; shows the current image
 *   label="Image"                   // default "Image"
 *   onUploadingChange={setBusy}     // optional; true while an upload runs (disable Save)
 *   onChange={(url) => …}           // optional; the new URL, or null after "Remove image"
 * />
 * ```
 *
 * The hidden input is an empty string when there is no image. The Event save must check the URL
 * with `isEventImageUrl` (from `@/admin/images/image-url`) or accept the URL already stored on the
 * Event: a form value is not proof.
 *
 * A file over 4 MB (and at most 10 MB) is made smaller in the browser first, because a Vercel
 * Function accepts at most 4.5 MB. Server actions give no byte progress, so progress is the
 * "Uploading…" state. A failed upload keeps the earlier image.
 */
import { useId, useState } from "react";
import { uploadEventImageAction } from "./actions";
import { ACCEPT, ACCEPTED_TYPES, MAX_SELECT_BYTES } from "./limits";
import { ShrinkFailed, shrinkForUpload } from "./shrink-in-browser";

export interface ImageUploadFieldProps {
  /** Name of the hidden input with the URL. Default `imageUrl`. */
  name?: string;
  /** The current image URL, or null. */
  defaultValue?: string | null;
  /** Default "Image". */
  label?: string;
  disabled?: boolean;
  /** True while an upload runs, then false. */
  onUploadingChange?: (uploading: boolean) => void;
  /** The new URL after an upload, or null after "Remove image". */
  onChange?: (url: string | null) => void;
}

type Status = { kind: "idle" } | { kind: "uploading" } | { kind: "error"; message: string };

export function ImageUploadField({
  name = "imageUrl",
  defaultValue = null,
  label = "Image",
  disabled = false,
  onUploadingChange,
  onChange,
}: ImageUploadFieldProps) {
  const id = useId();
  const [url, setUrl] = useState<string | null>(defaultValue || null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const uploading = status.kind === "uploading";

  function setValue(next: string | null) {
    setUrl(next);
    onChange?.(next);
  }

  async function upload(file: File) {
    if (file.type !== "" && !(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      setStatus({ kind: "error", message: "Use a JPEG, PNG, GIF, WebP, or AVIF image." });
      return;
    }
    if (file.size > MAX_SELECT_BYTES) {
      setStatus({ kind: "error", message: "The image is larger than 10 MB. Pick a smaller file." });
      return;
    }

    setStatus({ kind: "uploading" });
    onUploadingChange?.(true);
    try {
      const body = await shrinkForUpload(file);
      const formData = new FormData();
      formData.append("file", body, file.name);
      const result = await uploadEventImageAction(formData);
      if (result.ok) {
        setValue(result.url);
        setStatus({ kind: "idle" });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof ShrinkFailed ? error.message : "The upload failed. Try again.",
      });
    } finally {
      onUploadingChange?.(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input type="hidden" name={name} value={url ?? ""} />
      {url && (
        // A plain <img>: the preview shows any stored URL (also an imported one) at its own size.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="max-h-64 w-auto max-w-full self-start rounded border border-gray-300" />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* No `name`: the file never goes with the Event form. */}
        <input
          id={id}
          type="file"
          accept={ACCEPT}
          disabled={disabled || uploading}
          aria-describedby={`${id}-status`}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void upload(file);
          }}
          className="text-sm"
        />
        {url && (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => {
              setValue(null);
              setStatus({ kind: "idle" });
            }}
            className="rounded border border-gray-500 px-3 py-1 text-sm disabled:opacity-60"
          >
            Remove image
          </button>
        )}
      </div>
      <p id={`${id}-status`} className="text-sm">
        {status.kind === "uploading" && <span role="status">Uploading…</span>}
        {status.kind === "error" && (
          <span role="alert" className="text-red-700">
            {status.message}
          </span>
        )}
        {status.kind === "idle" && (
          <span className="text-gray-700">JPEG, PNG, GIF, WebP, or AVIF, up to 10 MB. Stored at most 1600 px wide.</span>
        )}
      </p>
    </div>
  );
}

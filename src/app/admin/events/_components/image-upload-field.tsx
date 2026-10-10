"use client";

/**
 * Stand-in for `ImageUploadField` from `@/admin/images/image-upload-field` (stream
 * `admin-people-tags-images`), with the same props. It shows a plain URL input; the real field
 * uploads the file. When that stream merges, import the real component and delete this file.
 */
import { useId, useState } from "react";

export interface ImageUploadFieldProps {
  name: string;
  defaultValue?: string | null;
  label: string;
  /** The real field calls it while a file uploads. The stand-in never uploads. */
  onUploadingChange?: (uploading: boolean) => void;
  onChange?: (url: string) => void;
  disabled?: boolean;
}

export function ImageUploadField({ name, defaultValue, label, onChange, disabled }: ImageUploadFieldProps) {
  const id = useId();
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <p className="text-sm text-gray-700">Image URL. Upload comes later.</p>
      <input
        id={id}
        name={name}
        type="url"
        className="w-full rounded border border-gray-400 px-3 py-2"
        placeholder="https://"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(e.target.value);
        }}
      />
    </div>
  );
}

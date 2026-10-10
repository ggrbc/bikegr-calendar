"use client";

import { cloneElement, type ReactElement, useId } from "react";
import type { ContentValues, FieldErrors } from "@/admin/events/event-input";
import { CALENDAR_LABELS } from "@/admin/events/format";
import { ImageUploadField } from "@/admin/images/image-upload-field";
import type { PickerTag } from "@/admin/tags/tags";
import type { CalendarSlug } from "@/engine";
import { checkClass, chipClass, hintClass, inputClass, labelClass, legendClass } from "../../_components/ui";

export { inputClass };

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm font-semibold text-red-700">
      {message}
    </p>
  );
}

/**
 * A label, an optional hint, one input, and its error. The input gets a unique id: the router keeps
 * an earlier page in the DOM (hidden), so a fixed id could point the label at the wrong input.
 */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}) {
  const inputId = `${id}-${useId()}`;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className={labelClass}>
        {label}
      </label>
      {hint && <p className={hintClass}>{hint}</p>}
      {cloneElement(children, {
        id: inputId,
        "aria-describedby": error ? errorId : undefined,
        "aria-invalid": error ? true : undefined,
      })}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function TagPicker({
  tags,
  selected,
  onChange,
  error,
}: {
  tags: PickerTag[];
  selected: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={`${labelClass} mb-1`}>Tags</legend>
      {tags.length === 0 && <p className={hintClass}>This Calendar has no Tags yet.</p>}
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <label key={tag.id} className={chipClass}>
            <input
              type="checkbox"
              className={checkClass}
              checked={selected.includes(tag.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, tag.id] : selected.filter((id) => id !== tag.id))
              }
            />
            {tag.name}
          </label>
        ))}
      </div>
      <FieldError id="tags-error" message={error} />
    </fieldset>
  );
}

/**
 * Title, description, place, Tags, image, and button: the fields that "All dates" changes.
 * `lockCalendar`: a Series split keeps the Calendar.
 */
export function ContentFields<T extends ContentValues>({
  values,
  onChange,
  errors,
  tagsByCalendar,
  lockCalendar = false,
  imageKey,
  onUploadingChange,
}: {
  values: T;
  onChange: (values: T) => void;
  errors: FieldErrors;
  tagsByCalendar: Record<CalendarSlug, PickerTag[]>;
  lockCalendar?: boolean;
  imageKey: string;
  onUploadingChange: (busy: boolean) => void;
}) {
  const set = (patch: Partial<ContentValues>) => onChange({ ...values, ...patch });
  const calendar = values.calendar as CalendarSlug;
  return (
    <div className="flex flex-col gap-4">
      <Field id="calendar" label="Calendar" error={errors.calendar}>
        <select
          id="calendar"
          className={inputClass}
          value={values.calendar}
          disabled={lockCalendar}
          // A new Calendar has its own Tags, so the Tag choice starts again.
          onChange={(e) => set({ calendar: e.target.value, tagIds: [] })}
        >
          {(Object.keys(CALENDAR_LABELS) as CalendarSlug[]).map((slug) => (
            <option key={slug} value={slug}>
              {CALENDAR_LABELS[slug]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="title" label="Title" error={errors.title}>
        <input
          id="title"
          className={inputClass}
          value={values.title}
          onChange={(e) => set({ title: e.target.value })}
          required
        />
      </Field>
      <Field id="description" label="Description" error={errors.description}>
        <textarea
          id="description"
          rows={5}
          className={inputClass}
          value={values.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
      <Field id="location" label="Location" error={errors.location}>
        <input
          id="location"
          className={inputClass}
          value={values.location}
          onChange={(e) => set({ location: e.target.value })}
        />
      </Field>
      <TagPicker
        tags={tagsByCalendar[calendar] ?? []}
        selected={values.tagIds}
        onChange={(tagIds) => set({ tagIds })}
        error={errors.tags}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className={`${legendClass} mb-1`}>Button (optional)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="cta-label" label="Button label">
            <input
              id="cta-label"
              className={inputClass}
              placeholder="Register"
              value={values.ctaLabel}
              onChange={(e) => set({ ctaLabel: e.target.value })}
            />
          </Field>
          <Field id="cta-url" label="Button URL">
            <input
              id="cta-url"
              type="url"
              className={inputClass}
              placeholder="https://"
              value={values.ctaUrl}
              onChange={(e) => set({ ctaUrl: e.target.value })}
            />
          </Field>
        </div>
        <FieldError id="cta-error" message={errors.cta} />
      </fieldset>
      <div>
        <ImageUploadField
          key={imageKey}
          name="imageUrl"
          label="Image"
          defaultValue={values.imageUrl || null}
          onUploadingChange={onUploadingChange}
          onChange={(url) => set({ imageUrl: url ?? "" })}
        />
        <FieldError id="image-error" message={errors.imageUrl} />
      </div>
    </div>
  );
}

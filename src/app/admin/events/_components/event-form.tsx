"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { EventFormValues, FieldErrors } from "@/admin/events/event-input";
import { previewRuleInput } from "@/admin/events/form-values";
import { nextOccurrences } from "@/admin/events/preview";
import type { PickerTag } from "@/admin/tags/tags";
import { addMinutes, type CalendarSlug, isLocalDateTime, minutesBetween, type OverrideInput } from "@/engine";
import { createEventAction, saveEventAction, type SaveState } from "../actions";
import { ContentFields, Field, inputClass } from "./fields";
import { OccurrencePreview } from "./occurrence-preview";
import { RuleEditor, SkippedDates } from "./rule-editor";
import { errorsOf, IDLE, SaveStatus } from "./save-status";

export interface EventFormProps {
  /** `create`, or the edit of a one-time Event. */
  mode: "create" | "edit";
  id?: string;
  version?: number;
  initial: EventFormValues;
  tagsByCalendar: Record<CalendarSlug, PickerTag[]>;
  isAdmin: boolean;
  /** Today in Detroit, from the server. */
  today: string;
  overrides?: OverrideInput[];
  /** Edit only: "pending" for a Submission (every field, also the rule of a Series). */
  scope?: "one-time" | "pending";
  /** Edit only: true while the form has changes that are not saved. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Create, or edit a one-time Event (which may become a Series), or a pending Submission. */
export function EventForm(props: EventFormProps) {
  const [state, dispatch, pending] = useActionState<SaveState, unknown>(
    props.mode === "create" ? createEventAction : saveEventAction,
    IDLE,
  );
  return (
    <div className="flex flex-col gap-4">
      <SaveStatus state={state} />
      {/* A new version (after a save) starts the form again from the saved values. */}
      <EventFormBody
        key={props.version ?? 0}
        {...props}
        errors={errorsOf(state)}
        pending={pending}
        submit={(values) => dispatch({ id: props.id, version: props.version, scope: props.scope ?? "one-time", values })}
      />
    </div>
  );
}

export function TimingFields({
  values,
  onChange,
  errors,
}: {
  values: Pick<EventFormValues, "allDay" | "start" | "end">;
  onChange: (patch: Pick<EventFormValues, "allDay" | "start" | "end">) => void;
  errors: FieldErrors;
}) {
  const { allDay, start, end } = values;

  function setAllDay(next: boolean) {
    if (next === allDay) return;
    onChange(
      next
        ? { allDay: true, start: start.slice(0, 10), end: end.slice(0, 10) || start.slice(0, 10) }
        : { allDay: false, start: `${start.slice(0, 10)}T18:00`, end: `${end.slice(0, 10) || start.slice(0, 10)}T20:00` },
    );
  }

  /** A new start keeps the length of the time slot. */
  function setStart(next: string) {
    if (!allDay && isLocalDateTime(start) && isLocalDateTime(end) && isLocalDateTime(next)) {
      onChange({ allDay, start: next, end: addMinutes(next, Math.max(0, minutesBetween(start, end))) });
    } else if (allDay && end < next) {
      onChange({ allDay, start: next, end: next });
    } else {
      onChange({ allDay, start: next, end });
    }
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-medium">When (Detroit time)</legend>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        All day
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="start" label={allDay ? "First day" : "Starts"} error={errors.start}>
          <input
            id="start"
            type={allDay ? "date" : "datetime-local"}
            className={inputClass}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field id="end" label={allDay ? "Last day" : "Ends"} error={errors.end}>
          <input
            id="end"
            type={allDay ? "date" : "datetime-local"}
            className={inputClass}
            value={end}
            onChange={(e) => onChange({ allDay, start, end: e.target.value })}
          />
        </Field>
      </div>
    </fieldset>
  );
}

export function ScheduleFields({
  status,
  note,
  onChange,
  errors,
}: {
  status: string;
  note: string;
  onChange: (patch: { scheduleStatus?: string; scheduleNote?: string }) => void;
  errors: FieldErrors;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="schedule-status" label="Schedule status" error={errors.scheduleStatus}>
        <select
          id="schedule-status"
          className={inputClass}
          value={status}
          onChange={(e) => onChange({ scheduleStatus: e.target.value })}
        >
          <option value="scheduled">Scheduled (no badge)</option>
          <option value="tentative">Tentative (date to be confirmed)</option>
          <option value="cancelled">Cancelled</option>
          <option value="postponed">Postponed (new date not known)</option>
        </select>
      </Field>
      <Field id="schedule-note" label="Schedule note (public, short)" error={errors.scheduleNote}>
        <input
          id="schedule-note"
          className={inputClass}
          value={note}
          placeholder="Rain — see you next week"
          onChange={(e) => onChange({ scheduleNote: e.target.value })}
        />
      </Field>
    </div>
  );
}

function EventFormBody({
  mode,
  initial,
  tagsByCalendar,
  isAdmin,
  today,
  overrides = [],
  onDirtyChange,
  errors,
  pending,
  submit,
}: EventFormProps & {
  errors: FieldErrors;
  pending: boolean;
  submit: (values: EventFormValues) => void;
}) {
  const [values, setValues] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<EventFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const repeats = values.rule.mode !== "none";
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const preview = useMemo(() => {
    const input = previewRuleInput(values);
    return input.ok ? nextOccurrences(input.rule, overrides, today) : input;
  }, [values, overrides, today]);

  return (
    <form action={() => submit(values)} className="flex flex-col gap-6">
      <ContentFields
        values={values}
        onChange={setValues}
        errors={errors}
        tagsByCalendar={tagsByCalendar}
        imageKey="image"
        onUploadingChange={setUploading}
      />
      <TimingFields values={values} onChange={set} errors={errors} />
      <RuleEditor
        value={values.rule}
        onChange={(rule) => set({ rule })}
        startDate={values.start.slice(0, 10)}
        isAdmin={isAdmin}
        errors={errors}
      />
      {repeats && <SkippedDates dates={values.exdates} onChange={(exdates) => set({ exdates })} error={errors.exdates} />}
      {!repeats && (
        <ScheduleFields
          status={values.scheduleStatus}
          note={values.scheduleNote}
          onChange={set}
          errors={errors}
        />
      )}
      <OccurrencePreview title="Next dates" result={preview} />
      <div>
        <button
          type="submit"
          disabled={pending || uploading}
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : mode === "create" ? "Create Event" : "Save"}
        </button>
      </div>
    </form>
  );
}

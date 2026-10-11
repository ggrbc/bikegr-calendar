"use client";

import { useActionState, useState } from "react";
import type { FieldErrors, OverrideFormValues } from "@/admin/events/event-input";
import { clearOverrideAction, saveOverrideAction, type SaveState } from "../actions";
import { TimingFields } from "./event-form";
import { ScheduleFields } from "./schedule-fields";
import { buttonClass, hintClass, panelClass } from "../../_components/ui";
import { Field, inputClass } from "./fields";
import { errorsOf, IDLE, SaveStatus } from "./save-status";
import { submitForm } from "./submit-form";

export interface OverrideFormProps {
  id: string;
  version: number;
  allDay: boolean;
  initial: OverrideFormValues;
  hasOverride: boolean;
}

/** Change one date of a Series: time, title, place, Schedule status, and Schedule note. */
export function OverrideForm(props: OverrideFormProps) {
  const [state, dispatch, pending] = useActionState<SaveState, unknown>(saveOverrideAction, IDLE);
  const [clearState, clear, clearing] = useActionState<SaveState, unknown>(clearOverrideAction, IDLE);
  const shown = clearState.status !== "idle" && state.status === "idle" ? clearState : state;
  return (
    <div className="flex flex-col gap-4">
      <SaveStatus state={shown} />
      <OverrideBody
        key={props.version}
        {...props}
        errors={errorsOf(state)}
        pending={pending || clearing}
        submit={(values) => dispatch({ id: props.id, version: props.version, values })}
        clear={() => clear({ id: props.id, version: props.version, originalStart: props.initial.originalStart })}
      />
    </div>
  );
}

function OverrideBody({
  allDay,
  initial,
  hasOverride,
  errors,
  pending,
  submit,
  clear,
}: OverrideFormProps & {
  errors: FieldErrors;
  pending: boolean;
  submit: (values: OverrideFormValues) => void;
  clear: () => void;
}) {
  const [values, setValues] = useState(initial);
  const set = (patch: Partial<OverrideFormValues>) => setValues((v) => ({ ...v, ...patch }));
  return (
    <form onSubmit={(event) => submitForm(event, () => submit(values))} className={`${panelClass} flex flex-col gap-6`}>
      <TimingFields
        values={{ allDay, start: values.start, end: values.end }}
        // The kind of time slot stays the Series' kind.
        onChange={({ start, end }) => set({ start, end })}
        errors={errors}
      />
      <Field id="override-title" label="Title on this date" error={errors.title}>
        <input
          id="override-title"
          className={inputClass}
          value={values.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      </Field>
      <Field id="override-location" label="Location on this date" error={errors.location}>
        <input
          id="override-location"
          className={inputClass}
          value={values.location}
          onChange={(e) => set({ location: e.target.value })}
        />
      </Field>
      <ScheduleFields
        status={values.scheduleStatus}
        note={values.scheduleNote}
        details={values.occurrenceDetails}
        onChange={set}
        errors={errors}
      />
      <p className={hintClass}>
        A new time shows as “Rescheduled” on the old and the new date. Fields that you do not change stay
        the same as the Series.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending}
          className={buttonClass("primary")}
        >
          {pending ? "Saving…" : "Save this date"}
        </button>
        {hasOverride && (
          <button
            type="button"
            disabled={pending}
            className={buttonClass("secondary")}
            onClick={() => {
              if (window.confirm("Remove every change to this date?")) clear();
            }}
          >
            Clear the changes to this date
          </button>
        )}
      </div>
    </form>
  );
}

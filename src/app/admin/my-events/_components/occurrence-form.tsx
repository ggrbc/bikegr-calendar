"use client";

import { useActionState, useState } from "react";
import { buttonClass, panelClass } from "../../_components/ui";
import { ScheduleFields } from "../../events/_components/schedule-fields";
import { errorsOf, IDLE, SaveStatus } from "../../events/_components/save-status";
import { submitForm } from "../../events/_components/submit-form";
import type { SaveState } from "../../events/actions";
import { saveOccurrenceAction } from "../actions";

export interface OccurrenceFormProps {
  eventId: string;
  originalStart: string;
  initial: { scheduleStatus: string; scheduleNote: string; occurrenceDetails: string };
}

/**
 * The Event manager's date form: Schedule status, Schedule note, and Occurrence details. Nothing
 * else. The server checks the grant and the date again.
 */
export function OccurrenceForm({ eventId, originalStart, initial }: OccurrenceFormProps) {
  const [values, setValues] = useState(initial);
  const [state, dispatch, pending] = useActionState<SaveState, unknown>(saveOccurrenceAction, IDLE);
  // A change to a field hides the result of the last save. The next save then shows a new status
  // element, which a screen reader announces (the same text twice would be silent).
  const [staleFor, setStaleFor] = useState<SaveState | null>(null);
  return (
    <form
      onSubmit={(event) => submitForm(event, () => dispatch({ eventId, originalStart, values }))}
      className={`${panelClass} flex flex-col gap-4`}
    >
      <ScheduleFields
        status={values.scheduleStatus}
        note={values.scheduleNote}
        details={values.occurrenceDetails}
        onChange={(patch) => {
          setValues((v) => ({ ...v, ...patch }));
          setStaleFor(state);
        }}
        errors={errorsOf(state)}
      />
      <SaveStatus state={state === staleFor ? IDLE : state} pending={pending} />
      <div>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

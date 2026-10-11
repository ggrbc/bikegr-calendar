"use client";

import type { FieldErrors } from "@/admin/events/event-input";
import { hintClass } from "../../_components/ui";
import { Field, inputClass } from "./fields";

const DETAILS_MAX = 2000;

/**
 * Schedule status, Schedule note, and Occurrence details of one Occurrence. The Editor forms and the
 * Event manager's date form share it
 * (it offers the four stored values only: `rescheduled` needs a new time).
 */
export function ScheduleFields({
  status,
  note,
  details,
  onChange,
  errors,
}: {
  status: string;
  note: string;
  details: string;
  onChange: (patch: { scheduleStatus?: string; scheduleNote?: string; occurrenceDetails?: string }) => void;
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
      <div className="sm:col-span-2">
        <Field id="occurrence-details" label="Occurrence details (public, for this date)" error={errors.occurrenceDetails}>
          <textarea
            id="occurrence-details"
            rows={5}
            maxLength={DETAILS_MAX}
            className={inputClass}
            value={details}
            placeholder="Route, conditions, a map link"
            onChange={(e) => onChange({ occurrenceDetails: e.target.value })}
          />
        </Field>
        <p className={`${hintClass} mt-1`}>
          {[...details].length} of {DETAILS_MAX.toLocaleString("en-US")} characters. Web addresses become
          links. Shown on the page of this date, not on the agenda card.
        </p>
      </div>
    </div>
  );
}

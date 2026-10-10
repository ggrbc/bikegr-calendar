"use client";

import { useActionState, useMemo, useState } from "react";
import { describeRrule } from "@/admin/events/describe-rule";
import type { FieldErrors, SeriesContentValues, SplitDraft, SplitFormValues } from "@/admin/events/event-input";
import { rruleFromChoice } from "@/admin/events/form-values";
import { planSplit, type SplitPlan, type SplitSeries } from "@/admin/events/plan-split";
import { nextOccurrences } from "@/admin/events/preview";
import type { PickerTag } from "@/admin/events/seams";
import { shortDate, shortSlot, timeText } from "@/agenda/dates";
import { addDays, type CalendarSlug, isLocalDate, type OverrideInput } from "@/engine";
import { saveEventAction, type SaveState, splitSeriesAction } from "../actions";
import { ContentFields, Field, inputClass } from "./fields";
import { OccurrencePreview } from "./occurrence-preview";
import { RuleEditor, SkippedDates } from "./rule-editor";
import { errorsOf, IDLE, SaveStatus } from "./save-status";

type Scope = "all" | "later" | "one";

export interface SeriesEditorProps {
  id: string;
  version: number;
  contentInitial: SeriesContentValues;
  splitInitial: SplitFormValues;
  series: SplitSeries & { rrule: string };
  overrides: OverrideInput[];
  tagsByCalendar: Record<CalendarSlug, PickerTag[]>;
  isAdmin: boolean;
  today: string;
}

const SCOPES: { value: Scope; label: string; help: string }[] = [
  {
    value: "all",
    label: "All dates",
    help: "Change the title, description, place, Tags, image, button, or skipped dates for every date. The time and the repeat stay the same.",
  },
  {
    value: "later",
    label: "This date and later",
    help: "Change the time or the repeat from a date you pick, or stop the Series. Dates before it stay as they are. A change makes a new Event from that date on.",
  },
  {
    value: "one",
    label: "One date",
    help: "Change, move, or cancel one date only. Pick it in the list of dates below.",
  },
];

/** The three Series edit scopes (ADR 0001). */
export function SeriesEditor(props: SeriesEditorProps) {
  const [scope, setScope] = useState<Scope>("all");
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">What do you want to change?</legend>
        {SCOPES.map((s) => (
          <label key={s.value} className="flex items-start gap-2">
            <input
              type="radio"
              name="scope"
              className="mt-1"
              checked={scope === s.value}
              onChange={() => setScope(s.value)}
            />
            <span>
              <span className="font-medium">{s.label}</span> — {s.help}
            </span>
          </label>
        ))}
      </fieldset>
      {scope === "all" && <AllDatesForm {...props} />}
      {scope === "later" && <SplitPanel {...props} />}
      {scope === "one" && (
        <p>
          Pick a date in <a href="#dates" className="underline">the list of dates</a>, then “Change this date”.
        </p>
      )}
    </div>
  );
}

function AllDatesForm(props: SeriesEditorProps) {
  const [state, dispatch, pending] = useActionState<SaveState, unknown>(saveEventAction, IDLE);
  return (
    <div className="flex flex-col gap-4">
      <SaveStatus state={state} />
      <AllDatesBody
        key={props.version}
        {...props}
        errors={errorsOf(state)}
        pending={pending}
        submit={(values) => dispatch({ id: props.id, version: props.version, scope: "all", values })}
      />
    </div>
  );
}

function AllDatesBody({
  contentInitial,
  series,
  overrides,
  tagsByCalendar,
  today,
  errors,
  pending,
  submit,
}: SeriesEditorProps & { errors: FieldErrors; pending: boolean; submit: (v: SeriesContentValues) => void }) {
  const [values, setValues] = useState(contentInitial);
  const [uploading, setUploading] = useState(false);
  const preview = useMemo(() => {
    const exdates = values.exdates
      .filter(isLocalDate)
      .map((d) => (series.timing.kind === "timed" ? `${d}${series.timing.start.slice(10)}` : d));
    return nextOccurrences(
      { eventId: "preview", timing: series.timing, rrule: series.rrule, exdates, scheduleStatus: "scheduled", scheduleNote: null },
      overrides,
      today,
    );
  }, [values.exdates, series, overrides, today]);

  return (
    <form action={() => submit(values)} className="flex flex-col gap-6">
      <p className="rounded bg-gray-100 p-3">
        Repeat: {describeRrule(series.rrule)}, {timeText(series.timing)}. To change the time or the repeat, pick
        “This date and later”.
      </p>
      <ContentFields
        values={values}
        onChange={setValues}
        errors={errors}
        tagsByCalendar={tagsByCalendar}
        imageKey="image-all"
        onUploadingChange={setUploading}
      />
      <SkippedDates
        dates={values.exdates}
        onChange={(exdates) => setValues((v) => ({ ...v, exdates }))}
        error={errors.exdates}
      />
      <OccurrencePreview title="Next dates" result={preview} />
      <div>
        <button
          type="submit"
          disabled={pending || uploading}
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save for all dates"}
        </button>
      </div>
    </form>
  );
}

function SplitPanel(props: SeriesEditorProps) {
  const [state, dispatch, pending] = useActionState<SaveState, unknown>(splitSeriesAction, IDLE);
  return (
    <div className="flex flex-col gap-4">
      <SaveStatus state={state} />
      <SplitBody
        key={props.version}
        {...props}
        errors={errorsOf(state)}
        pending={pending}
        submit={(values) => dispatch({ id: props.id, version: props.version, values })}
      />
    </div>
  );
}

/** The plan for the form's values, as the server will make it. */
function planFor(values: SplitFormValues, series: SplitSeries, overrides: OverrideInput[]): SplitPlan {
  if (!isLocalDate(values.splitDate)) return { kind: "refused", message: "Pick a date." };
  const rule = rruleFromChoice(values.rule, values.splitDate, series.rrule);
  if (!rule.ok) return { kind: "refused", message: rule.message, field: "rule" };
  const time: SplitDraft["time"] = values.allDay
    ? { kind: "allDay", days: values.days }
    : { kind: "timed", startTime: values.startTime, endTime: values.endTime };
  if (time.kind === "timed" && !(/^\d{2}:\d{2}$/.test(time.startTime) && /^\d{2}:\d{2}$/.test(time.endTime))) {
    return { kind: "refused", message: "Give a start time and an end time." };
  }
  return planSplit(series, overrides, {
    splitDate: values.splitDate,
    mode: values.mode,
    time,
    rule: values.rule.mode === "same" || !rule.rrule ? { kind: "same" } : { kind: "rrule", rrule: rule.rrule },
  });
}

function changesText(n: number): string {
  return `${n} change${n === 1 ? "" : "s"} to one date`;
}

function PlanSummary({ plan }: { plan: SplitPlan }) {
  if (plan.kind === "refused") {
    return (
      <p role="alert" className="text-red-700">
        {plan.message}
      </p>
    );
  }
  const removed = plan.removedOverrides.map((s) => shortDate(s.slice(0, 10)));
  const lines: string[] = [];
  if (plan.kind === "stop") {
    const last = plan.old.rrule.match(/UNTIL=(\d{4})(\d{2})(\d{2})/);
    if (last) lines.push(`The Series ends on ${shortDate(`${last[1]}-${last[2]}-${last[3]}`)}. No new Event.`);
  } else {
    if (plan.kind === "split") {
      lines.push(
        `Dates before ${shortDate(plan.splitDate)} stay as they are. The old Event ends on ${shortDate(addDays(plan.splitDate, -1))}.`,
      );
      lines.push(
        `From ${shortSlot(plan.next.timing)}: ${timeText(plan.next.timing)}, ${describeRrule(plan.next.rrule)}. This is a new Event.`,
      );
    } else {
      lines.push(
        `No date is before ${shortDate(plan.splitDate)}, so this Event changes. First date: ${shortSlot(plan.next.timing)}, ${timeText(plan.next.timing)}, ${describeRrule(plan.next.rrule)}.`,
      );
    }
    if (plan.moved.length > 0) lines.push(`${changesText(plan.moved.length)} move to the new time.`);
  }
  return (
    <div role="status" className="rounded border border-blue-700 bg-blue-50 p-3">
      <h3 className="font-medium">What the save does</h3>
      <ul className="list-disc pl-6">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {removed.length > 0 && (
          <li className="text-red-800">
            {removed.length === 1 ? "This change to one date is removed" : "These changes to one date are removed"}:{" "}
            {removed.join("; ")}.
          </li>
        )}
      </ul>
    </div>
  );
}

function SplitBody({
  splitInitial,
  series,
  overrides,
  tagsByCalendar,
  isAdmin,
  today,
  errors,
  pending,
  submit,
}: SeriesEditorProps & { errors: FieldErrors; pending: boolean; submit: (v: SplitFormValues) => void }) {
  const [values, setValues] = useState(splitInitial);
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<SplitFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const plan = useMemo(() => planFor(values, series, overrides), [values, series, overrides]);
  const preview = useMemo(() => {
    if (plan.kind !== "split" && plan.kind !== "in-place") return null;
    const from = values.splitDate > today ? values.splitDate : today;
    return nextOccurrences(
      { eventId: "preview", ...plan.next, scheduleStatus: "scheduled", scheduleNote: null },
      [],
      from,
    );
  }, [plan, values.splitDate, today]);

  return (
    <form action={() => submit(values)} className="flex flex-col gap-6">
      <Field id="split-date" label="From this date" error={errors.splitDate}>
        <input
          id="split-date"
          type="date"
          className={`${inputClass} max-w-xs`}
          value={values.splitDate}
          onChange={(e) => set({ splitDate: e.target.value })}
        />
      </Field>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">From this date</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="split-mode" checked={values.mode === "change"} onChange={() => set({ mode: "change" })} />
          Change the time or the repeat
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="split-mode" checked={values.mode === "stop"} onChange={() => set({ mode: "stop" })} />
          Stop the Series (no more dates from this date)
        </label>
      </fieldset>

      {values.mode === "change" && (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="font-medium">New time (Detroit time)</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={values.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
              All day
            </label>
            {values.allDay ? (
              <Field id="split-days" label="Number of days" error={errors.days}>
                <input
                  id="split-days"
                  type="number"
                  min={1}
                  max={31}
                  className={`${inputClass} max-w-24`}
                  value={values.days}
                  onChange={(e) => set({ days: Number(e.target.value) })}
                />
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="split-start" label="Starts" error={errors.startTime}>
                  <input
                    id="split-start"
                    type="time"
                    className={inputClass}
                    value={values.startTime}
                    onChange={(e) => set({ startTime: e.target.value })}
                  />
                </Field>
                <Field
                  id="split-end"
                  label="Ends"
                  hint="An end before the start means the next day."
                  error={errors.endTime}
                >
                  <input
                    id="split-end"
                    type="time"
                    className={inputClass}
                    value={values.endTime}
                    onChange={(e) => set({ endTime: e.target.value })}
                  />
                </Field>
              </div>
            )}
          </fieldset>
          <RuleEditor
            value={values.rule}
            onChange={(rule) => set({ rule })}
            startDate={values.splitDate}
            isAdmin={isAdmin}
            allowSame
            allowNone={false}
            storedRrule={series.rrule}
            errors={errors}
          />
          <details className="rounded border border-gray-300 p-3">
            <summary className="cursor-pointer font-medium">Also change the words, Tags, image, or button from this date</summary>
            <div className="mt-3">
              <ContentFields
                values={values}
                onChange={setValues}
                errors={errors}
                tagsByCalendar={tagsByCalendar}
                lockCalendar
                imageKey="image-split"
                onUploadingChange={setUploading}
              />
            </div>
          </details>
        </>
      )}

      <PlanSummary plan={plan} />
      {preview && <OccurrencePreview title="Dates from the change" result={preview} />}
      <div>
        <button
          type="submit"
          disabled={pending || uploading || plan.kind === "refused"}
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : values.mode === "stop" ? "Stop the Series" : "Save from this date"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import { describeRrule, MONTH_NAMES, weekdayName } from "@/admin/events/describe-rule";
import type { FieldErrors, RuleChoice } from "@/admin/events/event-input";
import { defaultRuleForm } from "@/admin/events/form-values";
import {
  MONTH_POSITIONS,
  type MonthPosition,
  type RuleEnd,
  type RuleForm,
  WEEKDAYS,
  type Weekday,
} from "@/admin/events/rule-form";
import { shortDate } from "@/agenda/dates";
import { dayOfWeek, isLocalDate } from "@/engine";
import {
  buttonClass,
  checkClass,
  chipClass,
  hintClass,
  labelClass,
  legendClass,
  smallInputClass,
} from "../../_components/ui";
import { Field, FieldError, inputClass } from "./fields";

type RepeatKind = "none" | "same" | RuleForm["repeat"] | "advanced";

const REPEAT_LABELS: Record<RepeatKind, string> = {
  none: "Does not repeat",
  same: "Same repeat as now",
  weekly: "Weekly",
  monthlyWeekday: "Monthly, on a weekday (for example the 2nd Tuesday)",
  monthlyDay: "Monthly, on a day of the month",
  yearly: "Yearly, on a date",
  fullMoon: "Every full moon",
  advanced: "Advanced: RRULE text (Admins)",
};

const POSITION_LABELS: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th", "-1": "Last" };

function kindOf(choice: RuleChoice): RepeatKind {
  if (choice.mode === "form") return choice.form.repeat;
  return choice.mode;
}

/** A new form of `kind`, from the start date, with the end of the current form. */
function newForm(kind: RuleForm["repeat"], startDate: string, end: RuleEnd): RuleForm {
  const date = isLocalDate(startDate) ? startDate : "2026-01-06";
  const weekday = WEEKDAYS[(dayOfWeek(date) + 6) % 7];
  const day = Number(date.slice(8, 10));
  switch (kind) {
    case "weekly":
      return { ...defaultRuleForm(date), end } as RuleForm;
    case "monthlyWeekday": {
      const position = Math.ceil(day / 7);
      return { repeat: "monthlyWeekday", positions: [position > 4 ? -1 : (position as MonthPosition)], weekday, end };
    }
    case "monthlyDay":
      return { repeat: "monthlyDay", day, end };
    case "yearly":
      return { repeat: "yearly", month: Number(date.slice(5, 7)), day, end };
    case "fullMoon":
      return { repeat: "fullMoon", end };
  }
}

function toggle<T>(list: T[], item: T, on: boolean): T[] {
  return on ? [...new Set([...list, item])] : list.filter((x) => x !== item);
}

/**
 * The rule editor: structured shapes, an end, and (Admins) Advanced RRULE text. A rule that does
 * not fit the form is read-only for Editors.
 */
export function RuleEditor({
  value,
  onChange,
  startDate,
  isAdmin,
  allowSame = false,
  allowNone = true,
  storedRrule = null,
  defaultEnd,
  errors,
}: {
  value: RuleChoice;
  onChange: (value: RuleChoice) => void;
  startDate: string;
  isAdmin: boolean;
  allowSame?: boolean;
  allowNone?: boolean;
  storedRrule?: string | null;
  /** The end of a new repeat when there is none yet. */
  defaultEnd?: RuleEnd;
  errors: FieldErrors;
}) {
  const kind = kindOf(value);
  const currentEnd: RuleEnd = value.mode === "form" ? value.form.end : (defaultEnd ?? { kind: "never" });
  const kinds: RepeatKind[] = [
    ...(allowNone ? (["none"] as const) : []),
    ...(allowSame ? (["same"] as const) : []),
    "weekly",
    "monthlyWeekday",
    "monthlyDay",
    "yearly",
    "fullMoon",
    ...(isAdmin ? (["advanced"] as const) : []),
  ];
  const readOnly = value.mode === "advanced" && !isAdmin;

  function pick(next: RepeatKind) {
    if (next === "none" || next === "same") onChange({ mode: next });
    else if (next === "advanced") {
      onChange({ mode: "advanced", text: value.mode === "advanced" ? value.text : (storedRrule ?? "") });
    } else onChange({ mode: "form", form: newForm(next, startDate, currentEnd) });
  }

  const setForm = (form: RuleForm) => onChange({ mode: "form", form });

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className={`${legendClass} mb-1`}>Repeat</legend>
      {readOnly ? (
        <p>
          {describeRrule(value.text)}. Only an Admin can change this rule.
          {allowSame ? " You can still change the time with the same repeat." : ""}
        </p>
      ) : (
        <select
          aria-label="Repeat"
          className={inputClass}
          value={kind}
          onChange={(e) => pick(e.target.value as RepeatKind)}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {REPEAT_LABELS[k]}
            </option>
          ))}
        </select>
      )}
      {value.mode === "same" && storedRrule && (
        <p className={hintClass}>{describeRrule(storedRrule)}</p>
      )}
      {value.mode === "form" && <RuleFormFields form={value.form} onChange={setForm} errors={errors} />}
      {value.mode === "advanced" && isAdmin && (
        <Field
          id="rrule"
          label="RRULE"
          hint="RFC 5545, without the RRULE: prefix. The engine checks it. UNTIL is Detroit wall-clock time."
          error={errors.rule}
        >
          <textarea
            id="rrule"
            rows={2}
            className={`${inputClass} font-mono`}
            value={value.text}
            onChange={(e) => onChange({ mode: "advanced", text: e.target.value })}
          />
        </Field>
      )}
      {value.mode !== "advanced" && <FieldError id="rule-error" message={errors.rule} />}
    </fieldset>
  );
}

function RuleFormFields({
  form,
  onChange,
  errors,
}: {
  form: RuleForm;
  onChange: (form: RuleForm) => void;
  errors: FieldErrors;
}) {
  return (
    <div className="flex flex-col gap-3">
      {form.repeat === "weekly" && (
        <>
          <Field id="interval" label="Every how many weeks" error={errors.interval}>
            <input
              id="interval"
              type="number"
              min={1}
              max={52}
              className={`${inputClass} max-w-24`}
              value={form.interval}
              onChange={(e) => onChange({ ...form, interval: Number(e.target.value) })}
            />
          </Field>
          <fieldset>
            <legend className={labelClass}>Days</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => (
                <label key={day} className={chipClass}>
                  <input
                    type="checkbox"
                    className={checkClass}
                    checked={form.days.includes(day)}
                    onChange={(e) => onChange({ ...form, days: toggle(form.days, day, e.target.checked) })}
                  />
                  {weekdayName(day)}
                </label>
              ))}
            </div>
            <FieldError id="days-error" message={errors.days} />
          </fieldset>
          <fieldset>
            <legend className={labelClass}>Only in these months (none checked = every month)</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {MONTH_NAMES.map((name, i) => (
                <label key={name} className={chipClass}>
                  <input
                    type="checkbox"
                    className={checkClass}
                    checked={form.months.includes(i + 1)}
                    onChange={(e) => onChange({ ...form, months: toggle(form.months, i + 1, e.target.checked) })}
                  />
                  {name.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      {form.repeat === "monthlyWeekday" && (
        <>
          <fieldset>
            <legend className={labelClass}>Weeks of the month</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {MONTH_POSITIONS.map((p) => (
                <label key={p} className={chipClass}>
                  <input
                    type="checkbox"
                    className={checkClass}
                    checked={form.positions.includes(p)}
                    onChange={(e) => onChange({ ...form, positions: toggle(form.positions, p, e.target.checked) })}
                  />
                  {POSITION_LABELS[String(p)]}
                </label>
              ))}
            </div>
            <FieldError id="positions-error" message={errors.positions} />
          </fieldset>
          <Field id="weekday" label="Weekday">
            <select
              id="weekday"
              className={inputClass}
              value={form.weekday}
              onChange={(e) => onChange({ ...form, weekday: e.target.value as Weekday })}
            >
              {WEEKDAYS.map((day) => (
                <option key={day} value={day}>
                  {weekdayName(day)}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {form.repeat === "monthlyDay" && (
        <Field id="month-day" label="Day of the month" error={errors.day}>
          <input
            id="month-day"
            type="number"
            min={1}
            max={31}
            className={`${inputClass} max-w-24`}
            value={form.day}
            onChange={(e) => onChange({ ...form, day: Number(e.target.value) })}
          />
        </Field>
      )}
      {form.repeat === "yearly" && (
        <div className="flex flex-wrap gap-3">
          <Field id="year-month" label="Month">
            <select
              id="year-month"
              className={inputClass}
              value={form.month}
              onChange={(e) => onChange({ ...form, month: Number(e.target.value) })}
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="year-day" label="Day" error={errors.day}>
            <input
              id="year-day"
              type="number"
              min={1}
              max={31}
              className={`${inputClass} max-w-24`}
              value={form.day}
              onChange={(e) => onChange({ ...form, day: Number(e.target.value) })}
            />
          </Field>
        </div>
      )}
      {form.repeat === "fullMoon" && (
        <p className={hintClass}>
          On the date of each full moon in Grand Rapids, at the same time. The first date moves to the
          next full moon if the start date is not one.
        </p>
      )}
      <EndFields end={form.end} onChange={(end) => onChange({ ...form, end })} error={errors.ruleEnd} />
    </div>
  );
}

function EndFields({ end, onChange, error }: { end: RuleEnd; onChange: (end: RuleEnd) => void; error?: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={`${labelClass} mb-1`}>Ends</legend>
      <label className="flex items-center gap-2">
        <input type="radio" name="rule-end" className={checkClass} checked={end.kind === "never"} onChange={() => onChange({ kind: "never" })} />
        No end date
      </label>
      <label className="flex flex-wrap items-center gap-2">
        <input
          type="radio"
          name="rule-end"
          className={checkClass}
          checked={end.kind === "until"}
          onChange={() => onChange({ kind: "until", date: end.kind === "until" ? end.date : "" })}
        />
        On a date (the last day with a date)
        {end.kind === "until" && (
          <input
            type="date"
            aria-label="Last date"
            className={smallInputClass}
            value={end.date}
            onChange={(e) => onChange({ kind: "until", date: e.target.value })}
          />
        )}
      </label>
      <label className="flex flex-wrap items-center gap-2">
        <input
          type="radio"
          name="rule-end"
          className={checkClass}
          checked={end.kind === "count"}
          onChange={() => onChange({ kind: "count", count: end.kind === "count" ? end.count : 10 })}
        />
        After a number of dates
        {end.kind === "count" && (
          <input
            type="number"
            min={1}
            aria-label="Number of dates"
            className={`${smallInputClass} w-24`}
            value={end.count}
            onChange={(e) => onChange({ kind: "count", count: Number(e.target.value) })}
          />
        )}
      </label>
      <FieldError id="rule-end-error" message={error} />
    </fieldset>
  );
}

/** Skipped dates: dates that the repeat makes but the Event does not have. */
export function SkippedDates({
  dates,
  onChange,
  error,
}: {
  dates: string[];
  onChange: (dates: string[]) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={`${legendClass} mb-1`}>Skipped dates</legend>
      <p className={hintClass}>
        A skipped date is not part of the Series and does not show. To show a date as cancelled, change
        that one date instead.
      </p>
      {dates.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {dates.map((date) => (
            <li key={date} className="flex items-center gap-2 rounded-[300px] border border-[#8a898a] bg-brand-page py-1 pl-3 pr-1">
              {isLocalDate(date) ? shortDate(date) : date}, {date.slice(0, 4)}
              <button
                type="button"
                className={buttonClass("secondary", "sm")}
                aria-label={`Do not skip ${date}`}
                onClick={() => onChange(dates.filter((d) => d !== date))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          aria-label="Date to skip"
          className={smallInputClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className={buttonClass("secondary", "sm")}
          disabled={!isLocalDate(draft)}
          onClick={() => {
            onChange([...new Set([...dates, draft])].sort());
            setDraft("");
          }}
        >
          Skip this date
        </button>
      </div>
      <FieldError id="exdates-error" message={error} />
    </fieldset>
  );
}

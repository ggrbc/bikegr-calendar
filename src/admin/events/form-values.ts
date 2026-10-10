/**
 * Form values from stored rows, defaults, and the rule input for the live preview. Pure; the client
 * forms use it.
 */
import type { EventRow } from "@/db/schema";
import {
  type CalendarSlug,
  checkTiming,
  dayOfWeek,
  daysBetween,
  type EventRuleInput,
  isLocalDate,
  isLocalDateTime,
  type LocalDate,
  type Timing,
} from "@/engine";
import {
  type EventFormValues,
  exdateFromDate,
  type RuleChoice,
  type SeriesContentValues,
  type SplitFormValues,
} from "./event-input";
import { checkRuleForm, type RuleForm, ruleFormToRrule, rruleToRuleForm, WEEKDAYS } from "./rule-form";

/** The stored columns that the forms need. */
export type FormRow = Pick<
  EventRow,
  | "calendar"
  | "title"
  | "description"
  | "location"
  | "ctaLabel"
  | "ctaUrl"
  | "imageUrl"
  | "allDay"
  | "startLocal"
  | "endLocal"
  | "startDate"
  | "endDate"
  | "rrule"
  | "exdates"
  | "scheduleStatus"
  | "scheduleNote"
>;

export function emptyEventValues(calendar: CalendarSlug, today: LocalDate): EventFormValues {
  return {
    calendar,
    title: "",
    description: "",
    location: "",
    tagIds: [],
    ctaLabel: "",
    ctaUrl: "",
    imageUrl: "",
    allDay: false,
    start: `${today}T18:00`,
    end: `${today}T20:00`,
    rule: { mode: "none" },
    exdates: [],
    scheduleStatus: "scheduled",
    scheduleNote: "",
  };
}

function contentValues(row: FormRow, tagIds: string[]) {
  return {
    calendar: row.calendar,
    title: row.title,
    description: row.description,
    location: row.location ?? "",
    tagIds,
    ctaLabel: row.ctaLabel ?? "",
    ctaUrl: row.ctaUrl ?? "",
    imageUrl: row.imageUrl ?? "",
  };
}

/** The stored rule as a rule choice: the structured form if it fits, else Advanced text. */
export function ruleChoiceFromRrule(rrule: string | null): RuleChoice {
  if (rrule === null) return { mode: "none" };
  const form = rruleToRuleForm(rrule);
  return form ? { mode: "form", form } : { mode: "advanced", text: rrule };
}

export function datesFromExdates(exdates: string[]): LocalDate[] {
  return [...new Set(exdates.map((e) => e.slice(0, 10)))].sort();
}

export function eventValuesFromRow(row: FormRow, tagIds: string[]): EventFormValues {
  return {
    ...contentValues(row, tagIds),
    allDay: row.allDay,
    start: (row.allDay ? row.startDate : row.startLocal) ?? "",
    end: (row.allDay ? row.endDate : row.endLocal) ?? "",
    rule: ruleChoiceFromRrule(row.rrule),
    exdates: datesFromExdates(row.exdates),
    scheduleStatus: row.scheduleStatus,
    scheduleNote: row.scheduleNote ?? "",
  };
}

export function seriesContentValuesFromRow(row: FormRow, tagIds: string[]): SeriesContentValues {
  return { ...contentValues(row, tagIds), exdates: datesFromExdates(row.exdates) };
}

export function splitValuesFromRow(row: FormRow, tagIds: string[], today: LocalDate): SplitFormValues {
  return {
    ...contentValues(row, tagIds),
    splitDate: today,
    mode: "change",
    allDay: row.allDay,
    startTime: row.startLocal?.slice(11) ?? "18:00",
    endTime: row.endLocal?.slice(11) ?? "20:00",
    days: row.allDay && row.startDate && row.endDate ? daysBetween(row.startDate, row.endDate) + 1 : 1,
    rule: { mode: "same" },
  };
}

/** A weekly rule on the weekday of `date`: the default when the Editor picks "Repeats". */
export function defaultRuleForm(date: string): RuleForm {
  const day = date.slice(0, 10);
  const weekday = isLocalDate(day) ? WEEKDAYS[(dayOfWeek(day) + 6) % 7] : "TU";
  return { repeat: "weekly", interval: 1, days: [weekday], months: [], end: { kind: "never" } };
}

/** The timing in the form, or null if it is not complete. */
export function timingFromValues(values: Pick<EventFormValues, "allDay" | "start" | "end">): Timing | null {
  const right = values.allDay ? isLocalDate : isLocalDateTime;
  if (!right(values.start) || !right(values.end)) return null;
  const timing: Timing = values.allDay
    ? { kind: "allDay", startDate: values.start, endDate: values.end }
    : { kind: "timed", start: values.start, end: values.end };
  try {
    checkTiming(timing, "time slot");
    return timing;
  } catch {
    return null;
  }
}

/** The rule text that a rule choice makes, or a message. `same` gives the stored rule. */
export function rruleFromChoice(
  choice: RuleChoice,
  startDate: LocalDate,
  storedRrule: string | null = null,
): { ok: true; rrule: string | null } | { ok: false; message: string } {
  switch (choice.mode) {
    case "none":
      return { ok: true, rrule: null };
    case "same":
      return { ok: true, rrule: storedRrule };
    case "advanced": {
      const text = choice.text.trim().replace(/^RRULE:/i, "");
      return text === "" ? { ok: false, message: "Enter the RRULE text." } : { ok: true, rrule: text };
    }
    case "form": {
      const errors = Object.values(checkRuleForm(choice.form, startDate));
      return errors.length > 0
        ? { ok: false, message: errors[0]! }
        : { ok: true, rrule: ruleFormToRrule(choice.form) };
    }
  }
}

type PreviewValues = Pick<
  EventFormValues,
  "allDay" | "start" | "end" | "rule" | "exdates" | "scheduleStatus" | "scheduleNote"
>;

/** The engine input for the preview of the form, or a message. */
export function previewRuleInput(
  values: PreviewValues,
): { ok: true; rule: EventRuleInput } | { ok: false; message: string } {
  const timing = timingFromValues(values);
  if (!timing) return { ok: false, message: "Enter a start and an end first." };
  const rule = rruleFromChoice(values.rule, values.start.slice(0, 10));
  if (!rule.ok) return rule;
  const repeats = rule.rrule !== null;
  return {
    ok: true,
    rule: {
      eventId: "preview",
      timing,
      rrule: rule.rrule,
      exdates: repeats ? values.exdates.filter(isLocalDate).map((d) => exdateFromDate(timing, d)) : [],
      scheduleStatus: repeats ? "scheduled" : (values.scheduleStatus as EventRuleInput["scheduleStatus"]),
      scheduleNote: repeats ? null : values.scheduleNote || null,
    },
  };
}

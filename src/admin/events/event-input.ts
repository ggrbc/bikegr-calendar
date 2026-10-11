/**
 * Form values (what the admin forms send) and their parsers. Server actions treat every value as
 * untrusted: a parser checks each field and gives a typed draft or field messages. Pure; the forms
 * use the same types.
 */
import {
  type CalendarSlug,
  checkLocalDate,
  checkTiming,
  type EventRuleInput,
  isLocalDate,
  isLocalDateTime,
  type LocalDate,
  type OriginalStart,
  shiftTiming,
  type StoredScheduleStatus,
  type Timing,
  timingStart,
} from "@/engine";
import { isHttpUrl } from "@/agenda/safe-url";
import { firstStartOnOrAfter } from "./preview";
import {
  checkRuleForm,
  MONTH_POSITIONS,
  type MonthPosition,
  type RuleEnd,
  type RuleForm,
  ruleFormToRrule,
  WEEKDAYS,
  type Weekday,
} from "./rule-form";

// ---------------------------------------------------------------------------------------------
// Form values

export type RuleChoice =
  | { mode: "none" }
  /** Split only: keep the Series' rule (with its end adjusted). */
  | { mode: "same" }
  | { mode: "form"; form: RuleForm }
  | { mode: "advanced"; text: string };

export interface ContentValues {
  calendar: string;
  title: string;
  description: string;
  location: string;
  tagIds: string[];
  ctaLabel: string;
  ctaUrl: string;
  imageUrl: string;
}

/** Create, and edit of a one-time Event. `start`/`end`: `YYYY-MM-DDTHH:mm`, or dates if all-day. */
export interface EventFormValues extends ContentValues {
  allDay: boolean;
  start: string;
  end: string;
  rule: RuleChoice;
  /** Skipped dates (`YYYY-MM-DD`). */
  exdates: string[];
  scheduleStatus: string;
  scheduleNote: string;
  occurrenceDetails: string;
}

/** "All dates" edit of a Series. */
export interface SeriesContentValues extends ContentValues {
  exdates: string[];
}

/** "This date and later". */
export interface SplitFormValues extends ContentValues {
  splitDate: string;
  mode: "change" | "stop";
  allDay: boolean;
  /** `HH:mm`. An end time before the start time means the next day. */
  startTime: string;
  endTime: string;
  /** All-day length in days (1 = one day). */
  days: number;
  rule: RuleChoice;
}

/** One Occurrence. `start`/`end` as in {@link EventFormValues}. */
export interface OverrideFormValues {
  originalStart: string;
  start: string;
  end: string;
  title: string;
  location: string;
  scheduleStatus: string;
  scheduleNote: string;
  occurrenceDetails: string;
}

export type FieldErrors = Partial<Record<string, string>>;

export interface ParseContext {
  isAdmin: boolean;
  /** The image URL stored on the Event now (imported images stay valid). */
  storedImageUrl: string | null;
  /** True for an image URL that the upload makes. */
  isImageUrl: (url: string) => boolean;
}

// ---------------------------------------------------------------------------------------------
// Drafts

export interface ContentDraft {
  calendar: CalendarSlug;
  title: string;
  description: string;
  location: string | null;
  tagIds: string[];
  cta: { label: string; url: string } | null;
  imageUrl: string | null;
}

export type RuleDraft = Omit<EventRuleInput, "eventId">;

export interface EventDraft extends ContentDraft {
  rule: RuleDraft;
}

export interface SeriesContentDraft extends ContentDraft {
  exdateDates: LocalDate[];
}

export type SplitTime =
  | { kind: "timed"; startTime: string; endTime: string }
  | { kind: "allDay"; days: number };

export type SplitRule = { kind: "same" } | { kind: "rrule"; rrule: string };

export interface SplitDraft extends ContentDraft {
  splitDate: LocalDate;
  mode: "change" | "stop";
  time: SplitTime;
  rule: SplitRule;
}

export interface OverrideDraft {
  originalStart: OriginalStart;
  timing: Timing;
  title: string;
  location: string | null;
  scheduleStatus: StoredScheduleStatus;
  scheduleNote: string | null;
  occurrenceDetails: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

// ---------------------------------------------------------------------------------------------
// Helpers for untrusted values

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
}

function text(raw: Raw, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value.trim() : "";
}

function strings(raw: Raw, key: string): string[] {
  const value = raw[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
}

const CALENDARS: CalendarSlug[] = ["rides", "advocacy"];
const STATUSES: StoredScheduleStatus[] = ["scheduled", "tentative", "cancelled", "postponed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TITLE_MAX = 200;
export const NOTE_MAX = 300;
export const OCCURRENCE_DETAILS_MAX = 2000;


function isRealDate(value: string): boolean {
  try {
    checkLocalDate(value, "date");
    return true;
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The skipped date as an engine original start, with the Series' time of day. */
export function exdateFromDate(timing: Timing, date: LocalDate): OriginalStart {
  return timing.kind === "timed" ? `${date}${timing.start.slice(10)}` : date;
}

// ---------------------------------------------------------------------------------------------
// Parsers

function parseContent(raw: Raw, ctx: ParseContext, errors: FieldErrors): ContentDraft {
  const calendar = text(raw, "calendar") as CalendarSlug;
  if (!CALENDARS.includes(calendar)) errors.calendar = "Pick a Calendar.";

  const title = text(raw, "title");
  if (title === "") errors.title = "Give the Event a title.";
  else if (title.length > TITLE_MAX) errors.title = `Use ${TITLE_MAX} characters or fewer.`;

  const tagIds = [...new Set(strings(raw, "tagIds"))];
  if (!tagIds.every((id) => UUID.test(id))) errors.tags = "Pick Tags from the list.";

  const ctaLabel = text(raw, "ctaLabel");
  const ctaUrl = text(raw, "ctaUrl");
  let cta: ContentDraft["cta"] = null;
  if (ctaLabel !== "" || ctaUrl !== "") {
    if (ctaLabel === "" || ctaUrl === "") errors.cta = "Give both a button label and a URL, or neither.";
    else if (!isHttpUrl(ctaUrl)) errors.cta = "Use a web address that starts with http:// or https://.";
    else cta = { label: ctaLabel, url: ctaUrl };
  }

  const imageUrl = text(raw, "imageUrl");
  if (imageUrl !== "" && imageUrl !== ctx.storedImageUrl && !ctx.isImageUrl(imageUrl)) {
    errors.imageUrl = "This image URL is not allowed. Upload the image again.";
  }

  const location = text(raw, "location");
  return {
    calendar,
    title,
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    location: location === "" ? null : location,
    tagIds,
    cta,
    imageUrl: imageUrl === "" ? null : imageUrl,
  };
}

function parseDates(raw: Raw, key: string, errors: FieldErrors): LocalDate[] {
  const dates = [...new Set(strings(raw, key))].sort();
  if (!dates.every(isRealDate)) errors.exdates = "Each skipped date must be a real date.";
  return dates;
}

function parseTiming(raw: Raw, allDay: boolean, errors: FieldErrors): Timing | null {
  const start = text(raw, "start");
  const end = text(raw, "end");
  const isRight = allDay ? isLocalDate : isLocalDateTime;
  if (!isRight(start)) errors.start = allDay ? "Give a start date." : "Give a start date and time.";
  if (!isRight(end)) errors.end = allDay ? "Give an end date." : "Give an end date and time.";
  if (errors.start || errors.end) return null;
  const timing: Timing = allDay
    ? { kind: "allDay", startDate: start, endDate: end }
    : { kind: "timed", start, end };
  try {
    checkTiming(timing, "time slot");
  } catch (error) {
    if (end < start) errors.end = allDay ? "The end date is before the start date." : "The end is before the start.";
    else errors.start = errorText(error);
    return null;
  }
  return timing;
}

function parseRuleEnd(value: unknown): RuleEnd | null {
  const raw = asRecord(value);
  if (raw.kind === "never") return { kind: "never" };
  if (raw.kind === "until" && typeof raw.date === "string" && isRealDate(raw.date)) {
    return { kind: "until", date: raw.date };
  }
  if (raw.kind === "count") return { kind: "count", count: numberValue(raw.count) };
  return null;
}

const WEEKDAY_SET = new Set<string>(WEEKDAYS);
const POSITION_SET = new Set<number>(MONTH_POSITIONS);

/** A `RuleForm` from untrusted input, or null if its shape is wrong. */
function parseRuleForm(value: unknown): RuleForm | null {
  const raw = asRecord(value);
  const end = parseRuleEnd(raw.end);
  if (!end) return null;
  const weekday = typeof raw.weekday === "string" && WEEKDAY_SET.has(raw.weekday) ? (raw.weekday as Weekday) : null;
  switch (raw.repeat) {
    case "weekly": {
      const days = Array.isArray(raw.days) ? raw.days : [];
      const months = Array.isArray(raw.months) ? raw.months.map(numberValue) : [];
      if (!days.every((d) => typeof d === "string" && WEEKDAY_SET.has(d))) return null;
      if (!months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)) return null;
      return { repeat: "weekly", interval: numberValue(raw.interval), days: days as Weekday[], months, end };
    }
    case "monthlyWeekday": {
      const positions = Array.isArray(raw.positions) ? raw.positions.map(numberValue) : [];
      if (!weekday || !positions.every((p) => POSITION_SET.has(p))) return null;
      return {
        repeat: "monthlyWeekday",
        positions: positions as MonthPosition[],
        weekday,
        end,
      };
    }
    case "monthlyDay":
      return { repeat: "monthlyDay", day: numberValue(raw.day), end };
    case "yearly":
      return { repeat: "yearly", month: numberValue(raw.month), day: numberValue(raw.day), end };
    default:
      return null;
  }
}

const RULE_ERROR_KEYS: Record<string, string> = { end: "ruleEnd" };

type ParsedRule = { kind: "none" } | { kind: "same" } | { kind: "rrule"; rrule: string };

function parseRuleChoice(
  value: unknown,
  ctx: ParseContext,
  startDate: LocalDate,
  allowSame: boolean,
  errors: FieldErrors,
): ParsedRule | null {
  const raw = asRecord(value);
  if (raw.mode === "none" && !allowSame) return { kind: "none" };
  if (raw.mode === "same" && allowSame) return { kind: "same" };
  if (raw.mode === "advanced") {
    if (!ctx.isAdmin) {
      errors.rule = "Only an Admin can enter RRULE text.";
      return null;
    }
    const rrule = (typeof raw.text === "string" ? raw.text.trim() : "").replace(/^RRULE:/i, "");
    if (rrule === "") {
      errors.rule = "Enter the RRULE text.";
      return null;
    }
    return { kind: "rrule", rrule };
  }
  if (raw.mode === "form") {
    const form = parseRuleForm(raw.form);
    if (!form) {
      errors.rule = "The repeat is not complete.";
      return null;
    }
    const formErrors = checkRuleForm(form, startDate);
    for (const [key, message] of Object.entries(formErrors)) errors[RULE_ERROR_KEYS[key] ?? key] = message;
    if (Object.keys(formErrors).length > 0) return null;
    return { kind: "rrule", rrule: ruleFormToRrule(form) };
  }
  errors.rule = "Pick how the Event repeats.";
  return null;
}

function parseSchedule(raw: Raw, errors: FieldErrors): { status: StoredScheduleStatus; note: string | null } {
  const status = text(raw, "scheduleStatus") as StoredScheduleStatus;
  if (!STATUSES.includes(status)) errors.scheduleStatus = "Pick a Schedule status.";
  const note = text(raw, "scheduleNote");
  if (note.length > NOTE_MAX) errors.scheduleNote = `Use ${NOTE_MAX} characters or fewer.`;
  return { status, note: note === "" ? null : note };
}

/** Occurrence details: plain text, line ends as `\n`, 2,000 characters at most. Empty is none. */
function parseOccurrenceDetails(raw: Raw, errors: FieldErrors): string | null {
  const value = raw.occurrenceDetails;
  const details = (typeof value === "string" ? value : "").replace(/\r\n?/g, "\n").trim();
  if ([...details].length > OCCURRENCE_DETAILS_MAX) {
    errors.occurrenceDetails = "Use 2,000 characters or fewer.";
  }
  return details === "" ? null : details;
}

function result<T>(value: T, errors: FieldErrors): Parsed<T> {
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/**
 * Create, or edit of a one-time Event. A Series' stored start is its first Occurrence on or after
 * the start the Editor entered.
 */
export function parseEventInput(input: unknown, ctx: ParseContext): Parsed<EventDraft> {
  const raw = asRecord(input);
  const errors: FieldErrors = {};
  const content = parseContent(raw, ctx, errors);
  const allDay = raw.allDay === true;
  let timing = parseTiming(raw, allDay, errors);
  const exdateDates = parseDates(raw, "exdates", errors);
  const schedule = parseSchedule(raw, errors);
  const details = parseOccurrenceDetails(raw, errors);
  const startDate = timing ? timingStart(timing).slice(0, 10) : "0000-01-01";
  const rule = parseRuleChoice(raw.rule, ctx, startDate, false, errors);

  let rrule: string | null = null;
  if (timing && rule?.kind === "rrule") {
    try {
      const first = firstStartOnOrAfter(timing, rule.rrule, timingStart(timing));
      if (first === null) errors.rule = "This repeat has no dates.";
      else timing = shiftTiming(timing, first);
      rrule = rule.rrule;
    } catch (error) {
      errors.rule = errorText(error);
    }
  }
  if (!timing) return { ok: false, errors };
  const repeats = rrule !== null;
  return result(
    {
      ...content,
      rule: {
        timing,
        rrule,
        exdates: repeats ? exdateDates.map((d) => exdateFromDate(timing, d)) : [],
        // A Series uses Overrides for one date; its own Schedule status stays `scheduled`.
        scheduleStatus: repeats ? "scheduled" : schedule.status,
        scheduleNote: repeats ? null : schedule.note,
        ...(!repeats && details ? { occurrenceDetails: details } : {}),
      },
    },
    errors,
  );
}

/** "All dates" edit of a Series: content and skipped dates only. */
export function parseSeriesContentInput(input: unknown, ctx: ParseContext): Parsed<SeriesContentDraft> {
  const raw = asRecord(input);
  const errors: FieldErrors = {};
  const content = parseContent(raw, ctx, errors);
  const exdateDates = parseDates(raw, "exdates", errors);
  return result({ ...content, exdateDates }, errors);
}

/** "This date and later". The rule is checked against the Series in `planSplit`. */
export function parseSplitInput(input: unknown, ctx: ParseContext): Parsed<SplitDraft> {
  const raw = asRecord(input);
  const errors: FieldErrors = {};
  const content = parseContent(raw, ctx, errors);
  const splitDate = text(raw, "splitDate");
  if (!isRealDate(splitDate)) errors.splitDate = "Pick a date.";
  const mode = raw.mode === "stop" ? "stop" : "change";

  let time: SplitTime = { kind: "allDay", days: 1 };
  let rule: SplitRule = { kind: "same" };
  if (mode === "change") {
    if (raw.allDay === true) {
      const days = numberValue(raw.days);
      if (!Number.isInteger(days) || days < 1 || days > 31) errors.days = "Give 1 to 31 days.";
      time = { kind: "allDay", days };
    } else {
      const startTime = text(raw, "startTime");
      const endTime = text(raw, "endTime");
      if (!TIME.test(startTime)) errors.startTime = "Give a start time.";
      if (!TIME.test(endTime)) errors.endTime = "Give an end time.";
      time = { kind: "timed", startTime, endTime };
    }
    const parsed = parseRuleChoice(raw.rule, ctx, isRealDate(splitDate) ? splitDate : "0000-01-01", true, errors);
    if (parsed?.kind === "rrule") rule = parsed;
  }
  return result({ ...content, splitDate, mode, time, rule }, errors);
}

/** One Occurrence. `allDay` is the Event's timing kind. */
export function parseOverrideInput(input: unknown, allDay: boolean): Parsed<OverrideDraft> {
  const raw = asRecord(input);
  const errors: FieldErrors = {};
  const originalStart = text(raw, "originalStart");
  const rightKind = allDay ? isLocalDate(originalStart) : isLocalDateTime(originalStart);
  if (!rightKind) errors.originalStart = "This is not a date of the Series.";
  const timing = parseTiming(raw, allDay, errors);
  const title = text(raw, "title");
  if (title === "") errors.title = "Give a title.";
  else if (title.length > TITLE_MAX) errors.title = `Use ${TITLE_MAX} characters or fewer.`;
  const location = text(raw, "location");
  const schedule = parseSchedule(raw, errors);
  const details = parseOccurrenceDetails(raw, errors);
  if (!timing) return { ok: false, errors };
  return result(
    {
      originalStart,
      timing,
      title,
      location: location === "" ? null : location,
      scheduleStatus: schedule.status,
      scheduleNote: schedule.note,
      occurrenceDetails: details,
    },
    errors,
  );
}

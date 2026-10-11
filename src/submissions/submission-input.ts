/**
 * The public Submission form: its values and their parser. The admin parser (`parseEventInput`)
 * checks the Event fields, so a Submission follows the same rules as an Editor's Event. This
 * wrapper adds the Submitter fields, the public length limits, the date limits, and the simple
 * repeat ("Repeats weekly on [days] until [date]"). The Submitter cannot send any other rule. Pure.
 */
import { type EventDraft, type FieldErrors, type Parsed, parseEventInput } from "@/admin/events/event-input";
import { WEEKDAYS } from "@/admin/events/rule-form";
import { isValidEmail, normalizeEmail } from "@/auth/rules";
import { type CalendarSlug, dayOfWeek, isLocalDate, type LocalDate } from "@/engine";

export interface SubmissionValues {
  calendar: string;
  title: string;
  description: string;
  preview: string;
  location: string;
  tagIds: string[];
  ctaLabel: string;
  ctaUrl: string;
  allDay: boolean;
  /** `YYYY-MM-DDTHH:mm`, or `YYYY-MM-DD` if all day. */
  start: string;
  end: string;
  repeats: boolean;
  /** `MO` … `SU`. */
  repeatDays: string[];
  /** `YYYY-MM-DD`. */
  repeatUntil: string;
  submitterName: string;
  submitterEmail: string;
}

export interface Submitter {
  name: string;
  email: string;
}

export interface SubmissionDraft {
  event: EventDraft;
  submitter: Submitter;
}

export const LIMITS = {
  description: 5000,
  location: 200,
  ctaLabel: 40,
  ctaUrl: 2000,
  submitterName: 100,
  submitterEmail: 254,
  /** The start is at most this many months after today. */
  startMonths: 18,
  /** The repeat ends at most this many months after the start. */
  repeatMonths: 12,
} as const;

/** The Calendar from the `?calendar=` link: `rides` or `advocacy`; anything else gives `rides`. */
export function submissionCalendar(value: string | string[] | undefined): CalendarSlug {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "advocacy" ? "advocacy" : "rides";
}

/** The same day `months` later, or the last day of that month if it is shorter. */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + months;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(Number(date.slice(8, 10)), lastDay);
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

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

const WEEKDAY_SET = new Set<string>(WEEKDAYS);

/** Rule error keys of the admin parser, as the fields of the public form. */
const RULE_KEYS: Record<string, string> = { days: "repeatDays", ruleEnd: "repeatUntil", rule: "repeatUntil" };

function tooLong(max: number): string {
  return `Use ${max} characters or fewer.`;
}

export function parseSubmissionInput(input: unknown, { today }: { today: LocalDate }): Parsed<SubmissionDraft> {
  const raw = asRecord(input);
  const errors: FieldErrors = {};
  const repeats = raw.repeats === true;
  const start = text(raw, "start");
  const startDate = start.slice(0, 10);

  const repeatDays = [...new Set(strings(raw, "repeatDays"))];
  const repeatUntil = text(raw, "repeatUntil");
  let rule: unknown = { mode: "none" };
  if (repeats) {
    if (!repeatDays.every((d) => WEEKDAY_SET.has(d))) errors.repeatDays = "Pick days from the list.";
    // The typed first date must be a date of the Event: a Tuesday start with only Monday picked
    // would quietly move the Event to the next Monday.
    else if (repeatDays.length > 0 && isLocalDate(startDate)) {
      const startDay = WEEKDAYS[(dayOfWeek(startDate) + 6) % 7];
      if (!repeatDays.includes(startDay)) errors.repeatDays = "The first date must be on one of the days you picked.";
    }
    if (!isLocalDate(repeatUntil)) errors.repeatUntil = "Give the date of the last ride or meeting.";
    else if (isLocalDate(startDate) && repeatUntil > addMonths(startDate, LIMITS.repeatMonths)) {
      errors.repeatUntil = `The repeat can end at most ${LIMITS.repeatMonths} months after the start.`;
    }
    rule = {
      mode: "form",
      form: { repeat: "weekly", interval: 1, days: repeatDays, months: [], end: { kind: "until", date: repeatUntil } },
    };
  }

  // Only the fields of the public form go to the admin parser: never a rule, an image URL, or a
  // Schedule status from the input.
  const parsed = parseEventInput(
    {
      calendar: text(raw, "calendar"),
      title: text(raw, "title"),
      description: typeof raw.description === "string" ? raw.description : "",
      preview: text(raw, "preview"),
      location: text(raw, "location"),
      tagIds: strings(raw, "tagIds"),
      ctaLabel: text(raw, "ctaLabel"),
      ctaUrl: text(raw, "ctaUrl"),
      imageUrl: "",
      allDay: raw.allDay === true,
      start,
      end: text(raw, "end"),
      rule: errors.repeatDays || errors.repeatUntil ? { mode: "none" } : rule,
      exdates: [],
      scheduleStatus: "scheduled",
      scheduleNote: "",
    },
    { isAdmin: false, storedImageUrl: null, isImageUrl: () => false },
  );
  if (!parsed.ok) {
    for (const [key, message] of Object.entries(parsed.errors)) {
      const field = RULE_KEYS[key] ?? key;
      errors[field] ??= message;
    }
  }

  if (isLocalDate(startDate) && !errors.start) {
    if (startDate < today) errors.start = "The event must start today or later.";
    else if (startDate > addMonths(today, LIMITS.startMonths)) {
      errors.start = `The event must start within ${LIMITS.startMonths} months.`;
    }
  }

  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (description.length > LIMITS.description) errors.description = tooLong(LIMITS.description);
  if (text(raw, "location").length > LIMITS.location) errors.location = tooLong(LIMITS.location);
  if (text(raw, "ctaLabel").length > LIMITS.ctaLabel) errors.cta = `Use ${LIMITS.ctaLabel} characters or fewer for the button label.`;
  if (text(raw, "ctaUrl").length > LIMITS.ctaUrl) errors.cta = "This web address is too long.";

  const name = text(raw, "submitterName");
  if (name === "") errors.submitterName = "Give your name.";
  else if (name.length > LIMITS.submitterName) errors.submitterName = tooLong(LIMITS.submitterName);

  const email = normalizeEmail(text(raw, "submitterEmail"));
  if (!isValidEmail(email) || email.length > LIMITS.submitterEmail) {
    errors.submitterEmail = "Give a valid email address.";
  }

  if (!parsed.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { event: parsed.value, submitter: { name, email } } };
}

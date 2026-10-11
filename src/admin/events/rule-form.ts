/**
 * The rule editor's form model and its mapping to and from an RFC 5545 `RRULE` value. Pure; runs in
 * the browser too. Plan: docs/plans/admin-event-editing.md ("Rule editor").
 *
 * A stored rule "fits" the form only if the form writes back the same parts and values (the order
 * of the items in `BYDAY` and `BYMONTH` may change). Other rules are Advanced (Admins only).
 */
import { FULL_MOON_FREQ, type LocalDate } from "@/engine";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Week of the month: 1st to 4th, or -1 for the last. */
export const MONTH_POSITIONS = [1, 2, 3, 4, -1] as const;
export type MonthPosition = (typeof MONTH_POSITIONS)[number];

export type RuleEnd =
  | { kind: "never" }
  | { kind: "until"; date: LocalDate }
  | { kind: "count"; count: number };

export type RuleForm =
  | { repeat: "weekly"; interval: number; days: Weekday[]; months: number[]; end: RuleEnd }
  | { repeat: "monthlyWeekday"; positions: MonthPosition[]; weekday: Weekday; end: RuleEnd }
  | { repeat: "monthlyDay"; day: number; end: RuleEnd }
  | { repeat: "yearly"; month: number; day: number; end: RuleEnd }
  | { repeat: "fullMoon"; end: RuleEnd };

export type RuleFormErrors = Partial<Record<"days" | "interval" | "positions" | "day" | "end", string>>;

const byWeekday = (a: Weekday, b: Weekday) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b);
/** 1, 2, 3, 4, then -1 (last). */
const byPosition = (a: number, b: number) => (a === -1 ? 5 : a) - (b === -1 ? 5 : b);
const unique = <T>(items: T[]) => [...new Set(items)];

export function ruleFormToRrule(form: RuleForm): string {
  const parts: string[] = [];
  switch (form.repeat) {
    case "weekly": {
      parts.push("FREQ=WEEKLY");
      if (form.interval > 1) parts.push(`INTERVAL=${form.interval}`);
      parts.push(`BYDAY=${unique(form.days).sort(byWeekday).join(",")}`);
      const months = unique(form.months).sort((a, b) => a - b);
      if (months.length > 0 && months.length < 12) parts.push(`BYMONTH=${months.join(",")}`);
      break;
    }
    case "monthlyWeekday":
      parts.push("FREQ=MONTHLY");
      parts.push(
        `BYDAY=${unique(form.positions)
          .sort(byPosition)
          .map((n) => `${n}${form.weekday}`)
          .join(",")}`,
      );
      break;
    case "monthlyDay":
      parts.push("FREQ=MONTHLY", `BYMONTHDAY=${form.day}`);
      break;
    case "yearly":
      parts.push("FREQ=YEARLY", `BYMONTH=${form.month}`, `BYMONTHDAY=${form.day}`);
      break;
    case "fullMoon":
      parts.push(`FREQ=${FULL_MOON_FREQ}`);
      break;
  }
  if (form.end.kind === "until") parts.push(`UNTIL=${form.end.date.replace(/-/g, "")}T235959`);
  if (form.end.kind === "count") parts.push(`COUNT=${form.end.count}`);
  return parts.join(";");
}

/** The parts of a rule by name, or null if it is not `NAME=value;…` with each name once. */
function ruleParts(rrule: string): Map<string, string> | null {
  const body = rrule.endsWith(";") ? rrule.slice(0, -1) : rrule;
  const parts = new Map<string, string>();
  for (const part of body.split(";")) {
    const match = /^([A-Z]+)=([^=;]+)$/.exec(part);
    if (!match || parts.has(match[1])) return null;
    parts.set(match[1], match[2]);
  }
  return parts;
}

const LIST_PARTS = new Set(["BYDAY", "BYMONTH", "BYMONTHDAY"]);

/** True if two rules have the same parts and values. List order and `INTERVAL=1` do not count. */
export function sameRuleParts(a: string, b: string): boolean {
  const pa = ruleParts(a);
  const pb = ruleParts(b);
  if (!pa || !pb) return false;
  for (const parts of [pa, pb]) if (parts.get("INTERVAL") === "1") parts.delete("INTERVAL");
  if (pa.size !== pb.size) return false;
  for (const [name, value] of pa) {
    const other = pb.get(name);
    if (other === undefined) return false;
    const same = LIST_PARTS.has(name)
      ? value.split(",").sort().join(",") === other.split(",").sort().join(",")
      : value === other;
    if (!same) return false;
  }
  return true;
}

const WEEKDAY_SET = new Set<string>(WEEKDAYS);
const POSITIVE = /^[1-9]\d*$/;

function parseEnd(parts: Map<string, string>): RuleEnd | null {
  const until = parts.get("UNTIL");
  const count = parts.get("COUNT");
  if (until !== undefined && count !== undefined) return null;
  if (until !== undefined) {
    const match = /^(\d{4})(\d{2})(\d{2})T235959$/.exec(until);
    return match ? { kind: "until", date: `${match[1]}-${match[2]}-${match[3]}` } : null;
  }
  if (count !== undefined) return POSITIVE.test(count) ? { kind: "count", count: Number(count) } : null;
  return { kind: "never" };
}

function intList(value: string | undefined, min: number, max: number): number[] | null {
  if (value === undefined) return [];
  const items = value.split(",");
  if (!items.every((item) => POSITIVE.test(item))) return null;
  const numbers = items.map(Number);
  return numbers.every((n) => n >= min && n <= max) ? numbers : null;
}

function only(parts: Map<string, string>, allowed: string[]): boolean {
  return [...parts.keys()].every((name) => allowed.includes(name));
}

const END_PARTS = ["UNTIL", "COUNT"];

function parseForm(parts: Map<string, string>): RuleForm | null {
  const end = parseEnd(parts);
  if (!end) return null;
  const freq = parts.get("FREQ");

  if (freq === "WEEKLY") {
    if (!only(parts, ["FREQ", "INTERVAL", "BYDAY", "BYMONTH", ...END_PARTS])) return null;
    const days = parts.get("BYDAY")?.split(",");
    if (!days || !days.every((d) => WEEKDAY_SET.has(d))) return null;
    const interval = parts.get("INTERVAL") ?? "1";
    if (!POSITIVE.test(interval)) return null;
    const months = intList(parts.get("BYMONTH"), 1, 12);
    if (!months) return null;
    return {
      repeat: "weekly",
      interval: Number(interval),
      days: unique(days as Weekday[]).sort(byWeekday),
      months: unique(months).sort((a, b) => a - b),
      end,
    };
  }

  if (freq === "MONTHLY") {
    if (parts.has("BYDAY")) {
      if (!only(parts, ["FREQ", "BYDAY", ...END_PARTS])) return null;
      const items = parts.get("BYDAY")!.split(",").map((item) => /^(-1|[1-4])([A-Z]{2})$/.exec(item));
      if (!items.every((m) => m && WEEKDAY_SET.has(m[2]))) return null;
      const weekdays = unique(items.map((m) => m![2]));
      if (weekdays.length !== 1) return null;
      return {
        repeat: "monthlyWeekday",
        positions: unique(items.map((m) => Number(m![1]) as MonthPosition)).sort(byPosition),
        weekday: weekdays[0] as Weekday,
        end,
      };
    }
    if (!only(parts, ["FREQ", "BYMONTHDAY", ...END_PARTS])) return null;
    const days = intList(parts.get("BYMONTHDAY"), 1, 31);
    if (!days || days.length !== 1) return null;
    return { repeat: "monthlyDay", day: days[0], end };
  }

  if (freq === "YEARLY") {
    if (!only(parts, ["FREQ", "BYMONTH", "BYMONTHDAY", ...END_PARTS])) return null;
    const months = intList(parts.get("BYMONTH"), 1, 12);
    const days = intList(parts.get("BYMONTHDAY"), 1, 31);
    if (!months || !days || months.length !== 1 || days.length !== 1) return null;
    return { repeat: "yearly", month: months[0], day: days[0], end };
  }

  if (freq === FULL_MOON_FREQ) {
    if (!only(parts, ["FREQ", ...END_PARTS])) return null;
    return { repeat: "fullMoon", end };
  }
  return null;
}

/** The form for a stored rule, or null if the rule does not fit the form. */
export function rruleToRuleForm(rrule: string): RuleForm | null {
  const parts = ruleParts(rrule);
  if (!parts) return null;
  const form = parseForm(parts);
  if (!form) return null;
  return sameRuleParts(ruleFormToRrule(form), rrule) ? form : null;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Field messages for a form. Empty when the form is good. */
export function checkRuleForm(form: RuleForm, startDate: LocalDate): RuleFormErrors {
  const errors: RuleFormErrors = {};
  if (form.repeat === "weekly") {
    if (form.days.length === 0) errors.days = "Pick one or more days.";
    if (!Number.isInteger(form.interval) || form.interval < 1 || form.interval > 52) {
      errors.interval = "Every 1 to 52 weeks.";
    }
  }
  if (form.repeat === "monthlyWeekday" && form.positions.length === 0) {
    errors.positions = "Pick one or more weeks of the month.";
  }
  if (form.repeat === "monthlyDay" && !(Number.isInteger(form.day) && form.day >= 1 && form.day <= 31)) {
    errors.day = "Pick a day from 1 to 31.";
  }
  if (form.repeat === "yearly") {
    const max = DAYS_IN_MONTH[form.month - 1];
    if (max === undefined || !Number.isInteger(form.day) || form.day < 1 || form.day > max) {
      errors.day = "This date does not exist.";
    }
  }
  if (form.end.kind === "count" && !(Number.isInteger(form.end.count) && form.end.count >= 1)) {
    errors.end = "The number of dates must be 1 or more.";
  }
  if (form.end.kind === "until" && !(form.end.date >= startDate)) {
    errors.end = "The end date must be on or after the start date.";
  }
  return errors;
}

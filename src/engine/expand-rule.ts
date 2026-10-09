/**
 * Expands an RFC 5545 `RRULE` in wall-clock time, with the `rrule` library in "floating" mode.
 *
 * Floating mode: `DTSTART` and every result are floating `Date`s (see `wall-clock.ts`), and no
 * `tzid` is given to `rrule`. So the library only counts days and weeks on the wall clock, and DST
 * cannot move a time. This also avoids the DST bugs of `rrule`'s own `tzid` support.
 *
 * `UNTIL` is wall-clock time in America/Detroit. Accepted forms:
 * - `YYYYMMDD` — the whole day is included;
 * - `YYYYMMDDTHHMMSS` — floating wall-clock (the import and the Series split write
 *   `<last date>T235959`);
 * - `YYYYMMDDTHHMMSSZ` — UTC; converted to Detroit wall-clock first.
 *
 * A `DTSTART` that does not match the rule is not an Occurrence (`rrule` and Google Calendar
 * behavior).
 *
 * `EXDATE`s are not applied here; `expand-occurrences.ts` applies them.
 */
import { RRule, type Options } from "rrule";
import type { OriginalStart, Timing } from "./types";
import { timingStart } from "./timing";
import { fromFloating, fromFloatingDate, toFloating, utcToWallClock } from "./wall-clock";

export class InvalidRuleError extends Error {
  constructor(rrule: string, reason: string) {
    super(`Invalid RRULE "${rrule}": ${reason}`);
    this.name = "InvalidRuleError";
  }
}

const FREQUENCIES = new Set(["YEARLY", "MONTHLY", "WEEKLY", "DAILY"]);
const WEEKDAY = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;
const NUMBER_LIST = /^[+-]?\d{1,3}(,[+-]?\d{1,3})*$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const UNTIL_VALUE = /^(\d{8})(T(\d{6})(Z)?)?$/;

/** Parts that may appear in a rule, with a check for each value. */
const PART_CHECKS: Record<string, (value: string) => boolean> = {
  FREQ: (value) => FREQUENCIES.has(value),
  INTERVAL: (value) => POSITIVE_INTEGER.test(value),
  COUNT: (value) => POSITIVE_INTEGER.test(value),
  UNTIL: (value) => UNTIL_VALUE.test(value),
  WKST: (value) => /^(MO|TU|WE|TH|FR|SA|SU)$/.test(value),
  BYDAY: (value) => value.split(",").every((day) => WEEKDAY.test(day)),
  BYMONTH: (value) => NUMBER_LIST.test(value),
  BYMONTHDAY: (value) => NUMBER_LIST.test(value),
  BYYEARDAY: (value) => NUMBER_LIST.test(value),
  BYWEEKNO: (value) => NUMBER_LIST.test(value),
  BYSETPOS: (value) => NUMBER_LIST.test(value),
};

/** Checks the rule and rewrites `UNTIL` as floating wall-clock time. */
function normalizeRule(rrule: string): string {
  if (rrule.trim() === "") throw new InvalidRuleError(rrule, "the rule is empty");
  const seen = new Set<string>();
  const parts = rrule.split(";").map((part) => {
    const [name, value, ...rest] = part.split("=");
    const check = PART_CHECKS[name];
    if (!check) throw new InvalidRuleError(rrule, `unknown part "${name}"`);
    if (value === undefined || rest.length > 0 || !check(value)) {
      throw new InvalidRuleError(rrule, `bad value for ${name}`);
    }
    if (seen.has(name)) throw new InvalidRuleError(rrule, `${name} is given twice`);
    seen.add(name);
    return name === "UNTIL" ? `UNTIL=${floatingUntil(value)}` : part;
  });
  if (!seen.has("FREQ")) throw new InvalidRuleError(rrule, "FREQ is missing");
  if (seen.has("UNTIL") && seen.has("COUNT")) {
    throw new InvalidRuleError(rrule, "UNTIL and COUNT cannot both be given");
  }
  return parts.join(";");
}

function floatingUntil(value: string): string {
  const [, date, , time, utc] = UNTIL_VALUE.exec(value)!;
  if (!time) return `${date}T235959`;
  if (!utc) return value;
  const instant = new Date(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T` +
      `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`,
  );
  // Seconds are dropped: wall-clock values in the app have minute precision.
  return `${utcToWallClock(instant).replace(/[-:]/g, "")}00`;
}

/** Parsed rule options by rule text. Only the parse step is cached; it holds no results. */
const parsedRules = new Map<string, Partial<Options>>();
const MAX_PARSED_RULES = 500;

function parseRule(rrule: string): Partial<Options> {
  let options = parsedRules.get(rrule);
  if (!options) {
    options = RRule.parseString(normalizeRule(rrule));
    if (parsedRules.size >= MAX_PARSED_RULES) parsedRules.clear();
    parsedRules.set(rrule, options);
  }
  return options;
}

/** A new `RRule` for the Event's first time slot. Exported for tests. */
export function buildRule(timing: Timing, rrule: string): RRule {
  const dtstart = toFloating(timingStart(timing));
  // noCache = true: rrule's own result cache keeps every window ever asked, with no limit.
  return new RRule({ ...parseRule(rrule), dtstart }, true);
}

function format(timing: Timing, date: Date): OriginalStart {
  return timing.kind === "timed" ? fromFloating(date) : fromFloatingDate(date);
}

/** Original starts that the rule makes from `from` to `to`, both included. */
export function ruleStartsBetween(
  timing: Timing,
  rrule: string,
  from: OriginalStart,
  to: OriginalStart,
): OriginalStart[] {
  return buildRule(timing, rrule)
    .between(toFloating(from), toFloating(to), true)
    .map((date) => format(timing, date));
}

/** The first original start that the rule makes after `after`, or `null` if the rule ends. */
export function nextRuleStart(
  timing: Timing,
  rrule: string,
  after: OriginalStart,
): OriginalStart | null {
  const next = buildRule(timing, rrule).after(toFloating(after), false);
  return next ? format(timing, next) : null;
}

/** True if the rule makes exactly this original start. */
export function isRuleStart(timing: Timing, rrule: string, start: OriginalStart): boolean {
  return ruleStartsBetween(timing, rrule, start, start).includes(start);
}

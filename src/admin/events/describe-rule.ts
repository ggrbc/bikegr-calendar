/** A rule in plain words, for the admin: "Every week on Tuesday, April to October, until …". */
import { longDate } from "./format";
import { type RuleEnd, type RuleForm, rruleToRuleForm, WEEKDAYS, type Weekday } from "./rule-form";

const DAY_NAMES: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function weekdayName(day: Weekday): string {
  return DAY_NAMES[day];
}

/** "a", "a and b", "a, b, and c". */
export function listText(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function ordinal(n: number): string {
  if (n === -1) return "last";
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}

function monthsText(months: number[]): string {
  const sorted = [...months].sort((a, b) => a - b);
  const contiguous = sorted.every((m, i) => i === 0 || m === sorted[i - 1] + 1);
  if (sorted.length >= 3 && contiguous) {
    return `${MONTH_NAMES[sorted[0] - 1]} to ${MONTH_NAMES[sorted[sorted.length - 1] - 1]}`;
  }
  return `in ${listText(sorted.map((m) => MONTH_NAMES[m - 1]))}`;
}

function endText(end: RuleEnd): string {
  if (end.kind === "until") return `, until ${longDate(end.date)}`;
  if (end.kind === "count") return `, ${end.count} time${end.count === 1 ? "" : "s"}`;
  return "";
}

export function describeRule(form: RuleForm): string {
  let text: string;
  switch (form.repeat) {
    case "weekly": {
      const days = [...form.days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
      const every = form.interval > 1 ? `Every ${form.interval} weeks` : "Every week";
      text = `${every} on ${listText(days.map(weekdayName))}`;
      if (form.months.length > 0 && form.months.length < 12) text += `, ${monthsText(form.months)}`;
      break;
    }
    case "monthlyWeekday":
      text = `Every month on the ${listText(form.positions.map(ordinal))} ${weekdayName(form.weekday)}`;
      break;
    case "monthlyDay":
      text = `Every month on day ${form.day}`;
      break;
    case "yearly":
      text = `Every year on ${MONTH_NAMES[form.month - 1]} ${form.day}`;
      break;
    case "fullMoon":
      text = "Every full moon";
      break;
  }
  return text + endText(form.end);
}

/** A stored rule in words; a rule that does not fit the form shows its text. */
export function describeRrule(rrule: string): string {
  const form = rruleToRuleForm(rrule);
  return form ? describeRule(form) : `Custom rule: ${rrule}`;
}

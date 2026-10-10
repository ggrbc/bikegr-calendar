import { describe, expect, it } from "vitest";
import { addMonths, parseSubmissionInput, type SubmissionValues, submissionCalendar } from "./submission-input";

const TODAY = "2026-10-10"; // a Saturday
const TAG = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function values(patch: Partial<SubmissionValues> = {}): SubmissionValues {
  return {
    calendar: "rides",
    title: "Tuesday Social Ride",
    description: "Meet at the shop.",
    location: "Riverside Park",
    tagIds: [TAG],
    ctaLabel: "",
    ctaUrl: "",
    allDay: false,
    start: "2026-10-13T18:00",
    end: "2026-10-13T20:00",
    repeats: false,
    repeatDays: [],
    repeatUntil: "",
    submitterName: "Sam Rider",
    submitterEmail: " Sam@Example.org ",
    ...patch,
  };
}

const parse = (patch: Partial<SubmissionValues> = {}) => parseSubmissionInput(values(patch), { today: TODAY });

function errorsOf(patch: Partial<SubmissionValues>) {
  const result = parse(patch);
  expect(result.ok).toBe(false);
  return result.ok ? {} : result.errors;
}

describe("submissionCalendar", () => {
  it("takes rides or advocacy from the link and gives rides for anything else", () => {
    expect(submissionCalendar("advocacy")).toBe("advocacy");
    expect(submissionCalendar("rides")).toBe("rides");
    expect(submissionCalendar("tenant")).toBe("rides");
    expect(submissionCalendar(undefined)).toBe("rides");
    expect(submissionCalendar(["advocacy", "rides"])).toBe("advocacy");
  });
});

describe("addMonths", () => {
  it("keeps the day, or the last day of a shorter month", () => {
    expect(addMonths("2026-10-10", 12)).toBe("2027-10-10");
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2026-10-10", 18)).toBe("2028-04-10");
  });
});

describe("parseSubmissionInput", () => {
  it("a one-time Submission gives the admin draft and the Submitter, email normalized", () => {
    const result = parse();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.submitter).toEqual({ name: "Sam Rider", email: "sam@example.org" });
    expect(result.value.event).toMatchObject({
      calendar: "rides",
      title: "Tuesday Social Ride",
      tagIds: [TAG],
      imageUrl: null,
      cta: null,
      rule: {
        timing: { kind: "timed", start: "2026-10-13T18:00", end: "2026-10-13T20:00" },
        rrule: null,
        exdates: [],
        scheduleStatus: "scheduled",
        scheduleNote: null,
      },
    });
  });

  it("weekly on Tue and Thu until a date stores FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=<date>T235959", () => {
    const result = parse({ repeats: true, repeatDays: ["TH", "TU"], repeatUntil: "2027-04-30" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.event.rule.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270430T235959");
  });

  it("a start that is not on one of the picked days is refused on the days field", () => {
    // 2026-10-13 is a Tuesday: only Monday picked would store BYDAY=MO, and the typed date would
    // not be a date of the Event.
    expect(errorsOf({ repeats: true, repeatDays: ["MO"], repeatUntil: "2026-12-31" }).repeatDays).toBe(
      "The first date must be on one of the days you picked.",
    );
    expect(errorsOf({ repeats: true, repeatDays: ["TH"], repeatUntil: "2026-12-31" }).repeatDays).toBeDefined();
    const allDay = { allDay: true, start: "2026-10-13", end: "2026-10-13" };
    expect(errorsOf({ ...allDay, repeats: true, repeatDays: ["SA"], repeatUntil: "2026-12-31" }).repeatDays).toBeDefined();
  });

  it("a start on one of several picked days keeps the typed date", () => {
    const result = parse({ repeats: true, repeatDays: ["MO", "TU"], repeatUntil: "2026-12-31" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.event.rule.timing).toEqual({ kind: "timed", start: "2026-10-13T18:00", end: "2026-10-13T20:00" });
  });

  it("an all-day Submission is accepted", () => {
    const result = parse({ allDay: true, start: "2026-10-17", end: "2026-10-18" });
    expect(result.ok).toBe(true);
  });

  it("a repeat with no days, with no end date, or with an end before the start is refused", () => {
    expect(errorsOf({ repeats: true, repeatDays: [], repeatUntil: "2026-12-31" }).repeatDays).toBeDefined();
    expect(errorsOf({ repeats: true, repeatDays: ["TU"], repeatUntil: "" }).repeatUntil).toBeDefined();
    expect(errorsOf({ repeats: true, repeatDays: ["TU"], repeatUntil: "2026-10-01" }).repeatUntil).toBeDefined();
  });

  it("a repeat end more than 12 months after the start is refused", () => {
    expect(errorsOf({ repeats: true, repeatDays: ["TU"], repeatUntil: "2027-10-14" }).repeatUntil).toMatch(/12 months/);
    expect(parse({ repeats: true, repeatDays: ["TU"], repeatUntil: "2027-10-13" }).ok).toBe(true);
  });

  it("an unknown weekday is refused", () => {
    expect(errorsOf({ repeats: true, repeatDays: ["XX"], repeatUntil: "2026-12-31" }).repeatDays).toBeDefined();
  });

  it("a start in the past or more than 18 months ahead is refused", () => {
    expect(errorsOf({ start: "2026-10-09T18:00", end: "2026-10-09T20:00" }).start).toMatch(/today or later/);
    expect(errorsOf({ start: "2028-04-11T18:00", end: "2028-04-11T20:00" }).start).toMatch(/18 months/);
    expect(parse({ start: "2026-10-10T07:00", end: "2026-10-10T08:00" }).ok).toBe(true);
  });

  it("keeps the admin rules: title, timing, Calendar, Tags, CTA http or https only", () => {
    expect(errorsOf({ title: " " }).title).toBeDefined();
    expect(errorsOf({ end: "2026-10-13T17:00" }).end).toBeDefined();
    expect(errorsOf({ calendar: "tenant" }).calendar).toBeDefined();
    expect(errorsOf({ tagIds: ["not-a-uuid"] }).tags).toBeDefined();
    expect(errorsOf({ ctaLabel: "Register", ctaUrl: "javascript:alert(1)" }).cta).toBeDefined();
    expect(errorsOf({ ctaLabel: "Register", ctaUrl: "" }).cta).toBeDefined();
    const ok = parse({ ctaLabel: "Register", ctaUrl: "https://example.org/register" });
    expect(ok.ok && ok.value.event.cta).toEqual({ label: "Register", url: "https://example.org/register" });
  });

  it("refuses Advanced rule text and any rule other than the simple repeat", () => {
    const raw = { ...values(), rule: { mode: "advanced", text: "FREQ=DAILY" } };
    const result = parseSubmissionInput(raw, { today: TODAY });
    expect(result.ok && result.value.event.rule.rrule).toBeNull();
  });

  it("needs the Submitter name and a valid email", () => {
    expect(errorsOf({ submitterName: "" }).submitterName).toBeDefined();
    expect(errorsOf({ submitterEmail: "not an email" }).submitterEmail).toBeDefined();
    expect(errorsOf({ submitterEmail: "a@b.org, c@d.org" }).submitterEmail).toBeDefined();
  });

  it("refuses text over the public limits", () => {
    expect(errorsOf({ description: "x".repeat(5001) }).description).toMatch(/5000/);
    expect(errorsOf({ location: "x".repeat(201) }).location).toMatch(/200/);
    expect(errorsOf({ ctaLabel: "x".repeat(41), ctaUrl: "https://example.org" }).cta).toMatch(/40/);
    expect(errorsOf({ submitterName: "x".repeat(101) }).submitterName).toMatch(/100/);
    expect(errorsOf({ submitterEmail: `${"x".repeat(250)}@b.org` }).submitterEmail).toBeDefined();
  });

  it("treats a non-object input as empty", () => {
    expect(parseSubmissionInput("junk", { today: TODAY }).ok).toBe(false);
  });
});

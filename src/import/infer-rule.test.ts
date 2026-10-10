import { describe, expect, it } from "vitest";
import { addDays, type Timing } from "@/engine";
import { exactMatch, inferRule, openEndedAfter } from "./infer-rule";

/** `count` dates from `first`, `step` days apart. */
function every(first: string, count: number, step = 7): string[] {
  return Array.from({ length: count }, (_, i) => addDays(first, i * step));
}

const at6pm = (dates: string[]) => dates.map((date) => `${date}T18:00`);

function slot(first: string): Timing {
  return { kind: "timed", start: `${first}T18:00`, end: `${first}T21:00` };
}

const IMPORT_DATE = "2026-10-09";

describe("rule inference", () => {
  it("weekly dates with no gaps give a weekly rule with no EXDATEs", () => {
    const starts = at6pm(every("2026-09-08", 8));
    expect(inferRule({ timing: slot("2026-09-08"), originalStarts: starts, importDate: IMPORT_DATE }))
      .toEqual({
        ok: true,
        rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959",
        exdates: [],
        until: "2026-10-27",
      });
  });

  it("weekly dates with a missing week give one EXDATE", () => {
    const starts = at6pm(every("2026-09-08", 8).filter((date) => date !== "2026-09-29"));
    const result = inferRule({
      timing: slot("2026-09-08"),
      originalStarts: starts,
      importDate: IMPORT_DATE,
    });
    expect(result).toMatchObject({
      ok: true,
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959",
      exdates: ["2026-09-29T18:00"],
    });
  });

  it("dates two weeks apart give INTERVAL=2", () => {
    const result = inferRule({
      timing: { kind: "allDay", startDate: "2026-09-10", endDate: "2026-09-10" },
      originalStarts: ["2026-09-10", "2026-09-24"],
      importDate: IMPORT_DATE,
    });
    expect(result).toMatchObject({
      ok: true,
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;UNTIL=20260924T235959",
      exdates: [],
    });
  });

  it("dates only in the summer months give BYMONTH", () => {
    const thursdays = every("2026-04-02", 100).filter((date) => {
      const month = Number(date.slice(5, 7));
      return month >= 4 && month <= 10;
    });
    const starts = at6pm(thursdays.filter((date) => date <= "2027-10-28"));
    const result = inferRule({
      timing: slot("2026-04-02"),
      originalStarts: starts,
      importDate: IMPORT_DATE,
    });
    expect(result).toMatchObject({
      ok: true,
      rrule: "FREQ=WEEKLY;BYDAY=TH;BYMONTH=4,5,6,7,8,9,10",
      exdates: [],
      until: null,
    });
  });

  it("2nd and 4th Tuesdays give a monthly BYDAY=2TU,4TU rule", () => {
    const dates = ["2026-09-22", "2026-10-13", "2026-10-27", "2026-11-10", "2026-11-24"];
    const result = inferRule({
      timing: slot("2026-09-22"),
      originalStarts: at6pm(dates),
      importDate: IMPORT_DATE,
    });
    expect(result).toMatchObject({
      ok: true,
      rrule: "FREQ=MONTHLY;BYDAY=2TU,4TU;UNTIL=20261124T235959",
      exdates: [],
    });
  });

  it("4th Tuesdays, including months with five Tuesdays, give BYDAY=4TU", () => {
    // September 2026 and December 2026 have five Tuesdays.
    const dates = ["2026-09-22", "2026-10-27", "2026-11-24", "2026-12-22", "2027-01-26"];
    const result = inferRule({
      timing: slot("2026-09-22"),
      originalStarts: at6pm(dates),
      importDate: IMPORT_DATE,
    });
    expect(result).toMatchObject({ ok: true, rrule: "FREQ=MONTHLY;BYDAY=4TU;UNTIL=20270126T235959" });
  });

  it("last Tuesday of each month over 12 months gives BYDAY=-1TU with no EXDATEs", () => {
    // Positions 4 and 5 mixed: 2026-09-29 is the 5th Tuesday, 2026-10-27 is the 4th.
    const dates = [
      "2026-09-29", "2026-10-27", "2026-11-24", "2026-12-29", "2027-01-26", "2027-02-23",
      "2027-03-30", "2027-04-27", "2027-05-25", "2027-06-29", "2027-07-27", "2027-08-31",
    ];
    const result = inferRule({
      timing: slot("2026-09-29"),
      originalStarts: at6pm(dates),
      importDate: IMPORT_DATE,
    });
    expect(result).toEqual({
      ok: true,
      rrule: "FREQ=MONTHLY;BYDAY=-1TU;UNTIL=20270831T235959",
      exdates: [],
      until: "2027-08-31",
    });
  });

  it("same date each year gives a yearly rule", () => {
    const dates = ["2027-01-01", "2028-01-01", "2029-01-01"];
    const result = inferRule({
      timing: slot("2027-01-01"),
      originalStarts: at6pm(dates),
      importDate: IMPORT_DATE,
    });
    expect(result).toMatchObject({
      ok: true,
      rrule: "FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1",
      exdates: [],
      until: null,
    });
  });

  it("irregular dates are flagged", () => {
    const dates = ["2026-09-01", "2026-09-03", "2026-09-12", "2026-10-02", "2026-11-20"];
    const result = inferRule({
      timing: slot("2026-09-01"),
      originalStarts: at6pm(dates),
      importDate: IMPORT_DATE,
    });
    expect(result.ok).toBe(false);
  });

  it("too many EXDATEs are flagged", () => {
    // Tuesdays with many missing weeks. Weekly needs 13 EXDATEs for 5 dates.
    const dates = ["2026-09-01", "2026-09-08", "2026-10-06", "2026-11-17", "2026-12-29"];
    const result = inferRule({
      timing: slot("2026-09-01"),
      originalStarts: at6pm(dates),
      importDate: IMPORT_DATE,
    });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.reason).toMatch(/EXDATE/);
  });
});

/** Tuesdays at 6 pm from 2026-09-08 up to and including `last`. */
function tuesdaysUntil(last: string): string[] {
  const dates = every("2026-09-08", 200).filter((date) => date <= last);
  expect(dates.at(-1)).toBe(last);
  return at6pm(dates);
}

const weeklyFrom = (importDate: string, last: string) =>
  inferRule({ timing: slot("2026-09-08"), originalStarts: tuesdaysUntil(last), importDate });

describe("rule inference — open-ended Series by import date", () => {
  it("Series that ends 13 months after the import date is open-ended", () => {
    expect(weeklyFrom("2026-10-09", "2027-11-09")).toEqual({
      ok: true,
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      exdates: [],
      until: null,
    });
  });

  it("Series that ends 11 months after the import date keeps its UNTIL", () => {
    expect(weeklyFrom("2026-10-09", "2027-09-07")).toEqual({
      ok: true,
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20270907T235959",
      exdates: [],
      until: "2027-09-07",
    });
  });

  it("Series that ends on the same date one year after the import date keeps its UNTIL", () => {
    expect(weeklyFrom("2026-10-12", "2027-10-12")).toMatchObject({ ok: true, until: "2027-10-12" });
  });

  it("Series that ends one day after the same date one year later is open-ended", () => {
    expect(weeklyFrom("2026-10-11", "2027-10-12")).toMatchObject({ ok: true, until: null });
  });

  it("one year after 29 February is 28 February", () => {
    expect(openEndedAfter("2028-02-29")).toBe("2029-02-28");
    expect(openEndedAfter("2026-10-09")).toBe("2027-10-09");
  });

  it("monthly Series far after the import date is open-ended", () => {
    const dates = ["2026-09-22", "2026-10-27", "2026-11-24", "2026-12-22", "2027-01-26"];
    const open = inferRule({
      timing: slot("2026-09-22"),
      originalStarts: at6pm(dates),
      importDate: "2025-12-01",
    });
    expect(open).toMatchObject({ ok: true, rrule: "FREQ=MONTHLY;BYDAY=4TU", until: null });
  });

  it("exact-match check is bounded by the Series' own last Occurrence", () => {
    const timing = slot("2026-09-08");
    const starts = at6pm(every("2026-09-08", 8));
    // The open-ended rule goes on after 2026-10-27, but the check stops at the last feed date.
    expect(exactMatch(timing, "FREQ=WEEKLY;BYDAY=TU", [], starts)).toBe(true);
    // A rule that makes a date the feed does not have, before the last date, does not match.
    expect(exactMatch(timing, "FREQ=WEEKLY;BYDAY=TU,WE", [], starts)).toBe(false);
  });

  it("exact-match check rejects a rule that expands to one extra date", () => {
    const timing = slot("2026-09-08");
    const starts = at6pm(every("2026-09-08", 8).filter((date) => date !== "2026-09-29"));
    const rule = "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959";
    expect(exactMatch(timing, rule, [], starts)).toBe(false);
    expect(exactMatch(timing, rule, ["2026-09-29T18:00"], starts)).toBe(true);
  });
});

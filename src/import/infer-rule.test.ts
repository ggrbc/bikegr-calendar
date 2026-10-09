import { describe, expect, it } from "vitest";
import type { Timing } from "@/engine/types";
import { addDays } from "@/engine/wall-clock";
import { exactMatch, inferRule } from "./infer-rule";

/** `count` dates from `first`, `step` days apart. */
function every(first: string, count: number, step = 7): string[] {
  return Array.from({ length: count }, (_, i) => addDays(first, i * step));
}

const at6pm = (dates: string[]) => dates.map((date) => `${date}T18:00`);

function slot(first: string): Timing {
  return { kind: "timed", start: `${first}T18:00`, end: `${first}T21:00` };
}

const FAR_HORIZON = "2029-07-04";

describe("rule inference", () => {
  it("weekly dates with no gaps give a weekly rule with no EXDATEs", () => {
    const starts = at6pm(every("2026-09-08", 8));
    expect(inferRule({ timing: slot("2026-09-08"), originalStarts: starts, feedHorizon: FAR_HORIZON }))
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
      feedHorizon: FAR_HORIZON,
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
      feedHorizon: FAR_HORIZON,
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
      feedHorizon: "2027-10-28",
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
      feedHorizon: FAR_HORIZON,
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
      feedHorizon: FAR_HORIZON,
    });
    expect(result).toMatchObject({ ok: true, rrule: "FREQ=MONTHLY;BYDAY=4TU;UNTIL=20270126T235959" });
  });

  it("same date each year gives a yearly rule", () => {
    const dates = ["2027-01-01", "2028-01-01", "2029-01-01"];
    const result = inferRule({
      timing: slot("2027-01-01"),
      originalStarts: at6pm(dates),
      feedHorizon: FAR_HORIZON,
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
      feedHorizon: FAR_HORIZON,
    });
    expect(result.ok).toBe(false);
  });

  it("too many EXDATEs are flagged", () => {
    // Tuesdays with many missing weeks. Weekly needs 13 EXDATEs for 5 dates.
    const dates = ["2026-09-01", "2026-09-08", "2026-10-06", "2026-11-17", "2026-12-29"];
    const result = inferRule({
      timing: slot("2026-09-01"),
      originalStarts: at6pm(dates),
      feedHorizon: FAR_HORIZON,
    });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.reason).toMatch(/EXDATE/);
  });
});

describe("rule inference — feed horizon", () => {
  it("open-ended weekly Series at the horizon has no UNTIL", () => {
    // The last Tuesday is 2026-10-27; the next one (11-03) is after the horizon.
    const starts = at6pm(every("2026-09-08", 8));
    const result = inferRule({
      timing: slot("2026-09-08"),
      originalStarts: starts,
      feedHorizon: "2026-11-02",
    });
    expect(result).toEqual({ ok: true, rrule: "FREQ=WEEKLY;BYDAY=TU", exdates: [], until: null });
  });

  it("weekly Series is open-ended when its next date is one day after the horizon", () => {
    const starts = at6pm(every("2026-09-08", 8));
    const result = inferRule({
      timing: slot("2026-09-08"),
      originalStarts: starts,
      feedHorizon: "2026-11-02",
    });
    expect(result.ok && result.until).toBeNull();
    const onTheHorizon = inferRule({
      timing: slot("2026-09-08"),
      originalStarts: starts,
      feedHorizon: "2026-11-03",
    });
    expect(onTheHorizon.ok && onTheHorizon.until).toBe("2026-10-27");
  });

  it("Series that ends before the horizon keeps its UNTIL", () => {
    const starts = at6pm(every("2026-09-08", 8));
    const result = inferRule({
      timing: slot("2026-09-08"),
      originalStarts: starts,
      feedHorizon: "2027-06-01",
    });
    expect(result).toMatchObject({
      ok: true,
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959",
      until: "2026-10-27",
    });
  });

  it("monthly Series is open-ended when its next nth weekday is after the horizon", () => {
    // Next 4th Tuesday after 2027-01-26 is 2027-02-23.
    const dates = ["2026-09-22", "2026-10-27", "2026-11-24", "2026-12-22", "2027-01-26"];
    const open = inferRule({
      timing: slot("2026-09-22"),
      originalStarts: at6pm(dates),
      feedHorizon: "2027-02-22",
    });
    expect(open).toMatchObject({ ok: true, rrule: "FREQ=MONTHLY;BYDAY=4TU", until: null });
  });

  it("exact-match check is bounded by the horizon", () => {
    const timing = slot("2026-09-08");
    const starts = at6pm(every("2026-09-08", 8));
    // An open-ended rule matches the feed when the check stops at the horizon ...
    expect(exactMatch(timing, "FREQ=WEEKLY;BYDAY=TU", [], starts, "2026-11-02")).toBe(true);
    // ... and does not match if the horizon is later, because the feed shows no 2026-11-03.
    expect(exactMatch(timing, "FREQ=WEEKLY;BYDAY=TU", [], starts, "2026-11-03")).toBe(false);
  });

  it("exact-match check rejects a rule that expands to one extra date", () => {
    const timing = slot("2026-09-08");
    const starts = at6pm(every("2026-09-08", 8).filter((date) => date !== "2026-09-29"));
    const rule = "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959";
    expect(exactMatch(timing, rule, [], starts, FAR_HORIZON)).toBe(false);
    expect(exactMatch(timing, rule, ["2026-09-29T18:00"], starts, FAR_HORIZON)).toBe(true);
  });
});

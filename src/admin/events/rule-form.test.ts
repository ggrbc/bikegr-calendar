import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importTockify } from "@/import/import-tockify";
import { describeRrule, describeRule } from "./describe-rule";
import {
  checkRuleForm,
  type RuleForm,
  ruleFormToRrule,
  rruleToRuleForm,
  sameRuleParts,
} from "./rule-form";

const never = { kind: "never" } as const;

function weekly(patch: Partial<Extract<RuleForm, { repeat: "weekly" }>> = {}): RuleForm {
  return { repeat: "weekly", interval: 1, days: ["TU"], months: [], end: never, ...patch };
}

describe("rule form to RRULE", () => {
  it("weekly on Tuesday writes FREQ=WEEKLY;BYDAY=TU", () => {
    expect(ruleFormToRrule(weekly())).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("every 2 weeks on Thursday and Tuesday writes INTERVAL=2 and days Monday first", () => {
    expect(ruleFormToRrule(weekly({ interval: 2, days: ["TH", "TU"] }))).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH",
    );
  });

  it("weekly in April to October writes BYMONTH; all 12 months write no BYMONTH", () => {
    expect(ruleFormToRrule(weekly({ months: [10, 4, 5, 6, 7, 8, 9] }))).toBe(
      "FREQ=WEEKLY;BYDAY=TU;BYMONTH=4,5,6,7,8,9,10",
    );
    expect(ruleFormToRrule(weekly({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }))).toBe(
      "FREQ=WEEKLY;BYDAY=TU",
    );
  });

  it("monthly on the 2nd and 4th Tuesday writes BYDAY=2TU,4TU", () => {
    const form: RuleForm = { repeat: "monthlyWeekday", positions: [4, 2], weekday: "TU", end: never };
    expect(ruleFormToRrule(form)).toBe("FREQ=MONTHLY;BYDAY=2TU,4TU");
  });

  it("monthly on the last Tuesday writes BYDAY=-1TU, after the other positions", () => {
    expect(
      ruleFormToRrule({ repeat: "monthlyWeekday", positions: [-1], weekday: "TU", end: never }),
    ).toBe("FREQ=MONTHLY;BYDAY=-1TU");
    expect(
      ruleFormToRrule({ repeat: "monthlyWeekday", positions: [-1, 1], weekday: "FR", end: never }),
    ).toBe("FREQ=MONTHLY;BYDAY=1FR,-1FR");
  });

  it("monthly on day 15 and yearly on June 14 write their shapes", () => {
    expect(ruleFormToRrule({ repeat: "monthlyDay", day: 15, end: never })).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=15",
    );
    expect(ruleFormToRrule({ repeat: "yearly", month: 6, day: 14, end: never })).toBe(
      "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=14",
    );
  });

  it("every full moon writes FREQ=X-FULLMOON and reads back", () => {
    const form: RuleForm = { repeat: "fullMoon", end: { kind: "count", count: 6 } };
    expect(ruleFormToRrule(form)).toBe("FREQ=X-FULLMOON;COUNT=6");
    expect(rruleToRuleForm("FREQ=X-FULLMOON;COUNT=6")).toEqual(form);
    expect(rruleToRuleForm("FREQ=X-FULLMOON;BYDAY=TU")).toBeNull();
    expect(describeRrule("FREQ=X-FULLMOON;UNTIL=20270430T235959")).toBe("Every full moon, until April 30, 2027");
  });

  it("a full-moon repeat has at most 200 dates", () => {
    expect(checkRuleForm({ repeat: "fullMoon", end: { kind: "count", count: 200 } }, "2026-10-26")).toEqual({});
    expect(checkRuleForm({ repeat: "fullMoon", end: { kind: "count", count: 201 } }, "2026-10-26").end).toMatch(/200/);
  });

  it("until a date writes UNTIL=<date>T235959; count writes COUNT=n", () => {
    expect(ruleFormToRrule(weekly({ end: { kind: "until", date: "2026-10-27" } }))).toBe(
      "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959",
    );
    expect(ruleFormToRrule(weekly({ end: { kind: "count", count: 8 } }))).toBe(
      "FREQ=WEEKLY;BYDAY=TU;COUNT=8",
    );
  });
});

describe("RRULE to rule form", () => {
  it("every rule in the import fixture parses to a form and writes back the same parts", () => {
    const feed = new Uint8Array(
      readFileSync(new URL("../../import/__fixtures__/tockify-bikegr-2026-10-09.ics", import.meta.url)),
    );
    const rules = importTockify(feed, { importDate: "2026-10-09" })
      .events.map((e) => e.rule.rrule)
      .filter((r): r is string => r !== null);
    expect(rules.length).toBeGreaterThan(10);
    for (const rule of rules) {
      const form = rruleToRuleForm(rule);
      expect(form, rule).not.toBeNull();
      expect(sameRuleParts(ruleFormToRrule(form!), rule), rule).toBe(true);
    }
  });

  it("days in date order (TH,TU) still fit; the written text is Monday first", () => {
    const form = rruleToRuleForm("FREQ=WEEKLY;BYDAY=TH,TU");
    expect(form).toEqual(weekly({ days: ["TU", "TH"] }));
  });

  it("parses the end: until a date and count", () => {
    expect(rruleToRuleForm("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T235959")).toEqual(
      weekly({ end: { kind: "until", date: "2026-10-27" } }),
    );
    expect(rruleToRuleForm("FREQ=MONTHLY;BYDAY=-1TU;COUNT=3")).toEqual({
      repeat: "monthlyWeekday",
      positions: [-1],
      weekday: "TU",
      end: { kind: "count", count: 3 },
    });
  });

  it("a rule with BYSETPOS, DAILY, WKST, or a Z UNTIL does not fit the form", () => {
    for (const rule of [
      "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2",
      "FREQ=DAILY",
      "FREQ=WEEKLY;BYDAY=TU;WKST=SU",
      "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T120000Z",
      "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027",
      "FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU",
      "FREQ=MONTHLY;BYDAY=2TU,4WE",
      "FREQ=MONTHLY;BYDAY=5TU",
      "FREQ=YEARLY",
      "FREQ=WEEKLY",
      "not a rule",
    ]) {
      expect(rruleToRuleForm(rule), rule).toBeNull();
    }
  });
});

describe("rule form checks", () => {
  it("weekly with no day, count 0, and until before the start are refused with field messages", () => {
    expect(checkRuleForm(weekly({ days: [] }), "2026-10-06")).toEqual({
      days: "Pick one or more days.",
    });
    expect(checkRuleForm(weekly({ end: { kind: "count", count: 0 } }), "2026-10-06")).toEqual({
      end: "The number of dates must be 1 or more.",
    });
    expect(
      checkRuleForm(weekly({ end: { kind: "until", date: "2026-10-01" } }), "2026-10-06"),
    ).toEqual({ end: "The end date must be on or after the start date." });
  });

  it("interval, month day, and yearly date must be in range", () => {
    expect(checkRuleForm(weekly({ interval: 0 }), "2026-10-06")).toEqual({
      interval: "Every 1 to 52 weeks.",
    });
    expect(checkRuleForm({ repeat: "monthlyDay", day: 32, end: never }, "2026-10-06")).toEqual({
      day: "Pick a day from 1 to 31.",
    });
    expect(checkRuleForm({ repeat: "yearly", month: 2, day: 30, end: never }, "2026-10-06")).toEqual({
      day: "This date does not exist.",
    });
    expect(checkRuleForm({ repeat: "yearly", month: 2, day: 29, end: never }, "2026-10-06")).toEqual(
      {},
    );
  });

  it("monthly on a weekday needs one or more positions", () => {
    expect(
      checkRuleForm({ repeat: "monthlyWeekday", positions: [], weekday: "TU", end: never }, "2026-10-06"),
    ).toEqual({ positions: "Pick one or more weeks of the month." });
  });
});

describe("rule in words", () => {
  it("every 2 weeks on Tuesday and Thursday, April to October, until a date", () => {
    expect(
      describeRule(
        weekly({
          interval: 2,
          days: ["TH", "TU"],
          months: [4, 5, 6, 7, 8, 9, 10],
          end: { kind: "until", date: "2028-10-27" },
        }),
      ),
    ).toBe("Every 2 weeks on Tuesday and Thursday, April to October, until October 27, 2028");
  });

  it("other shapes", () => {
    expect(describeRule(weekly())).toBe("Every week on Tuesday");
    expect(describeRule(weekly({ days: ["MO", "WE", "FR"], months: [1, 3] }))).toBe(
      "Every week on Monday, Wednesday, and Friday, in January and March",
    );
    expect(
      describeRule({ repeat: "monthlyWeekday", positions: [2, 4], weekday: "TU", end: never }),
    ).toBe("Every month on the 2nd and 4th Tuesday");
    expect(
      describeRule({
        repeat: "monthlyWeekday",
        positions: [-1],
        weekday: "TU",
        end: { kind: "count", count: 3 },
      }),
    ).toBe("Every month on the last Tuesday, 3 times");
    expect(describeRule({ repeat: "monthlyDay", day: 15, end: never })).toBe(
      "Every month on day 15",
    );
    expect(describeRule({ repeat: "yearly", month: 7, day: 4, end: never })).toBe(
      "Every year on July 4",
    );
  });

  it("a rule that does not fit the form shows its text", () => {
    expect(describeRrule("FREQ=DAILY")).toBe("Custom rule: FREQ=DAILY");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=WE")).toBe("Every week on Wednesday");
  });
});

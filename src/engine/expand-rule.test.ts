import { describe, expect, it } from "vitest";
import {
  buildRule,
  InvalidRuleError,
  isRuleStart,
  ruleStartsBetween,
} from "./expand-rule";
import { allDay, timed } from "./test-helpers";

const tuesday6pm = timed("2026-09-08T18:00", "2026-09-08T21:00");

describe("expand-rule", () => {
  it("lists rule starts between two values, both included", () => {
    expect(
      ruleStartsBetween(tuesday6pm, "FREQ=WEEKLY;BYDAY=TU", "2026-09-15T18:00", "2026-09-29T18:00"),
    ).toEqual(["2026-09-15T18:00", "2026-09-22T18:00", "2026-09-29T18:00"]);
  });

  it("lists all-day rule starts as dates", () => {
    expect(
      ruleStartsBetween(allDay("2026-09-10"), "FREQ=WEEKLY;INTERVAL=2", "2026-09-01", "2026-09-30"),
    ).toEqual(["2026-09-10", "2026-09-24"]);
  });

  it("tells if a value is a rule start", () => {
    expect(isRuleStart(tuesday6pm, "FREQ=WEEKLY;BYDAY=TU", "2026-10-06T18:00")).toBe(true);
    expect(isRuleStart(tuesday6pm, "FREQ=WEEKLY;BYDAY=TU", "2026-10-07T18:00")).toBe(false);
    expect(isRuleStart(tuesday6pm, "FREQ=WEEKLY;BYDAY=TU", "2026-10-06T18:30")).toBe(false);
  });

  it.each([
    ["a trailing semicolon", "FREQ=WEEKLY;BYDAY=TU;"],
    ["BYDAY ordinals -1 and 53", "FREQ=YEARLY;BYDAY=-1TU,53TU"],
    ["BYMONTHDAY -31 and 31", "FREQ=MONTHLY;BYMONTHDAY=-31,31"],
    ["BYMONTH 1 and 12", "FREQ=YEARLY;BYMONTH=1,12"],
  ])("accepts %s", (_name, rule) => {
    expect(() => ruleStartsBetween(tuesday6pm, rule, "2026-09-01", "2026-10-01")).not.toThrow();
  });

  it("a trailing semicolon does not change the rule", () => {
    expect(
      ruleStartsBetween(tuesday6pm, "FREQ=WEEKLY;BYDAY=TU;", "2026-09-01", "2026-09-30"),
    ).toEqual(["2026-09-08T18:00", "2026-09-15T18:00", "2026-09-22T18:00", "2026-09-29T18:00"]);
  });

  it("rrule keeps no result cache, so memory does not grow with each window", () => {
    const rule = buildRule(tuesday6pm, "FREQ=WEEKLY;BYDAY=TU");
    rule.between(new Date("2026-09-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"), true);
    rule.after(new Date("2026-10-01T00:00:00Z"));
    expect((rule as unknown as { _cache: unknown })._cache).toBeNull();
  });

  it.each([
    ["an unknown FREQ", "FREQ=FORTNIGHTLY"],
    ["no FREQ", "BYDAY=TU"],
    ["an unknown weekday", "FREQ=WEEKLY;BYDAY=XX"],
    ["an unknown part", "FREQ=WEEKLY;NOPE=1"],
    ["both UNTIL and COUNT", "FREQ=WEEKLY;COUNT=3;UNTIL=20261020"],
    ["a bad UNTIL", "FREQ=WEEKLY;UNTIL=2026-10-20"],
    ["an RRULE: prefix", "RRULE:FREQ=WEEKLY"],
    ["an empty rule", ""],
    ["BYMONTH 0", "FREQ=YEARLY;BYMONTH=0"],
    ["BYMONTH 13", "FREQ=YEARLY;BYMONTH=4,13"],
    ["BYMONTHDAY 0", "FREQ=MONTHLY;BYMONTHDAY=0"],
    ["BYMONTHDAY 32", "FREQ=MONTHLY;BYMONTHDAY=32"],
    ["BYMONTHDAY -32", "FREQ=MONTHLY;BYMONTHDAY=-32"],
    ["a BYDAY ordinal of 0", "FREQ=MONTHLY;BYDAY=0TU"],
    ["a BYDAY ordinal of 54", "FREQ=YEARLY;BYDAY=54TU"],
    ["a BYDAY ordinal with WEEKLY", "FREQ=WEEKLY;BYDAY=2TU"],
    ["BYYEARDAY 367", "FREQ=YEARLY;BYYEARDAY=367"],
    ["BYWEEKNO 54", "FREQ=YEARLY;BYWEEKNO=54"],
    ["BYSETPOS 0", "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=0"],
    ["two semicolons", "FREQ=WEEKLY;;BYDAY=TU"],
  ])("rejects %s", (_name, rule) => {
    expect(() => ruleStartsBetween(tuesday6pm, rule, "2026-09-01", "2026-10-01")).toThrow(
      InvalidRuleError,
    );
  });
});

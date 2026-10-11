import { describe, expect, it } from "vitest";
import {
  defaultRuleForm,
  eventValuesFromRow,
  type FormRow,
  previewRuleInput,
  ruleChoiceFromRrule,
  splitValuesFromRow,
} from "./form-values";

const row: FormRow = {
  calendar: "rides",
  title: "Tuesday Ride",
  description: "",
  preview: null,
  location: null,
  ctaLabel: null,
  ctaUrl: null,
  imageUrl: null,
  allDay: false,
  startLocal: "2026-10-06T18:00",
  endLocal: "2026-10-06T20:00",
  startDate: null,
  endDate: null,
  rrule: "FREQ=WEEKLY;BYDAY=TU",
  exdates: ["2026-10-20T18:00"],
  scheduleStatus: "scheduled",
  scheduleNote: null,
  occurrenceDetails: null,
};

describe("form values", () => {
  it("a stored Series becomes form values with the rule form and skipped dates as dates", () => {
    expect(eventValuesFromRow(row, ["t1"])).toMatchObject({
      start: "2026-10-06T18:00",
      location: "",
      tagIds: ["t1"],
      rule: { mode: "form", form: { repeat: "weekly", days: ["TU"] } },
      exdates: ["2026-10-20"],
    });
  });

  it("a rule that does not fit becomes Advanced text", () => {
    expect(ruleChoiceFromRrule("FREQ=DAILY")).toEqual({ mode: "advanced", text: "FREQ=DAILY" });
    expect(ruleChoiceFromRrule(null)).toEqual({ mode: "none" });
  });

  it("split defaults: today, the same repeat, and the Series' time of day", () => {
    expect(splitValuesFromRow(row, [], "2026-10-10")).toMatchObject({
      splitDate: "2026-10-10",
      mode: "change",
      startTime: "18:00",
      endTime: "20:00",
      rule: { mode: "same" },
    });
  });

  it("the default repeat is weekly on the start date's weekday", () => {
    expect(defaultRuleForm("2026-10-08T18:00")).toMatchObject({ repeat: "weekly", days: ["TH"] });
    expect(defaultRuleForm("2026-10-11")).toMatchObject({ days: ["SU"] });
  });

  it("the preview input needs a complete time slot and a complete repeat", () => {
    const values = eventValuesFromRow(row, []);
    expect(previewRuleInput({ ...values, end: "" })).toEqual({
      ok: false,
      message: "Enter a start and an end first.",
    });
    const result = previewRuleInput(values);
    expect(result.ok && result.rule.exdates).toEqual(["2026-10-20T18:00"]);
  });
});

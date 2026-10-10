import { describe, expect, it } from "vitest";
import { HONEYPOT_FIELD, HONEYPOT_LABEL } from "./spam-rules";

/** Words that browser autofill and password managers match in a field's name, id, or label. */
const AUTOFILL_WORDS =
  /name|mail|phone|tel|address|street|city|zip|postal|company|organi[sz]ation|url|web|site|country|card|birth|user|login|pass/i;

describe("honeypot", () => {
  it("has a name that autofill does not know, so a real Submitter's browser leaves it empty", () => {
    expect(HONEYPOT_FIELD).toBe("bgr_hp_field");
    expect(HONEYPOT_FIELD).not.toMatch(AUTOFILL_WORDS);
  });

  it("has a label with no autofill word", () => {
    expect(HONEYPOT_LABEL).not.toMatch(AUTOFILL_WORDS);
  });
});

import { describe, expect, it } from "vitest";
import { isEventImageUrlForHost } from "@/admin/images/image-url";
import {
  type EventFormValues,
  type ParseContext,
  parseEventInput,
  parseOverrideInput,
  parseSeriesContentInput,
  parseSplitInput,
} from "./event-input";

/** A fixed Blob store host for the tests. */
const STORE_HOST = "abc123.public.blob.vercel-storage.com";
const UPLOADED = `https://${STORE_HOST}/events/${"a".repeat(64)}.webp`;

const editor: ParseContext = {
  isAdmin: false,
  storedImageUrl: null,
  isImageUrl: (url) => isEventImageUrlForHost(url, STORE_HOST),
};
const admin: ParseContext = { ...editor, isAdmin: true };
const TAG = "6f1c2c6e-1d1b-4c55-9a43-2b8a3f0c9e11";

function values(patch: Partial<EventFormValues> = {}): EventFormValues {
  return {
    calendar: "rides",
    title: "Tuesday Ride",
    description: "Meet at the shop.",
    preview: "",
    location: "Shop",
    tagIds: [TAG],
    ctaLabel: "",
    ctaUrl: "",
    imageUrl: "",
    allDay: false,
    start: "2026-10-06T18:00",
    end: "2026-10-06T20:00",
    rule: { mode: "none" },
    exdates: [],
    scheduleStatus: "scheduled",
    scheduleNote: "",
    occurrenceDetails: "",
    ...patch,
  };
}

const errorsOf = (result: { ok: boolean; errors?: object }) => (result.ok ? {} : result.errors);

describe("Event input", () => {
  it("a good one-time Event parses to a draft", () => {
    const result = parseEventInput(values(), editor);
    expect(result).toEqual({
      ok: true,
      value: {
        calendar: "rides",
        title: "Tuesday Ride",
        description: "Meet at the shop.",
        preview: null,
        location: "Shop",
        tagIds: [TAG],
        cta: null,
        imageUrl: null,
        rule: {
          timing: { kind: "timed", start: "2026-10-06T18:00", end: "2026-10-06T20:00" },
          rrule: null,
          exdates: [],
          scheduleStatus: "scheduled",
          scheduleNote: null,
        },
      },
    });
  });

  it("title and a valid Calendar are required", () => {
    expect(errorsOf(parseEventInput(values({ title: " ", calendar: "other" }), editor))).toMatchObject({
      title: "Give the Event a title.",
      calendar: "Pick a Calendar.",
    });
  });

  it("a timed end before its start and an all-day end date before its start date are refused", () => {
    expect(errorsOf(parseEventInput(values({ end: "2026-10-06T17:00" }), editor))).toEqual({
      end: "The end is before the start.",
    });
    expect(
      errorsOf(parseEventInput(values({ allDay: true, start: "2026-10-06", end: "2026-10-05" }), editor)),
    ).toEqual({ end: "The end date is before the start date." });
  });

  it("the CTA needs both a label and an http(s) URL", () => {
    expect(errorsOf(parseEventInput(values({ ctaLabel: "Register" }), editor))).toEqual({
      cta: "Give both a button label and a URL, or neither.",
    });
    for (const ctaUrl of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "example.org"]) {
      expect(errorsOf(parseEventInput(values({ ctaLabel: "Register", ctaUrl }), editor)), ctaUrl).toEqual({
        cta: "Use a web address that starts with http:// or https://.",
      });
    }
    const ok = parseEventInput(values({ ctaLabel: "Register", ctaUrl: "https://example.org/r" }), editor);
    expect(ok.ok && ok.value.cta).toEqual({ label: "Register", url: "https://example.org/r" });
  });

  it("the image URL is accepted when the upload made it, when it is the stored URL, or when empty", () => {
    expect(parseEventInput(values({ imageUrl: UPLOADED }), editor).ok).toBe(true);
    expect(
      parseEventInput(values({ imageUrl: "https://cdn.tockify/a.jpg" }), {
        ...editor,
        storedImageUrl: "https://cdn.tockify/a.jpg",
      }).ok,
    ).toBe(true);
    for (const bad of [
      "https://evil.example/a.jpg",
      `https://other.public.blob.vercel-storage.com/events/${"a".repeat(64)}.webp`,
      `${UPLOADED}?x=1`,
      UPLOADED.replace("https:", "http:"),
    ]) {
      expect(errorsOf(parseEventInput(values({ imageUrl: bad }), editor)), bad).toEqual({
        imageUrl: "This image URL is not allowed. Upload the image again.",
      });
    }
  });

  it("Advanced rule text from an Editor is refused; an Admin's is checked by the engine", () => {
    const advanced = values({ rule: { mode: "advanced", text: "FREQ=WEEKLY;BYDAY=TU" } });
    expect(errorsOf(parseEventInput(advanced, editor))).toEqual({
      rule: "Only an Admin can enter RRULE text.",
    });
    expect(parseEventInput(advanced, admin).ok).toBe(true);
    const bad = values({ rule: { mode: "advanced", text: "FREQ=SOMETIMES" } });
    expect(errorsOf(parseEventInput(bad, admin))).toEqual({
      rule: 'Invalid RRULE "FREQ=SOMETIMES": bad value for FREQ',
    });
  });

  it("a rule with no Occurrence is refused", () => {
    const result = parseEventInput(
      values({
        rule: {
          mode: "form",
          form: { repeat: "yearly", month: 2, day: 29, end: { kind: "until", date: "2027-12-31" } },
        },
      }),
      editor,
    );
    expect(errorsOf(result)).toEqual({ rule: "This repeat has no dates." });
  });

  it("the stored start of a Series is its first Occurrence; a Series is scheduled", () => {
    const result = parseEventInput(
      values({
        start: "2026-10-05T18:00",
        end: "2026-10-05T20:00",
        rule: {
          mode: "form",
          form: { repeat: "weekly", interval: 1, days: ["TU"], months: [], end: { kind: "never" } },
        },
        exdates: ["2026-10-20"],
        scheduleStatus: "cancelled",
        scheduleNote: "Not used",
      }),
      editor,
    );
    expect(result.ok && result.value.rule).toEqual({
      timing: { kind: "timed", start: "2026-10-06T18:00", end: "2026-10-06T20:00" },
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      exdates: ["2026-10-20T18:00"],
      scheduleStatus: "scheduled",
      scheduleNote: null,
    });
  });

  it("rule form messages map to their fields", () => {
    const result = parseEventInput(
      values({
        rule: {
          mode: "form",
          form: { repeat: "weekly", interval: 1, days: [], months: [], end: { kind: "count", count: 0 } },
        },
      }),
      editor,
    );
    expect(errorsOf(result)).toEqual({
      days: "Pick one or more days.",
      ruleEnd: "The number of dates must be 1 or more.",
    });
  });

  it("an input that is not an object gives field messages, not an exception", () => {
    expect(parseEventInput("nonsense", editor).ok).toBe(false);
    expect(parseEventInput({ ...values(), tagIds: ["x'; drop table"] }, editor).ok).toBe(false);
  });
});

describe("Series content, split, and Override input", () => {
  it("series content has skipped dates as dates", () => {
    const result = parseSeriesContentInput({ ...values(), exdates: ["2026-10-20", "2026-10-13"] }, editor);
    expect(result.ok && result.value.exdateDates).toEqual(["2026-10-13", "2026-10-20"]);
  });

  it("split input: a date, a new time, and the same repeat", () => {
    const result = parseSplitInput(
      { ...values(), splitDate: "2026-11-03", mode: "change", allDay: false, startTime: "18:30", endTime: "20:30", days: 1, rule: { mode: "same" } },
      editor,
    );
    expect(result.ok && [result.value.splitDate, result.value.time, result.value.rule]).toEqual([
      "2026-11-03",
      { kind: "timed", startTime: "18:30", endTime: "20:30" },
      { kind: "same" },
    ]);
  });

  it("split input needs a date and times", () => {
    const result = parseSplitInput(
      { ...values(), splitDate: "", mode: "change", allDay: false, startTime: "25:00", endTime: "", rule: { mode: "same" } },
      editor,
    );
    expect(errorsOf(result)).toEqual({
      splitDate: "Pick a date.",
      startTime: "Give a start time.",
      endTime: "Give an end time.",
    });
  });

  it("override input for a timed Series", () => {
    const result = parseOverrideInput(
      {
        originalStart: "2026-11-03T18:00",
        start: "2026-11-05T18:00",
        end: "2026-11-05T20:00",
        title: "Tuesday Ride on Thursday",
        location: "",
        scheduleStatus: "scheduled",
        scheduleNote: "Moved for the election",
      },
      false,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        originalStart: "2026-11-03T18:00",
        timing: { kind: "timed", start: "2026-11-05T18:00", end: "2026-11-05T20:00" },
        title: "Tuesday Ride on Thursday",
        location: null,
        scheduleStatus: "scheduled",
        scheduleNote: "Moved for the election",
        occurrenceDetails: null,
      },
    });
  });

  it("override input refuses a stored Schedule status that is not allowed (rescheduled is derived)", () => {
    const result = parseOverrideInput(
      { originalStart: "2026-11-03", start: "2026-11-03", end: "2026-11-03", title: "x", scheduleStatus: "rescheduled" },
      true,
    );
    expect(errorsOf(result)).toEqual({ scheduleStatus: "Pick a Schedule status." });
  });
});

describe("description input", () => {
  it("refuses Markdown that nests too deep to show", () => {
    expect(errorsOf(parseSeriesContentInput(values({ description: `${"- ".repeat(1875)}x` }), editor))).toEqual({
      description: "Use fewer lists or quotes inside each other.",
    });
    expect(parseSeriesContentInput(values({ description: "- a\n  - b" }), editor).ok).toBe(true);
  });
});

describe("Custom Preview input", () => {
  it("is trimmed, empty is null, and more than 300 characters is an error", () => {
    const ok = parseSeriesContentInput(values({ preview: "  Social pace, lights.  " }), editor);
    expect(ok.ok && ok.value.preview).toBe("Social pace, lights.");
    const empty = parseSeriesContentInput(values({ preview: "   " }), editor);
    expect(empty.ok && empty.value.preview).toBeNull();
    expect(errorsOf(parseSeriesContentInput(values({ preview: "x".repeat(301) }), editor))).toEqual({
      preview: "Use 300 characters or fewer.",
    });
    expect(parseSeriesContentInput(values({ preview: "é".repeat(300) }), editor).ok).toBe(true);
  });
});
